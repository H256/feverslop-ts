import {computeMemberCounts} from '../compose.ts'
import {formatTime} from '../frames.ts'
import {ask, askJson, llmMap} from '../llm.ts'
import {log, styles} from '../log.ts'
import {buildTimeline} from '../music.ts'
import {type Fact, type StoryBeat} from '../project.ts'
import {characterDescriptionPrompt, characterVariantLookPrompt} from '../prompts.ts'
import {pictureProp, propMissing} from '../prop-check.ts'
import {resolveUnknownTokens} from '../refs.ts'
import {reviewed} from '../review.ts'
import {beatsPrompt, musicStretches} from '../shot-planner.ts'
import {asDrawn} from '../props.ts'
import type {ProjectConfig} from '../config.ts'
import type {Character, Location, LyricSection, LyricsTiming, MusicMap, ProjectStore, PropStem, Singing} from '../project.ts'
import {energyBar} from './energy-bar.ts'
import {performanceRules} from './singers-choice.ts'
import {textOf} from '../text.ts'

// The beats of a music video (index.ts steps 9-10, #841): the story broken into beats along the song, the looks and descriptions of
// the members of a group, and the song cut into clips. The steps are the project's (project.step): cached, redone by --redo, the
// same as when they were part of index.ts.

/** What the beats are made from: the run, the song and its lyrics, the story, the cast and its looks. */
export type BeatsRun = {
    project: ProjectStore
    config: ProjectConfig
    args: {review: boolean}
    maxClipSec: number
    music: MusicMap
    lyrics: string
    lyricSections: LyricSection[]
    lyricsTiming: LyricsTiming | undefined
    propActivity: Partial<Record<PropStem, {start: number; end: number}[]>> | undefined
    singing: Singing | undefined
    storyBase: string
    cast: {characters: Character[]; locations: Location[]}
    lookBrief: string
    characterLooks: Record<string, string>
    characterDescriptions: Record<string, string>
}

