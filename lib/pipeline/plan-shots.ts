import {countShotsPerBeat, propActivityPerBeat, singingPerBeat} from '../compose.ts'
import {applyDirectionOverlay, directionNotTaken, directionPlanNotes, dropStaleEdits} from '../direction/service.ts'
import {directionViewCache} from '../direction/views.ts'
import {formatTime} from '../frames.ts'
import {ask, askJson, llmMap} from '../llm.ts'
import {log, styles} from '../log.ts'
import {mapBeatsToSlots, splitFightSlots} from '../music.ts'
import {playingCases, playingIssues} from '../playing-check.ts'
import {type BeatShots, type Blocking} from '../project.ts'
import {resolveUnknownTokens} from '../refs.ts'
import {LOCATION_VIEWS} from '../sequenceSheet.ts'
import {asBeatShots, type Issue, parseShotLines, readBeatPlan} from '../shot-plan.ts'
import {blockingPrompt, filmableRules, type PlanContext, plannerCalls, planPrompt} from '../shot-planner.ts'
import type {ProjectConfig} from '../config.ts'
import type {Character, Location, LocationLayout, LyricsTiming, MusicMap, ProjectStore, PropStem, Singing, StoryBeat, Timeline} from '../project.ts'
import {energyBar} from './energy-bar.ts'

// The shot planning of a music video (index.ts steps 11-11c, #841): the story matched to the clips of the song, the beats blocked one
// after the other, the shots of every beat planned from its blocking, the director's edits kept, and the view of the place per shot.
// The steps are the project's (project.step): cached, redone by --redo, the same as when they were part of index.ts.

/** What the shots are planned from: the run, the song and its timing, the story, the cast and the look as the steps before made them. */
export type ShotRun = {
    project: ProjectStore
    config: ProjectConfig
    args: {'legacy-moments': boolean}
    render: Set<string>
    music: MusicMap
    timeline: Timeline
    lyricsTiming: LyricsTiming | undefined
    propActivity: Partial<Record<PropStem, {start: number; end: number}[]>> | undefined
    singing: Singing | undefined
    beats: StoryBeat[]
    cast: {characters: Character[]; locations: Location[]}
    characterDescriptions: Record<string, string>
    locationDescriptions: Record<string, string>
    locationLayouts: Record<string, LocationLayout>
    lookBrief: string
}

