/**
 * Finds UI copy written in code instead of a catalog (slice 23 guard rail, used by
 * `i18n-literals.test.ts`). Pure: it parses sources with the TypeScript compiler API.
 *
 * What counts as copy:
 * - in `.tsx`: every JSX text with a letter; every string or template text that reads like
 *   prose (a non-ASCII letter, a space between words, or a capitalised word: "Cerrar caso",
 *   "Equipo", "¿La olvidaste?") outside the technical places below;
 * - in `.ts`: only strings with a non-ASCII letter or ¿ ¡ ("Configuración", "días"), since
 *   plain ASCII there is mostly identifiers and developer messages.
 *
 * Never copy: imports, type positions, object keys, comparisons and `case` labels, the
 * arguments of `t()` / `i18n.t()` / `useTranslation()` (keys), errors and `console`, class
 * names (`cn()`, `className`, Tailwind-looking strings) and technical JSX attributes (`id`,
 * `href`, `role`, `variant`…). A deliberate literal (a brand, a language's own name) carries
 * `// i18n-ignore` on its line or `// i18n-ignore-next-line` on the line above.
 */
import ts from 'typescript'

export interface LiteralFinding {
  file: string
  line: number
  text: string
}

/** JSX attributes whose values are never shown to people. */
const TECHNICAL_ATTRIBUTES = new Set([
  'accept',
  'align',
  'as',
  'autoComplete',
  'className',
  'd',
  'dir',
  'enterKeyHint',
  'fill',
  'form',
  'href',
  'htmlFor',
  'icon',
  'id',
  'inputMode',
  'key',
  'lang',
  'layout',
  'method',
  'mode',
  'name',
  'pattern',
  'rel',
  'role',
  'shape',
  'side',
  'size',
  'src',
  'stroke',
  'target',
  'to',
  'tone',
  'transform',
  'type',
  'variant',
  'viewBox',
  'aria-controls',
  'aria-current',
  'aria-describedby',
  'aria-haspopup',
  'aria-hidden',
  'aria-labelledby',
  'aria-live',
  'aria-relevant',
])

/** Calls whose string arguments are never copy. */
const TECHNICAL_CALLS = new Set([
  'addEventListener',
  'removeEventListener',
  'clsx',
  'cn',
  'twMerge',
  'getItem',
  'setItem',
  'removeItem',
  'matchMedia',
  'querySelector',
  'querySelectorAll',
  'closest',
  'useTranslation',
  'getFixedT',
  't',
])

const ERROR_CONSTRUCTOR = /Error$/

