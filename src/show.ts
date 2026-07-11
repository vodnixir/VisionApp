/**
 * The "Show" channel: the host device presents the arena on a big screen.
 *
 * Two transports, one protocol:
 *  - Presentation API (Chrome on phone/laptop → Chromecast, Miracast TVs):
 *    the TV loads this same app with #show and talks over the presentation
 *    connection. No servers — the message channel is provided by the browser.
 *  - window.open fallback (desktop): the show opens as a second window to be
 *    dragged onto a TV/projector connected as an extended display.
 *
 * On top of the message channel the host streams the live arena picture
 * (canvas.captureStream + game sfx audio) via WebRTC. If no video makes it
 * through, the receiver still renders a scoreboard from tiny state messages —
 * the TV is never blank.
 *
 * Inside the Capacitor APK neither transport exists (WebView has no
 * Presentation API); there the host uses system screen mirroring instead and
 * the cast button hides itself.
 */
import type { HudState } from './cv/draw'
import { getTheme, type ThemeId } from './theme'

/* Minimal Presentation API typings — the WICG spec isn't in TS's lib.dom. */
interface PresentationConnectionEvent {
  connection: PresentationConnectionShape
}
interface PresentationConnectionShape {
  state: string
  send(data: string): void
  close(): void
  onconnect: (() => void) | null
  onmessage: ((e: MessageEvent) => void) | null
  onclose: (() => void) | null
}
interface PresentationConnectionListShape {
  connections: PresentationConnectionShape[]
  onconnectionavailable: ((e: PresentationConnectionEvent) => void) | null
}
interface PresentationReceiverShape {
  connectionList: Promise<PresentationConnectionListShape>
}
declare global {
  // eslint-disable-next-line no-var
  var PresentationRequest:
    | (new (urls: string[]) => { start(): Promise<PresentationConnectionShape> })
    | undefined
  interface Navigator {
    presentation?: { receiver?: PresentationReceiverShape }
  }
}

export type ShowPhase = 'idle' | 'calibration' | 'playing' | 'over'

export interface ShowState {
  hud: HudState
  names: [string, string]
  phase: ShowPhase
  /** Host's active theme — the TV mirrors it (stamped by sendState). */
  theme?: ThemeId
}

export type ShowMessage =
  | { t: 'hello' }
  | { t: 'state'; s: ShowState }
  | { t: 'offer'; sdp: string }
  | { t: 'answer'; sdp: string }
  | { t: 'ice'; c: RTCIceCandidateInit | null }
  | { t: 'bye' }

export type CastStatus = 'idle' | 'connecting' | 'live'

export const SHOW_HASH = '#show'

export function isShowPage(): boolean {
  return window.location.hash.startsWith(SHOW_HASH)
}

export function showUrl(): string {
  return `${location.origin}${location.pathname}${location.search}${SHOW_HASH}`
}

/** State messages are throttled to this interval (~12 Hz is plenty for bars). */
const STATE_INTERVAL_MS = 80

/* ---------------- WebRTC peers (transport-agnostic, testable) ---------------- */

/**
 * Host side of the arena video: adds the media tracks and posts one offer.
 * LAN-only by design (no STUN/TURN): host candidates are enough for a phone
 * and a Chromecast on the same Wi-Fi, and nothing leaves the network.
 */
export async function offerMedia(
  media: MediaStream,
  post: (m: ShowMessage) => void,
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection()
  for (const track of media.getTracks()) pc.addTrack(track, media)
  pc.onicecandidate = (e) => post({ t: 'ice', c: e.candidate ? e.candidate.toJSON() : null })
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  post({ t: 'offer', sdp: offer.sdp ?? '' })
  return pc
}

