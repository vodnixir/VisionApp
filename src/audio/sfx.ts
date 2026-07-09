/**
 * All game sounds are synthesized with plain Web Audio oscillators — no assets.
 * Call unlock() from a user gesture (the START button) so the AudioContext is
 * allowed to play on mobile browsers.
 */
class SoundFX {
  enabled = true
  private ctx: AudioContext | null = null
  private streamDest: MediaStreamAudioDestinationNode | null = null

  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /**
   * Audio stream mirroring everything the players hear — mixed into the match
   * clip so the gong and the victory fanfare survive into TikTok.
   */
  captureStream(): MediaStream | null {
    if (!this.ctx) return null
    this.streamDest ??= this.ctx.createMediaStreamDestination()
    return this.streamDest.stream
  }

  /** Short blip when the system locks onto both fighters. */
  lock(): void {
    this.tone({ freq: 660, type: 'sine', duration: 0.09, gain: 0.15 })
  }

  /** Countdown beep: 3… 2… 1… */
  beep(): void {
    this.tone({ freq: 880, type: 'square', duration: 0.12, gain: 0.18 })
  }

  /** Fight-start gong: stacked inharmonic partials with a long decay. */
  gong(): void {
    const partials: Array<[number, number, number]> = [
      // [frequency, gain, duration]
      [98, 0.5, 1.6],
      [147, 0.35, 1.4],
      [196, 0.28, 1.2],
      [261, 0.18, 1.0],
      [389, 0.1, 0.7],
    ]
    for (const [freq, gain, duration] of partials) {
      this.tone({ freq, type: 'sine', duration, gain, glideTo: freq * 0.985 })
    }
    // metallic attack transient
    this.tone({ freq: 1244, type: 'triangle', duration: 0.1, gain: 0.12 })
  }

  /** Referee whistle: a freeze window opens — nobody move! */
  whistle(): void {
    this.tone({ freq: 2350, type: 'square', duration: 0.16, gain: 0.16, glideTo: 2200 })
    this.tone({ freq: 2350, type: 'square', duration: 0.3, gain: 0.16, delay: 0.2, glideTo: 2100 })
  }

  /** Freeze window over — move again! */
  release(): void {
    this.tone({ freq: 520, type: 'triangle', duration: 0.12, gain: 0.16 })
    this.tone({ freq: 780, type: 'triangle', duration: 0.18, gain: 0.16, delay: 0.1 })
  }

  /** Rising victory fanfare arpeggio. */
  victory(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5] // C5 E5 G5 C6 E6
    notes.forEach((freq, i) => {
      this.tone({ freq, type: 'square', duration: 0.22, gain: 0.14, delay: i * 0.13 })
      this.tone({ freq: freq / 2, type: 'sine', duration: 0.3, gain: 0.1, delay: i * 0.13 })
    })
    // final sustained chord
    for (const freq of [523.25, 659.25, 783.99]) {
      this.tone({ freq, type: 'sawtooth', duration: 0.9, gain: 0.06, delay: notes.length * 0.13 })
    }
  }

  private tone(options: {
    freq: number
    type: OscillatorType
    duration: number
    gain: number
    delay?: number
    glideTo?: number
  }): void {
    if (!this.enabled || !this.ctx) return
    const { freq, type, duration, gain, delay = 0, glideTo } = options
    const ctx = this.ctx
    const t0 = ctx.currentTime + delay

    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration)

    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.015)
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)

    osc.connect(env)
    env.connect(ctx.destination)
    if (this.streamDest) env.connect(this.streamDest)
    osc.start(t0)
    osc.stop(t0 + duration + 0.05)
    osc.onended = () => {
      osc.disconnect()
      env.disconnect()
    }
  }
}

export const sfx = new SoundFX()
