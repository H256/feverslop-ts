import {formatSlotRanges} from '../assemble.ts'
import {buildClipRequests} from '../compose.ts'
import {formatTime, frameAt, secondsAt} from '../frames.ts'
import {hideDetails, log, showsDetails, styles} from '../log.ts'
import {cutAudio, mixStems} from '../music.ts'
import {clipRequestsDir, clipRequestsIn, PREVIOUS, requestChanges, startOutput} from '../previous-output.ts'
import {checkPrompts} from '../prompt-check.ts'
import {readFineWaveform} from '../waveform.ts'
import {MAX_REFERENCE_IMAGES} from '../../comfy/helpers.ts'
import {MISSING_WORD_LEAD, RATE, voiceLead} from '../../shared/timing-fit.ts'
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import type {ProjectConfig} from '../config.ts'
import type {
    Assignment,
    Character,
    Location,
    LocationLayout,
    LyricsTiming,
    MusicMap,
    Project,
    ProjectStore,
    PropStem,
    Singing,
    Slot,
    StoryBeat,
    Stems,
    Timeline,
} from '../project.ts'
import type {PictureJob} from '../render.ts'

// The requests of a music video (index.ts step 12, #841): one MiniMax H3 request per clip, built from the plan on every run - its
// prompt, its pictures and its audio cut from the stems - written to output/ with the picture jobs, checked, and compared with the
// run before.

/** What the requests are built from: everything the planning made. */
export type RequestsRun = {
    project: ProjectStore
    config: ProjectConfig
    args: {'debug-audio': boolean; 'legacy-moments': boolean}
    language: string
    songFile: string
    music: MusicMap
    stems: Stems | undefined
    stemFiles: Record<string, string>
    lyricsTiming: LyricsTiming | undefined
    propActivity: Partial<Record<PropStem, {start: number; end: number}[]>> | undefined
    singing: Singing | undefined
    cast: {characters: Character[]; locations: Location[]}
    lookBrief: string
    characterDescriptions: Record<string, string>
    locationDescriptions: Record<string, string>
    locationAnchors: Record<string, string>
    locationLayouts: Record<string, LocationLayout>
    beats: StoryBeat[]
    memberCounts: Record<string, number>
    characterLookVariants: Record<string, string[]>
    characterDescriptionVariants: Record<string, string[]>
    timeline: Timeline
    clipSlots: Slot[]
    mapping: Assignment[]
    locationView: number | 'auto'
    directedPlan: Project
    shotViews: Record<string, number[]> | undefined
    pictureJobs: (memberCounts: Record<string, number>, lookVariants: Record<string, string[]>, descriptionVariants: Record<string, string[]>) => PictureJob[]
}

