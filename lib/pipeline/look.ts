import {applyLibraryText, CASTING_FILE, copyKey} from '../casting.ts'
import {ask, askJson, type AskOptions, llmMap} from '../llm.ts'
import {log, styles} from '../log.ts'
import {type Character, handsOf, type LocationLayout, type LocationSet, redoAfter} from '../project.ts'
import {
    characterDescriptionPrompt,
    characterLookPrompt,
    locationAnchorPrompt,
    locationDescriptionPrompt,
    locationLayoutPrompt,
    type Performer,
    locationLookPrompt,
    lookBriefPrompt,
    propInUsePrompt,
} from '../prompts.ts'
import {pictureProp, propMissing} from '../prop-check.ts'
import {asDrawn, propsOfPlace} from '../props.ts'
import {reviewed} from '../review.ts'
import {LOCATION_VIEWS} from '../sequenceSheet.ts'
import type {AssetKind} from '../asset-import.ts'
import type {LibraryAsset} from '../library.ts'
import type {Location, ProjectStore, StepName} from '../project.ts'
import {textOf, messageOf} from '../text.ts'

// The look of a music video (index.ts steps 6-8d, #841): the look of the whole, the looks and descriptions of the characters and the
// places, the background of each place and its floor plan. A library asset the casting chose stands in with its own texts. The
// steps are the project's (project.step): cached, redone by --redo, the same as when they were part of index.ts.

/** What the look is made from: the run, the story and the cast, and what the casting took from the library. */
export type LookRun = {
    project: ProjectStore
    args: {review: boolean}
    style: string
    storySummary: string
    cast: {characters: Character[]; locations: Location[]}
    /** the library assets the casting chose, by copyKey(kind, id) */
    castLibrary: Map<string, LibraryAsset>
    // config.propPictures: every prop has a picture of its own - the characters and the places are drawn without them (#944)
    propPictures: boolean
}

