import {describe, expect, test} from "bun:test";
import {MAX_CLIP_SEC, packClips, splitLongShot, speakingSeconds, toCoverage} from "./coverage.ts";
import {collapseEmptyScene, maxShotsFor, softProblems} from "./shot-checks.ts";
import {characterOf, locationOf, missingDialogue, speechSeconds, toCast, toScreenplay} from "./screenplay.ts";
import {screenplayToFountain} from "./fountain.ts";
import type {FilmCast, Scene, SceneCoverage, Screenplay} from "./types.ts";

const raw = {
    scenes: [
        {
            setting: 'EXT.', location: 'EXT. The Bridge', time: 'night', elements: [
                {type: 'action', text: 'Rain on the bridge. Anna waits.'},
                {type: 'dialogue', speaker: 'ANNA', text: 'You came.', kind: 'spoken', delivery: 'quietly'},
                {type: 'dialogue', speaker: 'BEN', text: 'I said I would.', kind: 'weird'},
            ],
        },
        {
            setting: 'INT', location: 'The Hut', time: '', shot: 'CLOSE UP - ANNA', elements: [
                {type: 'action', text: 'Anna lights a candle.'},
                {type: 'dialogue', speaker: 'ANNA', text: 'Tu en avais une. Tu la laissas pourrir en silence. Tu portas le poids jusqu\'à ce qu\'il écrase tes poumons. Je fais seulement pause dans la décadence.', kind: 'spoken', language: 'fr'},
            ],
        },
    ],
}
const screenplay = toScreenplay(raw, {title: 'T', language: 'en'})
const cast: FilmCast = toCast({
    characters: [{name: 'Anna', aliases: ['ANNA'], voice: 'a low voice'}, {name: 'Ben', aliases: ['BEN'], voice: 'a young voice'}],
    locations: [{name: 'The Bridge', aliases: ['The Bridge']}, {name: 'The Hut', aliases: ['The Hut']}],
}, screenplay)

describe('screenplay', () => {
    test('normalizes headings, settings, kinds and shot headings', () => {
        const [bridge, hut] = screenplay.scenes as [Scene, Scene]
        expect(bridge.setting).toBe('EXT')
        expect(bridge.location).toBe('The Bridge')
        expect(hut.time).toBe('DAY')
        expect(hut.shot).toBe('CLOSE UP - ANNA')
        expect(bridge.shot).toBeUndefined()
        expect(bridge.elements.filter(e => e.type === 'dialogue').map(e => e.kind)).toEqual(['spoken', 'spoken'])
    })
    test('a screenplay without scenes or a scene without content is rejected', () => {
        expect(() => toScreenplay({}, {title: 'T', language: 'en'})).toThrow()
        expect(() => toScreenplay({scenes: [{location: 'X', elements: []}]}, {title: 'T', language: 'en'})).toThrow()
    })
    test('finds dialogue the structuring changed', () => {
        expect(missingDialogue(screenplay, 'ANNA\nYou came.\nBEN\nI said I would.\nTu en avais une. Tu la laissas pourrir en silence. Tu portas le poids jusqu\'à ce qu\'il écrase tes poumons. Je fais seulement pause dans la décadence.')).toEqual([])
        expect(missingDialogue(screenplay, 'ANNA\nYou came!\nBEN\nI told you.')).toContain('I said I would.')
    })
    test('resolves speakers and places through aliases, case-insensitive', () => {
        expect(characterOf(cast, 'anna')?.id).toBe('anna')
        expect(locationOf(cast, 'the hut')?.id).toBe('the-hut')
        expect(characterOf(cast, 'nobody')).toBeUndefined()
    })
    test('a speaker that is not in the cast is rejected', () => {
        expect(() => toCast({characters: [{name: 'Anna', aliases: ['ANNA']}], locations: [{name: 'The Bridge'}, {name: 'The Hut'}]}, screenplay)).toThrow(/BEN/)
    })
    test('speaking time grows with the words, in any script', () => {
        expect(speechSeconds('one two three four five six')).toBeGreaterThan(speechSeconds('one two'))
        expect(speechSeconds('今日は雨が降っています')).toBeGreaterThan(speechSeconds('はい'))
    })
    test('fountain export has the lines and the parenthetical', () => {
        const fountain = screenplayToFountain(screenplay)
        expect(fountain).toContain('ANNA')
        expect(fountain).toContain('(quietly)')
        expect(fountain).toContain('You came.')
    })
})

