/**
 * WebRTC peer wrapper for the online battle — one data channel for game state,
 * one camera track each way, and a copy-paste handshake (no signaling server).
 *
 * The first handshake carries the DATA CHANNEL ONLY:
 *   host:  createOffer() → code ──▶ (chat/QR) ──▶ guest.acceptOffer(code) → answer code
 *   host.acceptAnswer(answerCode) ◀── (chat/QR) ◀── guest
 *
 * Why no camera in that first offer: a video m-line drags in the whole codec
 * list (VP8/VP9/H264 profiles, rtx, fmtp) and inflates the SDP ~5.5× — 6.3 KB vs
 * 1.1 KB — which pushed the packed code to ~2.3 KB and made the QR far too dense
 * for a camera to read. Data-channel-only lands around 880 chars, which scans.
 *
 * So the camera is attached AFTER the channel opens (attachCamera), by
 * renegotiating over the channel itself: onnegotiationneeded → { t: 'sdp' } →
 * peer applies it and answers the same way. BUNDLE means this reuses the
 * existing ICE transport, so no second candidate gathering happens. Glare (both
 * sides attaching at once) is handled by the standard perfect-negotiation
 * pattern — the host is impolite, the guest is polite.
 *
 * The first handshake's ICE is non-trickle: we wait for gathering to finish
 * (bounded by a timeout) so every candidate is baked into the single SDP the
 * code carries. STUN alone only works on friendly networks (same simple Wi-Fi);
 * a TURN relay — configured via VITE_TURN_* env vars at build time — is what
 * makes phones on different networks (mobile data, CGNAT, symmetric NAT)
 * actually connect.
 */
import { packSignal, unpackSignal, type NetMessage } from './protocol'

export type Role = 'host' | 'guest'
export type ConnState = 'new' | 'connecting' | 'connected' | 'failed' | 'closed'

export interface NetCallbacks {
  /** The opponent's live camera stream arrived — attach it to a <video>. */
  onRemoteStream?: (stream: MediaStream) => void
  /** A decoded game-state message arrived over the data channel. */
  onMessage?: (msg: NetMessage) => void
  /** Connection lifecycle changed. */
  onState?: (state: ConnState) => void
}

// TURN relay (e.g. a free metered.ca "Open Relay" account). Baked in at build
// time: locally via .env.local, on GitHub Pages via repo secrets (deploy.yml).
// VITE_TURN_URL may hold several comma-separated turn:/turns: URLs.
const TURN_URL: string = import.meta.env.VITE_TURN_URL ?? ''
const TURN_USERNAME: string = import.meta.env.VITE_TURN_USERNAME ?? ''
const TURN_CREDENTIAL: string = import.meta.env.VITE_TURN_CREDENTIAL ?? ''

/** Whether a TURN relay is baked into this build (UI warns when it isn't). */
export const TURN_CONFIGURED = Boolean(TURN_URL && TURN_USERNAME && TURN_CREDENTIAL)

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  ...(TURN_CONFIGURED
    ? [
        {
          urls: TURN_URL.split(',').map((u) => u.trim()),
          username: TURN_USERNAME,
          credential: TURN_CREDENTIAL,
        },
      ]
    : []),
]
/**
 * Hard cap on waiting for ICE gathering — some browsers never emit 'complete'.
 * Generous on purpose: cutting it short bakes an incomplete candidate set into
 * the one-shot SDP code (there is no trickle to recover with), and slow mobile
 * links can take several seconds to produce their relay candidates.
 */
const ICE_TIMEOUT_MS = 8000
/**
 * Gathering rarely reports 'complete' promptly — it waits on every configured
 * TURN URL, including transports that just time out, which stalled the invite
 * code for the full 8 s. Once we hold the candidates that actually decide
 * connectivity (a server-reflexive for direct P2P and a relay for when that
 * fails), the rest add nothing, so we settle after a short grace for stragglers.
 */
