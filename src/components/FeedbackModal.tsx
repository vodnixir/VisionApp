import { Lightbulb, Send, X } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'

const MAX_LENGTH = 500
/** How long the "sent" confirmation stays up before the modal auto-closes. */
const AUTO_CLOSE_MS = 1400

interface Props {
  onClose: () => void
}

/**
 * Improvement/suggestion box: type an idea, hit send. There is no backend yet
 * — submission just logs the text and shows a success state — so wiring up a
 * real endpoint later only means replacing the body of handleSubmit.
 */
export function FeedbackModal({ onClose }: Props) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)

  const canSubmit = text.trim().length > 0 && !sent

  const handleSubmit = () => {
    const suggestion = text.trim()
    if (!suggestion) return
    // TODO(backend): POST this to a real feedback endpoint once one exists.
    console.log('[feedback] suggestion submitted:', suggestion)
    setSent(true)
    setTimeout(onClose, AUTO_CLOSE_MS)
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-3xl border border-edge bg-page p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="flex flex-col">
            <span className="flex items-center gap-2 text-lg font-semibold text-t1">
              <Lightbulb className="size-5 text-t3" aria-hidden />
              {t('feedback.title')}
            </span>
            <span className="mt-0.5 text-xs text-t3">{t('feedback.subtitle')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.back')}
            className="rounded-lg p-1.5 text-t3 transition-colors hover:bg-selbg hover:text-t1"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        {sent ? (
          <p className="rounded-2xl border border-edge bg-card px-4 py-6 text-center text-sm font-semibold text-t1">
            {t('feedback.sent')}
          </p>
        ) : (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
              placeholder={t('feedback.placeholder')}
              rows={4}
              autoFocus
              className="w-full resize-none rounded-2xl border border-edge bg-card px-4 py-3 text-sm text-t1 outline-none placeholder:text-t3 focus:border-edge2"
            />
            <div className="mt-1 text-right text-[11px] text-t3">
              {text.length}/{MAX_LENGTH}
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-3 text-base font-black text-on-accent transition-transform active:scale-[0.98] disabled:opacity-40"
            >
              <Send className="size-4" aria-hidden />
              {t('feedback.submit')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
