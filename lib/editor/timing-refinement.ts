import {createHash, randomUUID} from 'node:crypto'
import {mkdirSync, readFileSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'
import type {Project, TimedWord} from '../project.ts'
import type {ClipRequest} from '../compose.ts'
import type {TimingRefinement, RefinementLanguage, ConfirmedPassage} from '../../shared/timing-refinement.ts'
import {passageInput, timingLocked} from './timing-passage.ts'
import {MIN_WORD_SEC} from '../lyrics.ts'
import {applyTiming, insideProject} from './timing.ts'
import type {EditorTarget} from './project.ts'
import {writeJsonFile} from '../json-file.ts'
import {withProjectLock} from '../lock.ts'
import {readClipRequests} from '../render-state.ts'
import {runProcess} from '../process.ts'

type Candidate = {line: number; words?: TimedWord[]; error?: string}
export const refinementFingerprint = (data: Project) =>
    createHash('sha256')
        .update(JSON.stringify([data.lyricsTiming, data.singing, data.music?.durationSec, data.stems]))
        .digest('hex')
const protectedLine = (l: NonNullable<Project['lyricsTiming']>['lines'][number]) => !!(l.off || l.adlib || timingLocked(l))

/** Scores from forced alignment are not probabilities that a lyric was sung. Whisper supplies presence evidence. */
export function buildRefinement(data: Project, candidates: Candidate[], language: RefinementLanguage): TimingRefinement {
    const report: TimingRefinement = {
        id: randomUUID(),
        fingerprint: refinementFingerprint(data),
        language,
        model: 'facebook/wav2vec2-lv-60-espeak-cv-ft@ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4',
        change: {lines: []},
        entries: [],
    }
    const lines = data.lyricsTiming?.lines ?? []
    const singers = (id: number) => data.singing?.lines.find(l => l.line === id)?.singers ?? data.singing?.singers ?? []
    const sameVoice = (a: number, b: number) => {
        const left = singers(a),
            right = singers(b)
        return (
            left.length === 1 && right.length === 1 && left[0] === right[0] && !data.singing?.lines.some(l => (l.line === a || l.line === b) && l.parts?.length)
        )
    }
    for (const [index, line] of lines.entries()) {
        const entry: TimingRefinement['entries'][number] = {line: line.line, text: line.text, before: [line.start, line.end], status: 'review', reason: ''}
        report.entries.push(entry)
        if (protectedLine(line)) {
            entry.status = 'protected'
            entry.reason = 'Manual timing, anchors, groups, ad-lib or left-out line retained.'
            continue
        }
        if (line.confidence === 0 && !line.presenceByHand) {
            entry.reason = 'No words matched the transcript. Presence is unknown; original timing and sung state retained. Listen and correct manually.'
            continue
        }
        const candidate = candidates.find(c => c.line === line.line)
        if (!candidate?.words?.length) {
            entry.reason = candidate?.error ?? 'No usable acoustic alignment.'
            continue
        }
        const words = candidate.words.map(w => ({
            text: w.text,
            start: Math.round(w.start * 1000) / 1000,
            end: Math.round(w.end * 1000) / 1000,
            estimated: true,
        }))
        if (words.length !== line.words.length || words.some((w, n) => w.text !== line.words[n]!.text)) {
            entry.reason = 'Word mapping changed; manual review required.'
            continue
        }
        if (Math.abs(words[0]!.start - line.start) > 3) {
            entry.reason = 'Onset moved more than 3 seconds; coarse alignment needs review.'
            continue
        }
        const next = lines.slice(index + 1).find(l => !l.off && (l.confidence > 0 || l.byHand))
        const last = words.at(-1)!
        let capped = false
        if (next && sameVoice(line.line, next.line) && (next.byHand || next.words[0]?.anchor) && last.end > next.start) {
            last.end = next.start
            capped = true
        }
        const invalid = words.some(
            (w, n) =>
                !Number.isFinite(w.start) ||
                !Number.isFinite(w.end) ||
                w.start < 0 ||
                w.end > (data.music?.durationSec ?? 0) ||
                w.end - w.start < MIN_WORD_SEC - 1e-9 ||
                (n > 0 && w.start < words[n - 1]!.end),
        )
        if (invalid) {
            entry.reason = 'Collapsed, overlapping or out-of-range words; original retained.'
            continue
        }
        const previous = lines
            .slice(0, index)
            .reverse()
            .find(l => !l.off && l.byHand)
        if (previous && sameVoice(previous.line, line.line) && previous.end > words[0]!.start && previous.end <= line.start) {
            entry.reason = 'Would overlap previously corrected timing; original retained.'
            continue
        }
        entry.status = 'refined'
        entry.after = [words[0]!.start, last.end]
        entry.reason = capped
            ? 'End capped at the next confirmed onset of the same singer. Listen to check.'
            : 'Phoneme alignment; listen to check. Long notes are retained.'
        report.change.lines.push({line: line.line, words})
    }
    // Adjacent windows can disagree at a seam. Never silently manufacture a shared
    // boundary from two uncertain estimates. Recheck after withdrawals as a retained
    // original may itself collide with another proposed neighbour.
    let removed: boolean
    do {
        removed = false
        // Unmatched unconfirmed placeholders stay visible, but their interpolated
        // spans are not reliable collision anchors. Explicit decisions still are.
        const audible = lines.filter(l => !l.off && (l.confidence > 0 || l.byHand || l.presenceByHand || l.words.some(w => w.anchor)))
        for (let i = 1; i < audible.length; i++) {
            const left = audible[i - 1]!,
                right = audible[i]!
            if (!sameVoice(left.line, right.line)) continue
            const a = report.change.lines.find(c => c.line === left.line && c.words)
            const b = report.change.lines.find(c => c.line === right.line && c.words)
            if (!a && !b) continue
            const overlap = (a?.words?.at(-1)?.end ?? left.end) - (b?.words?.[0]?.start ?? right.start)
            if (overlap <= Math.max(0, left.end - right.start) + 0.001) continue
            for (const change of [a, b])
                if (change) {
                    report.change.lines = report.change.lines.filter(c => c !== change)
                    const entry = report.entries.find(e => e.line === change.line)!
                    entry.status = 'review'
                    entry.reason = 'Neighbouring estimates introduce an overlap. Original retained; anchor their boundary and refine again.'
                    delete entry.after
                    removed = true
                }
        }
    } while (removed)
    return report
}

export function buildPassageRefinement(data: Project, candidates: Candidate[], language: RefinementLanguage, request: ConfirmedPassage): TimingRefinement {
    const input = passageInput(data, request)
    const report = buildRefinement(
        input.data,
        candidates.filter(c => input.window.targets.includes(c.line)),
        language,
    )
    report.fingerprint = refinementFingerprint(data)
    report.passage = {line: request.line, ...input.window}
    report.entries = report.entries.filter(e => input.window.targets.includes(e.line))
    if (input.window.targets.some(id => !report.change.lines.some(l => l.line === id && l.words))) {
        report.change.lines = []
        for (const entry of report.entries) {
            if (entry.status === 'refined') {
                entry.status = 'review'
                entry.reason = 'The passage could not be aligned safely as a whole. Both lines are retained.'
                delete entry.after
            }
        }
    }
    return report
}

export function applyRefinement(data: Project, report: TimingRefinement, requests: Pick<ClipRequest, 'id' | 'beatId'>[]) {
    if (report.change.lines.some(line => line.off !== undefined))
        throw new Error('This older proposal changes lyric presence. Prepare refinement again; leave lines out manually after listening.')
    if (refinementFingerprint(data) !== report.fingerprint) throw new Error('Timing or singers changed. Prepare the refinement again.')
    if (report.passage) {
        const scope = passageInput(data, {line: report.passage.line, confirmSung: true})
        if (
            scope.window.targets.some(id => !report.change.lines.some(l => l.line === id && l.words)) ||
            report.change.lines.some(l => !scope.window.targets.includes(l.line) || !l.words)
        )
            throw new Error('No usable alignment for the selected line. Prepare the passage again.')
    }
    const old = structuredClone(data.lyricsTiming!)
    const working = report.passage ? structuredClone(data) : data
    const change = report.passage
        ? {...report.change, lines: report.change.lines.map(l => (l.line === report.passage!.line ? {...l, off: false} : l))}
        : report.change
    const result = applyTiming(working, change, requests)
    for (const line of working.lyricsTiming!.lines) {
        if (!result.changed.includes(line.line)) continue
        const before = old.lines.find(l => l.line === line.line)!
        line.confidence = before.confidence
        if (before.byHand === undefined) delete line.byHand
        else line.byHand = before.byHand
        if (before.presenceByHand === undefined) delete line.presenceByHand
        else line.presenceByHand = before.presenceByHand
    }
    if (report.passage) {
        const selected = working.lyricsTiming!.lines.find(l => l.line === report.passage!.line)!
        selected.presenceByHand = true
        if (!result.changed.includes(selected.line)) result.changed.push(selected.line)
        Object.assign(data, working)
    }
    return result
}

const active = new Set<string>()
const readProject = (target: EditorTarget): Project => JSON.parse(readFileSync(join(target.dir, 'project.json'), 'utf8')) as Project
const folderOf = (target: EditorTarget) => join(target.dir, '.timing-refinement')
const audioStamp = (path: string) => {
    const s = statSync(path)
    return `${s.size}:${s.mtimeMs}`
}

/** The expensive stage writes a proposal only. Applying it uses the same locked save/invalidation as hand edits. */
export async function prepareTimingRefinement(target: EditorTarget, language: RefinementLanguage, passage?: ConfirmedPassage): Promise<TimingRefinement> {
    if (target.kind !== 'music' || !['de', 'en', 'fr'].includes(language)) throw new Error('Choose German (de), English (en) or French (fr) lyrics.')
    const key = resolve(target.dir)
    if (active.has(key)) throw new Error('A timing refinement is already running for this project.')
    active.add(key)
    try {
        const data = readProject(target)
        if (!data.lyricsTiming?.lines.length) throw new Error('Align lyrics with Whisper first.')
        const scoped = passage === undefined ? undefined : passageInput(data, passage)
        const audio = insideProject(target.dir, data.stems?.vocals)
        if (!audio) throw new Error('The vocals stem is missing. Separate stems first.')
        const audioPath = resolve(target.dir, audio.file),
            stamp = audioStamp(audioPath)
        const folder = folderOf(target)
        mkdirSync(folder, {recursive: true})
        const runId = randomUUID()
        const input = join(folder, `input-${runId}.json`),
            output = join(folder, `output-${runId}.json`)
        // Include protected sung neighbours for context, but never apply their model timings.
        const lines = scoped?.lines ?? data.lyricsTiming.lines.filter(l => !l.off && !l.adlib && (l.confidence > 0 || l.presenceByHand))
        writeJsonFile(input, {audio: audioPath, language, duration: data.music?.durationSec, lines, ...(scoped ? {window: scoped.window} : {})})
        let candidates: Candidate[] = []
        if (lines.some(l => !protectedLine(l))) {
            await runProcess(
                [
                    'uv',
                    'run',
                    '--python',
                    '3.12',
                    '--with',
                    'torch==2.15.0',
                    '--with',
                    'transformers==4.57.6',
                    '--with',
                    'soundfile',
                    '--with',
                    'phonemizer==3.6.0',
                    '--with',
                    'espeakng-loader==0.2.4',
                    'python',
                    join(import.meta.dir, '../../tools/refine_lyrics.py'),
                    input,
                    output,
                ],
                {stderr: 'tee', timeoutMs: 30 * 60 * 1000, errorMessage: e => `Phoneme refinement failed; original timing unchanged. ${e.slice(-3000)}`},
            )
            candidates = (JSON.parse(readFileSync(output, 'utf8')) as {lines: Candidate[]}).lines
            if (!Array.isArray(candidates)) throw new Error('Invalid phoneme alignment output')
        }
        const report = passage === undefined ? buildRefinement(data, candidates, language) : buildPassageRefinement(data, candidates, language, passage)
        if (refinementFingerprint(readProject(target)) !== report.fingerprint || audioStamp(audioPath) !== stamp)
            throw new Error('Project or vocals changed while aligning. Prepare again.')
        writeJsonFile(join(folder, 'proposal.json'), {...report, audioFile: audio.file, audioStamp: stamp})
        return report
    } finally {
        active.delete(key)
    }
}

export async function applyTimingRefinement(target: EditorTarget, id: string) {
    if (target.kind !== 'music') throw new Error('Lyrics timing is for music videos')
    const requests = await readClipRequests<ClipRequest>(target.dir)
    return withProjectLock(target.dir, target.id, () => {
        const report = JSON.parse(readFileSync(join(folderOf(target), 'proposal.json'), 'utf8')) as TimingRefinement & {audioFile: string; audioStamp: string}
        if (!id || report.id !== id) throw new Error('This proposal was replaced. Prepare again.')
        if (audioStamp(join(target.dir, report.audioFile)) !== report.audioStamp) throw new Error('Vocals changed. Prepare again.')
        const data = readProject(target)
        const backup = join(folderOf(target), `before-${report.id}.json`)
        const before = structuredClone(data.lyricsTiming)
        const result = applyRefinement(data, report, requests)
        if (result.changed.length) {
            writeJsonFile(backup, before)
            writeJsonFile(join(target.dir, 'project.json'), data)
        }
        return result
    })
}