export async function planLook(run: LookRun) {
    const {project, args, style, storySummary, cast, castLibrary, propPictures} = run
    const casted = (kind: AssetKind, id: string) => castLibrary.get(copyKey(kind, id))
    // the steps below that a library asset stands in for: its texts replace theirs, also in a step kept from an earlier run
    // (the entry was changed since) - what was planned with the old ones is named at the end
    const castChanged = new Set<StepName>()
    function castTexts<T>(step: StepName, kind: AssetKind, values: Record<string, T>, pick: (asset: LibraryAsset) => T | undefined) {
        for (const [key, asset] of castLibrary) {
            if (!key.startsWith(`${kind}:`)) continue
            if (applyLibraryText(values, key.slice(kind.length + 1), pick(asset))) castChanged.add(step)
        }
    }
    /**
     * A step asked once per character or place, as many at once as llm.parallel allows (#1156): the library's text where the casting
     * chose an asset, else the answer; one without an answer is left out. The library's texts are taken into a step kept from before too.
     */
    async function perEntity<T>(
        step: StepName,
        title: string,
        kind: AssetKind,
        pick: (asset: LibraryAsset) => T | undefined,
        askOne: (entity: Character | Location) => Promise<T | undefined>,
    ): Promise<Record<string, T>> {
        const entities: (Character | Location)[] = kind === 'character' ? cast.characters : cast.locations
        const label = kind === 'character' ? 'Character' : 'Location'
        const values = (await project.step(step, title, async () => {
            const answers = await llmMap(entities, async (entity, i) => {
                log.step(`${label} ${i + 1}/${entities.length}`, styles.name(entity.id))
                const asset = casted(kind, entity.id)
                return (asset && pick(asset)) || askOne(entity)
            })
            return Object.fromEntries(entities.flatMap((entity, i) => (answers[i] === undefined ? [] : [[entity.id, answers[i]]]))) as never
        })) as Record<string, T>
        castTexts(step, kind, values, pick)
        return values
    }
    /////////// DESIGNING THE LOOK - invented from the story, or extending the director's style.txt
    const lookBrief = await reviewed(
        project,
        args.review,
        'lookBrief',
        () => project.step('lookBrief', '6 · DESIGNING THE FILM LOOK', () => ask(lookBriefPrompt(style, storySummary))),
        look => log.box('Look brief', look),
    )

    ////////// CRAFTING CHARACTER LOOKS
    // The video model keeps the pose of the reference picture: a prop the picture shows at rest is never used in a clip, whatever
    // the clip prompt says (tides: a bass that "rests against her waist" - the bassist stood still in every clip, #323). The LLM
    // reads the look; a prop not in use is asked for once more, then it is a warning.
    async function lookWithPropInUse(char: Character, options: AskOptions): Promise<string> {
        const look = await ask(options)
        const prop = propPictures ? undefined : pictureProp(char)
        if (!prop) return look
        const first = await askJson<{inUse: boolean; why: string}>(propInUsePrompt(look, prop, handsOf(char))).catch(() => undefined)
        if (!first || first.inUse) return look
        log.warn(`${char.id}: the look shows the ${prop} not in use (${first.why}) - asking once more`)
        const again = await ask({
            ...options,
            input: `${options.input}\n\nThe last look you wrote shows the ${prop} not in use: ${first.why} Show it held in the position it has while it is used, with each of the ${handsOf(char)} where it is at work on it.`,
        })
        const second = await askJson<{inUse: boolean; why: string}>(propInUsePrompt(again, prop, handsOf(char))).catch(() => undefined)
        if (second && !second.inUse)
            log.warn(
                `${char.id}: the look still shows the ${prop} not in use (${second.why}) - the clips will keep that pose; edit the look in ${project.file} by hand, then --redo=characterLooks`,
            )
        return again
    }

    const characterLooks = await project.step('characterLooks', '7 · CRAFTING CHARACTER LOOKS', async () => {
        const looks: Record<string, string> = {}
        for (const [i, char] of cast.characters.entries()) {
            log.step(`Character ${i + 1}/${cast.characters.length}`, styles.name(char.id))
            const fromLibrary = casted('character', char.id)
            if (fromLibrary) {
                looks[char.id] = fromLibrary.description
                continue
            }
            const otherLooks = cast.characters.filter(c => c.id !== char.id && looks[c.id]).map(c => ({name: c.name, look: looks[c.id]!}))
            const options = characterLookPrompt(lookBrief, asDrawn(char, propPictures), otherLooks)
            looks[char.id] = await project.each('characterLooks', char.id, options, () => lookWithPropInUse(char, options))
        }
        return looks
    })
    castTexts('characterLooks', 'character', characterLooks, asset => asset.description)
    for (const [id, look] of Object.entries(characterLooks)) log.box(id, look)
    // a prop the look does not name is not in the reference picture - the clips would show the model's own idea of it
    for (const c of cast.characters) {
        const shown = propPictures ? undefined : pictureProp(c)
        if (shown && !casted('character', c.id) && characterLooks[c.id] && propMissing(characterLooks[c.id]!, shown))
            log.warn(`${c.id}: the look does not show its prop "${shown}" - redo characterLooks, or edit the look in ${project.file} by hand`)
    }

    ////////// DESCRIBING THE CHARACTERS - the look prompt without the reference sheet (pose, grey background, studio light)
    // one call per character, independent of each other - as many at once as llm.parallel allows
    const characterDescriptions = await perEntity(
        'characterDescriptions',
        '7b · DESCRIBING THE CHARACTERS FOR THE CLIPS',
        'character',
        asset => asset.description,
        char => {
            const options = characterDescriptionPrompt(characterLooks[char.id] ?? '')
            return project.each('characterDescriptions', char.id, options, () => ask(options))
        },
    )
    for (const [id, description] of Object.entries(characterDescriptions)) log.box(id, description)

    ////////// CRAFTING LOCATION LOOKS
    // unlike the characters, the places are not contrasted with each other - asked at once, up to llm.parallel
    const locationLooks = await perEntity(
        'locationLooks',
        '8 · CRAFTING LOCATION LOOKS',
        'location',
        asset => asset.description,
        location => {
            const {kept, standing} = propsOfPlace(cast.characters, location.id, propPictures)
            const options = locationLookPrompt(lookBrief, storySummary, location.name, kept, standing)
            return project.each('locationLooks', location.id, options, () => ask(options))
        },
    )
    for (const [id, look] of Object.entries(locationLooks)) log.box(id, look)

    ////////// DESCRIBING THE LOCATIONS - the look prompt without the establishing shot (camera, "empty", medium)
    const locationDescriptions = await perEntity(
        'locationDescriptions',
        '8b · DESCRIBING THE LOCATIONS FOR THE CLIPS',
        'location',
        asset => asset.description,
        location => {
            const options = locationDescriptionPrompt(locationLooks[location.id] ?? '')
            return project.each('locationDescriptions', location.id, options, () => ask(options))
        },
    )
    for (const [id, description] of Object.entries(locationDescriptions)) log.box(id, description)

    ////////// THE BACKGROUND OF EACH PLACE - the fixed features every shot with people in it keeps behind them
    const locationAnchors = await perEntity(
        'locationAnchors',
        '8c · NAMING THE BACKGROUND OF EACH PLACE',
        'location',
        asset => asset.anchors,
        async location => {
            const options = locationAnchorPrompt(locationDescriptions[location.id] ?? '')
            return (await project.each('locationAnchors', location.id, options, () => ask(options))).replace(/^["']|["'.\s]+$/g, '')
        },
    )
    for (const [id, anchor] of Object.entries(locationAnchors)) log.step(id, styles.muted(anchor))

    ////////// THE LAYOUT OF EACH PLACE - one floor plan per place: every beat there is staged in it, not in a room of its own
    const locationLayouts = await perEntity<LocationLayout>(
        'locationLayouts',
        '8d · LAYING OUT EACH PLACE',
        'location',
        asset => asset.layout,
        async location => {
            const options = locationLayoutPrompt(
                location.name,
                locationLooks[location.id] ?? '',
                locationDescriptions[location.id] ?? '',
                performersOf(cast.characters, location.id),
            )
            // an answer that cannot be read is asked once more; then the place has no layout and its beats write their own
            // staging, as before - a broken answer for one place does not stop the run
            let answer: {layout?: unknown; views?: unknown[]; set?: {stage?: unknown; spots?: {name?: unknown; spot?: unknown}[]}} | undefined
            for (let attempt = 1; attempt <= 2 && !answer; attempt++) {
                answer = await project
                    .each('locationLayouts', location.id, options, () => askJson<NonNullable<typeof answer>>(options))
                    .catch((e: unknown) => {
                        log.warn(
                            `${location.id}: the layout is unusable (${messageOf(e)})${attempt < 2 ? ' - asking again' : ' - its beats stage the place themselves'}`,
                        )
                        return undefined
                    })
            }
            if (!answer) return undefined
            const set = setOf(answer.set, cast.characters)
            return {layout: textOf(answer.layout).trim(), views: LOCATION_VIEWS.map((_, n) => textOf(answer!.views?.[n]).trim()), ...(set ? {set} : {})}
        },
    )
    if (castChanged.size) {
        await project.save()
        // a changed casting.json after the plan was made: what was made from the old texts is named, not redone (it costs)
        // every step a library asset stands in for counts as changed: redoing one of them would only ask the LLM for what the library gives
        const redo = redoAfter(
            ['characterLooks', 'characterDescriptions', 'locationLooks', 'locationDescriptions', 'locationAnchors', 'locationLayouts'],
            project.data,
        )
        if (redo.length)
            log.warn(
                `${CASTING_FILE} changed since the plan was made - it is made with the library's texts again by: bun index.ts ${project.id} --redo=${redo.join(',')}`,
            )
    }
    for (const [id, {layout, views}] of Object.entries(locationLayouts)) log.box(`${id} · layout`, [layout, ...views.map((v, n) => `${n}: ${v}`)].join('\n'))
    return {lookBrief, characterLooks, characterDescriptions, locationLooks, locationDescriptions, locationAnchors, locationLayouts}
}

/**
 * Who has a fixed place in a place of a music video (#1119): the players of the cast (for where the band plays), above all one
 * whose instrument stands there (a drum kit), and a crowd. A story without a band or a crowd has nobody - the layout is as before.
 */
export function performersOf(characters: Character[], locationId: string): Performer[] {
    const standing = (c: Character) => c.propCarried === false && !!c.prop && (!c.propPlace || c.propPlace === locationId)
    return characters
        .filter(c => c.propStem || standing(c) || c.isGroup)
        .map(c => ({
            name: c.name,
            role: c.role,
            ...(c.prop ? {prop: c.prop} : {}),
            ...(standing(c) ? {standing: true} : {}),
            ...(c.isGroup ? {group: true} : {}),
        }))
}

/** The set of an answer, by character id - a spot of a name that is not in the cast is left out; no stage, no set. */
export function setOf(answer: {stage?: unknown; spots?: {name?: unknown; spot?: unknown}[]} | undefined, characters: Character[]): LocationSet | undefined {
    const stage = textOf(answer?.stage).trim()
    if (!stage) return undefined
    const spots: Record<string, string> = {}
    for (const entry of Array.isArray(answer?.spots) ? answer.spots : []) {
        const id = characters.find(c => c.name === textOf(entry?.name).trim())?.id
        const spot = textOf(entry?.spot).trim()
        if (id && spot) spots[id] = spot
    }
    return {stage, spots}
}
