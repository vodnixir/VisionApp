import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useI18n } from '../../i18n'

/**
 * A QR code for the invite / answer link, so two phones in the same room connect
 * by pointing one camera at the other's screen — no typing, no copy-paste. The
 * qrcode dependency is bundled by Vite, so this works fully offline in the APK.
 *
 * Scannability is the whole game here. The payload is a compressed SDP link
 * (~1030 chars → version 23, 109×109 modules), and a camera needs roughly 3
 * screen pixels per module to resolve it. That budget is why the camera track
 * was moved out of the handshake (see net.ts) — with video in the offer this
 * was ~149×149 modules at 1.2 px/module, i.e. physically unreadable.
 *
 * So: the inline code fills whatever width it's given (never overflowing a
 * narrow phone), and tapping it opens a full-screen version that uses the whole
 * viewport — the reliable way to hit 3 px/module on any device.
 */
export function Qr({ value, size = 320 }: { value: string; size?: number }) {
  const { t } = useI18n()
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [full, setFull] = useState(false)

  useEffect(() => {
    let alive = true
    setFailed(false)
    QRCode.toDataURL(value, {
      errorCorrectionLevel: 'L', // lowest ECC → most data capacity for a long link
      margin: 2,
      // Render well above display size so the full-screen blow-up stays crisp.
      width: 1024,
    })
      .then((url) => {
        if (alive) setDataUrl(url)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [value])

  if (failed || !dataUrl) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setFull(true)}
        title={t('online.qrTapFull')}
        className="mx-auto block w-full overflow-hidden rounded-xl bg-white p-2"
        style={{ maxWidth: size }}
      >
        <img src={dataUrl} alt="QR" className="block w-full" />
      </button>

      {full && (
        <div
          role="dialog"
          onClick={() => setFull(false)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white p-3"
        >
          {/* Square and as large as the viewport allows — maximum px per module. */}
          <img
            src={dataUrl}
            alt="QR"
            className="block h-auto w-full"
            style={{ maxWidth: 'min(96vw, 96vh)' }}
          />
          <p className="text-center text-sm font-semibold text-black/60">{t('online.qrTapClose')}</p>
        </div>
      )}
    </>
  )
}
