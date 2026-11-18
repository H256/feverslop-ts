import {plural} from '../../lib/format'

const UNLISTED = /^(character|location)s without an entry in casting\.json run as "project:": (.+)$/

/**
 * The warnings of the Casting page (#1142): the lines "characters/locations without an entry in casting.json run as "project:": …"
 * become one sentence about what it means - the project makes them itself - with the names in its title. Every other warning stays as
 * it is.
 */
export function castingNotices(warnings: readonly string[]) {
  const unlisted = {character: [] as string[], location: [] as string[]}
  const rest: string[] = []
  for (const line of warnings) {
    const found = UNLISTED.exec(line)
    if (found) unlisted[found[1] as 'character' | 'location'].push(...found[2]!.split(', '))
    else rest.push(line)
  }
  const parts = [
    unlisted.character.length && plural(unlisted.character.length, 'character'),
    unlisted.location.length && plural(unlisted.location.length, 'place'),
  ].filter(Boolean)
  const names = [...unlisted.character, ...unlisted.location]
  return {
    unlisted: parts.length ? {text: `Not in casting.json yet: ${parts.join(', ')}. This project makes them itself.`, names: names.join(', ')} : undefined,
    rest,
  }
}
