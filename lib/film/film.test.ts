import {describe, expect, test} from "bun:test";
import {CoverageProblem, MAX_CLIP_SEC, packClips, splitLongShot, speakingSeconds, toCoverage} from "./coverage.ts";
import {collapseEmptyScene, maxShotsFor, softProblems} from "./shot-checks.ts";
import {characterOf, locationOf, missingDialogue, omittedSourceLines, speechSeconds, toCast, toScreenplay} from "./screenplay.ts";
import {screenplayToFountain} from "./fountain.ts";
import {FilmStore} from "./store.ts";
import {filmStepUsed} from "./inputs.ts";
import {filmDefaults} from "./config.ts";
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
    test('a single shot longer than a clip that cannot be split is an error, not a clip over the limit', () => {
        const plan = toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1, 2], seconds: 4})]}, bridge, cast).coverage
        const long = {...plan, shots: plan.shots.map(s => ({...s, seconds: 9.8, lines: []}))}
        expect(() => packClips(screenplay, [long, toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1], seconds: 4})]}, hut, cast).coverage], 'auto')).toThrow(/cannot be split/)
    })
    test('shots are not packed into one clip when their people would not all get a picture', () => {
        const plan = toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1], seconds: 2}), shot({lines: [2], seconds: 2, characters: ['Ben'], action: 'Ben answers.'})]}, bridge, cast).coverage
        const crowd = (from: number) => Array.from({length: 5}, (_, i) => `c${from + i}`)
        const wide = {...plan, shots: [{...plan.shots[0]!, characters: crowd(0)}, {...plan.shots[1]!, characters: crowd(5)}]}
        const clips = packClips(screenplay, [wide, toCoverage({soundscape: 's', people: true, shots: [shot({lines: [1], seconds: 4})]}, hut, cast).coverage], 'auto').filter(c => c.sceneId === 's1')
        expect(clips).toHaveLength(2)
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
        // with sequence sheets a look's sheet starts on the anchor of the normal picture and shows the change
        expect(jobs.find(j => j.id === 'karl--wounded')!.look).toEqual({base: 'karl', change: stateCast.characters[0]!.states![0]!.change})
        expect(jobs.find(j => j.id === 'karl')!.look).toBeUndefined()
    })
    test("a look's sheet: a lead-in on the anchor, then the six views in the new look - the lead-in is not in the sheet", async () => {
        const {characterLookSequencePrompt, characterSequencePrompt, lookSheetFrames, selectFrameIndices} = await import('../sequenceSheet.ts')
        const {prompt, beatTimes} = characterLookSequencePrompt('his left arm is bandaged and bloody.')
        // 141 frames: every shot 0.75 s, as in a normal sheet
        expect(beatTimes).toEqual([0, 0.75, 1.5, 2.25, 3, 3.75, 4.5])
        expect(prompt).toStartWith('Seven distinct locked-off shots joined by hard cuts. [Shot 1] The figure exactly as in the first frame')
        // the views name the person of the first frame and its clothing - no description that would redraw the clothes
        expect(prompt).toContain('only this is changed: his left arm is bandaged and bloody. [Shot 2] At 00:00.750, the shot cuts to a full-body shot that frames the same person as in the first frame, in exactly the same clothing')
        expect(prompt).toContain('[Shot 7] At 00:04.500')
        // every view says the change again
        expect(prompt.split('In this shot too, plainly visible: his left arm is bandaged and bloody.')).toHaveLength(7)
        expect(lookSheetFrames(beatTimes, 141)).toEqual(selectFrameIndices(beatTimes, 141).slice(1))
        expect(lookSheetFrames(beatTimes, 141)).toHaveLength(6)
        // the sheet of a normal picture stays six shots
        expect(characterSequencePrompt('Karl', 124).beatTimes).toHaveLength(6)
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
        expect(parts[1]!.people).toEqual({anna: {frame: undefined, facing: undefined, foreground: undefined}})
    })
    test('the parts after the first keep how everyone is in the picture, not what they do', () => {
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [{...base, characters: ['Anna', 'Ben'], action: 'Anna speaks.', lines: [1, 2]}]}, screenplay.scenes[1]!, cast)
        const parts = splitLongShot(screenplay.scenes[1]!, {...coverage.shots[0]!, lines: [0], seconds: 14, people: {anna: {state: 'stands', motion: 'turns', frame: 'sharp, centre'}, ben: {state: 'waits', frame: 'foreground left, shoulder only', facing: 'right', foreground: true}}})
        expect(parts[1]!.people!.ben).toEqual({frame: 'foreground left, shoulder only', facing: 'right', foreground: true})
        expect(parts[1]!.people!.anna!.state).toBeUndefined()
        expect(parts[1]!.people!.anna!.motion).toBeUndefined()
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
    test('the place is the one view the clip starts in - not the sheet - and the prompt says which side a shot looks from', async () => {
        const {buildFilmClipRequests} = await import("./compose.ts")
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [{framing: 'close-up', view: 'from the water side', placeView: 2, camera: 'c', characters: ['Anna'], action: 'Anna waits.', seconds: 4, lines: [1, 2]}]}, scene, cast)
        const [request] = buildFilmClipRequests({screenplay, cast, clips: packClips(screenplay, [coverage, toCoverage({soundscape: 's', people: true, shots: [{framing: 'wide', camera: 'c', characters: ['Anna'], action: 'Anna lights a candle.', lines: [1]}]}, screenplay.scenes[1]!, cast).coverage], 'auto').filter(c => c.sceneId === 's1'),
            soundscapes: {}, stagings: {}, voices: {}, characterDescriptions: {}, locationDescriptions: {}, locationViews: {'the-bridge': views}, lookBrief: 'Look. More.'})
        expect(request!.prompt).toContain('The picture shows the place from the water side, looking back toward the dunes.')
        expect(request!.prompt).toContain('The background is <Picture 1>.')
        expect(request!.prompt).not.toContain('sheet of views')
        expect(request!.assets.pictures[0]!.file).toBe('assets/sequence/locations/the-bridge/frames/frame_01.png')
    })
})

