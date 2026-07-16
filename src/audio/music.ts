import { useSyncExternalStore } from 'react'

/**
 * Background music, fully synthesized with Web Audio — no assets, works offline
 * in the APK just like the SFX layer. Two looping beds:
 *
 *  - 'menu':  a mellow minor-key club groove for the main menu
 *  - 'round': a faster, brighter four-on-the-floor track for live rounds
 *
 * A lookahead scheduler (the standard Web Audio pattern) queues notes a little
 * ahead of the clock so the loop never stutters. Browsers block audio until a
 * user gesture, so the first pointer/key/touch anywhere resumes the context.
 *
 * The on/off state lives here and drives React through useMusic(), mirroring the
 * theme/layout stores. Muting stops the scheduler entirely (no idle CPU).
 */

const MUSIC_STORAGE_KEY = 'sb.music'

export type MusicTrack = 'menu' | 'round' | 'rhythm'

/** Equal-temperament frequency for a semitone offset from A4 (440 Hz). */
function hz(semitonesFromA4: number): number {
  return 440 * 2 ** (semitonesFromA4 / 12)
}

// Scale degrees are expressed as semitone offsets from A4 so the two beds share
// one A-minor tonal centre. Negative = below A4 (A3 is an octave down).
const A3 = -12

interface Voice {
  /** Absolute start time (ctx.currentTime domain). */
  t: number
  freq: number
  dur: number
  type: OscillatorType
  gain: number
  /** Optional pitch glide target (kick drops, bass slides). */
  glideTo?: number
  /** Optional low-pass cutoff — warms up saw/square voices. */
  cutoff?: number
}

interface TrackSpec {
  bpm: number
  /** Master bed level for this track (round is punchier than menu). */
  level: number
  /** Steps per bar (16 = sixteenth-note grid). */
  stepsPerBar: number
  bars: number
  /** Emit the voices that fall on this absolute step (0-based, wraps per loop). */
  step: (step: number, t: number, secPerStep: number) => Voice[]
}

// A-minor loop: i – VI – III – VII (Am – F – C – G). Root per bar, in semitones.
const PROGRESSION = [A3, hzRootFrom(-4), hzRootFrom(3), hzRootFrom(-2)]

/** Root offset (semitones from A4) for a chord a given interval above A3. */
function hzRootFrom(semisAboveA3: number): number {
  return A3 + semisAboveA3
}

/** Chord tones (root, minor/major third, fifth) as semitone offsets, per bar. */
const CHORDS: number[][] = [
  [A3 + 0, A3 + 3, A3 + 7], // Am
  [A3 - 4, A3 + 0, A3 + 3], // F
  [A3 + 3, A3 + 7, A3 + 10], // C
  [A3 - 2, A3 + 2, A3 + 5], // G
]

const MENU: TrackSpec = {
  bpm: 92,
  level: 0.34,
  stepsPerBar: 16,
  bars: 4,
  step(step, t, secPerStep) {
    const voices: Voice[] = []
    const bar = Math.floor(step / 16) % 4
    const inBar = step % 16
    const chord = CHORDS[bar]

    // Soft sustained pad at the top of every bar.
    if (inBar === 0) {
      for (const semi of chord) {
        voices.push({ t, freq: hz(semi + 12), dur: secPerStep * 15, type: 'sine', gain: 0.05 })
      }
    }
    // Gentle heartbeat kick on the two main beats.
    if (inBar === 0 || inBar === 8) {
      voices.push({ t, freq: 120, glideTo: 55, dur: 0.28, type: 'sine', gain: 0.5 })
    }
    // Lazy sine arp on the offbeats — a couple of notes, never busy.
    if (inBar === 6 || inBar === 12 || inBar === 14) {
      const note = chord[(inBar / 2) % chord.length]
      voices.push({ t, freq: hz(note + 24), dur: secPerStep * 3, type: 'sine', gain: 0.08 })
    }
    return voices
  },
}