const ICE_SETTLE_MS = 700
/** Ping cadence — well under the ~30s ICE consent window it exists to protect. */
const KEEPALIVE_MS = 4000

export class OnlineConnection {
  readonly role: Role
  private pc: RTCPeerConnection
  private channel: RTCDataChannel | null = null
  private cb: NetCallbacks
  /**
   * Perfect negotiation state. Renegotiation only ever runs over the open data
   * channel, so it stays out of the way of the manual first handshake.
   */
  private renegotiating = false
  private makingOffer = false
  /** Our outgoing camera sender, so a restarted camera can swap tracks in place. */
  private videoSender: RTCRtpSender | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  /** The impolite peer wins a glare; the polite one rolls back. */
  private get polite(): boolean {
    return this.role === 'guest'
  }

  constructor(role: Role, cb: NetCallbacks) {
    this.role = role
    this.cb = cb
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    // Remote camera track → surface the stream once.
    this.pc.ontrack = (e) => {
      const stream = e.streams[0]
      if (stream) this.cb.onRemoteStream?.(stream)
    }

    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState
      if (s === 'connected') this.cb.onState?.('connected')
      else if (s === 'failed') this.cb.onState?.('failed')
      else if (s === 'closed') this.cb.onState?.('closed')
      else if (s === 'connecting') this.cb.onState?.('connecting')
    }

    // Adding the camera later fires this. It must stay inert until the channel
    // is open, or it would race the manual first handshake.
    this.pc.onnegotiationneeded = async () => {
      if (!this.renegotiating) return
      try {
        this.makingOffer = true
        await this.pc.setLocalDescription()
        this.sendRaw({ t: 'sdp', sdp: this.pc.localDescription!.toJSON() })
      } catch {
        /* the peer may have vanished mid-renegotiation */
      } finally {
        this.makingOffer = false
      }
    }

