import {readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {alignLyrics, tightenStarts} from '../lib/lyrics.ts'
import {projectLyricSections} from '../lib/music.ts'
import {readFineWaveform} from '../lib/waveform.ts'
import {runProcess} from '../lib/process.ts'
import type {LibrarySong} from '../lib/song-library.ts'
const library = resolve(process.env.ALIGNMENT_LIBRARY ?? 'library/songs')
const root = resolve(process.env.ALIGNMENT_OUTPUT ?? '.tmp/alignment-library-benchmark')
mkdirSync(root, {recursive: true})
const ids = ['epa-streikt-261104', 'schwarzer-flur-261026', 'well-of-youth-male-singing', 'mehr-als-code-261112']
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
for (const id of ids) {
    const dir = join(library, id),
        out = join(root, id)
    mkdirSync(out, {recursive: true})
    const json = readFileSync(join(dir, 'song.json'), 'utf8'),
        lyrics = readFileSync(join(dir, 'lyrics.txt'), 'utf8')
    const song = JSON.parse(json) as LibrarySong
    console.log(`PREPARE ${id}`)
    const baseline = alignLyrics(
        projectLyricSections(
            lyrics,
            song.music.sections.map(s => s.label),
        ),
        song.transcript.words,
        song.music.sections,
        song.transcript.activity,
        song.music.bpm,
    )
    const audio = join(dir, song.stems.vocals)
    const peaks = await readFineWaveform(audio, 100)
    if (!peaks) throw new Error(`Cannot read vocals waveform: ${id}`)
    const timing = tightenStarts(baseline, peaks).timing
    writeFileSync(join(out, 'baseline.json'), JSON.stringify(timing, null, 2))
    writeFileSync(join(out, 'reference.json'), JSON.stringify(song.lyricsTiming, null, 2))
    writeFileSync(
        join(out, 'input.json'),
        JSON.stringify(
            {audio, language: song.lyricsLanguage, duration: song.music.durationSec, lines: timing.lines.filter(l => !l.off && !l.adlib && l.confidence > 0)},
            null,
            2,
        ),
    )
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
            resolve('tools/refine_lyrics.py'),
            join(out, 'input.json'),
            join(out, 'output.json'),
        ],
        {stderr: 'tee', timeoutMs: 1800000, errorMessage: e => e.slice(-3000)},
    )
    if (hash(readFileSync(join(dir, 'song.json'), 'utf8')) !== hash(json) || hash(readFileSync(join(dir, 'lyrics.txt'), 'utf8')) !== hash(lyrics))
        throw new Error(`Reference changed: ${id}`)
    writeFileSync(
        join(out, 'provenance.json'),
        JSON.stringify(
            {
                id,
                language: song.lyricsLanguage,
                reference_sha256: hash(json),
                lyrics_sha256: hash(lyrics),
                audio_fingerprint: song.fingerprints.song,
                reference_unchanged: true,
                baseline: 'Reconstructed from saved transcript, original lyrics and vocal waveform; no hand timings or anchors',
            },
            null,
            2,
        ),
    )
    console.log(`COMPLETE ${id}`)
}