describe('held shots', () => {
    const scene = screenplay.scenes[0]!
    const input = (hold: boolean) => {
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [{framing: 'close-up', camera: 'locked off', characters: ['Anna'], action: 'Anna speaks.', lines: [1], seconds: 4, hold, people: {Anna: {state: 'stands at the rail'}}}, {framing: 'close-up', camera: 'c', characters: ['Ben'], action: 'Ben answers.', lines: [2], seconds: 4}]}, scene, cast, false)
        return {screenplay, cast, clips: packClips(screenplay, [coverage, toCoverage({soundscape: 's', people: true, shots: [{framing: 'wide', camera: 'c', characters: ['Anna'], action: 'Anna lights a candle.', lines: [1], seconds: 4}]}, screenplay.scenes[1]!, cast).coverage], 'auto').filter(c => c.sceneId === 's1'), soundscapes: {}, stagings: {}, voices: {}, characterDescriptions: {}, locationDescriptions: {}, lookBrief: 'Look. More.'}
    }
    test('a held shot says positively how the picture stays', async () => {
        const {buildFilmClipRequests} = await import("./compose.ts")
        const [held] = buildFilmClipRequests(input(true))
        expect(held!.prompt).toContain('A fixed tripod shot: the framing is the same from the first frame to the last - <Subject 2> keeps the same size and the same place in the frame')
        const [free] = buildFilmClipRequests(input(false))
        expect(free!.prompt).not.toContain('A fixed tripod shot')
    })
    test('the planner says per shot whether it is held', () => {
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [{framing: 'close-up', camera: 'c', characters: ['Anna'], action: 'Anna speaks.', lines: [1, 2], seconds: 4, hold: true}]}, scene, cast)
        expect(coverage.shots[0]!.hold).toBe(true)
        expect(toCoverage({soundscape: 's', people: true, shots: [{framing: 'close-up', camera: 'c', characters: ['Anna'], action: 'Anna speaks.', lines: [1, 2], seconds: 4, hold: 'yes'}]}, scene, cast).coverage.shots[0]!.hold).toBeUndefined()
    })
})

