import { useState, type ReactNode } from 'react'
import { Check, Copy, QrCode, RefreshCw, Share2, Wifi, WifiOff } from 'lucide-react'
import { useI18n, type I18nKey } from '../../i18n'
import { START_LIVES } from '../../runner/game'
import type { ConnState, Role } from '../../online/net'
import { Qr } from './Qr'

/**
 * Presentational building blocks for the online-battle screen. They're all pure
 * (state only where a control owns its own transient UI, like the "Copied" tick)
 * so the screen component itself can stay focused on the connection and game
 * lifecycle. Text-bearing ones read their own strings from i18n.
 */

/** Full-screen menu-style page with the app's neon-aware grid background. */
export function Screen({ children, scroll }: { children: ReactNode; scroll?: boolean }) {
  return (
    <div
      className={`screen absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-page/95 px-5 py-16 text-t1 backdrop-blur-sm ${
        scroll ? 'overflow-y-auto' : ''
      }`}
    >
      {children}
    </div>
  )
}

export function Hero({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode
  title: string
  subtitle: string
}) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-card2 ring-1 ring-edge">
        {icon}
      </div>
      <h1 className="text-2xl font-black text-t1">{title}</h1>
      <p className="text-sm text-t3">{subtitle}</p>
    </div>
  )
}

type Tone = 'accent' | 'light' | 'ghost'

export function BigButton({
  children,
  onClick,
  tone = 'accent',
  disabled,
  icon,
}: {
  children: ReactNode
  onClick: () => void
  tone?: Tone
  disabled?: boolean
  icon?: ReactNode
}) {
  const tones: Record<Tone, string> = {
    accent: 'bg-accent text-on-accent',
    light: 'bg-chip text-onchip',
    ghost: 'bg-card2 text-t2 ring-1 ring-edge',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 rounded-full px-8 py-4 text-lg font-black shadow-lg transition-transform active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${tones[tone]}`}
    >
      {icon}
      {children}
    </button>
  )
}

/** A numbered step with a completion tick. */
export function Step({
  n,
  title,
  done,
  children,
}: {
  n: number
  title: string
  done?: boolean
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-edge bg-card p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className={`flex size-6 items-center justify-center rounded-full text-xs font-black ${
            done ? 'bg-accent text-on-accent' : 'bg-selbg text-t2'
          }`}
        >
          {done ? <Check className="size-3.5" /> : n}
        </span>
        <span className="text-sm font-bold text-t1">{title}</span>
      </div>
      {children}
    </div>
  )
}

/**
 * A read-only code with Share + Copy actions. When `shareValue` is given (an
 * invite message with the link, or a reply message with the code), the buttons
 * act on THAT while the raw code stays visible as a manual fallback. `qrValue`
 * lets the QR carry just the bare link/code instead of the whole chat message.
 */
export function CodeShare({
  code,
  shareLabel,
  shareValue,
  qrValue,
}: {
  code: string
  shareLabel: string
  shareValue?: string
  qrValue?: string
}) {
  const { t } = useI18n()
  const payload = shareValue ?? code
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(payload).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ text: payload })
        return
      }
    } catch {
      /* user cancelled / unsupported */
    }
    copy()
  }
  return (
    <div className="flex flex-col gap-2">
      {showQr && (
        <div className="flex flex-col items-center gap-1.5 py-1">
          <Qr value={qrValue ?? payload} size={180} />
          <span className="text-[11px] text-t3">{t('online.scanQr')}</span>
        </div>
      )}
      <div className="max-h-16 overflow-y-auto break-all rounded-lg border border-edge bg-card2 p-2 font-mono text-[10px] leading-relaxed text-t3">
        {code}
      </div>
      <div className="flex gap-2">
        <button
          onClick={share}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-black text-on-accent active:scale-95"
        >
          <Share2 className="size-4" /> {shareLabel}
        </button>
        <button
          onClick={() => setShowQr((v) => !v)}
          aria-pressed={showQr}
          className={`flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-edge active:scale-95 ${
            showQr ? 'bg-selbg text-t1' : 'bg-card2 text-t2'
          }`}
        >
          <QrCode className="size-4" /> QR
        </button>
        <button
          onClick={copy}
          className="flex items-center justify-center gap-1.5 rounded-full bg-card2 px-4 py-2 text-sm font-semibold text-t2 ring-1 ring-edge active:scale-95"
        >
          {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4" />}
          {copied ? t('online.copied') : t('online.copy')}
        </button>
      </div>
    </div>
  )
}

/** A paste field + confirm button. */
export function PasteRow({
  value,
  onChange,
  placeholder,
  busy,
  disabled,
  action,
  onAction,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  busy: boolean
  disabled?: boolean
  action: string
  onAction: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="h-16 w-full resize-none rounded-lg border border-edge bg-card2 p-2.5 font-mono text-xs text-t1 placeholder:text-t3 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
      />
      <button
        onClick={onAction}
        disabled={busy || disabled || !value.trim()}
        className="flex items-center justify-center gap-1.5 rounded-full bg-chip px-5 py-2 text-sm font-black text-onchip active:scale-95 disabled:opacity-40"
      >
        {busy ? <RefreshCw className="size-4 animate-spin" /> : null}
        {busy ? t('online.wait') : action}
      </button>
    </div>
  )
}

export function PendingLine({ text, spin }: { text: string; spin?: boolean }) {
  return (
    <p className="mt-2 flex items-center gap-2 text-xs text-t3">
      <RefreshCw className={`size-3.5 ${spin ? 'animate-spin' : ''}`} /> {text}
    </p>
  )
}

/** Live connection status pill. */
export function ConnPill({ conn, role, bare }: { conn: ConnState; role: Role | null; bare?: boolean }) {
  const { t } = useI18n()
  const meta: Record<ConnState, { key: I18nKey; cls: string }> = {
    new: { key: 'online.connNew', cls: 'text-t3' },
    connecting: { key: 'online.connConnecting', cls: 'text-gold' },
    connected: { key: 'online.connLive', cls: 'text-accent' },
    failed: { key: 'online.connFailed', cls: 'text-danger' },
    closed: { key: 'online.connClosed', cls: 'text-t3' },
  }
  const s = meta[conn]
  const inner = (
    <>
      {conn === 'connected' ? (
        <Wifi className="size-3.5" />
      ) : conn === 'failed' ? (
        <WifiOff className="size-3.5" />
      ) : (
        <span className={`glow-dot size-2 rounded-full bg-current ${conn === 'connecting' ? 'animate-pulse' : ''}`} />
      )}
      {t(s.key)}
      {role && !bare && (
        <span className="opacity-50">· {t(role === 'host' ? 'online.roleHost' : 'online.roleGuest')}</span>
      )}
    </>
  )
  if (bare) return <span className={`inline-flex items-center gap-1.5 ${s.cls}`}>{inner}</span>
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-2 text-xs font-semibold backdrop-blur ${s.cls}`}
    >
      {inner}
    </span>
  )
}

