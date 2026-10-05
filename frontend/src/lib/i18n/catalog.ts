/**
 * The shape of a translation (slice 23): the same keys as the Spanish source, any strings.
 *
 * Every `src/locales/pt-BR/<ns>.ts` ends with `satisfies Translation<typeof es>`, so a key
 * missing from (or added only to) the translation is a compile error, nested keys included.
 */
export type Translation<Source> = {
  readonly [Key in keyof Source]: Source[Key] extends string ? string : Translation<Source[Key]>
}
