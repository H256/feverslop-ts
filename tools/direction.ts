import {cli} from '../lib/cli.ts'
import {parseArgs} from 'node:util'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {commandTarget} from '../lib/editor/preproduction.ts'
import {
    readDirection,
    setDirectionRules,
    setDirectionEdits,
    previewDirection,
    takeDirection,
    dropDirection,
    restoreDirection,
    describeEdit,
} from '../lib/direction/service.ts'
import type {DirectionEdit, DirectionScope, DirectionSize, DirectionView} from '../shared/direction.ts'
cli('direction')
const {values: a, positionals} = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
        film: {type: 'boolean'},
        json: {type: 'boolean'},
        add: {type: 'string'},
        scope: {type: 'string'},
        character: {type: 'string'},
        edit: {type: 'string'},
        text: {type: 'string'},
        remove: {type: 'string'},
        set: {type: 'string'},
        preview: {type: 'boolean'},
        take: {type: 'boolean'},
        drop: {type: 'boolean'},
        restore: {type: 'string'},
        without: {type: 'string'},
        size: {type: 'string'},
        unedit: {type: 'string'},
        show: {type: 'string'},
        'no-rebuild': {type: 'boolean'},
        with: {type: 'string'},
        join: {type: 'string', multiple: true},
        out: {type: 'string'},
        clips: {type: 'string'},
    },
})
if (positionals.length !== 1) throw Error('give exactly one project id')
if (a.text !== undefined && !a.edit) throw Error('--text goes with --edit=ID')
const target = commandTarget(positionals[0], a.film ?? false)
if (typeof target === 'string') throw Error(target)
// one change of the saved direction, then optionally a preview and a take in the same call: --add=... --scope=... --preview --take
const changes = [a.add, a.edit, a.remove, a.set, a.without, a.size, a.unedit].filter(v => v !== undefined)
if (changes.length > 1) throw Error('choose one change: --add, --edit, --remove, --set, --without, --size or --unedit')
if ((a.drop || a.restore) && (changes.length || a.preview || a.take)) throw Error('--drop and --restore go alone')
if (
    (a.scope !== undefined || a.character !== undefined) &&
    a.add === undefined &&
    !a.edit &&
    a.without === undefined &&
    a.size === undefined &&
    a.with === undefined &&
    a.out === undefined &&
    !a.join?.length
)
    throw Error('--scope goes with --add, --edit, --without or --size; --character with --add or --edit')
if (a.character !== undefined && (a.without !== undefined || a.size !== undefined))
    throw Error('--character goes with --add or --edit; --without names the character itself')
