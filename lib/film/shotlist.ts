import {dialogueOf, type FilmClip} from "./coverage.ts";
import type {FilmCast, SceneCoverage, Screenplay} from "./types.ts";

/**
 * The plan of the film as a page to read: scene by scene the staging, the shots with who is in them, what happens and what is said,
 * and the clip each shot ends up in - to see at a glance where a scene has too many shots, or one that repeats another. To change a
 * shot, edit `coverage` in project.json and run again.
 */
export function shotlistMarkdown({screenplay, cast, coverage, clips}: { screenplay: Screenplay, cast: FilmCast, coverage: SceneCoverage[], clips: FilmClip[] }) {
    const name = (id: string) => cast.characters.find(c => c.id === id)?.name ?? id
    const out = [`# ${screenplay.title} - shot list`, '', `${clips.length} clips, ${clips.reduce((sum, c) => sum + c.shots.length, 0)} shots, ${(clips.reduce((sum, c) => sum + c.frames, 0) / 24).toFixed(1)} s. Edit the shots in \`project.json\` (\`coverage\`) and run again.`]
    for (const scene of screenplay.scenes) {
        const planned = coverage.find(c => c.sceneId === scene.id)
        const sceneClips = clips.filter(c => c.sceneId === scene.id)
        const seconds = sceneClips.reduce((sum, c) => sum + c.seconds, 0)
        const dialogue = dialogueOf(scene)
        out.push('', `## ${scene.id} · ${scene.setting}. ${scene.location} - ${scene.time} · ${sceneClips.reduce((sum, c) => sum + c.shots.length, 0)} shots, ${seconds.toFixed(1)} s`)
        if (planned?.staging) out.push('', `**Staging:** ${planned.staging}`)
        if (planned?.soundscape) out.push('', `**Sound:** ${planned.soundscape}`)
        let n = 0
        for (const clip of sceneClips) {
            out.push('', `### ${clip.id} · ${clip.seconds.toFixed(1)} s${clip.startsFrom ? ` · goes on from ${clip.startsFrom}` : ''}`)
            for (const shot of clip.shots) {
                out.push('', `**${scene.id}.${++n}** · ${shot.seconds.toFixed(1)} s · ${shot.framing}${shot.continues ? ' · same take' : ''}`, `- who: ${shot.characters.length ? shot.characters.map(name).join(', ') : 'nobody'}`, `- ${shot.action}`)
                for (const [k, l] of shot.lines.entries()) {
                    const line = dialogue[l]
                    if (line?.type === 'dialogue') out.push(`- says${line.kind === 'voiceover' ? ' (voice-over)' : line.kind === 'offscreen' ? ' (off-screen)' : ''}${shot.texts?.[k] ? ' (part of a long line)' : ''}: **${line.speaker}** "${shot.texts?.[k] ?? line.text}"`)
                }
            }
        }
    }
    return `${out.join('\n')}\n`
}
