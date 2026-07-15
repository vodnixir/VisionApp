import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/**
 * A QR code for the invite / answer link, so two phones in the same room connect
 * by pointing one camera at the other's screen — no typing, no copy-paste. The
 * qrcode dependency is bundled by Vite, so this works fully offline in the APK.
 *
 * The payload is a whole signaling link (a compressed SDP), which is long — the
 * code lands around version 20–30 and needs a steady close-up scan. The shareable
 * link stays the reliable primary channel; the QR is the same-room shortcut.
 */
export function Qr({ value, size = 200 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setFailed(false)
    QRCode.toDataURL(value, {
      errorCorrectionLevel: 'L', // lowest ECC → most data capacity for a long link
      margin: 2,
      width: size * 2, // render at 2× for crisp scaling
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
  }, [value, size])

  if (failed) return null
  return (
    <div
      className="mx-auto overflow-hidden rounded-xl bg-white p-2"
      style={{ width: size, height: size }}
    >
      {dataUrl && (
        <img src={dataUrl} alt="QR" width={size - 16} height={size - 16} className="block" />
      )}
    </div>
  )
}
