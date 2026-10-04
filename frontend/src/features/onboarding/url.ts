/**
 * URL state of the emailed links (part 4): `/activate?token=…` and `/reset-password?token=…`
 * (the backend builds them on `CC_PUBLIC_APP_URL`). Pure: unit-tested in url.test.ts.
 */
import { PATHS } from '@/app/paths'

/** `?token=` of the link (blank = no token: the invalid screen). */
export function readToken(params: URLSearchParams): string | null {
  const token = params.get('token')?.trim()
  return token ? token : null
}

const LINK_PATHS: readonly string[] = [PATHS.activate, PATHS.resetPassword]

/** The link of an email as an in-app path ("/activate?token=…"), or null when foreign. */
export function inAppPath(link: string): string | null {
  try {
    const url = new URL(link)
    if (!LINK_PATHS.includes(url.pathname)) return null
    return `${url.pathname}${url.search}`
  } catch {
    return null
  }
}
