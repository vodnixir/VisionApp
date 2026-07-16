/**
 * WebRTC peer wrapper for the online battle — one camera track out, one data
 * channel for game state, and a copy-paste handshake (no signaling server).
 *
 * Handshake (host and guest each add their camera track FIRST, so the media is
 * part of the very first offer/answer):
 *   host:  createOffer() → code ──▶ (chat) ──▶ guest.acceptOffer(code) → answer code
 *   host.acceptAnswer(answerCode) ◀── (chat) ◀── guest
 * Once the answer lands the data channel opens and both sides are connected.
 *
 * ICE is non-trickle: we wait for gathering to finish (bounded by a timeout) so
 * every candidate is baked into the single SDP the code carries. STUN alone only
 * works on friendly networks (same simple Wi-Fi); a TURN relay — configured via
 * VITE_TURN_* env vars at build time — is what makes phones on different
 * networks (mobile data, CGNAT, symmetric NAT) actually connect.
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
 * Cap on waiting for ICE gathering — some browsers never emit 'complete'.
 * Generous on purpose: cutting it short bakes an incomplete candidate set into
 * the one-shot SDP code (there is no trickle to recover with), and slow mobile
 * links can take several seconds to produce their relay candidates.
 */
const ICE_TIMEOUT_MS = 8000

export class OnlineConnection {
  readonly role: Role
  private pc: RTCPeerConnection
  private channel: RTCDataChannel | null = null
  private cb: NetCallbacks

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

    // The host opens the channel; the guest receives it.
    if (role === 'host') {
      this.bindChannel(this.pc.createDataChannel('game', { ordered: true }))
    } else {
      this.pc.ondatachannel = (e) => this.bindChannel(e.channel)
    }
  }

  /** Add the local camera track so it rides in the first offer/answer. */
  addLocalStream(stream: MediaStream): void {
    for (const track of stream.getVideoTracks()) this.pc.addTrack(track, stream)
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
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(msg))
  }

  close(): void {
    this.channel?.close()
    this.pc.getSenders().forEach((s) => s.track?.stop())
    this.pc.close()
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel
    channel.onopen = () => this.cb.onState?.('connected')
    channel.onmessage = (e) => {
      try {
        this.cb.onMessage?.(JSON.parse(e.data as string) as NetMessage)
      } catch {
        /* ignore malformed frames */
      }
    }
  }

  private waitIce(): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        this.pc.removeEventListener('icegatheringstatechange', check)
        resolve()
      }
      const check = () => {
        if (this.pc.iceGatheringState === 'complete') finish()
      }
      this.pc.addEventListener('icegatheringstatechange', check)
      setTimeout(finish, ICE_TIMEOUT_MS)
    })
  }
}