/** Receiver side: answers offers, surfaces the incoming stream (null = gone). */
export function createReceiverPeer(
  post: (m: ShowMessage) => void,
  onStream: (stream: MediaStream | null) => void,
): { handle(msg: ShowMessage): Promise<void>; close(): void } {
  let pc: RTCPeerConnection | null = null
  return {
    async handle(msg: ShowMessage): Promise<void> {
      switch (msg.t) {
        case 'offer': {
          pc?.close()
          pc = new RTCPeerConnection()
          pc.ontrack = (e) => {
            onStream(e.streams[0] ?? new MediaStream([e.track]))
          }
          pc.onicecandidate = (e) =>
            post({ t: 'ice', c: e.candidate ? e.candidate.toJSON() : null })
          await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp })
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          post({ t: 'answer', sdp: answer.sdp ?? '' })
          break
        }
        case 'ice':
          try {
            await pc?.addIceCandidate(msg.c ?? undefined)
          } catch {
            /* candidate for a torn-down peer — ignore */
          }
          break
        case 'bye':
          pc?.close()
          pc = null
          onStream(null)
          break
        default:
          break
      }
    },
    close(): void {
      pc?.close()
      pc = null
    },
  }
}

/* ---------------- Host ---------------- */

export class ShowCast {
  status: CastStatus = 'idle'
  onStatus: ((s: CastStatus) => void) | null = null

  private conn: PresentationConnectionShape | null = null
  private win: Window | null = null
  private winWatch: ReturnType<typeof setInterval> | null = null
  private pc: RTCPeerConnection | null = null
  private media: MediaStream | null = null
  private lastState: ShowState | null = null
  private pendingState: ReturnType<typeof setTimeout> | null = null
  private lastSentAt = 0

