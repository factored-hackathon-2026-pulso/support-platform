/**
 * QR matrix of a text, through `qrcode-generator` (pinned exact version in
 * package.json): the smallest version that fits, error correction M, byte mode.
 * Kept apart from the component so the library is used in one place.
 */
import qrcode from 'qrcode-generator'

export function qrMatrix(text: string): boolean[][] {
  const code = qrcode(0, 'M')
  code.addData(text)
  code.make()
  const count = code.getModuleCount()
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => code.isDark(row, col)),
  )
}

/** The matrix as a standalone SVG (black cells on white, a 2-cell quiet zone). */
export function qrSvg(text: string, quiet = 2): string {
  const matrix = qrMatrix(text)
  const cells = matrix.length + quiet * 2
  let path = ''
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`
    }),
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cells} ${cells}" shape-rendering="crispEdges"><rect width="${cells}" height="${cells}" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`
}