export async function planShots(run: ShotRun) {
    const {
        project,
        config,
        args,
        render,
        music,
        timeline,
        lyricsTiming,
        propActivity,
        singing,
        beats,
        cast,
        characterDescriptions,
        locationDescriptions,
        locationLayouts,
        lookBrief,
    } = run
    ////////// MATCHING THE STORY TO THE MUSIC
    const storyMapping = await project.step('mapping', '11 · MATCHING THE STORY TO THE MUSIC', async () => mapBeatsToSlots(beats, timeline.slots))
    // config.fightClips: the clips of a fight beat are cut into one-bar pieces (not cached - derived from the timeline and the mapping)
    const {slots: clipSlots, mapping} = config.fightClips
        ? splitFightSlots(timeline.slots, storyMapping, beats, cast.characters, music)
        : {slots: timeline.slots, mapping: storyMapping}
    if (config.fightClips && clipSlots.length !== timeline.slots.length) {
        const fightBeats = new Set(clipSlots.filter(s => s.micro).map(s => mapping[s.index]!.beatId))
        log.step(
            'Fight clips',
            styles.muted(
                `${clipSlots.length} clips instead of ${timeline.slots.length}: the fight beats ${[...fightBeats].join(', ')} are cut into one-bar pieces`,
            ),
        )
    }
    const beatById = new Map(beats.map(b => [b.id, b]))
    for (const slot of clipSlots) {
        const beat = beatById.get(mapping[slot.index]!.beatId)!
        log.line(
            `   ${styles.muted(`${formatTime(slot.start)}`)} ${slot.section.padEnd(12)} ${energyBar(slot.energy)} ${styles.name(beat.id)} ${styles.muted(energyBar(beat.intensity))}`,
        )
    }

    ////////// REFINING THE MOMENTS TO ONE PER SHOT
    // beat.moments (2-6 sentences) is written before the beat's shot count is known, so a beat can end up covering far
    // more shots than it has moments for - the old code just reused/repeated moments across shots (--legacy-moments
    // still does). This step asks for exactly one distinct, progressing action per shot instead.
    const beatProps = propActivity ? propActivityPerBeat({slots: clipSlots, mapping, beats, characters: cast.characters}, propActivity) : undefined
    const beatSinging = singingPerBeat({slots: clipSlots, mapping, beats, singing, lyricsTiming})
    // One call per beat does not fit on a long song: thinking and ~100 shot sentences share max_output_tokens (see #91). So the
    // beats are blocked first, one after the other - the floor plan, where everybody starts and ends, each beat from the end
    // of the one before - and then the shots of every beat are written from its blocking, the beats at once (steps 11a and 11b).
    // a beat whose answer stayed unusable has no plan and plays on its beat moments: the next run plans just those beats
    // again, the ones already planned stay as they are
    const plannedBefore = args['legacy-moments']
        ? undefined
        : (() => {
              const before = project.data.shotMoments
              if (!before || beats.every(b => before[b.id] !== undefined)) return undefined
              return Object.fromEntries(Object.entries(before).filter(([, plan]) => !Array.isArray(plan))) as Record<string, BeatShots>
          })()
    // the views of the place per shot of the beats that stay planned: step 11c asks only for the others
    let viewsKept: Record<string, number[]> | undefined
    if (plannedBefore) {
        const missing = beats.filter(b => !plannedBefore[b.id]).map(b => b.id)
        log.step('Planning again', styles.muted(`${missing.join(', ')} - no plan of their own yet, the other ${beats.length - missing.length} stay`))
        delete project.data.shotMoments
        // the beats planned now have no view yet - the views of the others stay (see shotViews), in project.json too: a run that
        // stops before step 11c (a failure, Ctrl+C) keeps them for the next one, which then asks only for the beats planned now
        const views = project.data.shotViews
        if (views) {
            viewsKept = Object.fromEntries(Object.entries(views).filter(([beatId]) => plannedBefore[beatId]))
            project.data.shotViews = viewsKept
        }
    }
    const shotCounts = countShotsPerBeat({slots: clipSlots, mapping, beats})
    // the director's edits (direction.json): a plan made again keeps to them - the code enforces them on it as well (applyDirectionOverlay)
    const directionNotes = directionPlanNotes({id: project.id, dir: project.dir, kind: 'music'}, project.data)
    const planContext: PlanContext = {
        characters: cast.characters,
        locations: cast.locations,
        characterDescriptions,
        locationDescriptions,
        locationLayouts,
        continuity: config.continuity,
        slots: clipSlots,
        mapping,
        shotCounts,
        beatProps,
        beatSinging,
        filmLook: lookBrief,
        ...(Object.keys(directionNotes).length ? {direction: directionNotes} : {}),
    }
    // The blocking, beat after beat - short calls: the floor plan, where everybody starts and ends. Each beat starts where the
    // one before it ends, so this is the only part that has to go in order. A step of its own: --redo=shotMoments plans the shots
    // again on the same floor plans. A beat whose blocking stays unusable has no entry and plans its staging and ends itself.
    // Made only when the shots are planned - shots planned before this step existed stay without one
    const blockings =
        args['legacy-moments'] || project.data.shotMoments !== undefined
            ? undefined
            : await project.step('blocking', '11a · BLOCKING THE BEATS', async () => {
                  const blockings: Record<string, Blocking> = {}
                  for (const [i, beat] of beats.entries()) {
                      const prev = beats[i - 1]
                      const before =
                          prev && blockings[prev.id] ? {beatId: prev.id, staging: blockings[prev.id]!.staging, ends: blockings[prev.id]!.ends} : undefined
                      log.step(`Blocking ${i + 1}/${beats.length}`, styles.name(beat.id))
                      for (let attempt = 1; attempt <= 2 && !blockings[beat.id]; attempt++) {
                          const answer = parseShotLines(await ask({...blockingPrompt(planContext, beat, before, beats[i + 1]), label: `${beat.id} · blocking`}))
                          const texts = [answer.staging ?? '', ...Object.values(answer.starts), ...Object.values(answer.ends)]
                          const {texts: fixed} = await resolveUnknownTokens(texts, cast.characters)
                          let next = 0
                          const blocking: Blocking = {
                              staging: fixed[next++]!,
                              starts: Object.fromEntries(Object.keys(answer.starts).map(who => [who, fixed[next++]!])),
                              ends: Object.fromEntries(Object.keys(answer.ends).map(who => [who, fixed[next++]!])),
                          }
                          // a beat without people (a place alone) has nobody to start or end anywhere
                          const complete = blocking.staging && (!beat.characterIds.length || Object.keys(blocking.ends).length)
                          if (complete) blockings[beat.id] = blocking
                          else
                              log.warn(
                                  `${beat.id}: the blocking has no ${blocking.staging ? 'ends' : 'staging'}${attempt < 2 ? ' - asking again' : ' - the shot planning writes them itself'}`,
                              )
                      }
                  }
                  return blockings
              })
    const shotMoments = args['legacy-moments']
        ? undefined
        : await project.step('shotMoments', '11b · REFINING MOMENTS PER SHOT', async () => {
              type Beat = (typeof beats)[number]
              const MOMENT_SHOTS_PER_CALL = 4
              // the shots of a beat, MOMENT_SHOTS_PER_CALL at a time: each call sees the staging and the shots written so far.
              // A call without a single shot in its answer is asked once more; the beat is then short of those shots (a missing
              // shot repeats the last one, see readBeatPlan) instead of falling back to its beat moments as a whole.
              // Asked again (`before`: the first answer and what was wrong with it), only the calls whose shots have a problem are
              // made again, each with its own problems; the other calls keep their first answer. A problem of the whole beat (its
              // shot count) asks every call again - the shots of the calls after it would no longer line up.
              type RawBeat = {staging?: string; ends?: Record<string, string>; shots: Record<string, unknown>[]}
              const askBlock = async (
                  block: Beat[],
                  finished: {beat: Beat; plan: BeatShots} | undefined,
                  after: Beat | undefined,
                  before?: {moments: Record<string, RawBeat>; issues: Record<string, Issue[]>},
                  blocking?: Blocking,
              ) => {
                  const moments: Record<string, RawBeat> = {}
                  for (const beat of block) {
                      const total = shotCounts[beat.id] ?? 1
                      const raw: RawBeat = {shots: []}
                      const previous = before?.moments[beat.id]
                      const calls = plannerCalls(
                          total,
                          MOMENT_SHOTS_PER_CALL,
                          previous ? {issues: before!.issues[beat.id] ?? [], previousShots: previous.shots.length} : undefined,
                      )
                      for (const {from, to, keep, problems: own} of calls) {
                          if (keep) {
                              if (from === 0) raw.staging = blocking?.staging ?? previous!.staging
                              raw.shots.push(...previous!.shots.slice(from, to))
                              if (to === total) raw.ends = blocking?.ends ?? previous!.ends
                              continue
                          }
                          let chunk: ReturnType<typeof parseShotLines> | undefined
                          // the beats run at once - the label says which beat and which shots a line of the log is about
                          const label = `${beat.id} · shots ${from + 1}-${to} of ${total}`
                          for (let attempt = 1; attempt <= 2 && !chunk; attempt++) {
                              log.step('Shots', styles.name(label))
                              const parsed = parseShotLines(
                                  await ask({
                                      ...planPrompt(planContext, [beat], from === 0 ? finished : undefined, after, own, {
                                          from,
                                          to,
                                          total,
                                          written: raw.shots,
                                          staging: raw.staging,
                                          blocking,
                                      }),
                                      label,
                                  }),
                              )
                              if (parsed.shots.length) chunk = parsed
                              else
                                  log.warn(
                                      `${beat.id}, shots ${from + 1}-${to}: no shot in the answer${attempt < 2 ? ' - asking again' : ' - the beat is short of them'}`,
                                  )
                          }
                          if (!chunk) break
                          // with a blocking, the staging and the ends are the blocking's
                          if (from === 0) raw.staging = blocking?.staging ?? chunk.staging
                          raw.shots.push(...chunk.shots.slice(0, to - from))
                          if (to === total) raw.ends = blocking?.ends ?? chunk.ends
                      }
                      // tokens of nobody of the cast ({Aldric} for "Aldric Thorne") are mapped by one short call - cheaper than asking the
                      // planner again, and nothing reads the words
                      const slots: {get: () => unknown; set: (v: string) => void}[] = [
                          {get: () => raw.staging, set: (v: string) => (raw.staging = v)},
                          ...Object.keys(raw.ends ?? {}).map(who => ({get: () => raw.ends![who], set: (v: string) => (raw.ends![who] = v)})),
                          ...raw.shots.flatMap(shot => [
                              ...['action', 'view', 'camera', 'rest'].map(key => ({get: () => shot[key], set: (v: string) => (shot[key] = v)})),
                              ...Object.values((shot.people ?? {}) as Record<string, Record<string, unknown>>).flatMap(person =>
                                  ['state', 'frame', 'motion'].map(key => ({get: () => person[key], set: (v: string) => (person[key] = v)})),
                              ),
                          ]),
                      ].filter(slot => typeof slot.get() === 'string')
                      const {texts: fixed, mapped} = await resolveUnknownTokens(
                          slots.map(slot => slot.get() as string),
                          cast.characters,
                      )
                      if (Object.keys(mapped).length) {
                          log.line(
                              styles.muted(
                                  `        · ${beat.id}, names: ${Object.entries(mapped)
                                      .map(([token, name]) => `{${token}} → ${name ? `{${name}}` : 'nobody of the cast'}`)
                                      .join(', ')}`,
                              ),
                          )
                          slots.forEach((slot, n) => slot.set(fixed[n]!))
                      }
                      moments[beat.id] = raw
                  }
                  return {moments}
              }

              const result: Record<string, BeatShots> = {...plannedBefore}
              // the step runs only when the blocking step above ran or was cached
              const blocked = blockings ?? {}

              // The shots of every beat, from its own blocking (step 11a) - the beats do not wait for each other: as many at once as
              // llm.parallel allows. Each beat's plan is kept in project.json the moment it is there: a run stopped after beat 11 of
              // 14 lost all eleven (#340). Its key is the first question the planner gets for the beat - the beat, its blocking, the
              // handover, the film look, its music, the cast and the place - so a beat built on anything else is planned again. After
              // a stop, a run without --redo goes on from the kept beats; --redo=shotMoments drops them.
              const planBeat = async (beat: Beat) => {
                  const blocking = blocked[beat.id]
                  const after = beats[beats.indexOf(beat) + 1]
                  // without a blocking the beat goes on from the plan of the beat before, if that one is already there
                  const prev = beats[beats.indexOf(beat) - 1]
                  const handover = !blocking && prev && result[prev.id] ? {beat: prev, plan: result[prev.id]!} : undefined
                  const total = shotCounts[beat.id] ?? 1
                  const {instructions, input} = planPrompt(planContext, [beat], handover, after, [], {
                      from: 0,
                      to: Math.min(total, MOMENT_SHOTS_PER_CALL),
                      total,
                      written: [],
                      blocking,
                  })
                  const plan = await project.eachFound('shotMoments', beat.id, {instructions, input}, () => planShots(beat, blocking, after, handover))
                  if (plan) result[beat.id] = plan // a beat without a plan falls back to the legacy spread
              }
              const planShots = async (
                  beat: Beat,
                  blocking: Blocking | undefined,
                  after: Beat | undefined,
                  handover: {beat: Beat; plan: BeatShots} | undefined,
              ): Promise<BeatShots | undefined> => {
                  const block = [beat]
                  // what can be counted is read by the code; whether a heard player's hand phrase plays at all is read by one short
                  // call per beat (lib/playing-check.ts) - its "no" is a problem of that shot like the others
                  const read = (answer: Awaited<ReturnType<typeof askBlock>>) =>
                      Promise.all(
                          block.map(async beat => {
                              const read = readBeatPlan(
                                  answer.moments?.[beat.id],
                                  beat,
                                  cast.characters,
                                  shotCounts[beat.id] ?? 1,
                                  beatSinging[beat.id],
                                  beatProps?.[beat.id],
                              )
                              const idle = read
                                  ? await playingIssues(playingCases(read.plan.shots, beatProps?.[beat.id], cast.characters)).catch((e: unknown) => {
                                        log.warn(
                                            `${beat.id}: the check of the hand phrases failed (${e instanceof Error ? e.message : e}) - they stay unchecked`,
                                        )
                                        return []
                                    })
                                  : []
                              if (read)
                                  for (const issue of idle) {
                                      read.issues.push(issue)
                                      read.problems.push(issue.message)
                                  }
                              return {beat, read}
                          }),
                      )
                  // a long answer now and then cannot be read at all: asked again, twice at most, then the beat falls back to the
                  // legacy spread (a warning says so) instead of the run failing after the beats that worked
                  let first: Awaited<ReturnType<typeof read>> | undefined
                  let firstAnswer: Awaited<ReturnType<typeof askBlock>> | undefined
                  for (let attempt = 1; attempt <= 3 && !first; attempt++) {
                      try {
                          firstAnswer = await askBlock(block, handover, after, undefined, blocking)
                          first = await read(firstAnswer)
                      } catch (e) {
                          log.warn(
                              `the answer for ${beat.id} is unusable (${e instanceof Error ? e.message : e})${attempt < 3 ? ' - asking again' : ' - it keeps its beat moments'}`,
                          )
                      }
                  }
                  if (!first) return undefined
                  let reads = first
                  // what can be counted (a name that is not in the cast, a singing shot without a singer, a shot that names someone it does not show) is asked once more
                  const problems = reads.flatMap(r => (r.read?.problems ?? []).map(p => `${r.beat.id}, ${p}`))
                  if (problems.length) {
                      log.warn(`${problems.length} problem(s) in the staged shots of ${beat.id} - asking once more`)
                      for (const p of problems) log.line(styles.muted(`        · ${p}`))
                      const issues = Object.fromEntries(
                          reads.map(r => [r.beat.id, (r.read?.issues ?? []).map(i => ({...i, message: `${r.beat.id}, ${i.message}`}))]),
                      )
                      const again = await askBlock(block, handover, after, {moments: firstAnswer!.moments, issues}, blocking).then(read, (e: unknown) => {
                          log.warn(`the second answer is unusable (${e instanceof Error ? e.message : e}) - the first one stays`)
                          return reads
                      })
                      reads = reads.map((r, n) => (again[n]!.read && (!r.read || again[n]!.read!.problems.length <= r.read.problems.length) ? again[n]! : r))
                      for (const r of reads) for (const p of r.read?.problems ?? []) log.warn(`${r.beat.id}, ${p}`)
                  }
                  // what the code repaired or only noted costs no further call - a line in the log, nothing else
                  for (const r of reads) for (const note of r.read?.notes ?? []) log.line(styles.muted(`        · ${r.beat.id}, ${note}`))
                  return reads[0]?.read?.plan
              }
              // the beats with a blocking at once; one without goes on from the plan before it, so those wait for theirs
              await llmMap(
                  beats.filter(b => !result[b.id] && blocked[b.id]),
                  planBeat,
              )
              for (const beat of beats.filter(b => !result[b.id] && !blocked[b.id])) await planBeat(beat)
              // the model keeps writing a blank oval for a photograph's missing face or a "blade-shaped object" for a name, whatever
              // the prompt says - those moments get one rewrite
              // the planner flags them itself ("risky") - no word list decides what counts
              const risky = Object.entries(result).flatMap(([beatId, plan]) =>
                  plan.shots.flatMap((shot, j) => (shot.risky ? [{beatId, j, moment: shot.action}] : [])),
              )
              if (risky.length) {
                  log.warn(`${risky.length} shot moment(s) the planner flagged (blank face, stand-in object, readable text) - rewriting them`)
                  const rewritten = await askJson<{moments: string[]}>({
                      input: `Rewrite each of these music video shot descriptions so that it follows the rules below. Keep everything else exactly as it is: the same people, place, camera, action, emotions and singing - only remove what breaks a rule, by leaving it out or by showing the real action instead. Every name in braces ({Kara}) stays exactly as it is, in its braces.
    ${filmableRules}
    Answer only with JSON: {"moments": ["rewritten 1", "rewritten 2", ...]} - exactly ${risky.length} entries, in the same order.
    ---
    ${JSON.stringify(risky.map(r => r.moment))}`,
                      instructions: 'You are a music video director who corrects shot descriptions. Answer only with JSON.',
                      schema: {
                          type: 'object',
                          additionalProperties: false,
                          required: ['moments'],
                          properties: {moments: {type: 'array', minItems: risky.length, maxItems: risky.length, items: {type: 'string'}}},
                      },
                  })
                  if (rewritten.moments?.length === risky.length)
                      risky.forEach((r, k) => {
                          const {risky: _flag, ...shot} = result[r.beatId]!.shots[r.j]!
                          result[r.beatId]!.shots[r.j] = {...shot, action: String(rewritten.moments[k])}
                      })
                  else log.warn('the rewrite did not come back with one entry per moment - the moments stay as they are')
              }
              return result
          })
    if (shotMoments)
        for (const beat of beats) {
            const plan = shotMoments[beat.id] && asBeatShots(shotMoments[beat.id]!)
            if (!plan) continue
            log.line(`   ${styles.name(beat.id)} ${styles.muted(`${plan.shots.length} shots`)}`)
            if (plan.staging) log.line(styles.muted(`        staging: ${plan.staging}`))
            const nameOf = (id: string) => cast.characters.find(c => c.id === id)?.name ?? id
            for (const shot of plan.shots)
                log.line(styles.muted(`        · ${shot.characters?.length ? `[${shot.characters.map(nameOf).join(', ')}] ` : ''}${shot.action}`))
        }

    ////////// CHOOSING THE VIEW OF THE PLACE - only with "locationView": "auto"
    // The views are the frames the location sheets were composed of: without sequence sheets there are none and the picture is the plain one
    const locationView = config.sequenceSheets ? config.locationView : -1
    // The place's reference sheet shows it from five sides; a clip gets one of them as its picture. The planner knows where
    // the camera of a shot stands, so it chooses - the views change from scene to scene instead of one fixed background.
    // a beat without an entry (its answer failed, or it had no plan then) is asked again on the next run, the others stay
    // what the direction cannot apply does not stop the run (#801): edits made for shots planned again since are gone with those shots,
    // and instructions not taken yet are left out of the prompts - both said. Only a run that renders clips stops for instructions
    // not taken: it would render them without (it stops at the start already, see directionGate)
    const directionTarget = {id: project.id, dir: project.dir, kind: 'music' as const}
    for (const dropped of dropStaleEdits(directionTarget, project.data)) log.warn(`direction: dropped an edit made for a shot planned again since - ${dropped}`)
    const notTaken = render.has('videos') ? [] : directionNotTaken(directionTarget, project.data)
    if (notTaken.length)
        log.warn(
            `direction: the clip prompts are built without ${notTaken.length === 1 ? 'this instruction' : `these ${notTaken.length} instructions`} - preview and take them on the Direction page (bun run direction ${project.id} --preview):\n${notTaken.map(line => `  - ${line}`).join('\n')}`,
        )
    const directedPlan = applyDirectionOverlay(directionTarget, project.data, {allowPending: !render.has('videos')})
    const directedMoments = directedPlan.shotMoments
    const viewCache = directionViewCache(shotMoments, directedMoments, project.data.shotViews ?? viewsKept, project.data.shotViewPlans)
    const viewsBefore = viewCache.kept
    if (viewCache.invalidated) delete project.data.shotViews
    if (viewsBefore && shotMoments && beats.some(b => shotMoments[b.id] && viewsBefore[b.id]?.length !== asBeatShots(shotMoments[b.id]!).shots.length))
        delete project.data.shotViews
    const shotViews =
        shotMoments && locationView === 'auto'
            ? await project.step('shotViews', '11c · CHOOSING THE VIEW OF THE PLACE PER SHOT', async () => {
                  // the beats don't depend on each other here - asked at once, up to llm.parallel
                  const answers = await llmMap(beats, async (beat): Promise<number[] | undefined> => {
                      const plan = directedMoments?.[beat.id] && asBeatShots(directedMoments[beat.id]!)
                      if (!plan) return undefined
                      const kept = viewsBefore?.[beat.id]
                      if (kept?.length === plan.shots.length) return kept
                      const answer = await askJson<{views: unknown[]}>({
                          input: `A place is shown to the video model as a reference with five views of it. For every shot below choose the view the shot is in: the one that shows the part of the place the camera of the shot looks at, from the side it stands on. Different shots may be in different views; a shot that moves to another side of the place is in the view it starts in.
    views (number: what it shows):
    ${LOCATION_VIEWS.map((v, n) => `${n}: ${v}${locationLayouts[beat.locationId]?.views[n] ? ` - ${locationLayouts[beat.locationId]!.views[n]}` : ''}`).join('\n')}

    The place: ${plan.staging ?? beat.summary}
    shots:
    ${JSON.stringify(plan.shots.map((s, n) => ({shot: n, framing: s.framing, camera: s.camera, view: s.view, action: s.action})))}

    Answer only with JSON: {"views": [one number from 0 to ${LOCATION_VIEWS.length - 1} per shot, in order]} - exactly ${plan.shots.length} numbers.`,
                          instructions: 'You are a music video director who chooses the view of a place for each shot. Answer only with JSON.',
                          // a few numbers per beat: 18.6 min of thinking for the 14 beats of tides-of-eternal-flame, 27 s without it, the
                          // picks differing only where the camera of a shot sits between two views
                          reasoning: 'none',
                          schema: {
                              type: 'object',
                              additionalProperties: false,
                              required: ['views'],
                              properties: {
                                  views: {
                                      type: 'array',
                                      minItems: plan.shots.length,
                                      maxItems: plan.shots.length,
                                      items: {type: 'integer', minimum: 0, maximum: LOCATION_VIEWS.length - 1},
                                  },
                              },
                          },
                      }).catch((e: unknown) => {
                          log.warn(`${beat.id}: the answer for the views is unusable (${e instanceof Error ? e.message : e}) - its shots are in the first view`)
                          return undefined
                      })
                      // not stored: the beat is asked again on the next run instead of keeping the first view for good
                      if (!answer) return undefined
                      const views = plan.shots.map((_, n) => {
                          const v = Number(answer?.views?.[n])
                          return Number.isInteger(v) && v >= 0 && v < LOCATION_VIEWS.length ? v : 0
                      })
                      log.line(`   ${styles.name(beat.id)} ${styles.muted(`views ${views.join(', ')}`)}`)
                      return views
                  })
                  const result: Record<string, number[]> = {}
                  beats.forEach((beat, i) => {
                      if (answers[i]) result[beat.id] = answers[i]
                  })
                  return result
              })
            : undefined

    if (shotViews) {
        project.data.shotViewPlans = viewCache.keys
        await project.save()
    }
    return {clipSlots, mapping, locationView, directedPlan, shotViews}
}