describe('coverage', () => {
    const bridge = screenplay.scenes[0]!
    const hut = screenplay.scenes[1]!
    const shot = (extra: Record<string, unknown>) => ({framing: 'wide', camera: 'the camera drifts', characters: ['Anna'], action: 'Anna waits.', seconds: 4, ...extra})

    test('every dialogue line must be in exactly one shot, in order', () => {
        expect(() => toCoverage({soundscape: 's', shots: [shot({lines: [1]})]}, bridge, cast)).toThrow()
        expect(() => toCoverage({soundscape: 's', shots: [shot({lines: [2, 1]})]}, bridge, cast)).toThrow()
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1]}), shot({characters: ['Ben'], action: 'Ben answers.', lines: [2]})]}, bridge, cast)
        expect(coverage.shots.map(s => s.lines)).toEqual([[0], [1]])
    })
    test('whoever speaks on screen is in the shot, an unknown name is a problem', () => {
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [shot({characters: [], lines: [1, 2]})]}, bridge, cast)
        expect(coverage.shots[0]!.characters.sort()).toEqual(['anna', 'ben'])
        expect(() => toCoverage({soundscape: 's', shots: [shot({characters: ['Zed'], lines: [1, 2]})]}, bridge, cast)).toThrow(/Zed/)
    })
    test('a shot is never shorter than its lines, and deliveries line up with the lines', () => {
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1, 2], seconds: 2, deliveries: ['calm', 'tired']})]}, bridge, cast)
        const s = coverage.shots[0]!
        expect(s.seconds).toBeGreaterThanOrEqual(Math.floor(speakingSeconds(bridge, [0, 1]) * 100) / 100)
        expect(s.deliveries).toEqual(['calm', 'tired'])
    })
    test('a line too long for a clip is split at sentence ends and the parts are the line', () => {
        const long = shot({lines: [1], characters: ['Anna'], seconds: 8})
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [long]}, hut, cast)
        const parts = splitLongShot(hut, {...coverage.shots[0]!, seconds: 14})
        expect(parts.length).toBeGreaterThan(1)
        expect(parts.every(p => p.seconds <= 10)).toBe(true)
        expect(parts.slice(1).every(p => p.continues)).toBe(true)
        const line = hut.elements.find(e => e.type === 'dialogue')!
        expect(parts.map(p => p.texts?.[0] ?? '').join(' ')).toBe(line.type === 'dialogue' ? line.text : '')
    })
    test('an action that names someone who is not in the shot is a problem', () => {
        expect(() => toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1], action: 'Anna looks at Ben.'}), shot({characters: ['Ben'], action: 'Ben nods.', lines: [2]})]}, bridge, cast)).toThrow(/Ben/)
        const {notes} = toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1], action: 'Anna looks at Ben.'}), shot({characters: ['Ben'], action: 'Ben nods.', lines: [2]})]}, bridge, cast, false)
        expect(notes.some(n => n.includes('Ben'))).toBe(true)
    })
    test('short shots are not split', () => {
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1, 2]})]}, bridge, cast)
        expect(splitLongShot(bridge, coverage.shots[0]!)).toHaveLength(1)
    })
    test('clips never span two scenes and never exceed the limit', () => {
        const plans: SceneCoverage[] = [
            toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1], seconds: 8}), shot({characters: ['Ben'], action: 'Ben answers.', lines: [2], seconds: 8})]}, bridge, cast).coverage,
            toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1], seconds: 8})]}, hut, cast).coverage,
        ]
        const clips = packClips(screenplay, plans, 'auto')
        expect(clips.every(c => c.seconds <= MAX_CLIP_SEC + 0.5)).toBe(true)
        expect(new Set(clips.map(c => c.sceneId))).toEqual(new Set(['s1', 's2']))
        expect(clips[0]!.opensScene).toBe(true)
        expect(clips.map(c => c.index)).toEqual(clips.map((_, i) => i + 1))
        // frames of the clips follow each other without gaps
        clips.reduce((frame, c) => { expect(c.frameStart).toBe(frame); return frame + c.frames }, 0)
    })
    test('continuity "scene" chains every clip but the first of a scene, "never" none', () => {
        const plan = toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1], seconds: 8}), shot({characters: ['Ben'], action: 'Ben answers.', lines: [2], seconds: 8})]}, bridge, cast).coverage
        const hutPlan = toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1], seconds: 8})]}, hut, cast).coverage
        const chained = packClips(screenplay, [plan, hutPlan], 'scene')
        expect(chained.filter(c => c.startsFrom).map(c => c.id)).toContain('clip-002')
        expect(chained.find(c => c.sceneId === 's2' && c.opensScene)!.startsFrom).toBeUndefined()
        expect(packClips(screenplay, [plan, hutPlan], 'never').some(c => c.startsFrom)).toBe(false)
    })
})

