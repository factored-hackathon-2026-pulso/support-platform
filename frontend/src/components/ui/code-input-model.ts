/**
 * Pure editing rules for CodeInput (one box per digit, contiguous value).
 * The value is a string of 0..length digits; empty boxes are the tail.
 */

/** Keeps digits only, up to `length`. */
export function sanitizeDigits(raw: string, length: number): string {
  return raw.replace(/\D/g, '').slice(0, length)
}

/**
 * Writes `digits` starting at box `index` (clamped to the first empty box, so
 * the value never has holes). Returns the new value and the box to focus next.
 */
export function insertDigits(value: string, index: number, digits: string, length: number) {
  const clean = sanitizeDigits(digits, length)
  if (!clean) return { value, focus: Math.min(index, length - 1) }
  const start = Math.min(Math.max(0, index), value.length)
  const next = (value.slice(0, start) + clean + value.slice(start + clean.length)).slice(0, length)
  return { value: next, focus: Math.min(start + clean.length, length - 1) }
}

/**
 * Backspace on box `index`: clears it when filled (later digits shift left),
 * otherwise clears the previous box and moves there.
 */
export function deleteDigit(value: string, index: number) {
  if (index < value.length) {
    return { value: value.slice(0, index) + value.slice(index + 1), focus: index }
  }
  const previous = Math.max(0, Math.min(index, value.length) - 1)
  return { value: value.slice(0, previous), focus: previous }
}