export async function buildRequests(run: RequestsRun) {
    const {
        project,
        config,
        args,
        language,
        songFile,
        music,
        stems,
        stemFiles,
        lyricsTiming,
        propActivity,
        singing,
        cast,
        lookBrief,
        characterDescriptions,
        locationDescriptions,
        locationAnchors,
        locationLayouts,
        beats,
        memberCounts,
        characterLookVariants,
        characterDescriptionVariants,
        timeline,
        clipSlots,
        mapping,
        locationView,
        directedPlan,
        shotViews,
        pictureJobs,
    } = run
    ////////// BUILDING THE MINIMAX H3 REQUESTS
    // Deterministic from the data above, so it is rebuilt on every run instead of being cached
    log.section('12 · BUILDING THE MINIMAX H3 REQUESTS')
    // the vocals stem's loudness: a shot does not forbid the lip-sync where its singing is already heard (lib/compose.ts, voiceLead)
    const vocalPeaks = stems && singing ? await readFineWaveform(join(project.dir, stems.vocals), RATE).catch(() => undefined) : undefined
    // singing heard well before a line's first word: the clips follow the sound, but the timing most likely lost a word there (#738)
    if (vocalPeaks && lyricsTiming) {
        const early = lyricsTiming.lines.flatMap((line, n) => {
            const lead = voiceLead(line.words, vocalPeaks, lyricsTiming.lines[n - 1]?.end ?? 0)
            return lead >= MISSING_WORD_LEAD ? [`"${line.text}" (${lead.toFixed(1)} s)`] : []
        })
        if (early.length)
            log.warn(
                `${early.length} line(s) are heard before their first word - a word may be missing in their timing: ${early.join(', ')}. Check them on the workspace's Timing page`,
            )
    }
    const clips = buildClipRequests({
        slots: clipSlots,
        mapping,
        beats,
        characters: cast.characters,
        locations: cast.locations,
        characterDescriptions,
        characterDescriptionVariants,
        locationDescriptions,
        locationAnchors,
        locationLayouts,
        lookBrief,
        music,
        language,
        singing,
        lyricsTiming,
        vocalPeaks,
        shotMoments: args['legacy-moments'] ? undefined : directedPlan.shotMoments,
        propActivity,
        stemsAvailable: Boolean(stems),
        continuity: config.continuity,
        pinStartFrame: config.pinStartFrame || config.contextFrames > 0,
        contextFrames: config.contextFrames,
        locationView,
        clipPrompt: config.clipPrompt,
        shotViews,
    })

    // more people than reference pictures: whoever did not fit is in the scene without a picture - the video model invents them
    for (const clip of clips) {
        if (clip.dropped?.length)
            log.warn(
                `${clip.id}: no reference picture left for ${clip.dropped.map(id => cast.characters.find(c => c.id === id)?.name ?? id).join(', ')} - the workflow takes ${MAX_REFERENCE_IMAGES} pictures`,
            )
    }

    const outputDir = join(project.dir, 'output')
    // the output of the run before goes to output/.previous/ - to say below which requests this run changed
    startOutput(outputDir)
    mkdirSync(clipRequestsIn(outputDir), {recursive: true})
    mkdirSync(join(outputDir, 'audio'), {recursive: true})

    // a track mixed of several instrument stems (lib/compose.ts mixStem) is a stem file of its own, made once per set of stems -
    // uploaded and trimmed like any other stem
    for (const audio of clips.flatMap(c => c.assets.audio)) {
        if (!audio.mix || !audio.stem || stemFiles[audio.stem]) continue
        const sources = audio.mix.map(stem => stemFiles[stem])
        if (sources.some(f => !f)) continue
        stemFiles[audio.stem] = await mixStems(sources as string[], join(project.dir, 'stems', `${audio.stem}.wav`))
    }

    for (const clip of clips) {
        await Bun.write(join(clipRequestsIn(outputDir), `${clip.id}.json`), JSON.stringify(clip, null, 2))
        // one debug-listenable file per track, cut from its own stem to this clip's span - not what's actually
        // uploaded for rendering any more (lib/render.ts uploads and trims the whole stem itself), just handy to
        // hear exactly what a track covers
        // only with --debug-audio: one ffmpeg process per track and clip, on every run, for files nobody needs to render
        for (const audio of args['debug-audio'] ? clip.assets.audio : []) {
            await cutAudio(stemFiles[audio.stem!]!, secondsAt(frameAt(audio.songStart)), secondsAt(frameAt(audio.songEnd)), join(project.dir, audio.file))
        }
    }

    const pictures = pictureJobs(memberCounts, characterLookVariants, characterDescriptionVariants)
    await Bun.write(join(outputDir, 'assets.json'), JSON.stringify(pictures, null, 2))

    await Bun.write(
        join(outputDir, 'timeline.json'),
        JSON.stringify(
            {
                song: songFile,
                bpm: music.bpm,
                durationSec: music.durationSec,
                maxClipSec: timeline.maxClipSec,
                barsPerClip: timeline.barsPerSlot,
                beats,
                clips: clips.map(c => ({
                    id: c.id,
                    start: c.start,
                    end: c.end,
                    duration: c.duration,
                    section: c.section,
                    beatId: c.beatId,
                    shots: c.shots.length,
                    ...(c.vocals ? {vocals: c.vocals} : {}),
                    request: `clips/${c.id}.json`,
                })),
            },
            null,
            2,
        ),
    )

    // the prompts are in output/clips/ and in the log file - the terminal shows them with --show=clips (or -v)
    hideDetails(!showsDetails('clips'))
    for (const clip of clips) {
        log.box(`${clip.id} · ${formatTime(clip.start)} – ${formatTime(clip.end)} · ${clip.section} · ${clip.beatId}`, clip.prompt)
    }
    hideDetails(false)
    if (!showsDetails('clips')) log.step('Prompts', styles.muted(`${clips.length} - in ${clipRequestsDir(project.dir)} (--show=clips prints them here)`))
    // what went wrong between the parts of a prompt (#825): a word twice in a row, a label without a picture - said by clip
    {
        const found = checkPrompts(clips)
        for (const finding of found.slice(0, 8)) log.warn(`prompt of ${finding}`)
        if (found.length > 8) log.warn(`${found.length - 8} more findings in the prompts - bun run inspect ${project.id} <clip> shows a clip's`)
    }
    const changes = requestChanges(outputDir)
    if (changes) {
        const {changed, added, gone} = changes
        if (!changed.length && !added.length && !gone.length) log.step('Changes', styles.muted('every request is the same as in the run before'))
        else {
            log.step(
                'Changes',
                [
                    changed.length ? `${changed.length} changed: ${formatSlotRanges(changed)}` : '',
                    added.length ? `${added.length} new: ${formatSlotRanges(added)}` : '',
                    gone.length ? `${gone.length} gone: ${formatSlotRanges(gone)}` : '',
                ]
                    .filter(Boolean)
                    .join(' · '),
            )
            if (changed[0])
                log.step(
                    'Compare',
                    styles.muted(
                        `diff ${join(clipRequestsIn(join(outputDir, PREVIOUS)), `${changed[0]}.json`)} ${join(outputDir, 'clips', `${changed[0]}.json`)}`,
                    ),
                )
        }
    }
    return {clips, outputDir, pictures}
}