describe('film config workflows', () => {
    const load = async (config: object) => {
        const {mkdtempSync, writeFileSync, rmSync} = await import("node:fs")
        const {tmpdir} = await import("node:os")
        const {join} = await import("node:path")
        const {loadFilmConfig} = await import("./config.ts")
        const dir = mkdtempSync(join(tmpdir(), 'film-config-'))
        try {
            writeFileSync(join(dir, 'config.json'), JSON.stringify(config))
            return await loadFilmConfig(dir)
        } finally {
            rmSync(dir, {recursive: true, force: true})
        }
    }
    test('one image and one video workflow: the defaults, or the files named', async () => {
        const standard = await load({})
        expect([standard.imageWorkflow, standard.videoWorkflow]).toEqual(['kroma-image', 'h3-ref2video-film'])
        const {filmRenderConfig} = await import("./pictures.ts")
        expect(filmRenderConfig(await load({videoWorkflow: 'h3-ref2video'})).videoWorkflow).toBe('h3-ref2video')
    })
    test('the beta workflow: the same graph without the LoRA, res_multistep, beta, 20 steps', async () => {
        expect((await load({videoWorkflow: 'h3-ref2video-film-beta'})).videoWorkflow).toBe('h3-ref2video-film-beta')
        const {workflow, output} = (await import("../../comfy/workflows/h3-ref2video-film-beta.ts")).default({prompt: 'p', pictures: [], frames: 73, seed: 1, resolution: -1, filenamePrefix: 'x'})
        const nodes = Object.values(workflow.build({outputs: {result: output}}).workflow as Record<string, { class_type: string, inputs: Record<string, unknown> }>)
        expect(nodes.filter(n => n.class_type === 'LoraLoaderModelOnly')).toHaveLength(0)
        expect(nodes.find(n => n.class_type === 'KSamplerSelect')!.inputs.sampler_name).toBe('res_multistep')
        const scheduler = nodes.find(n => n.class_type === 'BasicScheduler')!
        expect([scheduler.inputs.scheduler, scheduler.inputs.steps]).toEqual(['beta', 20])
    })
    test('a workflow that is not in comfy/workflows/ is refused', async () => {
        await expect(load({videoWorkflow: 'nope'})).rejects.toThrow('videoWorkflow: no workflow comfy/workflows/nope.ts')
        await expect(load({imageWorkflow: 'nope'})).rejects.toThrow('imageWorkflow: no workflow comfy/workflows/nope.ts')
    })
})

describe('shot planning prompt rules', () => {
    test('the view of the place matches the camera position', async () => {
        const {coveragePrompt} = await import("./prompts.ts")
        const views = [{name: 'from the shore, looking north', shows: 'x'}, {name: 'high above the whole place', shows: 'y'}]
        const {instructions} = coveragePrompt(screenplay.scenes[0]!, cast.locations[0]!, cast.characters, 'en', 'Look. More.', undefined, 6, [], undefined, views)
        expect(instructions).toContain('never contradict each other')
        expect(instructions).toContain('an elevated view only for a camera that is high above')
        expect(instructions).not.toContain('never by that name')
    })
    test('the instructions are the same for every scene - the scene and the problems are in the input', async () => {
        const {coveragePrompt} = await import("./prompts.ts")
        const first = coveragePrompt(screenplay.scenes[0]!, cast.locations[0]!, cast.characters, 'en', 'Look.', 20, 3)
        const again = coveragePrompt(screenplay.scenes[0]!, cast.locations[0]!, cast.characters, 'en', 'Look.', undefined, 6, ['shot 2 names nobody'])
        expect(again.instructions).toBe(first.instructions)
        expect(first.input).toContain('Most shots: 3')
        expect(again.input).toEndWith('- shot 2 names nobody')
    })
})

