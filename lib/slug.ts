import slugify from 'slugify'

/** The longest id a name gives: ids become folder names, and a path longer than the file system allows (ENAMETOOLONG) breaks the run. */
export const MAX_ID_LENGTH = 48

/** Lowercase, dashes, no odd characters, cut at a whole word where it can be. Empty when the name has nothing to keep. */
export function toSlug(name: string): string {
    const full = slugify(name, {lower: true, strict: true})
    if (full.length <= MAX_ID_LENGTH) return full
    const cut = full.slice(0, MAX_ID_LENGTH)
    const atWord = cut.slice(0, Math.max(0, cut.lastIndexOf('-')))
    return (atWord.length >= MAX_ID_LENGTH / 2 ? atWord : cut).replace(/-+$/, '')
}
