import { ArrowLeft, Crown, LogIn, Plus, RefreshCw, Swords, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { sfx } from '../audio/sfx'
import { usePoseDetection } from '../hooks/usePoseDetection'
import { useWakeLock } from '../hooks/useWakeLock'
import { runCountdown } from '../countdown'
import type { EngineFrame } from '../cv/engine'
import { useRunnerControl } from '../runner/useRunnerControl'
import {
  START_LIVES,
  createRunnerState,
  runnerScore,
  stepRunner,
  type RunnerState,
} from '../runner/game'
import { drawScene } from '../runner/draw'
import { OnlineConnection, type ConnState, type Role } from '../online/net'
import { mulberry32, randomSeed, type NetMessage } from '../online/protocol'
import { useI18n } from '../i18n'
import {
  BigButton,
  CameraStatus,
  CodeShare,
  ConnPill,
  Hearts,
  Hero,
  PasteRow,
  PendingLine,
  ReadyChip,
  ScoreCard,
  Screen,
  SideTag,
  Step,
} from './online/ui'

/** Countdown the host announces; both sides run it locally. */
const START_DELAY_MS = 3200
/** How often each side heartbeats its progress to the opponent. */
const STATE_EVERY_MS = 200

type Phase = 'menu' | 'signal' | 'ready' | 'countdown' | 'play' | 'over'

/** Latest known snapshot of the opponent's run (from their heartbeat). */
interface Opponent {
  score: number
  lives: number
  over: boolean
}

const OPPONENT_START: Opponent = { score: 0, lives: START_LIVES, over: false }

/** A shareable invite link that opens this app straight into the guest flow. */
function inviteUrl(code: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#online?j=${encodeURIComponent(code)}`
}

/**
 * Online battle — two phones, one shared obstacle stream.
 *
 * Both players run their OWN local runner seeded identically (host picks the
 * seed, ships it over the data channel), so the obstacles match and the higher
 * score wins. The split screen shows your metro world on one half and the
 * opponent's live camera on the other, their score/lives painted on top. The
 * WebRTC handshake is a one-off code the players paste to each other — no
 * server. Reached at #online.
 */
export function OnlineBattleScreen({ initialInvite }: { initialInvite?: string } = {}) {
  const { t, lang } = useI18n()
  const [phase, setPhase] = useState<Phase>('menu')
  const [role, setRole] = useState<Role | null>(null)
  const [conn, setConn] = useState<ConnState>('new')
  const [count, setCount] = useState(3)
  const [mirror, setMirror] = useState(true)

  // Signaling (paste-to-a-friend) UI state.
  const [offerCode, setOfferCode] = useState('')
  const [answerCode, setAnswerCode] = useState('')
  const [pasteInput, setPasteInput] = useState('')
  const [signalBusy, setSignalBusy] = useState(false)
  const [signalError, setSignalError] = useState<string | null>(null)

  // Readiness gate before the host may start.
  const [myReady, setMyReady] = useState(false)
  const [oppReady, setOppReady] = useState(false)

  // Live opponent snapshot + end-of-match results.
  const [opp, setOpp] = useState<Opponent>(OPPONENT_START)
  const [myScore, setMyScore] = useState(0)
  const [myFinal, setMyFinal] = useState<number | null>(null)
  const [oppFinal, setOppFinal] = useState<number | null>(null)
  /** The opponent dropped mid-match — their last heartbeat becomes the result. */
  const [oppLeft, setOppLeft] = useState(false)

  const connRef = useRef<OnlineConnection | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const wakeLock = useWakeLock()

  // Latest snapshots for the disconnect effect (it can't depend on this state
  // directly without re-subscribing on every heartbeat).
  const oppRef = useRef(opp)
  oppRef.current = opp
  const oppFinalRef = useRef(oppFinal)
  oppFinalRef.current = oppFinal

  // Body-driven control + calibration, shared with the solo runner and the spike.
  const { controlRef, reliable, calibrating, beginCalibration, handleFrame } = useRunnerControl({
    mirror,
    onCalibrated: () => {
      setMyReady(true)
      connRef.current?.send({ t: 'ready' })
      sfx.release()
    },
  })

  // Run loop.
  const gameRef = useRef<RunnerState | null>(null)
  const seedRef = useRef(0)
  /** Countdown duration both sides honor (host announces it via the `start` msg). */
  const startDelayRef = useRef(START_DELAY_MS)
  const rafRef = useRef(0)
  const lastRef = useRef(0)
  const lastSentRef = useRef(0)
  const flashUntilRef = useRef(0)
  const trackAddedRef = useRef(false)

  const onFrameRef = useRef<(frame: EngineFrame) => void>(() => {})
  const { videoRef, canvasRef, status, error, start, stop, configure } = usePoseDetection((frame) =>
    onFrameRef.current(frame),
  )

  onFrameRef.current = (frame: EngineFrame) => {
    handleFrame(frame, canvasRef.current?.width ?? 0)
  }

  useEffect(() => {
    configure({
      mirror,
      scoring: false,
      drawOverlays: true,
      rolesLocked: false,
      names: [t('runner.you'), ''],
    })
  }, [mirror, configure, t, lang])

  // Once the camera is live, hand its track to the peer connection (must happen
  // before the offer/answer is created so the media is negotiated in).
  useEffect(() => {
    if (status !== 'running' || trackAddedRef.current) return
    const stream = videoRef.current?.srcObject as MediaStream | null
    if (stream && connRef.current) {
      connRef.current.addLocalStream(stream)
      trackAddedRef.current = true
    }
  }, [status, videoRef])

  // Teardown.
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current)
      connRef.current?.close()
      stop()
    },
    [stop],
  )

  /* ---------------- Networking ---------------- */

  const onMessage = (msg: NetMessage) => {
    switch (msg.t) {
      case 'ready':
        setOppReady(true)
        break
      case 'start':
        seedRef.current = msg.seed
        // Honor the host's announced countdown length so both sides run the
        // same duration (residual start skew is just one-way latency — fine for
        // a score race on an identical obstacle stream).
        startDelayRef.current = msg.inMs
        beginCountdown()
        break
      case 'state':
        setOpp({ score: msg.score, lives: msg.lives, over: msg.over })
        break
      case 'over':
        setOpp((o) => ({ ...o, score: msg.score, over: true }))
        setOppFinal(msg.score)
        break
    }
  }

  const beginRole = (r: Role) => {
    setRole(r)
    setSignalError(null)
    const c = new OnlineConnection(r, {
      onState: setConn,
      onMessage,
      onRemoteStream: (stream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream
          void remoteVideoRef.current.play().catch(() => {})
        }
      },
    })
    connRef.current = c
    setPhase('signal')
    sfx.unlock()
    wakeLock.acquire()
    void start()
  }

  // Arrived via a shared invite link (#online?j=…): drop straight into the guest
  // flow with the host's code prefilled — the friend only taps through.
  const bootedRef = useRef(false)
  useEffect(() => {
    if (bootedRef.current || !initialInvite) return
    bootedRef.current = true
    setPasteInput(initialInvite)
    beginRole('guest')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInvite])

  // Host: as soon as the camera track is in, mint the offer code to share.
  useEffect(() => {
    if (phase !== 'signal' || role !== 'host' || !trackAddedRef.current || offerCode) return
    let cancelled = false
    void connRef.current
      ?.createOffer()
      .then((code) => {
        if (!cancelled) setOfferCode(code)
      })
      .catch((e) => setSignalError(String(e?.message ?? e)))
    return () => {
      cancelled = true
    }
    // trackAddedRef flips imperatively; status is the observable proxy for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, role, status, offerCode])

  // Connection established → move on to calibration.
  useEffect(() => {
    if (conn === 'connected' && (phase === 'signal' || phase === 'menu')) {
      sfx.lock()
      setPhase('ready')
    }
  }, [conn, phase])

  // The peer dropped. Never leave a match hanging: if they hadn't already sent a
  // final score, settle their result with the last heartbeat so the outcome can
  // still resolve. (If they DID finish and then just left, this is a no-op — no
  // misleading "disconnected" note on a clean match.)
  useEffect(() => {
    if (conn !== 'failed' && conn !== 'closed') return
    setOppReady(false)
    if (phase !== 'countdown' && phase !== 'play' && phase !== 'over') return
    if (oppFinalRef.current !== null) return
    setOppLeft(true)
    setOppFinal(oppRef.current.score)
  }, [conn, phase])

  const handleAcceptOffer = async () => {
    setSignalBusy(true)
    setSignalError(null)
    try {
      const code = await connRef.current!.acceptOffer(pasteInput)
      setAnswerCode(code)
    } catch (e) {
      setSignalError(e instanceof Error ? e.message : String(e))
    } finally {
      setSignalBusy(false)
    }
  }

  const handleAcceptAnswer = async () => {
    setSignalBusy(true)
    setSignalError(null)
    try {
      await connRef.current!.acceptAnswer(pasteInput)
    } catch (e) {
      setSignalError(e instanceof Error ? e.message : String(e))
    } finally {
      setSignalBusy(false)
    }
  }

  /* ---------------- Calibrate → start ---------------- */

  const handleCalibrate = () => {
    setMyReady(false)
    beginCalibration()
    sfx.beep()
  }

  const handleHostStart = () => {
    const seed = randomSeed()
    seedRef.current = seed
    connRef.current?.send({ t: 'start', seed, inMs: START_DELAY_MS })
    beginCountdown()
  }

  const beginCountdown = () => {
    setCount(3)
    setPhase('countdown')
  }

  // 3 → 2 → 1 → GO. Self-correcting and lasting exactly startDelayRef.current
  // (the `inMs` both sides agreed on), so a busy thread can't stretch the total.
  useEffect(() => {
    if (phase !== 'countdown') return
    return runCountdown({
      from: 3,
      stepMs: startDelayRef.current / 3,
      onTick: (n) => {
        setCount(n)
        sfx.beep()
      },
      onDone: () => {
        sfx.gong()
        startRun()
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const startRun = () => {
    gameRef.current = createRunnerState(mulberry32(seedRef.current))
    flashUntilRef.current = 0
    lastRef.current = performance.now()
    lastSentRef.current = 0
    wakeLock.acquire()
    setOpp(OPPONENT_START)
    setOppLeft(false)
    setMyScore(0)
    setMyFinal(null)
    setOppFinal(null)
    setPhase('play')
    rafRef.current = requestAnimationFrame(loop)
  }

  const loop = (now: number) => {
    const g = gameRef.current
    const cv = overlayRef.current
    if (!g || !cv) return
    if (cv.width !== cv.clientWidth || cv.height !== cv.clientHeight) {
      cv.width = cv.clientWidth
      cv.height = cv.clientHeight
    }
    const dt = Math.min((now - lastRef.current) / 1000, 0.05)
    lastRef.current = now

    const c = controlRef.current
    const ev = stepRunner(g, {
      dt,
      lane: c.lane,
      airborne: c.airborne,
      crouching: c.crouching,
      nowMs: now,
    })
    if (ev.coin) sfx.tick()
    if (ev.dodge) sfx.release()
    if (ev.hit) {
      flashUntilRef.current = now + 350
      sfx.whistle()
    }

    // Heartbeat the opponent (throttled).
    if (now - lastSentRef.current >= STATE_EVERY_MS) {
      lastSentRef.current = now
      const score = runnerScore(g)
      setMyScore(score)
      connRef.current?.send({
        t: 'state',
        distance: g.distance,
        coins: g.coins,
        lives: g.lives,
        over: g.over,
        score,
      })
    }

    const ctx = cv.getContext('2d')
    if (ctx) drawScene(ctx, cv.width, cv.height, g, c, now < flashUntilRef.current, now)

    if (ev.gameOver) {
      sfx.victory()
      const score = runnerScore(g)
      setMyScore(score)
      setMyFinal(score)
      connRef.current?.send({ t: 'over', score, coins: g.coins })
      setPhase('over')
      return
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  const handleRematch = () => {
    // The connection persists — recalibrate and the host restarts with a new seed.
    setMyReady(false)
    setOppReady(false)
    setOpp(OPPONENT_START)
    setOppLeft(false)
    setMyScore(0)
    setMyFinal(null)
    setOppFinal(null)
    setPhase('ready')
  }

  const goBack = () => {
    cancelAnimationFrame(rafRef.current)
    connRef.current?.close()
    stop()
    wakeLock.release()
    window.location.hash = ''
    window.location.reload()
  }

  /* ---------------- Derived ---------------- */

  const bothDone = myFinal !== null && oppFinal !== null
  const outcome =
    myFinal === null || oppFinal === null
      ? null
      : myFinal > oppFinal
        ? 'win'
        : myFinal < oppFinal
          ? 'lose'
          : 'tie'
  const showWorld = phase === 'play' || phase === 'over' || phase === 'countdown'

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950 font-brand text-white select-none">
      <video ref={videoRef} className="hidden" playsInline muted />

      {/* Split: my side (world / self-cam) + opponent's live video. */}
      <div className="flex h-full w-full flex-col landscape:flex-row">
        {/* My side */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-950">
          {/* Metro world (shown once the run starts). */}
          <canvas
            ref={overlayRef}
            className={`absolute inset-0 h-full w-full ${showWorld ? '' : 'hidden'}`}
          />
          {/* Self-cam: full while framing/calibrating, a small PiP during the run. */}
          <canvas
            ref={canvasRef}
            className={
              showWorld
                ? 'absolute bottom-2 left-2 z-10 h-24 w-20 rounded-xl object-cover shadow-lg ring-2 ring-white/25 landscape:h-28 landscape:w-24'
                : 'absolute inset-0 h-full w-full object-cover'
            }
          />
          {!showWorld && (
            <>
              <div className="pointer-events-none absolute inset-3 rounded-2xl ring-2 ring-white/15" />
              <SideTag label={t('runner.you')} accent />
            </>
          )}
          {phase === 'play' && !reliable && (
            <div className="absolute inset-x-0 bottom-3 z-20 flex justify-center">
              <div className="rounded-full bg-danger/90 px-4 py-1.5 text-xs font-bold shadow-lg">
                {t('runner.inFrame')}
              </div>
            </div>
          )}
        </div>

        {/* Opponent side */}
        <div className="relative min-h-0 flex-1 overflow-hidden border-t-2 border-white/10 bg-black landscape:border-l-2 landscape:border-t-0">
          <video
            ref={remoteVideoRef}
            className="absolute inset-0 h-full w-full bg-black object-cover"
            playsInline
            autoPlay
          />
          {conn !== 'connected' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/85 text-sm text-white/50">
              <WifiOff className="size-7 opacity-60" />
              {t('online.oppOffline')}
            </div>
          )}
          <SideTag label={t('online.opponent')} />
          {(phase === 'play' || phase === 'over') && (
            <div className="absolute right-3 top-3 rounded-2xl bg-black/60 px-4 py-2 text-right backdrop-blur">
              <div className="text-3xl font-black tabular-nums leading-none">{opp.score}</div>
              <div className="mt-1 text-sm tracking-widest">
                <Hearts lives={opp.lives} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center VS score badge during the race. */}
      {phase === 'play' && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 landscape:left-1/2 landscape:top-3">
          <div className="flex items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 shadow-lg backdrop-blur">
            <span
              className={`tabular-nums text-lg font-black ${myScore >= opp.score ? 'text-accent' : 'text-white/60'}`}
            >
              {myScore}
            </span>
            <Swords className="size-4 text-white/50" />
            <span
              className={`tabular-nums text-lg font-black ${opp.score > myScore ? 'text-accent' : 'text-white/60'}`}
            >
              {opp.score}
            </span>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-40 flex items-center justify-between p-3">
        {phase !== 'play' ? (
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 rounded-full bg-black/55 px-4 py-2 text-sm font-semibold backdrop-blur transition-colors hover:bg-black/70"
          >
            <ArrowLeft className="size-4" /> {t('common.back')}
          </button>
        ) : (
          <span />
        )}
        {(phase === 'menu' || phase === 'signal' || phase === 'ready') && (
          <div className="flex items-center gap-2">
            <ConnPill conn={conn} role={role} />
            <label className="flex items-center gap-2 rounded-full bg-black/55 px-3 py-2 text-xs backdrop-blur">
              <input
                type="checkbox"
                checked={mirror}
                onChange={(e) => setMirror(e.target.checked)}
                className="accent-lime-400"
              />
              {t('online.mirror')}
            </label>
          </div>
        )}
      </div>

      {/* Countdown */}
      {phase === 'countdown' && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div
            key={count}
            className="countdown-digit animate-countdown-pop text-[26vh] font-black leading-none"
          >
            {count}
          </div>
        </div>
      )}

      {/* ---------------- Menu ---------------- */}
      {phase === 'menu' && (
        <Screen>
          <Hero
            icon={<Swords className="size-9 text-accent" />}
            title={t('online.title')}
            subtitle={t('online.subtitle')}
          />
          <div className="flex w-full max-w-xs flex-col gap-3">
            <BigButton onClick={() => beginRole('host')} tone="accent" icon={<Plus className="size-5" />}>
              {t('online.create')}
            </BigButton>
            <BigButton onClick={() => beginRole('guest')} tone="light" icon={<LogIn className="size-5" />}>
              {t('online.join')}
            </BigButton>
          </div>
          <p className="max-w-xs text-center text-xs text-white/40">{t('online.menuHint')}</p>
        </Screen>
      )}

      {/* ---------------- Signaling ---------------- */}
      {phase === 'signal' && (
        <Screen scroll>
          <div className="w-full max-w-md">
            <h1 className="mb-1 flex items-center gap-2 text-xl font-black">
              {role === 'host' ? <Plus className="size-5 text-accent" /> : <LogIn className="size-5 text-accent" />}
              {role === 'host' ? t('online.create') : t('online.join')}
            </h1>
            <p className="mb-4 flex items-center gap-2 text-xs text-white/45">
              <CameraStatus status={status} /> · <ConnPill conn={conn} role={role} bare />
            </p>

            {status === 'error' && error && (
              <div className="mb-4 rounded-xl bg-danger/85 px-4 py-3 text-sm">{error}</div>
            )}

            {role === 'host' && (
              <div className="flex flex-col gap-4">
                <Step n={1} title={t('online.step1Host')} done={conn === 'connected'}>
                  {offerCode ? (
                    <CodeShare
                      code={offerCode}
                      shareValue={inviteUrl(offerCode)}
                      shareLabel={t('online.inviteByLink')}
                    />
                  ) : (
                    <PendingLine text={t('online.preparingInvite')} />
                  )}
                </Step>
                <Step n={2} title={t('online.step2Host')} done={conn === 'connected'}>
                  <PasteRow
                    value={pasteInput}
                    onChange={setPasteInput}
                    placeholder={t('online.answerPlaceholder')}
                    busy={signalBusy}
                    disabled={conn === 'connected'}
                    action={t('online.connect')}
                    onAction={handleAcceptAnswer}
                  />
                </Step>
              </div>
            )}

            {role === 'guest' && (
              <div className="flex flex-col gap-4">
                <Step n={1} title={t('online.step1Guest')} done={Boolean(answerCode)}>
                  <PasteRow
                    value={pasteInput}
                    onChange={setPasteInput}
                    placeholder={t('online.invitePlaceholder')}
                    busy={signalBusy}
                    disabled={Boolean(answerCode) || status !== 'running'}
                    action={t('online.next')}
                    onAction={handleAcceptOffer}
                  />
                </Step>
                <Step n={2} title={t('online.step2Guest')} done={conn === 'connected'}>
                  {answerCode ? (
                    <>
                      <CodeShare code={answerCode} shareLabel={t('online.sendAnswer')} />
                      <PendingLine text={t('online.waitHost')} spin />
                    </>
                  ) : (
                    <p className="text-xs text-white/35">{t('online.afterStep1')}</p>
                  )}
                </Step>
              </div>
            )}

            {signalError && (
              <div className="mt-4 rounded-xl bg-danger/80 px-4 py-2.5 text-xs">{signalError}</div>
            )}

            {conn === 'failed' && (
              <div className="mt-3 rounded-xl bg-white/5 px-4 py-3 text-xs text-white/60 ring-1 ring-white/10">
                {t('online.directFail')}
              </div>
            )}
          </div>
        </Screen>
      )}

      {/* ---------------- Ready room (over the live camera) ---------------- */}
      {phase === 'ready' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-end gap-4 bg-gradient-to-b from-black/30 via-transparent to-black/80 p-6 landscape:justify-center">
          <div className="overlay-panel w-full max-w-sm rounded-3xl p-5 text-center">
            <h1 className="mb-1 text-lg font-black">{t('online.warmup')}</h1>
            <p className="text-sm text-white/70">{t('online.warmupHint')}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <ReadyChip label={t('online.me')} ready={myReady} />
              <ReadyChip label={t('online.opp')} ready={oppReady} />
            </div>
          </div>

          {status === 'running' ? (
            <BigButton
              onClick={handleCalibrate}
              tone={myReady ? 'light' : 'accent'}
              disabled={calibrating}
              icon={calibrating ? <RefreshCw className="size-5 animate-spin" /> : undefined}
            >
              {calibrating
                ? t('runner.holdStill')
                : myReady
                  ? t('online.recalibrate')
                  : t('online.readyBtn')}
            </BigButton>
          ) : (
            <div className="rounded-full bg-black/60 px-8 py-4 text-lg font-semibold backdrop-blur">
              {t('runner.startingCamera')}
            </div>
          )}

          {role === 'host' ? (
            <BigButton
              onClick={handleHostStart}
              tone="accent"
              disabled={!myReady || !oppReady}
              icon={<Swords className="size-5" />}
            >
              {myReady && oppReady ? t('setup.start') : t('online.waitReady')}
            </BigButton>
          ) : (
            <p className="rounded-full bg-black/50 px-5 py-2 text-sm text-white/60 backdrop-blur">
              {t('online.hostStarts')}
            </p>
          )}
        </div>
      )}

      {/* ---------------- Result ---------------- */}
      {phase === 'over' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-black/75 p-8 backdrop-blur">
          {bothDone ? (
            <div className="animate-winner-flash text-center">
              {outcome === 'win' && <Crown className="mx-auto mb-2 size-12 text-gold" />}
              <div
                className={`text-4xl font-black ${
                  outcome === 'win'
                    ? 'text-accent'
                    : outcome === 'lose'
                      ? 'text-danger'
                      : 'text-white'
                }`}
              >
                {outcome === 'win' ? t('online.win') : outcome === 'lose' ? t('online.lose') : t('online.tie')}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-2xl font-black text-white/80">
              <RefreshCw className="size-6 animate-spin" /> {t('online.waitOpp')}
            </div>
          )}

          <div className="flex items-stretch justify-center gap-4">
            <ScoreCard label={t('online.me')} value={myFinal} win={outcome === 'win'} />
            <div className="flex items-center text-2xl font-black text-white/30">VS</div>
            <ScoreCard label={t('online.opp')} value={oppFinal} win={outcome === 'lose'} />
          </div>

          {oppLeft && <p className="-mt-2 text-sm text-white/50">{t('online.oppLeft')}</p>}

          <div className="flex gap-3">
            <BigButton
              onClick={handleRematch}
              tone="accent"
              disabled={conn !== 'connected'}
              icon={<RefreshCw className="size-5" />}
            >
              {t('runner.again')}
            </BigButton>
            <BigButton onClick={goBack} tone="ghost">
              {t('runner.exit')}
            </BigButton>
          </div>
        </div>
      )}
    </div>
  )
}