export function CameraStatus({ status }: { status: string }) {
  const { t } = useI18n()
  const label =
    status === 'running'
      ? t('online.camReady')
      : status === 'starting'
        ? t('runner.startingCamera')
        : status === 'error'
          ? t('online.noCamera')
          : t('online.camera')
  return (
    <span className={`inline-flex items-center gap-1 ${status === 'running' ? 'text-accent' : ''}`}>
      {label}
    </span>
  )
}

export function ReadyChip({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div
      className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold ${
        ready ? 'bg-accent/20 text-accent' : 'bg-card2 text-t3'
      }`}
    >
      {ready ? <Check className="size-4" /> : <span className="size-2 rounded-full bg-current" />}
      {label}
    </div>
  )
}

export function ScoreCard({
  label,
  value,
  win,
}: {
  label: string
  value: number | null
  win?: boolean
}) {
  return (
    <div
      className={`min-w-24 rounded-2xl px-5 py-3 text-center ${
        win ? 'bg-accent/15 ring-2 ring-accent' : 'bg-white/5 ring-1 ring-white/10'
      }`}
    >
      <div className="text-xs uppercase tracking-widest text-white/45">{label}</div>
      <div className="mt-1 text-5xl font-black tabular-nums">{value ?? '…'}</div>
    </div>
  )
}

export function SideTag({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <div
      className={`absolute left-3 top-3 z-10 rounded-full px-3 py-1 text-xs font-black tracking-widest backdrop-blur ${
        accent ? 'bg-accent/85 text-on-accent' : 'bg-black/55 text-white'
      }`}
    >
      {label}
    </div>
  )
}

export function Hearts({ lives }: { lives: number }) {
  return (
    <>
      {'❤️'.repeat(Math.max(0, lives))}
      {'🖤'.repeat(Math.max(0, START_LIVES - lives))}
    </>
  )
}
