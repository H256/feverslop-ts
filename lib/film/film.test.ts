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

describe('script repair', () => {
    const play = toScreenplay({scenes: [
        {setting: 'EXT', location: 'The Yard', time: 'DUSK', elements: [{type: 'action', text: 'Leo walks free.'}, {type: 'dialogue', speaker: 'LEO', text: 'Hello.', kind: 'spoken'}]},
        {setting: 'INT', location: 'The Hut', time: 'DAY', elements: [{type: 'action', text: 'Leo is bound.'}]},
    ]}, {title: 'R', language: 'en'})

    test('an action line and a time of day can change, dialogue and scenes cannot', async () => {
        const {applyScriptFixes} = await import("./screenplay.ts")
        const result = applyScriptFixes(play, [
            {scene: 's1', element: 0, text: 'Leo walks the length of his rope.'},
            {scene: 's2', time: 'night'},
            {scene: 's1', element: 1, text: 'Changed.'},      // dialogue
            {scene: 's9', element: 0, text: 'x'},             // no such scene
            {scene: 's2', element: 0, text: '  '},            // empty
        ])
        expect(result.applied.map(a => a.scene)).toEqual(['s1', 's2'])
        expect(result.rejected).toHaveLength(3)
        expect(result.screenplay.scenes[0]!.elements[0]).toEqual({type: 'action', text: 'Leo walks the length of his rope.'})
        expect(result.screenplay.scenes[0]!.elements[1]).toEqual(play.scenes[0]!.elements[1]!)
        expect(result.screenplay.scenes[1]!.time).toBe('NIGHT')
        // the original is not changed
        expect(play.scenes[1]!.time).toBe('DAY')
    })
    test('anything that is not a list of edits changes nothing', async () => {
        const {applyScriptFixes} = await import("./screenplay.ts")
        expect(applyScriptFixes(play, undefined).applied).toEqual([])
        expect(applyScriptFixes(play, 'nope').screenplay).toEqual(play)
    })
})

describe('motion and hand-over', () => {
    const scene = screenplay.scenes[0]!
    const base = {framing: 'two-shot', camera: 'c', seconds: 4}

    test('motion per person and where everybody is at the end of the scene are kept', () => {
        const {coverage} = toCoverage({soundscape: 's', people: true,
            ends: {Anna: 'stands at the rail, hands on it', Ben: 'waits two steps away', Zed: 'x', Ben2: ''},
            shots: [{...base, characters: ['Anna', 'Ben'], action: 'Anna speaks.', lines: [1, 2],
                people: {Anna: {motion: 'stays where she stands, only the head and mouth move'}, Ben: {state: 'waits', motion: 'takes two steps toward Anna and stops'}}}]}, scene, cast)
        expect(coverage.shots[0]!.people!.anna).toEqual({motion: 'stays where she stands, only the head and mouth move'})
        expect(coverage.ends).toEqual({anna: 'stands at the rail, hands on it', ben: 'waits two steps away'})
    })
    test('the prompt says who stays where they are', async () => {
        const {buildFilmClipRequests} = await import("./compose.ts")
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [{...base, characters: ['Anna', 'Ben'], action: 'Anna turns to Ben.', lines: [1, 2],
            people: {Anna: {state: 'stands at the rail', motion: 'stays where she stands, does not step forward or back'}, Ben: {motion: 'stands motionless, arms at his sides'}}}]}, scene, cast)
        const [request] = buildFilmClipRequests({screenplay, cast, clips: packClips(screenplay, [coverage, toCoverage({soundscape: 's', people: true, shots: [{...base, characters: ['Anna'], action: 'Anna lights a candle.', lines: [1]}]}, screenplay.scenes[1]!, cast).coverage], 'auto').filter(c => c.sceneId === 's1'), soundscapes: {}, stagings: {}, voices: {}, characterDescriptions: {}, locationDescriptions: {}, lookBrief: 'Look. More.'})
        expect(request!.prompt).toMatch(/During the shot: <Subject 2> stays where she stands, does not step forward or back; <Subject 3> stands motionless, arms at his sides\./)
    })
})