export async function planBeats(run: BeatsRun) {
    const {
        project,
        config,
        args,
        maxClipSec,
        music,
        lyrics,
        lyricSections,
        lyricsTiming,
        propActivity,
        singing,
        storyBase,
        cast,
        lookBrief,
        characterLooks,
        characterDescriptions,
    } = run
    ////////// BREAKING THE STORY INTO BEATS
    // one beat per ~15 s of the song, so that no beat has to be stretched over far more clips than it has story for
    const beatCount = Math.max(6, Math.round(music.durationSec / 15))
    // where the last sung word ends - the singer is on screen until then
    const vocalsEnd = Math.max(0, ...(lyricsTiming?.lines.flatMap(l => l.words.map(w => w.end)) ?? []))
    const beats = await reviewed(
        project,
        args.review,
        'beats',
        () =>
            project.step('beats', '9 · BREAKING THE STORY INTO BEATS', async () => {
                // what the beats must do so the singers can be lip-synced - the singers are on screen until the last sung word
                const performance = `${singing ? performanceRules(singing, {cast, lyricSections}) : ''}
    ${
        singing && vocalsEnd
            ? `The singer${singing.singers.length > 1 ? 's sing' : ' sings'} on screen until ${formatTime(vocalsEnd)} of the ${formatTime(music.durationSec)} song and ${singing.singers.length > 1 ? 'are' : 'is'} visible, with the mouth in view, in every shot while singing - singing is part of what they do, not a number for the camera: a singer in a fight sings through it, at the opponent, between and over the blows. So nobody who sings leaves, vanishes, dies or is swallowed before ${formatTime(vocalsEnd)}: such an ending happens gradually while they keep singing, or only after the last vocal - the beats after that show the place without them.
    `
            : ''
    }`
                // the music along the way - loudness and whose instrument is heard - so the story's curve follows the song's
                const players = cast.characters.flatMap(c =>
                    c.prop && c.propStem && propActivity?.[c.propStem] ? [{name: c.name, prop: c.prop, ranges: propActivity[c.propStem]!}] : [],
                )
                const stretches = musicStretches(music, beatCount, players)
                const extracted = await askJson<{beats: Omit<StoryBeat, 'id' | 'order'>[]}>(
                    beatsPrompt({
                        durationSec: music.durationSec,
                        beatCount,
                        characters: cast.characters,
                        locations: cast.locations,
                        lyrics,
                        story: storyBase,
                        performance,
                        stretches,
                    }),
                )

                const BEAT_KINDS: string[] = ['establish', 'build', 'hit', 'release']
                const characterIds = new Set(cast.characters.map(c => c.id))
                const groupIds = new Set(cast.characters.filter(c => c.isGroup).map(c => c.id))
                const locationIds = cast.locations.map(l => l.id)
                const built = extracted.beats.map((beat, i) => {
                    if (!locationIds.includes(beat.locationId)) {
                        log.warn(`beat ${i + 1} uses unknown location "${beat.locationId}" - using ${locationIds[0]}`)
                    }
                    const beatCharacterIds = (Array.isArray(beat.characterIds) ? beat.characterIds : []).filter(id => characterIds.has(id))
                    const summary = String(beat.summary ?? '')
                    const groupSize = Object.fromEntries(
                        Object.entries(beat.groupSize ?? {})
                            .filter(([id]) => groupIds.has(id) && beatCharacterIds.includes(id))
                            .map(([id, count]) => [id, Math.min(20, Math.max(1, Math.round(Number(count)) || 1))]),
                    )
                    return {
                        ...beat,
                        // written with {Name} tokens (lib/refs.ts) - a beat from before them has plain names
                        tokens: true,
                        kind: BEAT_KINDS.includes(beat.kind) ? beat.kind : ('build' as const),
                        summary,
                        id: `beat-${String(i + 1).padStart(2, '0')}`,
                        order: i + 1,
                        locationId: locationIds.includes(beat.locationId) ? beat.locationId : locationIds[0]!,
                        characterIds: beatCharacterIds,
                        moments: Array.isArray(beat.moments) && beat.moments.length ? beat.moments.map(String) : [summary],
                        intensity: Math.min(1, Math.max(0, Number(beat.intensity) || 0.5)),
                        weight: Math.max(1, Number(beat.weight) || 1),
                        continuous: beat.continuous === true,
                        entrance: beat.entrance === true,
                        // each fact with whether it is one of the place; a plain string (the model forgot the object) is read as written
                        stateAfter: (Array.isArray(beat.stateAfter) ? beat.stateAfter : [])
                            .map((f: unknown): Fact =>
                                f && typeof f === 'object'
                                    ? {fact: textOf((f as Record<string, unknown>).fact), place: (f as Record<string, unknown>).place === true}
                                    : {fact: String(f), place: false},
                            )
                            .filter(f => f.fact.trim()),
                        ...(Object.keys(groupSize).length ? {groupSize} : {}),
                    }
                })
                // a token that is nobody of the cast ({Aldric} for "Aldric Thorne") is mapped by one short call, not by matching words
                const texts = built.flatMap(b => [b.summary, ...b.moments, ...b.stateAfter.map(f => f.fact)])
                const {texts: fixed, mapped} = await resolveUnknownTokens(texts, cast.characters)
                if (Object.keys(mapped).length)
                    log.step(
                        'Names',
                        Object.entries(mapped)
                            .map(([token, name]) => `{${token}} → ${name ? `{${name}}` : 'nobody of the cast'}`)
                            .join(', '),
                    )
                let next = 0
                return built.map(b => ({
                    ...b,
                    summary: fixed[next++]!,
                    moments: b.moments.map(() => fixed[next++]!),
                    stateAfter: b.stateAfter.map(f => ({...f, fact: fixed[next++]!})),
                }))
            }),
        beats => {
            for (const beat of beats) {
                log.line(
                    `   ${styles.name(beat.id)} ${styles.muted(`${beat.kind.padEnd(9)} ${energyBar(beat.intensity)} @${beat.locationId}${beat.lyricAnchor ? ` ♪${beat.lyricAnchor}` : ''}`)}`,
                )
                log.line(`      ${beat.summary}`)
                for (const moment of beat.moments) log.line(styles.muted(`        · ${moment}`))
            }
        },
    )

    ////////// GENERATING GROUP MEMBER VARIANT LOOKS
    // group characters (cast.characters[].isGroup) that ever show more than one individual on screen at once (beats
    // groupSize) get one extra look prompt per member here, so they don't all render from the same shared reference
    // picture - see computeMemberCounts/groupMemberId in lib/compose.ts for how a shot picks which member to show.
    const memberCounts = computeMemberCounts(beats, cast.characters)
    const characterLookVariants = await project.step('characterLookVariants', '9c · GENERATING GROUP MEMBER VARIANTS', async () => {
        const variants: Record<string, string[]> = {}
        for (const char of cast.characters) {
            const count = memberCounts[char.id] ?? 1
            if (count <= 1) continue
            log.step('Group', `${styles.name(char.id)} ${styles.muted(`${count} members`)}`)
            const looks = [characterLooks[char.id] ?? '']
            for (let i = 1; i < count; i++) {
                log.step(`Member ${i + 1}/${count}`, styles.name(char.id))
                const options = characterVariantLookPrompt(lookBrief, asDrawn(char, config.propPictures), looks)
                looks.push(await project.each('characterLookVariants', `${char.id}/${i}`, options, () => ask(options)))
            }
            variants[char.id] = looks
            const shown = config.propPictures ? undefined : pictureProp(char)
            if (shown)
                looks.forEach((look, i) => {
                    if (propMissing(look, shown)) log.warn(`${char.id} member ${i + 1}: the look does not show the prop "${shown}"`)
                })
        }
        return variants
    })

    ////////// DESCRIBING THE GROUP MEMBER VARIANTS
    // each member has its own look image, so it needs its own description too - reusing the group's shared
    // characterDescriptions entry (derived from member 0's look alone) described every other member's anchor image
    // with member 0's text, which reads as the video model fighting itself and drifting the whole sequence toward
    // whichever member the text actually described.
    const characterDescriptionVariants = await project.step('characterDescriptionVariants', '9d · DESCRIBING THE GROUP MEMBER VARIANTS', async () => {
        const descriptions: Record<string, string[]> = {}
        for (const [id, looks] of Object.entries(characterLookVariants)) {
            log.step('Group', `${styles.name(id)} ${styles.muted(`${looks.length} members`)}`)
            descriptions[id] = [
                characterDescriptions[id] ?? '',
                ...(await llmMap(looks.slice(1), (look, i) => {
                    const options = characterDescriptionPrompt(look)
                    return project.each('characterDescriptionVariants', `${id}/${i + 1}`, options, () => ask(options))
                })),
            ]
        }
        return descriptions
    })

    ////////// CUTTING THE SONG INTO CLIPS
    // switched alignLyrics on or off since the timeline was built
    if (project.data.timeline && (project.data.timeline.aligned ?? false) !== Boolean(lyricsTiming)) project.invalidate('timeline')
    const timeline = await project.step('timeline', '10 · CUTTING THE SONG INTO CLIPS', async () =>
        buildTimeline(music, lyricSections, maxClipSec, lyricsTiming, config.vocalGap),
    )
    log.step(
        'Clips',
        `${timeline.slots.length} clips of ${timeline.barsPerSlot} bars (${((timeline.barsPerSlot * 240) / music.bpm).toFixed(1)}s) - max ${timeline.maxClipSec}s`,
    )
    if (timeline.aligned) {
        log.step('Sections', styles.muted('from the lyrics timing (estimate from the audio in brackets)'))
        timeline.sections.forEach((s, i) => {
            const estimate = music.sections[i]
            log.line(
                `   ${styles.name(s.label.padEnd(12))} ${formatTime(s.start, true)} – ${formatTime(s.end, true)} ${styles.muted(estimate ? `(${formatTime(estimate.start, true)} – ${formatTime(estimate.end, true)})` : '')}`,
            )
        })
        log.step('Sung in clips', `${timeline.slots.filter(s => s.vocals?.length).length} of ${timeline.slots.length}`)
    }
    return {beats, memberCounts, characterLookVariants, characterDescriptionVariants, timeline}
}