const NON_ASCII_LETTER = /\P{ASCII}/u
const LETTER = /\p{L}/u
const WORDS_WITH_SPACE = /\p{L}[^\S\n]+\p{L}/u
const CAPITALISED_WORD = /(^|[^\p{L}])\p{Lu}\p{Ll}/u
const CLASS_TOKEN = /^[a-z0-9!:@\-[\]/.%_#()=,&>~*+'"]+$/
const SPANISH_PUNCTUATION = /[¿¡]/

/** "bg-warn text-ink", "flex items-center": Tailwind classes, not copy. */
function looksLikeClasses(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  return (
    tokens.length > 0 &&
    tokens.every((token) => CLASS_TOKEN.test(token)) &&
    tokens.some((token) => /[-:[]/.test(token))
  )
}

function readsLikeProse(text: string): boolean {
  if (!LETTER.test(text) || looksLikeClasses(text)) return false
  return (
    NON_ASCII_LETTER.test(text) ||
    SPANISH_PUNCTUATION.test(text) ||
    WORDS_WITH_SPACE.test(text) ||
    CAPITALISED_WORD.test(text)
  )
}

function hasSpanishCharacters(text: string): boolean {
  return (
    /[\p{L}]/u.test(text) &&
    (/[áéíóúüñÁÉÍÓÚÜÑçãõâêôàÇÃÕÂÊÔ]/u.test(text) || SPANISH_PUNCTUATION.test(text))
  )
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return null
}

function isConsoleCall(call: ts.CallExpression): boolean {
  const callee = call.expression
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'console'
  )
}

/** Whether a literal sits in a place that is never copy. */
function isTechnicalPlace(node: ts.Node): boolean {
  let child: ts.Node = node
  let parent = node.parent
  // Look through wrappers that keep the value as it is.
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isTemplateSpan(parent) ||
      ts.isTemplateExpression(parent) ||
      (ts.isConditionalExpression(parent) && child !== parent.condition) ||
      (ts.isBinaryExpression(parent) &&
        (parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
          parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) ||
      ts.isArrayLiteralExpression(parent))
  ) {
    child = parent
    parent = parent.parent
  }
  if (!parent) return false
  if (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    ts.isLiteralTypeNode(parent) ||
    ts.isElementAccessExpression(parent) ||
    ts.isCaseClause(parent)
  ) {
    return true
  }
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === child
  ) {
    return true
  }
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    const key = parent.name.text
    if (key === 'className' || /Class(es|Name)?$/.test(key) || key === 'queryKey') return true
  }
  if (ts.isBinaryExpression(parent)) {
    const kind = parent.operatorToken.kind
    if (
      kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      kind === ts.SyntaxKind.EqualsEqualsToken ||
      kind === ts.SyntaxKind.ExclamationEqualsToken
    ) {
      return true
    }
  }
  if (ts.isCallExpression(parent) && parent.expression !== child) {
    if (parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true
    if (isConsoleCall(parent)) return true
    const name = calleeName(parent.expression)
    if (name && (TECHNICAL_CALLS.has(name) || /^use\w*Context$/.test(name))) return true
  }
  if (ts.isNewExpression(parent)) {
    const name = calleeName(parent.expression)
    if (name && ERROR_CONSTRUCTOR.test(name)) return true
  }
  if (ts.isJsxAttribute(parent)) {
    const name = parent.name.getText()
    return TECHNICAL_ATTRIBUTES.has(name) || name.startsWith('data-')
  }
  if (ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent)) {
    const name = parent.parent.name.getText()
    return TECHNICAL_ATTRIBUTES.has(name) || name.startsWith('data-')
  }
  return false
}

function ignoredLines(source: string): Set<number> {
  const ignored = new Set<number>()
  source.split('\n').forEach((line, index) => {
    if (/i18n-ignore-next-line/.test(line)) ignored.add(index + 2)
    else if (/i18n-ignore\b/.test(line)) ignored.add(index + 1)
  })
  return ignored
}

export interface FindOptions {
  /**
   * Treat `.ts` like `.tsx` (any prose-like string). Too noisy to enforce (identifiers,
   * developer messages), but a good estimate of what an area still has to migrate.
   */
  proseInTs?: boolean
}

/** The copy literals of one file (`file` is the project path, e.g. "src/app/roles.ts"). */
export function findLiterals(
  file: string,
  source: string,
  { proseInTs = false }: FindOptions = {},
): LiteralFinding[] {
  const isTsx = file.endsWith('.tsx')
  const prose = isTsx || proseInTs
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const ignored = ignoredLines(source)
  const findings: LiteralFinding[] = []

  function report(node: ts.Node, text: string): void {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
    if (ignored.has(line)) return
    findings.push({ file, line, text: text.trim().replace(/\s+/g, ' ') })
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      if (LETTER.test(node.text)) report(node, node.text)
      return
    }
    let text: string | null = null
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text
    else if (ts.isTemplateExpression(node)) {
      text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ')
    }
    if (text !== null) {
      const isCopy = prose ? readsLikeProse(text) : hasSpanishCharacters(text)
      if (isCopy && !isTechnicalPlace(node)) report(node, text)
      if (ts.isTemplateExpression(node)) {
        node.templateSpans.forEach((span) => visit(span.expression))
      }
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

/** Sources the guard looks at: app code, not tests, catalogs or generated files. */
export function isScannedFile(file: string): boolean {
  return (
    /^src\/.*\.tsx?$/.test(file) &&
    !/\.test\.tsx?$/.test(file) &&
    !file.endsWith('.d.ts') &&
    !file.startsWith('src/test/') &&
    !file.startsWith('src/locales/') &&
    file !== 'src/lib/api/schema.gen.ts'
  )
}