    // The host opens the channel; the guest receives it.
    if (role === 'host') {
      this.bindChannel(this.pc.createDataChannel('game', { ordered: true }))
    } else {
      this.pc.ondatachannel = (e) => this.bindChannel(e.channel)
    }
  }

  /**
   * Send the local camera to the peer. Safe to call once the channel is open,
   * and safe to call REPEATEDLY: the camera can die and restart (Android reclaims
   * it when the app is backgrounded), so a second call with a fresh stream swaps
   * the track in place via replaceTrack — no renegotiation, no glare. Only the
   * very first attach adds a track (which does renegotiate over the channel).
   */
  attachCamera(stream: MediaStream): void {
    if (!this.renegotiating) return // channel not open yet
    const track = stream.getVideoTracks()[0]
    if (!track) return
    if (this.videoSender) {
      if (this.videoSender.track === track) return // already sending exactly this
      void this.videoSender.replaceTrack(track).catch(() => {})
      return
    }
    // First camera: addTrack fires onnegotiationneeded → offer over the channel.
    this.videoSender = this.pc.addTrack(track, stream)
  }

  /** Whether the local camera has been negotiated to the peer at least once. */
  get hasCamera(): boolean {
    return this.videoSender !== null
  }

  /** Apply a renegotiation offer/answer that arrived over the channel. */
  private async onRemoteSdp(sdp: RTCSessionDescriptionInit): Promise<void> {
    // Perfect negotiation: if both sides offered at once, the impolite peer
    // ignores the incoming offer and lets its own stand.
    const collision =
      sdp.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable')
    if (collision && !this.polite) return
    try {
      await this.pc.setRemoteDescription(sdp)
      if (sdp.type === 'offer') {
        await this.pc.setLocalDescription()
        this.sendRaw({ t: 'sdp', sdp: this.pc.localDescription!.toJSON() })
      }
    } catch {
      /* a rolled-back or stale description — the next negotiation recovers */
    }
  }

  /** Host step 1 — produce the offer code to send to the friend. */
  async createOffer(): Promise<string> {
    this.cb.onState?.('connecting')
    await this.pc.setLocalDescription(await this.pc.createOffer())
    await this.waitIce()
    return packSignal({ kind: 'offer', sdp: this.pc.localDescription! })
  }

  /** Host step 2 — apply the answer code the friend sent back. */
  async acceptAnswer(code: string): Promise<void> {
    const { kind, sdp } = await unpackSignal(code)
    if (kind !== 'answer') throw new Error('Нужен код-ОТВЕТ от соперника')
    await this.pc.setRemoteDescription(sdp)
  }

  /** Guest — apply the host's offer code and produce the answer code to send back. */
  async acceptOffer(code: string): Promise<string> {
    this.cb.onState?.('connecting')
    const { kind, sdp } = await unpackSignal(code)
    if (kind !== 'offer') throw new Error('Нужен код-ПРИГЛАШЕНИЕ от хоста')
    await this.pc.setRemoteDescription(sdp)
    await this.pc.setLocalDescription(await this.pc.createAnswer())
    await this.waitIce()
    return packSignal({ kind: 'answer', sdp: this.pc.localDescription! })
  }

  /** Send a game-state message (dropped silently if the channel isn't open). */
  send(msg: NetMessage): void {
    this.sendRaw(msg)
  }

  private sendRaw(msg: NetMessage): void {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(msg))
  }

  close(): void {
    this.renegotiating = false
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer)
    this.keepaliveTimer = null
    this.channel?.close()
    this.pc.getSenders().forEach((s) => s.track?.stop())
    this.pc.close()
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel
    channel.onopen = () => {
      // From here on the channel can carry SDP, so the camera may be attached.
      this.renegotiating = true
      // Keep the channel warm so ICE consent never lapses on an idle screen.
      if (!this.keepaliveTimer) {
        this.keepaliveTimer = setInterval(() => this.sendRaw({ t: 'ping' }), KEEPALIVE_MS)
      }
      this.cb.onState?.('connected')
    }
    channel.onmessage = (e) => {
      let msg: NetMessage
      try {
        msg = JSON.parse(e.data as string) as NetMessage
      } catch {
        return // ignore malformed frames
      }
      // Transport-only frames never reach the game layer.
      if (msg.t === 'sdp') {
        void this.onRemoteSdp(msg.sdp)
        return
      }
      if (msg.t === 'ping') return
      this.cb.onMessage?.(msg)
    }
  }

  /**
   * Collect ICE candidates for the one-shot code. Settles as soon as the useful
   * ones are in (see ICE_SETTLE_MS) rather than always burning the hard cap.
   */
  private waitIce(): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((resolve) => {
      let done = false
      let settle: ReturnType<typeof setTimeout> | null = null
      let sawSrflx = false
      let sawRelay = false

      const finish = () => {
        if (done) return
        done = true
        if (settle) clearTimeout(settle)
        clearTimeout(hardStop)
        this.pc.removeEventListener('icegatheringstatechange', onGathering)
        this.pc.removeEventListener('icecandidate', onCandidate)
        resolve()
      }

      // Enough to connect: a reflexive address for direct P2P, plus a relay for
      // when the NAT refuses it. Without TURN there is no relay to wait for.
      const enough = () => sawSrflx && (sawRelay || !TURN_CONFIGURED)

      const onCandidate = (e: RTCPeerConnectionIceEvent) => {
        const c = e.candidate?.candidate
        if (!c) return // null candidate = gathering finished
        if (c.includes('typ srflx')) sawSrflx = true
        else if (c.includes('typ relay')) sawRelay = true
        if (enough() && !settle) settle = setTimeout(finish, ICE_SETTLE_MS)
      }
      const onGathering = () => {
        if (this.pc.iceGatheringState === 'complete') finish()
      }

      this.pc.addEventListener('icecandidate', onCandidate)
      this.pc.addEventListener('icegatheringstatechange', onGathering)
      const hardStop = setTimeout(finish, ICE_TIMEOUT_MS)
    })
  }
}