describe('shot checks', () => {
    const empty: Screenplay = toScreenplay({scenes: [{setting: 'EXT', location: 'The Field', time: 'DAY', elements: [{type: 'action', text: 'Wind. Grass.'}, {type: 'action', text: 'Clouds pass.'}]}]}, {title: 'E', language: 'en'})
    const scene = empty.scenes[0]!
    const mk = (seconds: number) => ({framing: 'wide', camera: 'c', characters: [], action: 'a', lines: [], seconds})
    test('a scene without people and dialogue collapses to one shot', () => {
        const {shots} = collapseEmptyScene([mk(3), mk(4), mk(5)], scene, false)
        expect(shots).toHaveLength(1)
        expect(shots[0]!.seconds).toBeLessThanOrEqual(8)
    })
    test('a scene with people is not collapsed', () => {
        expect(collapseEmptyScene([mk(3), mk(4)], scene, true).shots).toHaveLength(2)
    })
    test('a fast action sequence may have more shots than its script has blocks', () => {
        const shots = [mk(3), mk(3), mk(3), mk(3), mk(3)]
        expect(softProblems(shots, scene)).toHaveLength(1)
        expect(softProblems(shots, scene, true)).toHaveLength(0)
        expect(softProblems([...shots, mk(3), mk(3)], scene, true)).toHaveLength(1)
    })
    test('the most shots come from the structure of the script', () => {
        expect(maxShotsFor(scene)).toBe(2)
        expect(maxShotsFor(screenplay.scenes[0]!)).toBeGreaterThanOrEqual(2)
    })
})

describe('names', () => {
    const anna = cast.characters.find(c => c.id === 'anna')!
    const ben = cast.characters.find(c => c.id === 'ben')!
    test('a sentence that names a character without a picture is left out', async () => {
        const {withoutSentencesNaming, mentions} = await import("./names.ts")
        const text = 'Anna stands at the stone. Ben is on the cot, bound. The room is dark.'
        expect(withoutSentencesNaming(text, [ben])).toBe('Anna stands at the stone. The room is dark.')
        expect(withoutSentencesNaming(text, [])).toBe(text)
        expect(mentions("ANNA's hands shake", anna)).toBe(true)
        expect(mentions('Annabel waits', anna)).toBe(false)
    })
})

describe('subtitles', () => {
    const withTranslation = toScreenplay({
        scenes: [{setting: 'INT', location: 'The Hut', time: 'NIGHT', elements: [
            {type: 'action', text: 'A candle.'},
            {type: 'dialogue', speaker: 'ANNA', text: 'Je suis là.', kind: 'spoken', translation: 'I am here.'},
            {type: 'dialogue', speaker: 'BEN', text: 'Moi aussi.', kind: 'spoken'},
        ]}],
    }, {title: 'T', language: 'fr'})

    test('the translations of the screenplay are the subtitles, nothing else', async () => {
        const {subtitleTexts} = await import("./subtitles.ts")
        expect(subtitleTexts(withTranslation, undefined, 'script')).toEqual({'s1:0': 'I am here.'})
        expect(subtitleTexts(withTranslation, {'s1:1': 'Me too.'}, 'en')).toEqual({'s1:1': 'Me too.'})
        expect(subtitleTexts(withTranslation, undefined, 'off')).toEqual({})
    })
    test('the translation step asks only for the lines in another language', async () => {
        const {subtitlePrompt} = await import("./subtitles.ts")
        expect(subtitlePrompt(withTranslation, 'fr').lines).toHaveLength(0)
        expect(subtitlePrompt(withTranslation, 'en').lines.map(l => l.key)).toEqual(['s1:0', 's1:1'])
    })
    test('a cue starts a beat into its shot; a line over two clips is one cue; cues never overlap', async () => {
        const {subtitleCues, toSrt} = await import("./subtitles.ts")
        const clip = (id: string, seconds: number, line: number, at: number, text: string) => ({id, seconds, sceneId: 's1', dialogue: [{at, line, text}]}) as never
        const cues = subtitleCues([clip('clip-001', 8, 0, 0, 'Une phrase. Et une autre phrase assez longue pour finir.'), clip('clip-002', 8, 0, 0, 'La suite.'), clip('clip-003', 8, 1, 1, 'Moi aussi.')], [0, 8, 16], {'s1:0': 'One line.', 's1:1': 'Me too.'})
        expect(cues).toHaveLength(2)
        expect(cues[0]!.start).toBeGreaterThan(0.5)
        expect(cues[0]!.end).toBeGreaterThan(8)
        expect(cues[0]!.end).toBeLessThan(cues[1]!.start)
        expect(toSrt(cues)).toMatch(/^1\n00:00:01,\d{3} --> 00:00:\d{2},\d{3}\nOne line\.\n\n2\n/)
    })
})

