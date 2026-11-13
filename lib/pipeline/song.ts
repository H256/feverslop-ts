import {formatTime} from '../frames.ts'
import {log, styles} from '../log.ts'
import {alignLyrics, lowConfidence, lyricsProblems, sungOnly, tightenStarts} from '../lyrics.ts'
import {analyzeSong, separateStems, transcribeVocals} from '../music.ts'
import {readFineWaveform} from '../waveform.ts'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import type {ProjectConfig} from '../config.ts'
import type {LyricSection, ProjectStore} from '../project.ts'
import {energyBar} from './energy-bar.ts'

// The song of a music video, heard (index.ts steps 2-2c, #841): its sections, beats and energy, and - when someone sings, or with
// "alignLyrics" - its stems, the vocals transcribed and the lyrics aligned to them. The steps are the project's (project.step):
// cached, redone by --redo, the same as when they were part of index.ts.

/** What the song is heard with: the run, the song file and its lyrics, and the language and idea of the project. */
export type SongRun = {
    project: ProjectStore
    projectId: string
    config: ProjectConfig
    songFile: string
    lyrics: string
    lyricSections: LyricSection[]
    language: string
    idea: string
}

export async function hearSong(run: SongRun) {
    const {project, projectId, config, songFile, lyrics, lyricSections, language, idea} = run
    ////////// ANALYZE THE SONG
    if (!existsSync(songFile))
        throw new Error(
            `No song found at ${project.input('song.wav')}, ${project.input('song.mp3')} or ${project.input('song.flac')}${idea || lyrics ? ` - run with --render=song to generate one from input/${idea ? 'idea.txt' : 'lyrics.txt'}` : ''}`,
        )
    const music = await project.step('music', '2 · ANALYZING THE SONG', async () => {
        log.step('Analyzing', styles.muted(`${songFile} - beats, bars and ${lyricSections.length} sections`))
        return analyzeSong(
            songFile,
            lyricSections.map(s => s.label),
        )
    })
    log.step('Tempo', `${music.bpm} BPM, ${music.downbeats.length} bars, ${Math.round(music.durationSec)}s`)
    for (const s of music.sections) {
        log.line(`   ${energyBar(s.energy)} ${styles.muted(`${formatTime(s.start)} – ${formatTime(s.end)}`)} ${styles.name(s.label)}`)
    }
    log.step(
        'Sections',
        styles.muted(
            config.alignLyrics
                ? 'estimated from audio - refined from the lyrics timing when the song is cut into clips'
                : `estimated from audio - fix them by hand in ${project.file} if they are off, then --redo=timeline`,
        ),
    )

    ////////// ALIGNING THE LYRICS - only when someone sings, or with "alignLyrics": true
    const stems = config.alignLyrics
        ? await project.step('stems', '2a · SEPARATING THE STEMS', async () => {
              log.step(
                  'Separating',
                  styles.muted(`${songFile} with demucs htdemucs_ft, then guitar and piano with htdemucs_6s - the first run downloads the models`),
              )
              return separateStems(songFile, project.dir)
          })
        : undefined
    if (stems) log.step('Stems', styles.muted(Object.values(stems).join(' · ')))

    const transcript = stems
        ? await project.step('transcript', '2b · TRANSCRIBING THE VOCALS', async () => {
              log.step('Transcribing', styles.muted(`${stems.vocals} with Whisper (${language})`))
              return transcribeVocals(join(project.dir, stems.vocals), config.lyricsLanguage, project.input('lyrics.txt'))
          })
        : undefined
    if (transcript) {
        log.step(
            'Heard',
            styles.muted(
                `${transcript.words.length} words: ${transcript.words
                    .slice(0, 12)
                    .map(w => w.text)
                    .join(' ')} …`,
            ),
        )
        if (transcript.activity) log.step('Vocal activity', styles.muted(`${transcript.activity.length} range(s) from RMS energy, independent of whisper`))
    }

    const alignedTiming = transcript
        ? await project.step('lyricsTiming', '2c · ALIGNING THE LYRICS', async () => {
              const aligned = alignLyrics(lyricSections, transcript.words, music.sections, transcript.activity, music.bpm)
              // the first word of a line starts where the singing does: its sound is measured on the vocals stem, not read from the transcript
              const loudness = await readFineWaveform(join(project.dir, stems!.vocals), 100).catch(() => undefined)
              if (!loudness) return aligned
              const {timing, moved} = tightenStarts(aligned, loudness)
              if (moved.length)
                  log.step(
                      'Starts',
                      styles.muted(
                          `${moved.length} line(s) began in silence and start where the singing does (longest: ${Math.max(...moved.map(m => m.by)).toFixed(1)} s)`,
                      ),
                  )
              return timing
          })
        : undefined
    // a line left out on the Timing page (heard, but not sung - or not sung there) is not sung anywhere from here on
    const lyricsTiming = alignedTiming && sungOnly(alignedTiming)
    if (lyricsTiming) {
        for (const line of lyricsTiming.lines) {
            const confidence = line.confidence < 0.5 ? styles.warning(line.confidence.toFixed(2)) : styles.muted(line.confidence.toFixed(2))
            log.line(
                `   ${styles.muted(`${formatTime(line.start, true)} – ${formatTime(line.end, true)}`)} ${confidence} ${styles.name(line.section.padEnd(12))} ${line.text}`,
            )
        }
        // with known lyrics nothing is lost and nothing added (#738): every line once, placed, with its own words
        for (const p of lyricsProblems(alignedTiming!, lyricSections))
            log.warn(`line ${p.line + 1} "${p.text}": ${p.problem} - check it on the Timing page (bun run timing ${projectId})`)
        const suggested = alignedTiming!.lines.filter(l => l.adlib && l.off)
        if (suggested.length)
            log.step(
                'Ad-libs',
                styles.muted(
                    `${suggested.length} line(s) heard that lyrics.txt does not have - not sung until taken: ${suggested.map(l => `${l.line + 1} "${l.text}"`).join(', ')} (bun run timing ${projectId} --on=N)`,
                ),
            )
        const unsure = lowConfidence(lyricsTiming)
        if (unsure.length)
            log.warn(
                `${unsure.length} line(s) barely found in the transcript - their times are interpolated. Check them on the workspace's Timing page (bun run editor), or fix lyricsTiming in ${project.file} by hand, then --redo=timeline`,
            )
    }
    return {music, stems, lyricsTiming}
}
