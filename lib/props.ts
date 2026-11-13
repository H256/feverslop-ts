import type {Character} from './project.ts'
import {toSlug} from './slug.ts'
import {pictureAsset} from './compose.ts'
import type {PictureJob} from './render.ts'

// A prop as a thing of its own (#944): a name, the words it is drawn from, and an id - the id names its picture,
// assets/props/<id>.png. A film plans its props (lib/film/types.ts FilmProp is this type); a music video has them in the cast's
// prop field and builds them from it here (config.propPictures), one per character who has one - no planning step of its own.
export type Prop = {id: string; name: string; description: string}

/**
 * The picture of a prop: the thing alone on the grey backdrop of the character pictures - a plain picture, no sheet. Nobody holds it
 * and nothing else is in it: a hand or a place in it would be drawn into every clip that has the prop.
 */
export const propPicturePrompt = (prop: Prop) =>
    `A studio product photograph of ${withArticle(prop.description.replace(/[.]+$/, ''))}. The ${prop.name} alone, whole and centred, on a plain seamless neutral grey backdrop, even soft light from every side, sharp focus. Nothing else in the picture: no hands, no people, no other objects, no text.`

/** The picture job of a prop: one plain picture (assets/props/<id>.png), never a sheet - a prop has no sides worth a turnaround. */
export const propPictureJob = (prop: Prop): PictureJob => ({
    kind: 'prop',
    id: prop.id,
    file: pictureAsset('prop', prop.id),
    name: prop.name,
    prompt: propPicturePrompt(prop),
    description: prop.description,
})

/** A character as its pictures draw it: with config.propPictures its prop has a picture of its own and is in none of theirs (#944). */
export const asDrawn = <C extends Pick<Character, 'prop'>>(c: C, propPictures: boolean): C & {propPicture?: true} =>
    propPictures && c.prop ? {...c, propPicture: true} : c

/**
 * The props a place's look names: kept - the characters' own, which come into a clip with them and so are not in the place; standing -
 * the ones that stand in it and are used there (a drum kit), drawn into it once. With config.propPictures a standing prop comes with
 * its player too, as a picture of its own: the place is drawn without it and stays reusable (#944).
 */
export function propsOfPlace(characters: Pick<Character, 'prop' | 'propCarried' | 'propPlace'>[], locationId: string, propPictures: boolean) {
    const kept = characters.flatMap(c => (c.prop && (propPictures || c.propCarried !== false) ? [c.prop] : []))
    const standing = propPictures ? [] : characters.flatMap(c => (c.prop && c.propCarried === false && c.propPlace === locationId ? [c.prop] : []))
    return {kept: [...new Set(kept)], standing: [...new Set(standing)]}
}

// "a photograph of electric guitar": the cast's words often come without an article (tides: "electric guitar", "obsidian drum kit")
const determiner = /^(?:a|an|the|his|her|their|its|my|our|your|some|one|two|three|four|\d+|this|that)\b/i
export const withArticle = (words: string) => (determiner.test(words.trim()) ? words.trim() : `${/^[aeiou]/i.test(words.trim()) ? 'an' : 'a'} ${words.trim()}`)

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
