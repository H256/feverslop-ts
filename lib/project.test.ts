import {describe, expect, test} from "bun:test";
import {type Project, ProjectStore} from "./project.ts";
import type {ProjectConfig} from "./config.ts";
import {projectInputs, stepUsed} from "./inputs.ts";

const store = (data: object) => {
    const project = new ProjectStore('zz-not-on-disk')
    project.data = structuredClone(data)
    return project
}

describe('what the next run would redo, without redoing it', () => {
    test('a step and the steps built on it that have a result', () => {
        const project = store({story: 's', summary: 'x', cast: {characters: [], locations: []}, lookBrief: 'l', beats: [], music: {}})
        expect(project.redoneBy(['summary'])).toEqual(['summary', 'lookBrief'])
        expect(project.redoneBy(['story'])).toEqual(['story', 'summary', 'cast', 'lookBrief', 'beats'])
        expect(project.data.summary).toBe('x')
    })
    test('a changed input names its steps; an unchanged one does not', () => {
        const project = store({inputs: {'story-idea.txt': Bun.hash('old').toString(16)}, story: 's'})
        expect(project.changedInputs({'story-idea.txt': {value: 'new', steps: ['story']}})).toEqual([{name: 'story-idea.txt', steps: ['story']}])
        expect(project.changedInputs({'story-idea.txt': {value: 'old', steps: ['story']}})).toEqual([])
    })
    test('an input without a fingerprint counts as its assumed value', () => {
        const project = store({inputs: {}, story: 's'})
        expect(project.changedInputs({singers: {value: '[]', steps: ['singing'], assumed: '[]'}})).toEqual([])
        expect(project.changedInputs({singers: {value: '["auto"]', steps: ['singing'], assumed: '[]'}})).toEqual([{name: 'singers', steps: ['singing']}])
    })
})

describe('the blocking, a step of its own before the shots', () => {
    const planned: Project = {beats: [], mapping: [],blocking: {b1: {staging: 's', starts: {}, ends: {}}}, shotMoments: {b1: {shots: []}}, shotViews: {b1: [0]}}
    test('redoing the shots keeps the blocking', () => {
        const project = store(planned)
        expect(project.redoneBy(['shotMoments'])).toEqual(['shotMoments', 'shotViews'])
        project.invalidate('shotMoments')
        expect(project.data.blocking).toEqual(planned.blocking)
        expect(project.data.shotMoments).toBeUndefined()
    })
    test('redoing the beats or the blocking redoes the blocking and the shots', () => {
        expect(store(planned).redoneBy(['beats'])).toEqual(['beats', 'mapping', 'blocking', 'shotMoments', 'shotViews'])
        expect(store(planned).redoneBy(['blocking'])).toEqual(['blocking', 'shotMoments', 'shotViews'])
        expect(store(planned).redoneBy(['locationLayouts'])).toEqual(['blocking', 'shotMoments', 'shotViews'])
    })
    test('a changed continuity redoes the blocking and so the shots', async () => {
        const inputs = await projectInputs('zz-not-on-disk', {continuity: 'never', fightClips: false} as ProjectConfig)
        const project = store({...planned, inputs: {continuity: Bun.hash('auto').toString(16)}})
        const steps = project.changedInputs({continuity: inputs.continuity!}).flatMap(c => c.steps)
        expect(project.redoneBy(steps)).toEqual(['blocking', 'shotMoments', 'shotViews'])
    })
    test('a project planned before the step keeps its shots: the blocking is made when they are planned again', async () => {
        const {blocking: _none, ...before} = planned
        const config = {} as ProjectConfig
        expect(stepUsed('blocking', 'zz-not-on-disk', before, config)).toBe(false)
        expect(stepUsed('blocking', 'zz-not-on-disk', {...before, shotMoments: undefined}, config)).toBe(true)
        expect(stepUsed('blocking', 'zz-not-on-disk', planned, config)).toBe(true)
        // made now, the blocking redoes nothing that is there
        const project = store(before)
        project.save = () => Promise.resolve()
        await project.step('blocking', 'blocking', async () => ({}))
        expect(project.data.shotMoments).toEqual(planned.shotMoments)
        expect(project.data.shotViews).toEqual(planned.shotViews)
    })
})