describe('characters the script has not brought in yet', () => {
    const empty = {...screenplay.scenes[0]!, elements: [{type: 'action' as const, text: 'A surreal horizon of dunes and black water under an eclipse.'}]}
    const shot = {framing: 'wide establishing shot', camera: 'c', characters: ['Anna'], action: 'The place lies empty.', seconds: 4}
    const raw = {soundscape: 's', people: true, shots: [shot]}
    test('named by the end of a scene: in the action lines, as a speaker, in what is spoken - never from the look brief', async () => {
        const {namedByScene} = await import("./names.ts")
        const arrives = {...empty, elements: [{type: 'action' as const, text: 'Anna emerges from the dust.'}]}
        expect([...namedByScene([empty, arrives], cast.characters, 0)]).toEqual([])
        expect([...namedByScene([empty, arrives], cast.characters, 1)]).toEqual([cast.characters.find(c => c.name === 'Anna')!.id])
        const speaks = {...empty, elements: [{type: 'dialogue' as const, speaker: 'BEN', text: 'Hello.', kind: 'spoken' as const}]}
        expect(namedByScene([speaks], cast.characters, 0).size).toBe(1)
    })
    test('a shot with a character who arrives later is asked again; the second time they are left out', () => {
        expect(() => toCoverage(raw, empty, cast, true, new Set())).toThrow(CoverageProblem)
        const {coverage, notes} = toCoverage(raw, empty, cast, false, new Set())
        expect(coverage.shots[0]!.characters).toEqual([])
        expect(notes.join(' ')).toContain('left out')
        // named by the script: nothing to say
        const anna = cast.characters.find(c => c.name === 'Anna')!.id
        expect(toCoverage(raw, empty, cast, true, new Set([anna])).coverage.shots[0]!.characters).toEqual([anna])
    })
})

describe('rules found in the witch film', () => {
    test('the place is described without what the script reveals later and without props', async () => {
        const {castPrompt} = await import("./prompts.ts")
        const {instructions} = castPrompt(screenplay)
        expect(instructions).toContain('what the script reveals, uncovers, builds, breaks or changes later')
        expect(instructions).toContain('every object that someone picks up, carries, uses or moves')
        expect(instructions).toContain('only in "states", never in "appearance"')
        expect(instructions).toContain('not an object that turns up in one scene')
        expect(instructions).toContain('never invented to fit the mood')
    })
    test('state and frame are one position, conversations keep the listener in the picture, a look keeps the whole outfit', async () => {
        const {coveragePrompt, stateLookPrompt} = await import("./prompts.ts")
        const {instructions} = coveragePrompt(screenplay.scenes[0]!, cast.locations[0]!, cast.characters, 'en', 'Look. More.', undefined, 6)
        expect(instructions).toContain('the same single position as their "frame"')
        expect(instructions).toContain('both in every shot of their conversation')
        expect(stateLookPrompt('base', 'Anna', {name: 'wounded', change: 'a cut'}).instructions).toContain('head to feet (trousers or skirt, shoes included)')
    })
    test('a voice-over is heard over the picture: nobody in the shot speaks it', async () => {
        const {buildFilmClipRequests} = await import("./compose.ts")
        const voiceScreenplay = {...screenplay, scenes: [{...screenplay.scenes[0]!, elements: [{type: 'dialogue' as const, speaker: 'ANNA', text: 'A voice on the radio.', kind: 'voiceover' as const}]}]}
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [{framing: 'close-up', camera: 'c', characters: ['Anna'], action: 'Anna holds a radio.', lines: [1], seconds: 4}]}, voiceScreenplay.scenes[0]!, cast)
        const [request] = buildFilmClipRequests({screenplay: voiceScreenplay, cast, clips: packClips(voiceScreenplay, [coverage], 'auto'), soundscapes: {}, stagings: {}, voices: {}, characterDescriptions: {}, locationDescriptions: {}, lookBrief: 'Look. More.'})
        expect(request!.prompt).toContain('heard over the picture, not spoken by anyone in it: everybody\'s lips stay completely closed')
    })
})

