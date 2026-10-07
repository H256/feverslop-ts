import type {Scene, Shot} from "./types.ts";

// Checks of a planned scene that need no understanding of words - only counting. What needs understanding (is anyone in the scene, does
// the script have voices in it) is not guessed from word lists here: the shot planning reads the script and says (SceneCoverage.people and
// .voices). Whether a finished clip has speech that it should not is for the listener: Whisper is too brittle to build on.
// All soft: the planner is asked again once, and what is still found then is kept with a warning (lib/film/coverage.ts).

/**
 * The most shots a scene needs: one for every block of action the screenplay has, and one for every two lines of dialogue. Counted from the
 * structure of the screenplay, not from its text - sentences and their punctuation differ between languages and scripts.
 */
export function maxShotsFor(scene: Scene) {
    const blocks = scene.elements.filter(e => e.type === 'action').length
    const lines = scene.elements.filter(e => e.type === 'dialogue').length
    return Math.max(1, blocks + Math.ceil(lines / 2))
}

const MAX_SHOT_SEC = 8

/**
 * A scene that is only a place - the planner read the script and says no one is in it, and it has no dialogue - is one shot, without people:
 * the first shot stays, as long as the longest of them. Several shots of mist and mud say the same, and people that the script does not put
 * there are not shown (the model gives them words and a story).
 */
export function collapseEmptyScene(shots: Shot[], scene: Scene, people: boolean | undefined): { shots: Shot[], notes: string[] } {
    const empty = people === false && !scene.elements.some(e => e.type === 'dialogue')
    if (!empty || (shots.length === 1 && !shots[0]!.characters.length)) return {shots, notes: []}
    const [first, ...rest] = shots
    const notes = [`the scene is only a place: ${shots.length} shot(s) became one${shots.some(s => s.characters.length) ? ', people the script does not name were left out' : ''}`]
    return {shots: [{...first!, characters: [], lines: [], seconds: Math.min(MAX_SHOT_SEC, Math.max(first!.seconds, ...rest.map(s => s.seconds))), continues: undefined}], notes}
}

/** Too many shots for what the scene has in it. */
export function softProblems(shots: Shot[], scene: Scene, fast = false): string[] {
    // a fast action sequence is cut on the movement: however short its script, up to 6 shots
    const most = fast ? Math.max(maxShotsFor(scene) * 2, 6) : maxShotsFor(scene)
    return shots.length > most ? [`${shots.length} shots, but the scene has material for ${most} at most - fewer, longer shots, and no second shot of what an earlier one already shows`] : []
}
