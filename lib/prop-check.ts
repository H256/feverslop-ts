// A character's prop is one specific object (see castPrompt). Whether a look, the picture's prompt, names it is the
// cheap check that the look prompt did what it was asked: a prop that is missing from the look is missing from the
// reference picture, and the clips then show the model's own idea of it - or none.

const FILLER = new Set(['a', 'an', 'the', 'of', 'with', 'and', 'in', 'on', 'for', 'her', 'his', 'their', 'its'])

/**
 * The word that says what the prop is: the last word of its first phrase - "a long-shafted war hammer with a
 * black iron head" is a "hammer", "an electric guitar" a "guitar", "a hand torch" a "torch". Lowercase, without a
 * plural s.
 */
export function propNoun(prop: string): string | undefined {
    const phrase = prop.toLowerCase().split(/\b(?:with|in|on|for|and)\b|[,;(]/)[0] ?? ''
    const words = phrase.match(/[a-z][a-z'-]*/g)?.filter(w => !FILLER.has(w)) ?? []
    const last = words[words.length - 1]
    return last?.replace(/'s$/, '').replace(/(?<=[a-z]{3})s$/, '')
}

/** True when `look` does not mention the prop: its noun is not in the text (also as part of a longer word, "warhammer"). */
export function propMissing(look: string, prop: string): boolean {
    const noun = propNoun(prop)
    return noun !== undefined && !look.toLowerCase().includes(noun)
}
