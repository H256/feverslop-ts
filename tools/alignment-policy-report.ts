/** Compare cached raw candidates and the real apply policy without modifying the reference library. */
import {readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {buildRefinement, applyRefinement} from '../lib/editor/timing-refinement.ts'
import type {Project, LyricsTiming, TimedWord} from '../lib/project.ts'
import type {RefinementLanguage} from '../shared/timing-refinement.ts'

const root = resolve(process.argv[2] ?? '.tmp/alignment-library-benchmark')
const ids = ['epa-streikt-261104', 'schwarzer-flur-261026', 'well-of-youth-male-singing', 'mehr-als-code-261112']
const read = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(dir, name), 'utf8'))
const metrics = (values: number[]) => {
    const sorted = values.map(v => Math.abs(v) * 1000).sort((a, b) => a - b)
    const n = sorted.length
    return n
        ? {
              n,
              mean_ms: Math.round(sorted.reduce((a, b) => a + b, 0) / n),
              median_ms: Math.round((sorted[Math.floor(n / 2)]! + sorted[Math.floor((n - 1) / 2)]!) / 2),
              within_200ms: sorted.filter(v => v <= 200).length,
              over_1s: sorted.filter(v => v > 1000).length,
          }
        : {n}
}
const results = ids.map(id => {
    const dir = join(root, id)
    const baseline = read(dir, 'baseline.json') as LyricsTiming
    const reference = read(dir, 'reference.json') as LyricsTiming
    const input = read(dir, 'input.json') as {duration: number; language: RefinementLanguage}
    const candidates = (read(dir, 'output.json') as {lines: {line: number; words?: TimedWord[]; error?: string}[]}).lines
    // Library exports have no project singer assignment. Do not invent a voice or feed hand anchors to the policy.
    const data: Project = {lyricsTiming: structuredClone(baseline), music: {durationSec: input.duration} as Project['music']}
    const proposal = buildRefinement(data, candidates, input.language)
    applyRefinement(data, proposal, [])
    const rows = reference.lines
        .filter(r => r.byHand && !r.off && !r.adlib)
        .flatMap(r => {
            const b = baseline.lines.find(l => l.line === r.line && l.text === r.text)
            if (!b) return []
            const applied = data.lyricsTiming!.lines.find(l => l.line === r.line)!
            const raw = candidates.find(l => l.line === r.line)?.words
            return [
                {
                    line: r.line,
                    text: r.text,
                    reference: [r.start, r.end],
                    baseline: [b.start, b.end],
                    raw: raw?.length ? [raw[0]!.start, raw.at(-1)!.end] : null,
                    applied: applied.off ? null : [applied.start, applied.end],
                    status: proposal.entries.find(e => e.line === r.line)?.status,
                },
            ]
        })
    const summary = (kind: 'baseline' | 'raw' | 'applied') => {
        const present = rows.filter(r => r[kind])
        return {
            active: present.length,
            missing: rows.length - present.length,
            onset: metrics(present.map(r => r[kind]![0]! - r.reference[0]!)),
            end: metrics(present.map(r => r[kind]![1]! - r.reference[1]!)),
        }
    }
    return {
        id,
        compared: rows.length,
        baseline: summary('baseline'),
        raw: summary('raw'),
        applied: summary('applied'),
        statuses: Object.fromEntries(['refined', 'review', 'omit', 'protected'].map(s => [s, rows.filter(r => r.status === s).length])),
        rows,
    }
})
writeFileSync(join(root, 'policy-report.json'), JSON.stringify(results, null, 2))
console.log(
    JSON.stringify(
        results.map(({rows, ...summary}) => summary),
        null,
        2,
    ),
)
