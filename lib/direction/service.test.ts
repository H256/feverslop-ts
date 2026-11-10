import {test, expect, afterEach} from 'bun:test'
import {mkdtempSync, writeFileSync, rmSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {
    readDirection,
    setDirectionRules,
    setDirectionEdits,
    directionPlanNotes,
    previewDirection,
    takeDirection,
    dropDirection,
    restoreDirection,
    applyDirectionOverlay,
    directionReview,
} from './service.ts'
const dirs: string[] = []
afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true})
})
function fixture(kind: 'music' | 'film' = 'music') {
    const dir = mkdtempSync(join(tmpdir(), 'direction-'))
    dirs.push(dir)
    const shots = [
        {action: 'walk', camera: 'still', characters: ['a'], seconds: 3, lines: [0]},
        {action: 'wait', characters: ['b'], seconds: 4, lines: []},
    ]
    const data: any =
        kind === 'film'
            ? {
                  screenplay: {scenes: [{id: 's1', elements: []}]},
                  cast: {
                      characters: [
                          {id: 'a', name: 'A'},
                          {id: 'b', name: 'B'},
                      ],
                  },
                  coverage: [{sceneId: 's1', shots}],
              }
            : {
                  story: 'story',
                  cast: {
                      characters: [
                          {id: 'a', name: 'A'},
                          {id: 'b', name: 'B'},
                      ],
                      locations: [],
                  },
                  beats: [{id: 's1', summary: 'walk', characterIds: ['a', 'b'], kind: 'build', moments: ['walk'], stateAfter: []}],
                  music: {bpm: 120, durationSec: 20, downbeats: [10, 12, 14], barEnergy: [0.5, 0.5, 0.5], sections: []},
                  shotMoments: {s1: {shots}},
              }
    writeFileSync(join(dir, 'project.json'), JSON.stringify(data))
    return {target: {dir, kind, id: 'test'}, data}
}
const answer = (input: any) => ({changes: input.selected.map((s: any) => ({shotId: s.id, after: {...s.data, action: 'walk gently'}})), conflicts: []})
test('verbatim rules select character intersection, preview never mutates plan; take/drop/restore work', async () => {
    const {target, data} = fixture()
    await setDirectionRules(target, {rules: [{id: 'r', text: '  Walk gently.  ', scope: {kind: 'global'}, characterId: 'a'}]})
    expect(readDirection(target).rules[0]!.text).toBe('  Walk gently.  ')
    await previewDirection(target, async o => answer(JSON.parse(o.input)))
    expect(readDirection(target).proposal!.changes).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(target.dir, 'project.json'), 'utf8'))).toEqual(data)
    await takeDirection(target)
    const v = readDirection(target).activeVersion!
    expect(applyDirectionOverlay(target, data).shotMoments!.s1!.shots[0]!.action).toBe('walk gently')
    await previewDirection(target, async o => answer(JSON.parse(o.input)))
    await dropDirection(target)
    expect(readDirection(target).proposal).toBeUndefined()
    await restoreDirection(target, v)
})
test('protected timing rejected with bounded retries; conflicts cannot be accepted', async () => {
    const {target} = fixture('film')
    await setDirectionRules(target, {rules: [{id: 'r', text: 'slowly', scope: {kind: 'global'}}]})
    let calls = 0
    await expect(
        previewDirection(target, async o => {
            calls++
            const r = answer(JSON.parse(o.input))
            r.changes[0].after.seconds = 99
            return r
        }),
    ).rejects.toThrow('protected')
    expect(calls).toBe(2)
    expect(readDirection(target).proposal).toBeUndefined()
    await previewDirection(target, async o => ({...answer(JSON.parse(o.input)), conflicts: ['contradicts next scene']}))
    await expect(takeDirection(target)).rejects.toThrow('conflict')
})
test('stale proposals and reused shot IDs rejected, broad intent retained after replan', async () => {
    const {target, data} = fixture()
    const id = readDirection(target).shots[0]!.id
    await setDirectionRules(target, {
        rules: [
            {id: 'r', text: 'gently', scope: {kind: 'shot', id}},
            {id: 'g', text: 'soft', scope: {kind: 'global'}},
        ],
    })
    await previewDirection(target, async o => answer(JSON.parse(o.input)))
    data.shotMoments!.s1!.shots[0]!.action = 'run'
    writeFileSync(join(target.dir, 'project.json'), JSON.stringify(data))
    await expect(takeDirection(target)).rejects.toThrow('stale')
    expect(readDirection(target).unresolved).toHaveLength(1)
    expect(readDirection(target).rules).toHaveLength(2)
    expect(() => applyDirectionOverlay(target, data)).toThrow('review')
})
test('malformed JSON and added shots never write proposal', async () => {
    const {target} = fixture()
    await setDirectionRules(target, {rules: [{id: 'g', text: 'soft', scope: {kind: 'global'}}]})
    await expect(previewDirection(target, async () => ({changes: [], conflicts: []}))).rejects.toThrow()
    await expect(previewDirection(target, async () => null)).rejects.toThrow()
    expect(readDirection(target).proposal).toBeUndefined()
})
test('concurrent same-process mutation cannot steal preview lock', async () => {
    const {target} = fixture()
    await setDirectionRules(target, {rules: [{id: 'g', text: 'soft', scope: {kind: 'global'}}]})
    let release!: () => void
    const waiting = new Promise<void>(r => (release = r))
    let entered!: () => void
    const ready = new Promise<void>(r => (entered = r))
    const pending = previewDirection(target, async o => {
        entered()
        await waiting
        return answer(JSON.parse(o.input))
    })
    await ready
    await expect(setDirectionRules(target, {rules: []})).rejects.toThrow('worked on')
    release()
    await pending
})
test('removing final rule retains accepted action and acknowledges future intent removal', async () => {
    const {target, data} = fixture()
    await setDirectionRules(target, {rules: [{id: 'g', text: 'soft', scope: {kind: 'global'}}]})
    await previewDirection(target, async o => answer(JSON.parse(o.input)))
    await takeDirection(target)
    await setDirectionRules(target, {rules: []})
    expect(readDirection(target).pending).toBe(false)
    expect((applyDirectionOverlay(target, data as any) as any).shotMoments.s1.shots[0].action).toBe('walk gently')
})
test('occasional broad rule may choose a subset; guitar close-up can remove other visible people', async () => {
    const {target, data} = fixture()
    const first = data.shotMoments!.s1!.shots[0]! as any
    first.characters = ['a', 'b']
    delete first.lines
    first.people = {a: {playing: true, plays: 'strums', motion: 'stands'}, b: {motion: 'stands'}}
    writeFileSync(join(target.dir, 'project.json'), JSON.stringify(data))
    await setDirectionRules(target, {rules: [{id: 'g', text: 'Sometimes frame only the guitar hands', scope: {kind: 'global'}}]})
    await previewDirection(target, async o => {
        const s = JSON.parse(o.input).selected[0]
        return {
            changes: [
                {
                    shotId: s.id,
                    after: {...s.data, characters: ['a'], hands: 'a', people: {a: {...s.data.people.a, plays: 'picks rapidly', motion: 'fingers race'}}},
                },
            ],
            conflicts: [],
        }
    })
    await takeDirection(target)
    expect(readDirection(target).proposal).toBeUndefined()
    expect(readDirection(target).shots[0]!.characters).toEqual(['a'])
})
test('restore baseline keeps rules, derived caches do not stale proposals, render config does', async () => {
    const {target, data} = fixture()
    await setDirectionRules(target, {rules: [{id: 'g', text: 'soft', scope: {kind: 'global'}}]})
    await previewDirection(target, async o => answer(JSON.parse(o.input)))
    data.shotViews = {s1: [2, 3]}
    data.partials = {cache: 123}
    writeFileSync(join(target.dir, 'project.json'), JSON.stringify(data))
    await takeDirection(target)
    const baseline = readDirection(target).versions.find(v => v.id.startsWith('baseline-'))!
    await restoreDirection(target, baseline.id)
    expect(readDirection(target).shots[0]!.data.action).toBe('walk')
    expect(readDirection(target).rules).toHaveLength(1)
    expect(readDirection(target).restored).toBe(true)
    await previewDirection(target, async o => answer(JSON.parse(o.input)))
    writeFileSync(join(target.dir, 'config.json'), JSON.stringify({fightClips: true}))
    await expect(takeDirection(target)).rejects.toThrow('stale')
})
test('tampered saved overlays cannot alter protected timing', async () => {
    const {target, data} = fixture()
    await setDirectionRules(target, {rules: [{id: 'g', text: 'soft', scope: {kind: 'global'}}]})
    await previewDirection(target, async o => answer(JSON.parse(o.input)))
    await takeDirection(target)
    const path = join(target.dir, 'direction.json'),
        s = JSON.parse(readFileSync(path, 'utf8'))
    s.versions.find((v: any) => v.id === s.activeVersion).changes[0].after.seconds = 77
    writeFileSync(path, JSON.stringify(s))
    expect(() => applyDirectionOverlay(target, data)).toThrow('protected')
})
test('music time scopes select intersecting windows and reject film time scope', async () => {
    const {target, data} = fixture()
    data.beats[0].kind = 'build'
    data.timeline = {slots: [{id: 'slot-001', index: 0, section: 'A', start: 10, end: 14, bars: 2, energy: 0.6, lyrics: []}]}
    data.mapping = [{slotId: 'slot-001', beatId: 's1'}]
    writeFileSync(join(target.dir, 'project.json'), JSON.stringify(data))
    await setDirectionRules(target, {rules: [{id: 'r', text: 'gently', scope: {kind: 'time', start: 12, end: 13}}]})
    await previewDirection(target, async o => answer(JSON.parse(o.input)))
    expect(readDirection(target).proposal!.changes.map(c => c.shotId)).toEqual(['s1:shot2'])
    const film = fixture('film')
    await expect(setDirectionRules(film.target, {rules: [{id: 'r', text: 'soft', scope: {kind: 'time', start: 1, end: 2}}]})).rejects.toThrow('film uses scene')
})
test('fight-split song ranges use regenerated per-bar slots', async () => {
    const {target, data} = fixture()
    data.beats[0].kind = 'hit'
    data.cast.characters[0].isGroup = true
    data.music = {downbeats: [0, 1, 3, 7], bpm: 120, durationSec: 8, barEnergy: [0.9, 0.9, 0.9, 0.9], sections: []}
    data.timeline = {slots: [{id: 'slot-001', index: 0, section: 'A', start: 0, end: 8, bars: 4, energy: 0.9, lyrics: []}]}
    data.mapping = [{slotId: 'slot-001', beatId: 's1'}]
    data.shotMoments.s1.shots.push({action: 'x', characters: ['a']}, {action: 'y', characters: ['a']})
    writeFileSync(join(target.dir, 'project.json'), JSON.stringify(data))
    writeFileSync(join(target.dir, 'config.json'), JSON.stringify({fightClips: true}))
    expect(readDirection(target).shots.map(s => s.start)).toEqual([0, 1, 3, 7])
})
test('after removing all rules a new base plan can run, retaining old versions only as history', async () => {
    const {target, data} = fixture()
    await setDirectionRules(target, {rules: [{id: 'g', text: 'gentle', scope: {kind: 'global'}}]})
    await previewDirection(target, async o => answer(JSON.parse(o.input)))
    await takeDirection(target)
    await setDirectionRules(target, {rules: []})
    data.shotMoments.s1.shots[0].action = 'new plan'
    writeFileSync(join(target.dir, 'project.json'), JSON.stringify(data))
    expect(readDirection(target).pending).toBe(false)
    expect(applyDirectionOverlay(target, data).shotMoments.s1.shots[0].action).toBe('new plan')
    expect(readDirection(target).versions.length).toBeGreaterThan(0)
})
test('render seed changes do not invalidate accepted direction', async () => {
    const {target, data} = fixture()
    await setDirectionRules(target, {rules: [{id: 'g', text: 'gentle', scope: {kind: 'global'}}]})
    await previewDirection(target, async o => answer(JSON.parse(o.input)))
    await takeDirection(target)
    writeFileSync(join(target.dir, 'config.json'), JSON.stringify({seed: 123, videoSteps: 20}))
    expect(readDirection(target).pending).toBe(false)
    expect(applyDirectionOverlay(target, data).shotMoments.s1.shots[0].action).toBe('walk gently')
})
test('invalid facing is rejected before it can reach composition', async () => {
    const {target, data} = fixture()
    data.shotMoments.s1.shots[0].people = {a: {facing: 'right', motion: 'walks'}}
    writeFileSync(join(target.dir, 'project.json'), JSON.stringify(data))
    await setDirectionRules(target, {rules: [{id: 'r', text: 'turn around', scope: {kind: 'character', id: 'a'}}]})
    await expect(
        previewDirection(target, async o => {
            const shot = JSON.parse(o.input).selected[0]
            return {changes: [{shotId: shot.id, after: {...shot.data, people: {a: {...shot.data.people.a, facing: 'backwards'}}}}], conflicts: []}
        }),
    ).rejects.toThrow('invalid facing')
    expect(readDirection(target).proposal).toBeUndefined()
})

