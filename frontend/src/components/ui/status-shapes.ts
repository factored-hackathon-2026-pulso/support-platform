/**
 * The status glyphs (Linear-style, drawn with strokes on a 16 px grid):
 *
 * - `dashed`: dashed ring (nobody has it yet: "Sin asignar")
 * - `ring`: empty ring (not started: "Nuevo"; availability: "Disponible", "Sin conexión")
 * - `pie-25` / `pie-50` / `pie-75`: ring with a pie of that share (in progress)
 * - `check`: filled circle with a check (done: "Cerrado", "Activa")
 * - `cross`: filled circle with an x (off: "Desactivada", "Inactivo")
 * - `dot`: filled circle (busy: "Atendiendo")
 * - `pause`: ring with a pause glyph ("En pausa")
 * - `lock`: ring with a lock ("Bloqueada")
 */
export type StatusShape =
  'dashed' | 'ring' | 'pie-25' | 'pie-50' | 'pie-75' | 'check' | 'cross' | 'dot' | 'pause' | 'lock'

export const STATUS_SHAPES: readonly StatusShape[] = [
  'dashed',
  'ring',
  'pie-25',
  'pie-50',
  'pie-75',
  'check',
  'cross',
  'dot',
  'pause',
  'lock',
]