describe('character states', () => {
    const play = toScreenplay({scenes: [{setting: 'EXT', location: 'The Field', time: 'DAY', elements: [
        {type: 'action', text: 'Karl is hit.'}, {type: 'dialogue', speaker: 'KARL', text: 'Ah.', kind: 'spoken'}, {type: 'action', text: 'Karl crawls on.'},
    ]}]}, {title: 'S', language: 'en'})
    const stateCast = toCast({
        characters: [
            {name: 'Karl', aliases: ['KARL'], voice: 'a low voice', states: [{name: 'Wounded', change: 'his tunic is torn and dark with blood'}, {name: 'wounded', change: 'again'}, {name: '', change: 'x'}]},
            {name: 'Narrator', aliases: ['NARRATOR'], voiceOnly: true, states: [{name: 'x', change: 'y'}]},
        ],
        locations: [{name: 'The Field', aliases: ['The Field']}],
    }, play)

    test('states are kept with ids, at most two, never for a voice-only character', () => {
        const karl = stateCast.characters[0]!
        expect(karl.states?.map(s => s.id)).toEqual(['wounded', 'wounded-2'])
        expect(stateCast.characters[1]!.states).toBeUndefined()
    })
    test('a shot names the look of a character who is in it; an unknown look is a problem', () => {
        const scene = play.scenes[0]!
        const shot = (extra: Record<string, unknown>) => ({framing: 'wide', camera: 'c', characters: ['Karl'], action: 'Karl crawls.', seconds: 4, lines: [1], ...extra})
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [shot({states: {Karl: 'wounded'}})]}, scene, stateCast)
        expect(coverage.shots[0]!.states).toEqual({karl: 'wounded'})
        expect(toCoverage({soundscape: 's', people: true, shots: [shot({states: {Karl: 'normal'}})]}, scene, stateCast).coverage.shots[0]!.states).toBeUndefined()
        expect(() => toCoverage({soundscape: 's', people: true, shots: [shot({states: {Karl: 'on fire'}})]}, scene, stateCast)).toThrow(/on fire/)
    })
    test('the clip uses the picture of the look the character is in', async () => {
        const {buildFilmClipRequests} = await import("./compose.ts")
        const scene = play.scenes[0]!
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [{framing: 'wide', camera: 'c', characters: ['Karl'], action: 'Karl crawls.', seconds: 4, lines: [1], states: {Karl: 'wounded'}}]}, scene, stateCast)
        const input = {
            screenplay: play, cast: stateCast, clips: packClips(play, [coverage], 'auto'), soundscapes: {}, stagings: {}, voices: {}, lookBrief: 'Look. More.',
            characterDescriptions: {karl: 'a man in a clean tunic', 'karl--wounded': 'a man in a torn, bloody tunic'}, locationDescriptions: {},
        }
        const [request] = buildFilmClipRequests(input)
        const picture = request!.assets.pictures.find(p => p.kind === 'character')!
        expect(picture.file).toBe('assets/characters/karl--wounded.png')
        expect(picture.id).toBe('karl')
        expect(request!.prompt).toContain('a man in a torn, bloody tunic')
        expect(request!.prompt).not.toContain('a man in a clean tunic')
        // without a state the normal picture
        const plain = buildFilmClipRequests({...input, clips: packClips(play, [{...coverage, shots: coverage.shots.map(s => ({...s, states: undefined}))}], 'auto')})
        expect(plain[0]!.assets.pictures.find(p => p.kind === 'character')!.file).toBe('assets/characters/karl.png')
    })
    test('every look is a picture of its own, drawn from the seed of the normal one', async () => {
        const {filmPictures} = await import("./pictures.ts")
        const jobs = filmPictures(stateCast, {characterLooks: {karl: 'a', 'karl--wounded': 'b'}, characterDescriptions: {}, locationLooks: {}, locationDescriptions: {}})
        expect(jobs.filter(j => j.kind === 'character').map(j => j.id)).toEqual(['karl', 'karl--wounded', 'karl--wounded-2'])
        expect(jobs.find(j => j.id === 'karl--wounded')!.baseId).toBe('karl')
        expect(jobs.find(j => j.id === 'karl')!.baseId).toBeUndefined()
    })
})