describe('staging and people', () => {
    const scene = screenplay.scenes[0]!
    const base = {framing: 'close-up', camera: 'c', seconds: 4}
    const input = (people: boolean) => {
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [{...base, characters: ['Anna'], action: 'Anna speaks.', lines: [1],
            ...(people ? {people: {Anna: {state: 'stands at the rail'}}} : {})}, {...base, characters: ['Ben'], action: 'Ben speaks.', lines: [2]}]}, scene, cast, false)
        return {screenplay, cast, clips: packClips(screenplay, [coverage, toCoverage({soundscape: 's', people: true, shots: [{...base, characters: ['Anna'], action: 'Anna lights a candle.', lines: [1]}]}, screenplay.scenes[1]!, cast).coverage], 'auto').filter(c => c.sceneId === 's1'),
            soundscapes: {}, stagings: {s1: 'The bridge runs left to right. Anna stands on the left, Ben on the right. Rain falls.'}, voices: {}, characterDescriptions: {}, locationDescriptions: {}, lookBrief: 'Look. More.'}
    }
    test('where the plan says where everybody is per shot, the staging places nobody - the close-up would get them twice', async () => {
        const {buildFilmClipRequests} = await import("./compose.ts")
        const data = input(true)
        data.clips[0]!.shots.forEach(s => { s.people = {...(s.people ?? {}), ...Object.fromEntries(s.characters.map(id => [id, {state: 'stands'}]))} })
        const [request] = buildFilmClipRequests(data)
        expect(request!.prompt).toContain('The bridge runs left to right.')
        expect(request!.prompt).toContain('Rain falls.')
        expect(request!.prompt).not.toMatch(/Anna stands on the left|Ben on the right/)
    })
    test('an older plan without per-shot positions keeps the staging as it is, apart from people without a picture', async () => {
        const {buildFilmClipRequests} = await import("./compose.ts")
        const [request] = buildFilmClipRequests(input(false))
        expect(request!.prompt).toContain('stands on the left')
    })
})

describe('location views', () => {
    const views = [
        {name: 'the main view', shows: 'the hero picture'},
        {name: 'from the water side, looking back toward the dunes', shows: 'the camera stands at the water and looks at the dunes'},
        {name: 'from the left', shows: 'seen along the place from the left'},
        {name: 'from the right', shows: 'seen along the place from the right'},
        {name: 'wide and raised', shows: 'the whole place from above'},
    ]
    const scene = screenplay.scenes[0]!

    test('the sheet video cuts to the designed views - without views the generic prompt is unchanged', async () => {
        const {locationSequencePrompt} = await import("../sequenceSheet.ts")
        const generic = locationSequencePrompt('A bridge')
        expect(generic.prompt).toContain('behind the location, looking back across it from the rear')
        const designed = locationSequencePrompt('A bridge', undefined, views.slice(1).map(v => v.shows))
        expect(designed.prompt).toContain('the camera stands at the water and looks at the dunes')
        expect(designed.prompt).toContain('seen along the place from the left')
        expect(designed.prompt).not.toContain('from the rear')
        expect(designed.beatTimes).toHaveLength(5)
    })
    test('the pictures of a location carry the four views after the first', async () => {
        const {filmPictures} = await import("./pictures.ts")
        const jobs = filmPictures(cast, {characterLooks: {}, characterDescriptions: {}, locationLooks: {}, locationDescriptions: {}, locationViews: {'the-bridge': views}})
        expect(jobs.find(j => j.id === 'the-bridge')!.views).toEqual(views.slice(1).map(v => v.shows))
        expect(jobs.find(j => j.id === 'the-hut')!.views).toBeUndefined()
    })
    test('a shot names the number of its background view, only 1 to 5', () => {
        const shot = (placeView: unknown) => ({framing: 'wide', camera: 'c', characters: ['Anna'], action: 'Anna waits.', seconds: 4, lines: [1, 2], placeView})
        expect(toCoverage({soundscape: 's', people: true, shots: [shot(2)]}, scene, cast).coverage.shots[0]!.placeView).toBe(2)
        expect(toCoverage({soundscape: 's', people: true, shots: [shot(9)]}, scene, cast).coverage.shots[0]!.placeView).toBeUndefined()
        expect(toCoverage({soundscape: 's', people: true, shots: [shot('x')]}, scene, cast).coverage.shots[0]!.placeView).toBeUndefined()
    })
    test('the clip prompt lists the views of the sheet and says which is the background of a shot', async () => {
        const {buildFilmClipRequests} = await import("./compose.ts")
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [{framing: 'close-up', view: 'from the water side', placeView: 2, camera: 'c', characters: ['Anna'], action: 'Anna waits.', seconds: 4, lines: [1, 2]}]}, scene, cast)
        const [request] = buildFilmClipRequests({screenplay, cast, clips: packClips(screenplay, [coverage, toCoverage({soundscape: 's', people: true, shots: [{framing: 'wide', camera: 'c', characters: ['Anna'], action: 'Anna lights a candle.', lines: [1]}]}, screenplay.scenes[1]!, cast).coverage], 'auto').filter(c => c.sceneId === 's1'),
            soundscapes: {}, stagings: {}, voices: {}, characterDescriptions: {}, locationDescriptions: {}, locationViews: {'the-bridge': views}, lookBrief: 'Look. More.'})
        expect(request!.prompt).toContain('The picture is a sheet of views of the place: 1. the main view; 2. from the water side, looking back toward the dunes;')
        expect(request!.prompt).toContain('The background is view 2 of <Picture 1>: from the water side, looking back toward the dunes.')
    })
})

