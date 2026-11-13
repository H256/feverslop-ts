import type {Character} from './project.ts'
import {toSlug} from './slug.ts'

// A prop as a thing of its own (#944): a name, the words it is drawn from, and an id - the id names its picture,
// assets/props/<id>.png. A film plans its props (lib/film/types.ts FilmProp is this type); a music video has them in the cast's
// prop field and builds them from it here (config.propPictures), one per character who has one - no planning step of its own.
export type Prop = {id: string; name: string; description: string}

// the article or possessive in front of a prop's words is not part of its name: "her battered bass" is "battered bass"
const leading = /^(?:a|an|the|his|her|their|its|my|our|your)\s+/i

/** The name a prop goes by: its words without the article in front ("an obsidian drum kit" - "obsidian drum kit"). */
export const propName = (words: string) => words.trim().replace(leading, '').replace(/[.]+$/, '').trim() || words.trim()

/**
 * The props of a music video's cast, by the character they belong to: one for everybody with a prop, carried (a guitar) or standing
 * in a place (a drum kit). The words of the cast describe it; two characters with the same prop get one id each.
 */
export function castProps(characters: Pick<Character, 'id' | 'prop'>[]): Record<string, Prop> {
    const taken = new Set<string>()
    const props: Record<string, Prop> = {}
    for (const c of characters) {
        const words = c.prop?.trim()
        if (!words) continue
        const name = propName(words)
        const base = toSlug(name) || `${c.id}-prop`
        let id = base
        for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
        taken.add(id)
        props[c.id] = {id, name, description: words.replace(/[.]+$/, '')}
    }
    return props
}
