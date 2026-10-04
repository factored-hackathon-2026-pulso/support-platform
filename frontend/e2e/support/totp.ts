import { createHmac } from 'node:crypto'

/**
 * RFC 6238 TOTP as the backend checks it (SHA-1, 6 digits, 30-second steps): the e2e
 * computes the authenticator code of a person it invited from the key the activation
 * screen (or the API) shows, like an authenticator app would.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=]/g, '').toUpperCase()
  let bits = ''
  for (const char of clean) {
    const value = BASE32.indexOf(char)
    if (value < 0) throw new Error(`not base32: ${char}`)
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** HOTP (RFC 4226) of `counter` with `digits` digits. */
export function hotp(key: Buffer, counter: number, digits = 6): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(message).digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0)
  return String(binary % 10 ** digits).padStart(digits, '0')
}

/** The code of a base32 `secret` at `at` (milliseconds, default now). */
export function totpCode(secret: string, at: number = Date.now(), digits = 6): string {
  return hotp(base32Decode(secret), Math.floor(at / 1000 / 30), digits)
}

// RFC 6238 Appendix B (SHA-1): the 8-digit code at T = 59 s is 94287082. Checked once
// when the support loads, so a broken helper fails loudly instead of as a wrong code.
if (hotp(Buffer.from('12345678901234567890'), 1, 8) !== '94287082') {
  throw new Error('e2e TOTP helper does not match RFC 6238')
}