test('direction windows use actual downbeat cuts, not evenly divided estimates', async () => {
    const {target, data} = fixture()
    data.music = {bpm: 120, durationSec: 8, downbeats: [0, 1, 3, 7], barEnergy: [0.5, 0.5, 0.5, 0.5], sections: []}
    data.beats[0] = {...data.beats[0], kind: 'build', order: 1, moments: ['walk'], stateAfter: [], locationId: 'hall'}
    data.cast.locations = [{id: 'hall', name: 'Hall'}]
    data.timeline = {slots: [{id: 'slot-001', index: 0, section: 'A', start: 0, end: 8, bars: 4, energy: 0.5, lyrics: []}]}
    data.mapping = [{slotId: 'slot-001', beatId: 's1'}]
    writeFileSync(join(target.dir, 'project.json'), JSON.stringify(data))
    await setDirectionRules(target, {rules: [{id: 'r', text: 'left', scope: {kind: 'time', start: 3.2, end: 3.8}}]})
    await previewDirection(target, async o => answer(JSON.parse(o.input)))
    expect(readDirection(target).proposal!.changes.map(c => c.shotId)).toEqual(['s1:shot2'])
})

// direct edits (#735): applied by code, no language model, kept through a new plan
const twoPeople = (target: {dir: string}, data: any) => {
    data.shotMoments.s1.shots[1] = {action: '{B} waits while {A} looks on', characters: ['a', 'b'], people: {a: {state: 'stands'}, b: {state: 'sits'}}}
    writeFileSync(join(target.dir, 'project.json'), JSON.stringify(data))
}
test('a person taken out of a shot by code; whoever performs in it stays; the words that still name them go to the preview', async () => {
    const {target, data} = fixture()
    twoPeople(target, data)
    await setDirectionEdits(target, {
        edits: [
            {id: 'e', scope: {kind: 'shot', id: 's1:shot2'}, remove: 'a'},
            {id: 'f', scope: {kind: 'shot', id: 's1:shot1'}, remove: 'a'},
        ],
    })
    const view = readDirection(target)
    const shot = view.shots.find(s => s.id === 's1:shot2')!
    expect(shot.data.characters).toEqual(['b'])
    expect(Object.keys(shot.data.people as object)).toEqual(['b'])
    // shot 1 has a line of A: A stays
    expect(view.shots[0]!.data.characters).toEqual(['a'])
    expect(view.editIssues.map(i => [i.editId, i.shotId, !!i.mentions])).toEqual([
        ['f', 's1:shot1', false],
        ['e', 's1:shot2', true],
    ])
    // no rules - not waiting for a review; the pipeline gets the edit at once
    expect(view.pending).toBe(false)
    expect(applyDirectionOverlay(target, data).shotMoments!.s1!.shots[1]!.characters).toEqual(['b'])
    // the preview gets a rule for the words, on the shot without A - the model cannot bring A back
    let asked: any
    await previewDirection(target, async o => {
        asked = JSON.parse(o.input)
        return {changes: [{shotId: 's1:shot2', after: {...asked.selected[0].data, action: '{B} waits alone'}}], conflicts: []}
    })
    expect(asked.selected.map((s: any) => s.id)).toEqual(['s1:shot2'])
    expect(asked.rules[0].text).toContain('A is no longer in this shot')
    await takeDirection(target)
    expect(readDirection(target).editIssues.filter(i => i.mentions)).toEqual([])
    expect(applyDirectionOverlay(target, data).shotMoments!.s1!.shots[1]!.action).toBe('{B} waits alone')
})
test('a size set by code: framing and size in music, framing in a film', async () => {
    const music = fixture()
    await setDirectionEdits(music.target, {edits: [{id: 'z', scope: {kind: 'beat', id: 's1'}, size: 'close'}]})
    expect(readDirection(music.target).shots.map(s => [s.data.framing, s.data.size])).toEqual([
        ['close-up', 'close'],
        ['close-up', 'close'],
    ])
    const film = fixture('film')
    await setDirectionEdits(film.target, {edits: [{id: 'z', scope: {kind: 'shot', id: 's1:shot2'}, size: 'wide'}]})
    expect(readDirection(film.target).shots[1]!.data).toMatchObject({framing: 'wide shot'})
    expect(readDirection(film.target).shots[1]!.data.size).toBeUndefined()
    await expect(setDirectionEdits(film.target, {edits: [{id: 'y', scope: {kind: 'beat', id: 's1'}, size: 'wide'}]})).rejects.toThrow('scene')
    await expect(setDirectionEdits(film.target, {edits: [{id: 'y', scope: {kind: 'global'}, remove: 'nobody'}]})).rejects.toThrow('no character')
})
test('a new plan: a beat edit applies to its new shots, a shot edit waits to be bound again; the planner is told', async () => {
    const {target, data} = fixture()
    twoPeople(target, data)
    await setDirectionEdits(target, {
        edits: [
            {id: 'beat', scope: {kind: 'beat', id: 's1'}, remove: 'b'},
            {id: 'shot', scope: {kind: 'shot', id: 's1:shot2'}, size: 'wide'},
        ],
    })
    expect(directionPlanNotes(target, data)).toEqual({s1: ['in every shot, B is not in the picture', 'in shot 2, the shot is a wide shot']})
    // planned again: other shots
    data.shotMoments.s1.shots = [
        {action: 'run', characters: ['a', 'b'], people: {a: {}, b: {}}},
        {action: 'stop', characters: ['b']},
    ]
    writeFileSync(join(target.dir, 'project.json'), JSON.stringify(data))
    const view = readDirection(target)
    expect(view.shots.map(s => s.data.characters)).toEqual([['a'], []])
    expect(view.shots[1]!.data.framing).toBeUndefined()
    expect(view.editIssues.map(i => i.editId)).toContain('shot')
})
test("the director's words reach the planner for the beats they are about; a rule saved before the beat has shots holds for them (#765)", async () => {
    const {target, data} = fixture()
    await setDirectionRules(target, {
        rules: [
            {id: 'beat', text: 'They dance a slow waltz.', scope: {kind: 'beat', id: 's1'}},
            {id: 'who', text: 'Always in red light.', scope: {kind: 'character', id: 'b'}},
            {id: 'all', text: 'Candlelight only.', scope: {kind: 'global'}},
            {id: 'shot', text: 'Hold on her face.', scope: {kind: 'shot', id: 's1:shot2'}},
        ],
    })
    expect(directionPlanNotes(target, data)).toEqual({s1: ['They dance a slow waltz.', 'for B: Always in red light.', 'Candlelight only.']})
    // a beat without shots: the rule is bound to "missing" and is not unresolved once the beat is planned
    delete data.shotMoments.s1
    writeFileSync(join(target.dir, 'project.json'), JSON.stringify(data))
    await setDirectionRules(target, {rules: [{id: 'later', text: 'They dance.', scope: {kind: 'beat', id: 's1'}}]})
    data.shotMoments = {s1: {shots: [{action: 'dance', characters: ['a', 'b']}]}}
    writeFileSync(join(target.dir, 'project.json'), JSON.stringify(data))
    expect(readDirection(target).unresolved).toEqual([])
})
test('a rule for the planner only needs no review: a plan run is not held up by it (#765)', async () => {
    const {target, data} = fixture()
    await setDirectionRules(target, {rules: [{id: 'p', text: 'They dance.', scope: {kind: 'beat', id: 's1'}, planned: true}]})
    expect(readDirection(target).pending).toBe(false)
    expect(() => applyDirectionOverlay(target, data)).not.toThrow()
    expect(directionPlanNotes(target, data)).toEqual({s1: ['They dance.']})
    await setDirectionRules(target, {rules: [{id: 'r', text: 'Slowly.', scope: {kind: 'global'}}]})
    expect(readDirection(target).pending).toBe(true)
})
test('a planned rule on a shot reaches the planner as a note of its beat for that shot (#767)', async () => {
    const {target, data} = fixture()
    await setDirectionRules(target, {
        rules: [
            {id: 'in', text: 'B is in this shot.', scope: {kind: 'shot', id: 's1:shot2'}, planned: true, presence: {characters: ['b'], in: true}},
            {id: 'out', text: 'B is not in this shot.', scope: {kind: 'shot', id: 's1:shot1'}, planned: true, presence: {characters: ['b'], in: false}},
        ],
    })
    expect(directionPlanNotes(target, data)).toEqual({s1: ['shot 2: B is in this shot.', 'shot 1: B is not in this shot.']})
    expect(readDirection(target).pending).toBe(false)
})
test('a rule whose shot was planned again is named, with what to do, by the review, the preview and a run (#782)', async () => {
    const {target, data} = fixture()
    expect(directionReview(target)).toBeUndefined()
    const id = readDirection(target).shots[0]!.id
    await setDirectionRules(target, {rules: [{id: 'r', text: 'Elias strides quickly right to left across the floor', scope: {kind: 'shot', id}}]})
    expect(directionReview(target)).toEqual({pending: true, unresolved: []})
    await previewDirection(target, async o => answer(JSON.parse(o.input)))
    await takeDirection(target)
    expect(directionReview(target)).toEqual({pending: false, unresolved: []})
    data.shotMoments!.s1!.shots[0]!.action = 'run'
    writeFileSync(join(target.dir, 'project.json'), JSON.stringify(data))
    const review = directionReview(target)!
    expect(review.pending).toBe(true)
    expect(review.unresolved).toEqual([
        `shot ${id} "Elias strides quickly right to left across the floor": Its shots were planned again: rebind it to the shots as they are now, or remove it.`,
    ])
    await expect(previewDirection(target, async o => answer(JSON.parse(o.input)))).rejects.toThrow(`shot ${id} "Elias strides`)
    expect(() => applyDirectionOverlay(target, data)).toThrow(`First rebind or remove this rule:\n  - shot ${id} "Elias strides`)
})