describe('who talks looks at the listener', () => {
    const scene = screenplay.scenes[0]!
    const lines = scene.elements.filter(e => e.type === 'dialogue')
    const shotOf = (facing: string) => ({soundscape: 's', people: true, shots: [{framing: 'medium close-up', camera: 'c', characters: ['Anna', 'Ben'], action: 'Anna speaks to Ben.', lines: [1, 2], seconds: 4, people: {Anna: {state: 'stands', frame: 'sharp, centre', facing}, Ben: {state: 'stands', frame: 'soft, edge'}}}]})
    test('a speaker with a listener in the shot who looks into the lens is asked again, once', () => {
        expect(lines.length).toBeGreaterThan(0)
        expect(() => toCoverage(shotOf('camera'), scene, cast, true)).toThrow(CoverageProblem)
        // the second time it is only noted
        const {notes} = toCoverage(shotOf('camera'), scene, cast, false)
        expect(notes.join(' ')).toContain('looks into the lens')
        // looking at the listener is fine, and facing is kept
        expect(Object.values(toCoverage(shotOf('left'), scene, cast, true).coverage.shots[0]!.people!).map(p => p.facing)).toContain('left')
    })
    test('the face is turned the way the planner says, in the clip prompt', async () => {
        const {buildFilmClipRequests} = await import("./compose.ts")
        const {coverage} = toCoverage(shotOf('left'), scene, cast, true)
        const [request] = buildFilmClipRequests({screenplay, cast, clips: packClips(screenplay, [coverage, toCoverage({soundscape: 's', people: true, shots: [{framing: 'wide', camera: 'c', characters: ['Anna'], action: 'Anna lights a candle.', lines: [1], seconds: 4}]}, screenplay.scenes[1]!, cast).coverage], 'auto').filter(c => c.sceneId === scene.id), soundscapes: {}, stagings: {}, voices: {}, characterDescriptions: {}, locationDescriptions: {}, lookBrief: 'Look. More.'})
        expect(request!.prompt).toContain('sharp, centre, looking toward the left of the frame')
    })
})

describe('a person at the near edge of the picture', () => {
    test('is drawn from "In frame" alone: no place, no movement - a second whole person would appear there', async () => {
        const {buildFilmClipRequests} = await import("./compose.ts")
        const scene = screenplay.scenes[0]!
        const {coverage} = toCoverage({soundscape: 's', people: true, shots: [{framing: 'medium close-up', camera: 'c', characters: ['Anna', 'Ben'], action: 'Anna speaks to Ben.', lines: [1, 2], seconds: 4, hold: true, people: {
            Anna: {state: 'stands at the stone, hands in the roots', frame: 'sharp, centre', facing: 'right', motion: 'stays at the stone'},
            Ben: {state: 'stands at the east edge of the clearing', frame: 'soft, left of frame, back and shoulder only', foreground: true, motion: 'stays at the edge'}}}]}, scene, cast)
        const [request] = buildFilmClipRequests({screenplay, cast, clips: packClips(screenplay, [coverage, toCoverage({soundscape: 's', people: true, shots: [{framing: 'wide', camera: 'c', characters: ['Anna'], action: 'Anna lights a candle.', lines: [1], seconds: 4}]}, screenplay.scenes[1]!, cast).coverage], 'auto').filter(c => c.sceneId === scene.id), soundscapes: {}, stagings: {}, voices: {}, characterDescriptions: {}, locationDescriptions: {}, lookBrief: 'Look. More.'})
        expect(request!.prompt).toContain('soft, left of frame, back and shoulder only')
        expect(request!.prompt).toContain('stands at the stone, hands in the roots')
        expect(request!.prompt).not.toContain('east edge of the clearing')
        expect(request!.prompt).not.toContain('stays at the edge')
        expect(request!.prompt).toContain('stays at the stone')
    })
})

