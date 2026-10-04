import { useMemo } from 'react'
import { qrSvg } from '../qr'

export interface QrCodeProps {
  /** What the code encodes (the `otpauth://` URI). */
  value: string
  /** Accessible name (the image's `alt`). */
  label: string
  size?: number
}

/**
 * A QR code as an image (an inline SVG data URL of `qrMatrix`, error correction M, a
 * 2-cell quiet zone). Black on white whatever the theme: scanners need the contrast.
 */
export function QrCode({ value, label, size = 168 }: QrCodeProps) {
  const src = useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg(value))}`, [value])
  return (
    <img
      src={src}
      alt={label}
      width={size}
      height={size}
      className="shrink-0 rounded-12 border border-border bg-white p-2.5 [image-rendering:pixelated]"
    />
  )
}
