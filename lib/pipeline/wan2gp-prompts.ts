// The wan2gp prompts of a music video's clips (#1214): planned with the rest, before rendering, so the LLM can be shut down first.
// Only when the project names a wan2gp template (videoWorkflowWan2gp); each clip's answer is kept by the fingerprint of what it was
// asked, a rerun asks only for the clips whose prompt or pictures changed. Thinking is off: rewriting needs none, 12 s per clip.
import {join} from 'node:path'
import type {ClipRequest} from '../compose.ts'
import type {ProjectConfig} from '../config.ts'
import {ask} from '../llm.ts'
import {log, styles} from '../log.ts'
import {clipRequestsIn} from '../previous-output.ts'
import type {ProjectStore} from '../project.ts'
import {WAN2GP_PROMPT_RULES, writeWan2gpPrompt} from '../wan2gp-prompt.ts'

export async function planWan2gpPrompts(project: ProjectStore, config: ProjectConfig, clips: ClipRequest[], outputDir: string) {
    if (!config.videoWorkflowWan2gp) return
    log.section('12b · SHORT PROMPTS FOR WAN2GP')
    let missing = 0
    for (const clip of clips) {
        const input = {prompt: clip.prompt, pictures: clip.assets.pictures.map(p => [p.kind, p.name]), rules: WAN2GP_PROMPT_RULES}
        const prompt = await project.eachFound('wan2gpPrompts', clip.id, input, async () => {
            const result = await writeWan2gpPrompt(options => ask({...options, reasoning: 'none', temperature: 0.3}), clip)
            if ('problem' in result) {
                log.warn(`${clip.id}: no short wan2gp prompt - ${result.problem} It renders on wan2gp from its full prompt; the next run asks again`)
                return undefined
            }
            return result.prompt
        })
        if (prompt === undefined) {
            missing++
            continue
        }
        clip.wan2gpPrompt = prompt
        await Bun.write(join(clipRequestsIn(outputDir), `${clip.id}.json`), JSON.stringify(clip, null, 2))
    }
    log.step(
        'wan2gp',
        `${clips.length - missing} of ${clips.length} clips with a short prompt${missing ? styles.muted(` · ${missing} without, asked again next run`) : ''}`,
    )
}
