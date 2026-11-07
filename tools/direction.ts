import { cli } from '../lib/cli.ts';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { commandTarget } from '../lib/editor/preproduction.ts';
import { readDirection, setDirectionRules, previewDirection, takeDirection, dropDirection, restoreDirection } from '../lib/direction/service.ts';
import type { DirectionScope } from '../shared/direction.ts';
cli('direction');
const { values: a, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: { film: { type: 'boolean' }, json: { type: 'boolean' }, add: { type: 'string' }, scope: { type: 'string' }, character: { type: 'string' }, edit: { type: 'string' }, text: { type: 'string' }, remove: { type: 'string' }, set: { type: 'string' }, preview: { type: 'boolean' }, take: { type: 'boolean' }, drop: { type: 'boolean' }, restore: { type: 'string' } } });
if (positionals.length !== 1)
    throw Error('give exactly one project id');
if (a.text !== undefined && !a.edit)
    throw Error('--text goes with --edit=ID');
if ((a.scope !== undefined || a.character !== undefined) && a.add === undefined && !a.edit)
    throw Error('--scope and --character go with --add or --edit');
const target = commandTarget(positionals[0], a.film ?? false);
if (typeof target === 'string')
    throw Error(target);
if ([a.add, a.edit, a.remove, a.set, a.preview, a.take, a.drop, a.restore].filter(v => v !== undefined && v !== false).length > 1)
    throw Error('choose one direction operation');
function scope(value: string): DirectionScope {
    if (value === 'global')
        return { kind: 'global' };
    const colon = value.indexOf(':');
    const kind = value.slice(0, colon), id = value.slice(colon + 1);
    if (kind === 'time') {
        if (!/^\d+(?:\.\d+)?-\d+(?:\.\d+)?$/.test(id))
            throw Error('time scope takes START-END in seconds');
        const [start, end] = id.split('-').map(Number);
        return { kind, start: start!, end: end! };
    }
    if (['character', 'beat', 'scene', 'shot'].includes(kind))
        return { kind: kind as 'character' | 'beat' | 'scene' | 'shot', id };
    throw Error('scope: global, character:ID, beat:ID, scene:ID, shot:ID or time:START-END');
}
if (a.set)
    await setDirectionRules(target, JSON.parse(readFileSync(a.set, 'utf8')));
else if (a.add !== undefined || a.edit || a.remove) {
    let rules = readDirection(target).rules;
    if (a.add !== undefined)
        rules = [...rules, { id: randomUUID(), text: a.add, scope: scope(a.scope ?? 'global'), ...(a.character ? { characterId: a.character } : {}) }];
    if (a.edit) {
        if (!rules.some(r => r.id === a.edit))
            throw Error('unknown rule');
        rules = rules.map(r => r.id === a.edit ? { ...r, text: a.text ?? r.text, scope: a.scope ? scope(a.scope) : r.scope, ...(a.character !== undefined ? { characterId: a.character || undefined } : {}), binding: a.scope || a.character !== undefined ? undefined : r.binding } : r);
    }
    if (a.remove) {
        if (!rules.some(r => r.id === a.remove))
            throw Error('unknown rule');
        rules = rules.filter(r => r.id !== a.remove);
    }
    await setDirectionRules(target, { rules });
}
else if (a.preview) {
    const { configureLlm } = await import('../lib/llm.ts');
    const { loadSettings } = await import('../lib/settings.ts');
    const config = target.kind === 'film' ? await (await import('../lib/film/config.ts')).loadFilmConfig(target.dir) : await (await import('../lib/config.ts')).loadProjectConfig(target.dir);
    configureLlm((await loadSettings({ projectModel: config.llm.model })).llm);
    await previewDirection(target);
}
else if (a.take)
    await takeDirection(target);
else if (a.drop)
    await dropDirection(target);
else if (a.restore)
    await restoreDirection(target, a.restore);
const view = readDirection(target);
if (a.json)
    console.log(JSON.stringify(view, null, 2));
else {
    console.log(`Direction: ${target.id} (${target.kind})${view.pending ? ' - review needed' : ''}`);
    for (const r of view.rules)
        console.log(`${r.id}  ${JSON.stringify(r.scope)}${r.characterId ? ` / ${r.characterId}` : ''}\n  ${r.text}`);
    for (const u of view.unresolved)
        console.log(`Unresolved ${u.ruleId}: ${u.message}`);
    if (view.proposal) {
        console.log(`Proposal ${view.proposal.id}: ${view.proposal.changes.length} shot(s)`);
        for (const c of view.proposal.changes)
            console.log(`${c.shotId}\nBefore: ${JSON.stringify(c.before, null, 2)}\nAfter: ${JSON.stringify(c.after, null, 2)}`);
        for (const conflict of view.proposal.conflicts)
            console.log(`Conflict: ${conflict}`);
    }
    for (const v of view.versions)
        console.log(`Version ${v.id}  ${v.createdAt}  ${v.changes.length} edits${v.id === view.activeVersion ? ' (current)' : ''}`);
    if (!view.rules.length)
        console.log('No direction rules.');
    console.log(`Shots: ${view.shots.map(s => s.id).join(', ') || 'not planned yet'}`);
    console.log('Use --json for the full plan and rules (--set reads its rules). --preview asks the LLM; --take accepts; --drop discards.');
    console.log('Removing a rule does not undo accepted action; use --restore=VERSION. Run the pipeline after take/restore to rebuild clip prompts. Nothing is rendered here.');
}