describe('a cutaway while a line is heard', () => {
    const scene = screenplay.scenes[0]!
    const raw = (cutaway: boolean) => ({soundscape: 's', people: true, shots: [{framing: 'extreme close-up insert', camera: 'c', characters: ['Anna'], action: 'The jar fills the frame.', lines: [1, 2], seconds: 4, cutaway}]})
    test('the speaker is not added to the picture, the line is spoken off-screen', async () => {
        const {buildFilmClipRequests} = await import("./compose.ts")
        const on = toCoverage(raw(false), scene, cast).coverage.shots[0]!
        expect(on.characters.length).toBeGreaterThan(0)
        const {coverage} = toCoverage({...raw(true), shots: [{...raw(true).shots[0]!, characters: []}]}, scene, cast)
        expect(coverage.shots[0]!.cutaway).toBe(true)
        expect(coverage.shots[0]!.characters).toEqual([])
        const [request] = buildFilmClipRequests({screenplay, cast, clips: packClips(screenplay, [coverage, toCoverage({soundscape: 's', people: true, shots: [{framing: 'wide', camera: 'c', characters: ['Anna'], action: 'Anna lights a candle.', lines: [1], seconds: 4}]}, screenplay.scenes[1]!, cast).coverage], 'auto').filter(c => c.sceneId === scene.id), soundscapes: {}, stagings: {}, voices: {}, characterDescriptions: {}, locationDescriptions: {}, lookBrief: 'Look. More.'})
        expect(request!.prompt).toContain('off-screen, says in')
        expect(request!.prompt).toContain('nobody in the picture speaks it')
    })
})

describe('a look begins in the scene the script gives it', () => {
    const scene = screenplay.scenes[0]!
    const anna = cast.characters.find(c => c.name === 'Anna')!
    const withLook = {...cast, characters: cast.characters.map(c => c.id === anna.id ? {...c, states: [{id: 'bearded', name: 'bearded', change: 'a full beard', from: 3}]} : c)}
    const raw = {soundscape: 's', people: true, shots: [{framing: 'medium shot', camera: 'c', characters: ['Anna'], action: 'Anna waits.', seconds: 4, lines: [1, 2], states: {Anna: 'bearded'}}]}
    test('before that scene the planner cannot use it, from it on it can', () => {
        expect(toCoverage(raw, scene, withLook, true, undefined, 2).coverage.shots[0]!.states).toBeUndefined()
        expect(toCoverage(raw, scene, withLook, true, undefined, 3).coverage.shots[0]!.states).toEqual({[anna.id]: 'bearded'})
    })
    test('the cast step gives the scene number of a look, the screenplay headings are numbered for it', async () => {
        const {toCast} = await import("./screenplay.ts")
        const {screenplayToText} = await import("./fountain.ts")
        expect(screenplayToText(screenplay, true)).toContain('[Scene 1] ')
        expect(screenplayToText(screenplay, true)).toContain('[Scene 2] ')
        expect(screenplayToText(screenplay)).not.toContain('[Scene 1]')
        const made = toCast({characters: [{name: 'Anna', aliases: ['ANNA'], role: 'r', appearance: 'a', voice: 'v', states: [{name: 'bearded', change: 'a full beard', from: 19}, {name: 'tired', change: 'dark rings', from: 'nonsense'}]}, {name: 'Ben', aliases: ['BEN'], role: 'r', appearance: 'a', voice: 'v'}], locations: [{name: 'The Bridge', aliases: ['BRIDGE'], description: 'd'}, {name: 'The Hut', aliases: ['HUT'], description: 'd'}]} as never, screenplay)
        const states = made.characters[0]!.states!
        expect(states[0]!.from).toBe(19)
        expect(states[1]!.from).toBeUndefined()
    })
})