  /** No Presentation API and no real windows inside the Capacitor WebView. */
  supported(): boolean {
    if ('PresentationRequest' in window) return true
    const capacitor = (
      window as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor
    return !capacitor?.isNativePlatform?.()
  }

  get active(): boolean {
    return this.status !== 'idle'
  }

  /** Open the TV picker (Presentation API) or the fallback show window. */
  async start(): Promise<void> {
    if (this.active) return
    this.setStatus('connecting')

    if (typeof PresentationRequest === 'function') {
      try {
        const request = new PresentationRequest([showUrl()])
        const conn = await request.start()
        this.conn = conn
        conn.onmessage = (e) => this.receive(String(e.data))
        conn.onclose = () => this.stop()
        if (conn.state === 'connected') this.setStatus('live')
        else conn.onconnect = () => this.setStatus('live')
        return
      } catch {
        // No cast devices / user dismissed the picker — try the window fallback.
      }
    }

    const win = window.open(showUrl(), 'speed-battle-show', 'width=960,height=540')
    if (!win) {
      this.setStatus('idle')
      return
    }
    this.win = win
    window.addEventListener('message', this.onWindowMessage)
    // window.close() of the show has no event on our side — poll it.
    this.winWatch = setInterval(() => {
      if (win.closed) this.stop()
    }, 1000)
    this.setStatus('live')
  }

  stop(): void {
    if (this.status === 'idle') return
    this.post({ t: 'bye' })
    this.pc?.close()
    this.pc = null
    if (this.pendingState) {
      clearTimeout(this.pendingState)
      this.pendingState = null
    }
    try {
      this.conn?.close()
    } catch {
      /* already closed */
    }
    this.conn = null
    if (this.winWatch) {
      clearInterval(this.winWatch)
      this.winWatch = null
    }
    window.removeEventListener('message', this.onWindowMessage)
    try {
      this.win?.close()
    } catch {
      /* window already gone */
    }
    this.win = null
    this.setStatus('idle')
  }

  /**
   * Stream this canvas (plus game audio) to the receiver. Call when the arena
   * comes alive; safe to call again — renegotiates a fresh peer.
   */
  attachMedia(canvas: HTMLCanvasElement, audio: MediaStream | null): void {
    this.dropMedia()
    try {
      const stream = canvas.captureStream(30)
      if (audio) for (const track of audio.getAudioTracks()) stream.addTrack(track.clone())
      this.media = stream
    } catch {
      return // captureStream unsupported — receiver stays on the scoreboard
    }
    void this.negotiate()
  }

  /** Back to scoreboard mode (arena left / camera stopped). */
  detachMedia(): void {
    this.dropMedia()
    this.post({ t: 'bye' })
  }

  /** Throttled, trailing-edge state push — the LAST state always lands. */
  sendState(state: ShowState): void {
    this.lastState = { ...state, theme: getTheme() }
    if (!this.active || this.pendingState) return
    const wait = Math.max(0, STATE_INTERVAL_MS - (performance.now() - this.lastSentAt))
    this.pendingState = setTimeout(() => {
      this.pendingState = null
      this.lastSentAt = performance.now()
      if (this.lastState && this.active) this.post({ t: 'state', s: this.lastState })
    }, wait)
  }

  private dropMedia(): void {
    this.media?.getTracks().forEach((t) => t.stop())
    this.media = null
    this.pc?.close()
    this.pc = null
  }

  private async negotiate(): Promise<void> {
    if (!this.media || this.status !== 'live') return
    this.pc?.close()
    try {
      this.pc = await offerMedia(this.media, (m) => this.post(m))
    } catch {
      this.pc = null // video failed; state messages keep the TV useful
    }
  }

  private receive(raw: string): void {
    let msg: ShowMessage
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    void this.handle(msg)
  }

  private async handle(msg: ShowMessage): Promise<void> {
    switch (msg.t) {
      case 'hello':
        // Receiver (re)loaded: catch it up instantly, then offer the video.
        if (this.lastState) this.post({ t: 'state', s: this.lastState })
        void this.negotiate()
        break
      case 'answer':
        try {
          await this.pc?.setRemoteDescription({ type: 'answer', sdp: msg.sdp })
        } catch {
          /* stale answer for a replaced peer */
        }
        break
      case 'ice':
        try {
          await this.pc?.addIceCandidate(msg.c ?? undefined)
        } catch {
          /* candidate raced a renegotiation */
        }
        break
      default:
        break
    }
  }

  private onWindowMessage = (e: MessageEvent): void => {
    if (e.origin !== location.origin || !this.win || e.source !== this.win) return
    void this.handle(e.data as ShowMessage)
  }

  private post(msg: ShowMessage): void {
    if (this.conn) {
      if (this.conn.state === 'connected') {
        try {
          this.conn.send(JSON.stringify(msg))
        } catch {
          /* connection died mid-send; onclose will follow */
        }
      }
      return
    }
    this.win?.postMessage(msg, location.origin)
  }

  private setStatus(s: CastStatus): void {
    if (this.status === s) return
    this.status = s
    this.onStatus?.(s)
  }
}

/* ---------------- Receiver ---------------- */

export interface ShowReceiverHandlers {
  onState(s: ShowState): void
  onStream(stream: MediaStream | null): void
}

/**
 * Bind this page (opened with #show) to whichever transport brought it up:
 * the Presentation API receiver context on a Chromecast, or window.opener
 * when it's the desktop fallback window. Returns a cleanup function.
 */
export function attachShowReceiver(h: ShowReceiverHandlers): () => void {
  let post: (m: ShowMessage) => void = () => {}
  const peer = createReceiverPeer(
    (m) => post(m),
    (stream) => h.onStream(stream),
  )
  const handle = (msg: ShowMessage): void => {
    if (msg.t === 'state') h.onState(msg.s)
    else void peer.handle(msg)
  }

  const presentation = navigator.presentation
  if (presentation?.receiver) {
    void presentation.receiver.connectionList.then((list) => {
      const bind = (conn: PresentationConnectionShape): void => {
        post = (m) => {
          try {
            conn.send(JSON.stringify(m))
          } catch {
            /* not connected yet */
          }
        }
        conn.onmessage = (e) => {
          try {
            handle(JSON.parse(String(e.data)) as ShowMessage)
          } catch {
            /* malformed frame */
          }
        }
        post({ t: 'hello' })
      }
      list.connections.forEach(bind)
      list.onconnectionavailable = (e) => bind(e.connection)
    })
    return () => peer.close()
  }

  if (window.opener) {
    const opener = window.opener as Window
    post = (m) => opener.postMessage(m, location.origin)
    const onMsg = (e: MessageEvent): void => {
      if (e.origin !== location.origin) return
      handle(e.data as ShowMessage)
    }
    window.addEventListener('message', onMsg)
    post({ t: 'hello' })
    return () => {
      window.removeEventListener('message', onMsg)
      peer.close()
    }
  }

  return () => peer.close()
}