function scope(value: string): DirectionScope {
    if (value === 'global') return {kind: 'global'}
    const colon = value.indexOf(':')
    const kind = value.slice(0, colon),
        id = value.slice(colon + 1)
    if (kind === 'time') {
        if (!/^\d+(?:\.\d+)?-\d+(?:\.\d+)?$/.test(id)) throw Error('time scope takes START-END in seconds')
        const [start, end] = id.split('-').map(Number)
        return {kind, start: start!, end: end!}
    }
    if (['character', 'beat', 'scene', 'shot'].includes(kind)) return {kind: kind as 'character' | 'beat' | 'scene' | 'shot', id}
    throw Error('scope: global, character:ID, beat:ID, scene:ID, shot:ID or time:START-END')
}
// who is in which beats or clips (#765, #767): characters of the cast (--with) and new ones joining it (--join="Name: who they
// are") come in, characters go out (--out), with --add as what they do there - of whole beats (--scope=beat:ID[,ID]) or of some
// clips only (--clips=slot-024,slot-025). The floor plans and shots of those beats go, the next plan run plans just them again
if (a.with !== undefined || a.join?.length || a.out !== undefined) {
    if (target.kind !== 'music') throw Error('--with, --out and --join are for a music video; a film has its script')
    if (!a.scope?.startsWith('beat:') && !a.clips)
        throw Error('--with, --out and --join need --scope=beat:ID[,ID] or --clips=ID[,ID] - the beats or clips they are about')
    if (a.scope !== undefined && !a.scope.startsWith('beat:')) throw Error('--with, --out and --join take --scope=beat:ID[,ID] only')
    if (a.edit || a.remove || a.set || a.without !== undefined || a.size !== undefined || a.unedit !== undefined || a.preview || a.take)
        throw Error('--with, --out and --join go with --scope or --clips and --add (what they do there) only')
    const join = (a.join ?? []).map(j => {
        const colon = j.indexOf(':')
        if (colon < 1) throw Error('--join takes "Name: who they are and what they look like"')
        return {name: j.slice(0, colon).trim(), role: j.slice(colon + 1).trim()}
    })
    const {writeBeatCast} = await import('../lib/editor/beat-cast.ts')
    const result = await writeBeatCast(target, {
        beats: (a.scope ?? '').slice('beat:'.length).split(',').filter(Boolean),
        clips: (a.clips ?? '').split(',').filter(Boolean),
        characters: (a.with ?? '').split(',').filter(Boolean),
        without: (a.out ?? '').split(',').filter(Boolean),
        join,
        ...(a.add !== undefined ? {note: a.add} : {}),
    })
    if (result.joined.length)
        console.log(`Joined the cast: ${result.joined.join(', ')} - their look and description are written by the next plan run, everyone else keeps theirs`)
    for (const {beat, character} of result.added) console.log(`${character} is in ${beat}`)
    for (const {beat, character} of result.removed ?? []) console.log(`${character} is out of ${beat}`)
    if (result.shots) console.log(`Only the clips ${a.clips} of their beats (shots ${result.shots.join(', ')}) - a newcomer is told to stay out of the others`)
    if (result.rules) console.log(`${result.rules} direction rule(s) for the planner: who is in which shots${a.add ? ', and the note' : ''}`)
    console.log(`Planned again by the next plan run: ${result.beats.join(', ')} - the other beats keep their shots`)
    console.log(`Next: bun index.ts ${target.id}   (the language model: ${result.joined.length ? 'the new looks and ' : ''}these beats)`)
    if (result.joined.length) console.log(`Then: bun index.ts ${target.id} --render=images   (the pictures of whoever joined)`)
    console.log(`Then: bun index.ts ${target.id} --render=videos --refresh=clips   (the clips of these beats)`)
    process.exit(0)
}
// a direct edit: no language model, applied by code to the shots of its scope - and the prompts are built again right away
let rebuild = false
if (a.without !== undefined || a.size !== undefined || a.unedit !== undefined) {
    let edits = readDirection(target).edits
    if (a.unedit !== undefined) {
        if (!edits.some(e => e.id === a.unedit)) throw Error('unknown edit')
        edits = edits.filter(e => e.id !== a.unedit)
    } else {
        if (a.scope === undefined) throw Error('--without and --size need --scope (shot:ID, beat:ID, scene:ID, character:ID, time:START-END or global)')
        if (a.size !== undefined && !['wide', 'medium', 'close', 'extreme'].includes(a.size)) throw Error('--size takes wide, medium, close or extreme')
        const edit: DirectionEdit = {
            id: randomUUID(),
            scope: scope(a.scope),
            ...(a.without !== undefined ? {remove: a.without} : {size: a.size as DirectionSize}),
        }
        edits = [...edits, edit]
    }
    await setDirectionEdits(target, {edits})
    rebuild = true
} else if (a.set) await setDirectionRules(target, JSON.parse(readFileSync(a.set, 'utf8')))
else if (a.add !== undefined || a.edit || a.remove) {
    let rules = readDirection(target).rules
    if (a.add !== undefined)
        rules = [...rules, {id: randomUUID(), text: a.add, scope: scope(a.scope ?? 'global'), ...(a.character ? {characterId: a.character} : {})}]
    if (a.edit) {
        if (!rules.some(r => r.id === a.edit)) throw Error('unknown rule')
        rules = rules.map(r =>
            r.id === a.edit
                ? {
                      ...r,
                      text: a.text ?? r.text,
                      scope: a.scope ? scope(a.scope) : r.scope,
                      ...(a.character !== undefined ? {characterId: a.character || undefined} : {}),
                      binding: a.scope || a.character !== undefined ? undefined : r.binding,
                  }
                : r,
        )
    }
    if (a.remove) {
        if (!rules.some(r => r.id === a.remove)) throw Error('unknown rule')
        rules = rules.filter(r => r.id !== a.remove)
    }
    await setDirectionRules(target, {rules})
}
if (a.preview) {
    const {configureLlm} = await import('../lib/llm.ts')
    const {loadSettings} = await import('../lib/settings.ts')
    const config =
        target.kind === 'film'
            ? await (await import('../lib/film/config.ts')).loadFilmConfig(target.dir)
            : await (await import('../lib/config.ts')).loadProjectConfig(target.dir)
    configureLlm((await loadSettings({projectModel: config.llm.model})).llm)
    await previewDirection(target)
}
if (a.take) {
    await takeDirection(target)
    rebuild = true
} else if (a.drop) await dropDirection(target)
else if (a.restore) {
    await restoreDirection(target, a.restore)
    rebuild = true
}
const view = readDirection(target)
const nameOf = (id: string) => view.characters.find(c => c.id === id)?.name ?? id
const scopeText = (s: DirectionScope) => (s.kind === 'global' ? 'global' : s.kind === 'time' ? `time:${s.start}-${s.end}` : `${s.kind}:${s.id}`)
/** One shot as it is now (the accepted plan with the edits): who is in it and what each of them does. */
function showShot(view: DirectionView, id: string) {
    const shot = view.shots.find(s => s.id === id)
    if (!shot) throw Error(`no shot ${id} - the shots are: ${view.shots.map(s => s.id).join(', ')}`)
    const d = shot.data as Record<string, unknown>
    const time = shot.start !== undefined && shot.end !== undefined ? `  ${shot.start.toFixed(2)}-${shot.end.toFixed(2)} s` : ''
    console.log(`${shot.id}${time}`)
    console.log(`  ${[d.framing, d.size && `(${d.size})`, d.camera].filter(Boolean).join(' · ')}`)
    if (d.view) console.log(`  view: ${d.view}`)
    console.log(`  action: ${d.action}`)
    const people = (d.people ?? {}) as Record<string, Record<string, unknown>>
    for (const who of shot.characters) {
        const p = people[who] ?? {}
        const flags = [p.singing === true && 'sings', (p.playing === true || p.plays) && 'plays', Array.isArray(d.lines) && d.lines.length && 'speaks'].filter(
            Boolean,
        )
        console.log(`  ${nameOf(who)}${flags.length ? ` [${flags.join(', ')}]` : ''}`)
        for (const key of ['state', 'frame', 'motion', 'facing'] as const) if (p[key]) console.log(`    ${key}: ${p[key]}`)
    }
    if (d.rest) console.log(`  rest: ${d.rest}`)
    for (const r of view.rules.filter(r => r.scope.kind === 'shot' && r.scope.id === id)) console.log(`  rule ${r.id}: ${r.text}`)
    for (const e of view.edits.filter(e => e.scope.kind === 'shot' && e.scope.id === id)) console.log(`  edit ${e.id}: ${describeEdit(e, nameOf)}`)
    for (const i of view.editIssues.filter(i => i.shotId === id)) console.log(`  ! ${i.message}`)
}
if (a.json) console.log(JSON.stringify(view, null, 2))
else if (a.show) showShot(view, a.show)
else {
    console.log(`Direction: ${target.id} (${target.kind})${view.pending ? ' - review needed' : ''}`)
    for (const r of view.rules) console.log(`${r.id}  ${JSON.stringify(r.scope)}${r.characterId ? ` / ${r.characterId}` : ''}\n  ${r.text}`)
    for (const e of view.edits) console.log(`edit ${e.id}  ${scopeText(e.scope)}\n  ${describeEdit(e, nameOf)}`)
    for (const u of view.unresolved) console.log(`Unresolved ${u.ruleId}: ${u.message}`)
    for (const i of view.editIssues) console.log(`Edit ${i.editId}${i.shotId ? ` in ${i.shotId}` : ''}: ${i.message}`)
    if (view.proposal) {
        console.log(`Proposal ${view.proposal.id}: ${view.proposal.changes.length} shot(s)`)
        for (const c of view.proposal.changes)
            console.log(`${c.shotId}\nBefore: ${JSON.stringify(c.before, null, 2)}\nAfter: ${JSON.stringify(c.after, null, 2)}`)
        for (const conflict of view.proposal.conflicts) console.log(`Conflict: ${conflict}`)
    }
    for (const v of view.versions) console.log(`Version ${v.id}  ${v.createdAt}  ${v.changes.length} edits${v.id === view.activeVersion ? ' (current)' : ''}`)
    if (!view.rules.length && !view.edits.length) console.log('No direction rules or edits.')
    console.log(`Shots: ${view.shots.map(s => s.id).join(', ') || 'not planned yet'}`)
    console.log('--show=SHOT lists who is in a shot and what each does. --add=TEXT asks the LLM (--preview, then --take; one call can do all three);')
    console.log(
        '--without=CHARACTER and --size=wide|medium|close|extreme change the plan directly (with --scope). Removing a rule does not undo accepted action; use --restore=VERSION. Nothing is rendered here.',
    )
}
// taken, restored or edited: the clip prompts are built again from the plan as it is now - the normal planning run, which reuses
// every step it has (it may ask the language model for the background views of changed shots). Nothing is rendered.
if (rebuild && !a['no-rebuild']) {
    const script = join(import.meta.dir, '..', target.kind === 'film' ? 'film.ts' : 'index.ts')
    console.log(`Building the clip prompts again: bun ${target.kind === 'film' ? 'film.ts' : 'index.ts'} ${target.id}`)
    const run = Bun.spawn(['bun', script, target.id], {stdio: ['inherit', 'inherit', 'inherit']})
    const code = await run.exited
    if (code !== 0) throw Error(`building the clip prompts failed (exit ${code}) - run bun ${target.kind === 'film' ? 'film.ts' : 'index.ts'} ${target.id}`)
}
