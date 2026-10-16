import {describe, expect, test} from "bun:test";
import {ProjectStore} from "./project.ts";

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
