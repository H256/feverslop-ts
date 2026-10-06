import type {FilmCast, Scene, Shot} from "./types.ts";

// Checks of a planned scene that only need the script of the scene - no LLM. They are soft: the planner is asked again once, and
// what is still found then is kept with a warning (lib/film/coverage.ts) - a rule of thumb must never stop a film.

// Words for someone making a sound with their voice. Whether the script of the scene has any of them is what decides if a shot may.
const VOCAL = /\b(say|says|said|speak|speaks|spoke|tell|tells|told|ask|asks|asked|answer|answers|reply|replies|call|calls|called|shout|shouts|shouted|yell|yells|scream|screams|screamed|whisper|whispers|whispered|mutter|mutters|murmur|murmurs|cry|cries|cried|sing|sings|chant|chants|chanting|incantation|voice|voices|word|words|spell|spells)\b/i

// Words for someone being there, besides the names of the cast: a script that says "the men scramble up the ladders" has people in it
const PEOPLE = /\b(man|men|woman|women|people|person|persons|soldier|soldiers|figure|figures|crowd|boy|boys|girl|girls|child|children|he|she|they|him|her|them|his|their|someone|everyone|somebody|creature|creatures|beast|monster|ghost|ghosts|shadow|shadows)\b/i

const actionText = (scene: Scene) => scene.elements.filter(e => e.type === 'action').map(e => e.text).join(' ')

/** Does the script of the scene itself have voices in it - whispers, a chant, a spell, someone calling? Then the shots may too. */
export const describesVoices = (scene: Scene) => VOCAL.test(actionText(scene))

/** Everything written in a scene: its actions and the cues of its speakers. */
const sceneText = (scene: Scene) => scene.elements.map(e => e.type === 'action' ? e.text : e.speaker).join(' ')

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Is anyone in the scene? A character of the cast named by one of its aliases (a creature is a character of the cast, too), a person
 * said in general words ("the men", "he", "soldiers"), or a line of dialogue. A scene that is only a place - mist, mud, the sound of guns -
 * has no one in it, and a shot of it shows no one.
 */
export function hasPeople(scene: Scene, cast: FilmCast) {
    if (scene.elements.some(e => e.type === 'dialogue')) return true
    const text = sceneText(scene)
    if (PEOPLE.test(text)) return true
    return cast.characters.some(c => c.aliases.some(a => new RegExp(`(?<![\\p{L}\\p{N}])${escape(a)}(?![\\p{L}\\p{N}])`, 'iu').test(text)))
}

/** The most shots a scene needs: one for every sentence of its action, and one for every two lines of dialogue - one, for a scene that is only a place. */
export function maxShotsFor(scene: Scene, cast: FilmCast) {
    if (!hasPeople(scene, cast)) return 1
    const sentences = scene.elements.filter(e => e.type === 'action').reduce((sum, e) => sum + Math.max(1, e.text.split(/(?<=[.!?])\s+/).filter(s => s.trim()).length), 0)
    const lines = scene.elements.filter(e => e.type === 'dialogue').length
    return Math.max(1, sentences + Math.ceil(lines / 2))
}

const MAX_SHOT_SEC = 8

/**
 * A scene that is only a place is one shot, without people: the first shot stays, as long as the longest of them. Several shots of mist and
 * mud say the same, and people that the script does not put there are not shown (the model gives them words and a story).
 */
export function collapseEmptyScene(shots: Shot[], scene: Scene, cast: FilmCast): { shots: Shot[], notes: string[] } {
    if (hasPeople(scene, cast) || (shots.length === 1 && !shots[0]!.characters.length)) return {shots, notes: []}
    const [first, ...rest] = shots
    const notes = [`the scene is only a place: ${shots.length} shot(s) became one${shots.some(s => s.characters.length) ? ', people the script does not name were left out' : ''}`]
    return {shots: [{...first!, characters: [], lines: [], seconds: Math.min(MAX_SHOT_SEC, Math.max(first!.seconds, ...rest.map(s => s.seconds))), continues: undefined}], notes}
}

/** What a scene's shots get wrong that is not the model's to know: speech where the script has none, too many shots. */
export function softProblems(shots: Shot[], scene: Scene, cast: FilmCast): string[] {
    const problems: string[] = []
    if (!describesVoices(scene)) {
        shots.forEach((shot, i) => {
            if (!shot.lines.length && VOCAL.test(shot.action)) problems.push(`shot ${i + 1}: the action has someone speak or call out, but the scene has no voices in it and this shot has no dialogue line - only the numbered lines are spoken`)
        })
    }
    const most = maxShotsFor(scene, cast)
    if (shots.length > most) problems.push(`${shots.length} shots, but the scene has material for ${most} at most - fewer, longer shots, and no second shot of what an earlier one already shows`)
    return problems
}
