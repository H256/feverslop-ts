import {afterAll, beforeAll, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {editorHandler} from './server.ts';
import {runCommand} from './runs.ts';
import {lockProject} from '../lock.ts';
import {filmDirectionScenes} from './project.ts';
import {splitLongShot} from '../film/coverage.ts';
import type {FilmProject} from '../film/types.ts';

test('film direction links require unsplit source shots and complete request counts', () => {
    const shot = {action: 'speaks', framing: 'medium', camera: 'still', characters: ['kael'], seconds: 3, lines: [0]};
    const scene = {id: 's1', setting: 'INT' as const, location: 'Hall', time: 'DAY', elements: [{type: 'dialogue' as const, speaker: 'Kael', kind: 'spoken' as const, text: 'A short answer.'}]};
    const data: FilmProject = {screenplay: {title: 'Test', language: 'en', scenes: [scene]}, coverage: [{sceneId: 's1', soundscape: '', shots: [shot, {...shot, lines: []}]}]};
    const requests = [{sceneId: 's1', shots: [{}, {}]}];
    expect([...filmDirectionScenes(data, requests)]).toEqual(['s1']);
    expect([...filmDirectionScenes(data, [{sceneId: 's1', shots: [{}]}])]).toEqual([]);
    scene.elements[0]!.text = 'This sentence takes a little time to say clearly. '.repeat(8);
    shot.seconds = 40;
    const split = splitLongShot(scene, shot);
    expect(split.length).toBeGreaterThan(1);
    expect([...filmDirectionScenes(data, [{sceneId: 's1', shots: [...split, {}]}])]).toEqual([]);
    // Even stale request counts that happen to match must not revive the shifted links.
    expect([...filmDirectionScenes(data, requests)]).toEqual([]);
});

const here = process.cwd();
let root: string;
beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'direction-routes-'));
    for (const kind of ['projects', 'films']) {
        const dir = join(root, kind, 'demo');
        mkdirSync(dir, {recursive: true});
        writeFileSync(join(dir, 'project.json'), JSON.stringify({cast: {characters: [{id: 'kael', name: 'Kael'}], locations: []}}));
    }
    process.chdir(root);
});
afterAll(() => { process.chdir(here); rmSync(root, {recursive: true, force: true}); });

const request = (kind: string, path = '', body?: unknown) => editorHandler()(new Request(`http://localhost/p/${kind}/demo/api/direction${path}`, body === undefined ? {} : {method: 'POST', body: JSON.stringify(body)}));

test('direction rules can be saved/read through the same API in music and film without changing project.json', async () => {
    for (const kind of ['music', 'film']) {
        const file = join(root, kind === 'film' ? 'films' : 'projects', 'demo', 'project.json');
        const before = readFileSync(file, 'utf8');
        const rules = [{id: 'turn', text: 'Kael turns toward his own left.', scope: {kind: 'global'}, characterId: 'kael'}];
        expect((await request(kind, '', {rules})).status).toBe(200);
        const view = await (await request(kind)).json() as {rules: unknown[]};
        expect(view.rules).toEqual(rules);
        expect(readFileSync(file, 'utf8')).toBe(before);
        expect((await request(kind, '/drop', {})).status).toBe(200);
        expect((await request(kind, '/take', {})).status).toBe(409);
        expect((await request(kind, '/restore', {version: '../../other'})).status).toBe(409);
    }
});

test('workspace direction writes respect the CLI project lock', async () => {
    const release = lockProject(join(root, 'projects', 'demo'), 'test');
    try {
        expect((await request('music', '', {rules: []})).status).toBe(409);
    } finally { release(); }
});

test('direction preview runs the CLI with fixed arguments, never arbitrary client flags', () => {
    for (const kind of ['music', 'film'] as const) {
        expect(runCommand({id: 'demo', kind}, {type: 'direction'} as any)).toEqual({script: 'tools/direction.ts', args: ['demo', ...(kind === 'film' ? ['--film'] : []), '--preview']});
    }
});
