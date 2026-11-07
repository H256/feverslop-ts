import type {Project} from '../project.ts';
import {buildClipRequests} from '../compose.ts';
import {defaults, languageName, type ProjectConfig} from '../config.ts';
import {splitFightSlots} from '../music.ts';
import {asBeatShots} from '../shot-plan.ts';
import type {DirectionShot} from '../../shared/direction.ts';

/** Actual song ranges, including downbeats, word-safe cuts and fight splits. No IO or generation. */
export function musicShots(data: Project, options: Partial<ProjectConfig> = {}): DirectionShot[] {
    const windows = new Map<string, {start: number, end: number}[]>();
    const config = {...defaults, ...options};
    if (data.music && data.timeline && data.mapping && data.beats && data.cast) {
        const timeline = config.fightClips
            ? splitFightSlots(data.timeline.slots, data.mapping, data.beats, data.cast.characters, data.music)
            : {slots: data.timeline.slots, mapping: data.mapping};
        const clips = buildClipRequests({
            ...timeline, beats: data.beats, characters: data.cast.characters, locations: data.cast.locations,
            characterDescriptions: data.characterDescriptions ?? {}, characterDescriptionVariants: data.characterDescriptionVariants,
            locationDescriptions: data.locationDescriptions ?? {}, locationAnchors: data.locationAnchors,
            lookBrief: data.lookBrief ?? '', music: data.music, language: languageName(config.lyricsLanguage) ?? config.lyricsLanguage,
            singing: data.singing, lyricsTiming: data.lyricsTiming, shotMoments: data.shotMoments,
            propActivity: data.propActivity, stemsAvailable: !!data.stems, continuity: config.continuity,
            pinStartFrame: config.pinStartFrame || config.contextFrames > 0, contextFrames: config.contextFrames,
            locationView: typeof config.locationView === 'number' ? config.locationView : undefined, shotViews: data.shotViews,
        });
        for (const clip of clips) {
            const slot = timeline.slots.find(s => s.id === clip.id)!;
            const spans = clip.shots.map((shot, n) => ({start: slot.start + shot.at, end: slot.start + (clip.shots[n + 1]?.at ?? slot.end - slot.start)}));
            windows.set(clip.beatId, [...windows.get(clip.beatId) ?? [], ...spans]);
        }
    }
    return (data.beats ?? []).flatMap(beat => {
        const plan = data.shotMoments?.[beat.id];
        if (!plan) return [];
        return asBeatShots(plan).shots.map((shot, i) => ({
            id: `${beat.id}:shot${i + 1}`, groupId: beat.id,
            characters: shot.characters ?? beat.characterIds, ...windows.get(beat.id)?.[i],
            data: structuredClone(shot) as Record<string, unknown>,
        }));
    });
}

export function putMusicShot(data: Project, id: string, shot: Record<string, unknown>) {
    const match = /^(.*):shot([1-9]\d*)$/.exec(id);
    const value = match && data.shotMoments?.[match[1]!];
    const plan = value && asBeatShots(value);
    const index = Number(match?.[2]) - 1;
    if (!plan?.shots[index]) throw Error(`missing shot ${id}`);
    data.shotMoments![match![1]!] = plan;
    plan.shots[index] = shot as typeof plan.shots[number];
}

export const musicContext = (data: Project) => ({
    story: data.story, beats: data.beats, cast: data.cast, lookBrief: data.lookBrief,
    characterDescriptions: data.characterDescriptions, locationDescriptions: data.locationDescriptions,
    characterLooks: data.characterLooks, locationLooks: data.locationLooks, locationLayouts: data.locationLayouts,
    propActivity: data.propActivity, music: data.music, blocking: data.blocking, timeline: data.timeline,
    mapping: data.mapping, shotMoments: data.shotMoments, singing: data.singing, lyricsTiming: data.lyricsTiming,
});
