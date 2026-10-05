import { useTranslation } from '@/lib/i18n'
import { formatDocumentTitle } from './document-title'

export interface DocumentTitleProps {
  /** Page name, usually the h1 ("Entrar", "Por aprobar"). */
  title: string
}

/**
 * Sets the browser tab title of the current screen (WCAG 2.4.2). React 19 hoists
 * the `<title>` into `<head>`, ahead of the static one in index.html, and removes
 * it on unmount. Render exactly one per screen: PageHeader and AuthHeading already
 * do it from their `title`.
 */
export function DocumentTitle({ title }: DocumentTitleProps) {
  useTranslation() // the app suffix follows the UI language
  return <title>{formatDocumentTitle(title)}</title>
}