describe('shot geography', () => {
    const scene = screenplay.scenes[0]!
    const base = {framing: 'over-the-shoulder shot', camera: 'c', seconds: 4}

    test('view and, per person, state and frame are kept; people who are not in the shot are dropped', () => {
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [
            {...base, view: 'from beside the cot, looking toward the hearth', characters: ['Anna', 'Ben'], action: 'Anna turns.', lines: [1, 2],
                people: {Anna: {state: 'stands at the stone, hands on the roots', frame: 'sharp, left of centre'}, Ben: {frame: 'foreground right, back and shoulder only, out of focus'}, Zed: {state: 'x'}}},
        ]}, scene, cast)
        const shot = coverage.shots[0]!
        expect(shot.view).toContain('hearth')
        expect(Object.keys(shot.people!).sort()).toEqual(['anna', 'ben'])
        expect(shot.people!.ben!.state).toBeUndefined()
    })
    test('the other person is in the picture when the planner says so - and a text that names someone outside the shot is a problem', () => {
        expect(() => toCoverage({soundscape: 's', people: true, shots: [
            {...base, characters: ['Anna'], action: 'Anna speaks.', lines: [1], people: {Anna: {state: 'stands, looking at Ben'}}},
            {...base, characters: ['Ben'], action: 'Ben answers.', lines: [2]},
        ]}, scene, cast)).toThrow(/Ben/)
    })
    test('a part of a long line does not tell the action again', () => {
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [{...base, characters: ['Anna'], action: 'Anna lifts the radio down from the shelf.', lines: [1, 2]}]}, screenplay.scenes[1]!, cast)
        const parts = splitLongShot(screenplay.scenes[1]!, {...coverage.shots[0]!, lines: [0], seconds: 14, people: {anna: {state: 'stands at the shelf'}}})
        expect(parts.length).toBeGreaterThan(1)
        expect(parts[0]!.action).toContain('radio')
        expect(parts[1]!.action).not.toContain('radio')
        expect(parts[1]!.people).toBeUndefined()
    })
    test('the clip prompt says where the camera is, where everyone is at the start and how they are in the picture', async () => {
        const {buildFilmClipRequests} = await import("./compose.ts")
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [
            {...base, view: 'beside the bridge rail, looking along it', characters: ['Anna', 'Ben'], action: 'Anna turns to Ben.', lines: [1, 2],
                people: {Anna: {state: 'stands at the rail, one hand on it', frame: 'sharp, left of centre'}, Ben: {state: 'waits two steps away', frame: 'foreground right, shoulder only, soft'}}},
        ]}, scene, cast)
        const [request] = buildFilmClipRequests({screenplay, cast, clips: packClips(screenplay, [coverage, toCoverage({soundscape: 's', people: true, shots: [{...base, characters: ['Anna'], action: 'Anna lights a candle.', lines: [1]}]}, screenplay.scenes[1]!, cast).coverage], 'auto').filter(c => c.sceneId === 's1'), soundscapes: {}, stagings: {}, voices: {}, characterDescriptions: {}, locationDescriptions: {}, lookBrief: 'Look. More.'})
        expect(request!.prompt).toContain('The camera is beside the bridge rail, looking along it.')
        expect(request!.prompt).toMatch(/At the start of the shot: <Subject 2> stands at the rail, one hand on it; <Subject 3> waits two steps away\./)
        expect(request!.prompt).toContain('foreground right, shoulder only, soft')
    })
})