describe('the cast step asked again', () => {
    test('the union of both answers by name: the new one wins, what only the earlier one has is kept', async () => {
        const {mergeRawCasts} = await import("./screenplay.ts")
        const merged = mergeRawCasts(
            {characters: [{name: 'Anna', role: 'old'}, {name: 'Radio Voice', role: 'voice'}], locations: [{name: 'The Hut'}]},
            {characters: [{name: 'anna', role: 'new'}, {name: 'Ben', role: 'b'}], locations: [{name: 'The Bridge'}]})
        expect(merged.characters!.map(c => `${c.name}:${c.role}`)).toEqual(['anna:new', 'Ben:b', 'Radio Voice:voice'])
        expect(merged.locations!.map(l => l.name)).toEqual(['The Bridge', 'The Hut'])
    })
    test('a place the second answer writes otherwise ("–" for "-", other case) is the same place, with the names of both', async () => {
        const {mergeRawCasts} = await import("./screenplay.ts")
        const merged = mergeRawCasts(
            {characters: [{name: 'Vyvian'}], locations: [{name: 'AURORA THEATRE - STAGE', aliases: ['AURORA THEATRE - STAGE']}]},
            {characters: [{name: 'Vyvian'}], locations: [{name: 'Aurora Theatre – Stage', aliases: ['INT. AURORA THEATRE - STAGE - NIGHT']}]})
        expect(merged.locations).toHaveLength(1)
        expect(merged.locations![0]!.aliases).toEqual(['INT. AURORA THEATRE - STAGE - NIGHT', 'AURORA THEATRE - STAGE'])
        // and one answer that has it twice gives one place - every name of it finds it
        const play = toScreenplay({scenes: [{setting: 'INT', location: 'AURORA THEATRE - STAGE', time: 'NIGHT', elements: [{type: 'action', text: 'Vyvian waits.'}]}]}, {title: 't', language: 'en'})
        const cast = toCast({characters: [{name: 'Vyvian'}], locations: [{name: 'AURORA THEATRE - STAGE'}, {name: 'Aurora Theatre – Stage', aliases: ['the old stage']}]}, play)
        expect(cast.locations.map(l => l.id)).toEqual(['aurora-theatre-stage'])
        expect(locationOf(cast, 'the old stage')?.id).toBe('aurora-theatre-stage')
    })
})

describe('a closer too many in an answer of the language model', () => {
    test('a bracket that closes the whole answer while it goes on is left out', async () => {
        const {closeOpenBrackets} = await import("../llm.ts")
        const answer = '{"people": true, "ends": {"Leo": "stands", "Ben": "waits"}}, "shots": [{"framing": "wide", "people": {"Leo": {"state": "x"}}, "lines": []}]}'
        expect(() => JSON.parse(answer)).toThrow()
        expect(JSON.parse(closeOpenBrackets(answer)).shots[0].framing).toBe('wide')
        // what was repaired before still is: a missing closer at the end
        expect(JSON.parse(closeOpenBrackets('{"a": [{"b": 1}'))).toEqual({a: [{b: 1}]})
        // a closer that ends the answer is not touched
        expect(closeOpenBrackets('{"a": 1}')).toBe('{"a": 1}')
    })
})

describe('the timeline as an edit decision list', () => {
    test('clips in order, a continuing clip without its first frame', async () => {
        const {timelineEdl} = await import("./timeline.ts")
        const edl = timelineEdl('Test', [{id: 'clip-001', frames: 48}, {id: 'clip-002', frames: 72, startsFrom: 'clip-001'}, {id: 'clip-003', frames: 24, startsFrom: 'clip-001'}])
        expect(edl).toContain('TITLE: Test')
        expect(edl).toContain('001  AX       V     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00')
        // the second goes on from the first: source from frame 1, record right after the first
        expect(edl).toContain('002  AX       V     C        00:00:00:01 00:00:03:00 00:00:02:00 00:00:04:23')
        // the third names a clip that is not the one before it: nothing is left out
        expect(edl).toContain('003  AX       V     C        00:00:00:00 00:00:01:00 00:00:04:23 00:00:05:23')
        expect(edl).toContain('* FROM CLIP NAME: clip-002.mp4')
    })
})