describe('image edit workflows', () => {
    const options = {prompt: 'the same place from the other side', image: 'feverslop-ts/film-x/edit/hero.png', seed: 42, filenamePrefix: 'feverslop-ts/film-x/edit/view-2'}
    // the API graph of a workflow: node id -> {class_type, inputs}
    const graph = async (path: string, name = 'default') => {
        const {WorkflowBuilder} = await import("../../comfy/nodes.ts")
        const module = await import(path) as Record<string, (o: typeof options) => { workflow: InstanceType<typeof WorkflowBuilder>, output: string }>
        const {workflow, output} = module[name]!(options)
        return {nodes: workflow.build({outputs: {result: output}}).workflow as Record<string, { class_type: string, inputs: Record<string, unknown> }>, output}
    }
    const classes = (nodes: Record<string, { class_type: string }>) => Object.values(nodes).map(n => n.class_type)

    test('FLUX.2 Klein: the picture is a reference of both conditionings, four steps, the prompt and the seed are in', async () => {
        const {nodes} = await graph("../../comfy/workflows/edit-flux2-klein.ts")
        const kinds = classes(nodes)
        expect(kinds.filter(k => k === 'ReferenceLatent')).toHaveLength(2)
        expect(kinds).toContain('Flux2Scheduler')
        expect(Object.values(nodes).find(n => n.class_type === 'Flux2Scheduler')!.inputs.steps).toBe(4)
        expect(Object.values(nodes).find(n => n.class_type === 'CLIPTextEncode' && n.inputs.text)!.inputs.text).toBe(options.prompt)
        expect(Object.values(nodes).find(n => n.class_type === 'RandomNoise')!.inputs.noise_seed).toBe(42)
        expect(Object.values(nodes).find(n => n.class_type === 'LoadImage')!.inputs.image).toBe(options.image)
    })
    test('Qwen edit: the camera LoRA and the Lightning LoRA are chained in front of the sampler', async () => {
        for (const [name, loras] of [['qwenAngles', ['Lightning-4steps', 'Multiple-angles']], ['qwenNextScene', ['Lightning-4steps', 'next-scene']]] as const) {
            const {nodes} = await graph("../../comfy/workflows/edit-qwen.ts", name)
            const used = Object.values(nodes).filter(n => n.class_type === 'LoraLoaderModelOnly').map(n => String(n.inputs.lora_name))
            expect(used).toHaveLength(2)
            for (const part of loras) expect(used.some(u => u.includes(part))).toBe(true)
            const sampler = Object.values(nodes).find(n => n.class_type === 'KSampler')!
            expect(sampler.inputs.steps).toBe(4)
            expect(sampler.inputs.seed).toBe(42)
            expect(Object.values(nodes).find(n => n.class_type === 'TextEncodeQwenImageEditPlus' && n.inputs.prompt)!.inputs.prompt).toBe(options.prompt)
        }
    })
})