const ROUND: TrackSpec = {
  bpm: 128,
  level: 0.4,
  stepsPerBar: 16,
  bars: 4,
  step(step, t, secPerStep) {
    const voices: Voice[] = []
    const bar = Math.floor(step / 16) % 4
    const inBar = step % 16
    const chord = CHORDS[bar]
    const root = PROGRESSION[bar]

    // Four-on-the-floor kick.
    if (inBar % 4 === 0) {
      voices.push({ t, freq: 150, glideTo: 48, dur: 0.22, type: 'sine', gain: 0.6 })
    }
    // Offbeat hats (square blips stand in for a closed hat).
    if (inBar % 4 === 2) {
      voices.push({ t, freq: 8000, dur: 0.03, type: 'square', gain: 0.05 })
    }
    // Driving eighth-note bass on the bar root.
    if (inBar % 2 === 0) {
      voices.push({
        t,
        freq: hz(root - 12),
        dur: secPerStep * 1.7,
        type: 'sawtooth',
        gain: 0.14,
        cutoff: 420,
      })
    }
    // Bright sixteenth arp cycling the chord tones — the energy on top.
    const arp = chord[inBar % chord.length]
    voices.push({
      t,
      freq: hz(arp + 24),
      dur: secPerStep * 1.4,
      type: 'square',
      gain: 0.06,
      cutoff: 3200,
    })
    return voices
  },
}

/**
 * The Rhythm-mode bed. Tempo is locked to RHYTHM_BPM (105) so one quarter note
 * equals exactly one scoring beat — a loud, unmistakable kick lands on every
 * beat the game rewards, giving players a pulse to move their whole body to.
 * (Kept intentionally sparse between kicks so the beat itself stays the star.)
 */
const RHYTHM: TrackSpec = {
  bpm: 105,
  level: 0.5,
  stepsPerBar: 16,
  bars: 2,
  step(step, t, secPerStep) {
    const voices: Voice[] = []
    const bar = Math.floor(step / 16) % 2
    const inBar = step % 16
    const onBeat = inBar % 4 === 0 // the four scoring beats per bar
    const beat = inBar / 4 // 0..3 on a quarter note

    // Punchy kick on EVERY quarter note — this is the anchor players move to.
    if (onBeat) {
      voices.push({ t, freq: 165, glideTo: 50, dur: 0.24, type: 'sine', gain: 0.85 })
      // A short click layered on top sharpens the transient so the beat reads
      // even through phone speakers.
      voices.push({ t, freq: 1600, dur: 0.02, type: 'square', gain: 0.18 })
    }
    // Clap/snare on the backbeats (2 and 4) for a danceable groove.
    if (beat === 1 || beat === 3) {
      voices.push({ t, freq: 2000, dur: 0.04, type: 'square', gain: 0.12 })
    }
    // Offbeat hats keep the sixteenth grid alive without competing with the kick.
    if (inBar % 4 === 2) {
      voices.push({ t, freq: 9000, dur: 0.025, type: 'square', gain: 0.05 })
    }
    // Simple root bass under each beat drives the pulse.
    if (onBeat) {
      const root = CHORDS[bar % CHORDS.length][0]
      voices.push({
        t,
        freq: hz(root - 12),
        dur: secPerStep * 3,
        type: 'sawtooth',
        gain: 0.13,
        cutoff: 480,
      })
    }
    return voices
  },
}

const SPECS: Record<MusicTrack, TrackSpec> = { menu: MENU, round: ROUND, rhythm: RHYTHM }

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_S = 0.12

class MusicEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private track: MusicTrack | null = null
  private step = 0
  private nextStepTime = 0
  private gestureBound = false

  /** Currently sounding track, or null when silent. */
  get current(): MusicTrack | null {
    return this.track
  }

  /** Resume the context from a user gesture (mobile autoplay unlock). */
  unlock(): void {
    this.ensureContext()
    if (this.ctx?.state === 'suspended') void this.ctx.resume()
  }

  /** Start (or switch to) a track. No-op if that track is already playing. */
  play(track: MusicTrack): void {
    if (!enabled) {
      this.track = null
      return
    }
    if (this.track === track && this.timer !== null) return
    this.ensureContext()
    if (!this.ctx || !this.master) return

    this.track = track
    this.step = 0
    this.nextStepTime = this.ctx.currentTime + 0.06
    // Ramp the bed in so switching tracks doesn't click.
    const level = SPECS[track].level
    this.master.gain.cancelScheduledValues(this.ctx.currentTime)
    this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), this.ctx.currentTime)
    this.master.gain.exponentialRampToValueAtTime(level, this.ctx.currentTime + 0.5)

    if (this.timer === null) {
      this.timer = setInterval(() => this.scheduler(), LOOKAHEAD_MS)
    }
    if (this.ctx.state === 'suspended') this.bindGestureUnlock()
  }

  /** Fade out and stop the scheduler. */
  stop(): void {
    this.track = null
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), now)
      this.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
    }
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private ensureContext(): void {
    if (this.ctx) return
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.0001
    this.master.connect(this.ctx.destination)
  }

  /** One-shot: the next user gesture resumes a context the browser suspended. */
  private bindGestureUnlock(): void {
    if (this.gestureBound || typeof window === 'undefined') return
    this.gestureBound = true
    const resume = () => {
      this.gestureBound = false
      void this.ctx?.resume()
      window.removeEventListener('pointerdown', resume)
      window.removeEventListener('keydown', resume)
      window.removeEventListener('touchstart', resume)
    }
    window.addEventListener('pointerdown', resume, { once: true })
    window.addEventListener('keydown', resume, { once: true })
    window.addEventListener('touchstart', resume, { once: true })
  }

  private scheduler(): void {
    if (!this.ctx || !this.master || !this.track) return
    const spec = SPECS[this.track]
    const secPerStep = 60 / spec.bpm / (spec.stepsPerBar / 4)
    const loopSteps = spec.stepsPerBar * spec.bars

    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD_S) {
      const voices = spec.step(this.step % loopSteps, this.nextStepTime, secPerStep)
      for (const v of voices) this.emit(v)
      this.nextStepTime += secPerStep
      this.step = (this.step + 1) % loopSteps
    }
  }

  private emit(v: Voice): void {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = v.type
    osc.frequency.setValueAtTime(v.freq, v.t)
    if (v.glideTo) osc.frequency.exponentialRampToValueAtTime(v.glideTo, v.t + v.dur)

    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, v.t)
    env.gain.exponentialRampToValueAtTime(v.gain, v.t + 0.02)
    env.gain.exponentialRampToValueAtTime(0.0001, v.t + v.dur)

    if (v.cutoff) {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(v.cutoff, v.t)
      osc.connect(lp)
      lp.connect(env)
    } else {
      osc.connect(env)
    }
    env.connect(this.master)

    osc.start(v.t)
    osc.stop(v.t + v.dur + 0.05)
    osc.onended = () => {
      osc.disconnect()
      env.disconnect()
    }
  }
}

export const music = new MusicEngine()

/* ---------------- React store for the mute toggle ---------------- */

function detectEnabled(): boolean {
  try {
    const saved = localStorage.getItem(MUSIC_STORAGE_KEY)
    if (saved === 'off') return false
  } catch {
    /* storage unavailable */
  }
  return true
}

let enabled = detectEnabled()
const listeners = new Set<() => void>()

export function isMusicEnabled(): boolean {
  return enabled
}

export function setMusicEnabled(next: boolean): void {
  if (next === enabled) return
  enabled = next
  try {
    localStorage.setItem(MUSIC_STORAGE_KEY, next ? 'on' : 'off')
  } catch {
    /* storage unavailable */
  }
  if (!next) {
    music.stop()
  } else {
    music.unlock()
    // Resume whatever bed the app last asked for (menu on the home screen).
    music.play(music.current ?? 'menu')
  }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** React binding: re-renders when the music toggle flips. */
export function useMusic() {
  const musicEnabled = useSyncExternalStore(subscribe, isMusicEnabled)
  return { musicEnabled, setMusicEnabled }
}