describe('source fidelity and ambiguous names', () => {
    const play = toScreenplay({scenes: [{setting: 'INT', location: 'The Hut', time: 'DAY', elements: [{type: 'dialogue', speaker: 'A', text: 'Hello.', kind: 'spoken'}]}]}, {title: 'T', language: 'en'})
    test('a source line the screenplay has no trace of is reported', () => {
        expect(omittedSourceLines(play, 'A\nHello.\nB\nDo not leave me here.')).toEqual(['Do not leave me here.'])
    })
    test('a source with everything in it reports nothing', () => {
        expect(omittedSourceLines(play, 'A\nHello.')).toEqual([])
    })
    test('a short line is not found inside other words', () => {
        const short = toScreenplay({scenes: [{setting: 'INT', location: 'The Hut', time: 'DAY', elements: [{type: 'dialogue', speaker: 'A', text: 'No.', kind: 'spoken'}]}]}, {title: 'T', language: 'en'})
        expect(missingDialogue(short, 'A\nNone of this is said.')).toEqual(['No.'])
    })
    test('an alias that names two characters belongs to neither - the cue is then not in the cast', () => {
        const raw = {characters: [{name: 'Anna', aliases: ['A']}, {name: 'Ben', aliases: ['A']}], locations: [{name: 'The Hut', aliases: ['The Hut']}]}
        expect(() => toCast(raw, play)).toThrow('not in the cast')
        const named = toCast(raw, toScreenplay({scenes: [{setting: 'INT', location: 'The Hut', time: 'DAY', elements: [{type: 'dialogue', speaker: 'Anna', text: 'Hi.', kind: 'spoken'}]}]}, {title: 'T', language: 'en'}))
        expect(characterOf(named, 'A')).toBeUndefined()
        expect(characterOf(named, 'Anna')?.name).toBe('Anna')
    })
})

describe('the film store and its inputs - for --dry-run, --review and bun run status --film', () => {
    const store = () => {
        const film = new FilmStore('test-film')
        film.data = {brief: {} as never, screenplay: {} as never, cast: {characters: [], locations: []}, summary: 's', lookBrief: 'l', characterLooks: {}, coverage: [], inputs: {'style.txt': Bun.hash('noir').toString(16)}}
        return film
    }
    test('changedInputs: what changed since the last run, read only', () => {
        const film = store()
        expect(film.changedInputs({'style.txt': {value: 'noir', steps: ['lookBrief']}, 'idea.txt': {value: 'new', steps: ['brief']}})).toEqual([])
        expect(film.changedInputs({'style.txt': {value: 'pastel', steps: ['lookBrief']}})).toEqual([{name: 'style.txt', steps: ['lookBrief']}])
        expect(film.data.lookBrief).toBe('l')
    })
    test('redoneBy: the steps with a result that invalidating these would remove, in pipeline order, nothing removed', () => {
        const film = store()
        expect(film.redoneBy(['lookBrief'])).toEqual(['lookBrief', 'characterLooks', 'coverage'])
        expect(film.redoneBy(['screenplay'])).toEqual(['screenplay', 'cast', 'summary', 'lookBrief', 'characterLooks', 'coverage'])
        expect(film.data.lookBrief).toBe('l')
    })
    test('which steps a film uses', () => {
        const config = {...filmDefaults, targetDurationSet: false}
        expect(filmStepUsed('outline', 'screenplay', {}, config)).toBe(false)
        expect(filmStepUsed('outline', 'idea', {}, config)).toBe(true)
        expect(filmStepUsed('locationViews', 'idea', {}, config)).toBe(false)
        expect(filmStepUsed('locationViews', 'idea', {}, {...config, locationViews: true})).toBe(true)
        expect(filmStepUsed('scriptFixes', 'idea', {}, config)).toBe(false)
        expect(filmStepUsed('scriptFixes', 'idea', {scriptFixes: []}, config)).toBe(true)
        expect(filmStepUsed('subtitles', 'idea', {}, config)).toBe(false)
        expect(filmStepUsed('subtitles', 'idea', {}, {...config, subtitles: 'en'})).toBe(true)
    })
})
