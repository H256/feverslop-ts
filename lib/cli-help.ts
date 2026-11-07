// What --help says beyond the usage line, for the two commands with many options. No imports of the pipeline: help stays
// instant. lib/cli.test.ts checks that every option of index.ts and film.ts and every step is named here.
type Help = { options: [string, string][], steps: [string, string][], notes: string[] }

const rendering: [string, string][] = [
    ['--only=ID,ID', 'Only these clips or pictures (with --render=videos, final or images); try one before all - every clip is GPU time'],
    ['--again', 'Render the clips or pictures in --only once more with a new seed; the old version is kept. Needs --render=videos or images'],
    ['--new-anchor', 'With --render=images --again: a reference sheet gets a new anchor too - another person or place, not only other views'],
    ['--picture-prompt=FILE', 'With --render=images --only=ID --again: render this one picture from the words in FILE and keep it (pinned)'],
    ['--picture-anchor=FILE', 'With --render=images --only=ID --again: put your own picture in as the anchor of this one picture and draw its sheet from it; the old one is kept'],
    ['--picture-description=FILE', 'With --picture-anchor: what the clips and the sheet say of it, from FILE, into project.json'],
    ['--describe-picture', 'With --picture-anchor: the description read from your picture by the vision model (bun run setup vision)'],
    ['--preview', 'With --render=videos: cheap renders into previews/ (config.json "preview"), never a clip. With --render=final: a low-resolution video from them'],
    ['--retake=CLIP:PART', 'Render part of a clip again, between the frames around it: slot-007:3.2-5.0 in seconds, or slot-007:shot2. The old clip is kept'],
    ['--refresh=pictures,clips', 'Render again what was made from an older plan; the old files go to old/attempts/'],
    ['--strict', 'Refuse stale clips in the final video instead of only listing them'],
]
const planning: [string, string][] = [
    ['--review', 'Stop after each main step that was just generated: accept, edit, generate again or stop'],
    ['--until=STAGE', 'Plan up to story, cast or look and stop there; the next run goes on from it. --until=look --render=images renders the pictures of the cast and the places first'],
    ['--dry-run', 'Say what this command would redo and render, with an estimate where one is known; does nothing'],
]
const servers: [string, string][] = [
    ['--llm-url=URL', 'LLM server for this run, instead of the settings'],
    ['--llm-key=KEY', 'API key of that server'],
    ['--llm-model=MODEL', 'Model for this run'],
    ['--comfy=URL,URL', 'ComfyUI servers for this run'],
]
const redo = 'Generate these steps again, and every step built on them'

export const commandHelp: Record<string, Help> = {
    direction: {
        options: [['--add=TEXT --scope=SCOPE', 'Scopes: global, character:ID, beat:ID (music), scene:ID (film), shot:ID, time:START-END (music song seconds). --character=ID intersects any scope.'], ['--edit=ID --text=TEXT', 'Edit verbatim intent; --scope=SCOPE explicitly rebinds to the current plan.'], ['--remove=ID', 'Remove future intent, leaving accepted action intact.'], ['--json | --set=FILE', 'Round-trip {rules:[{id,text,scope,characterId?,binding?}]}. Omit binding only to explicitly rebind.'], ['--preview | --take | --drop', 'Ask the LLM for a structured proposal, accept a conflict-free current proposal, or discard it.'], ['--restore=VERSION', 'Restore an accepted plan version or baseline; retains rules and existing renders.']],
        steps: [],
        notes: ['Specificity: shot > beat/scene/time > character > global. Equal-priority contradictions and continuity conflicts block take.', 'New source plans require review; scene/shot bindings never silently follow reused IDs.', 'Take/restore do not render. Run the pipeline to rebuild requests, then selectively render stale clips.'],
    },
    plan: {
        options: [
            ['--redo=STEP,STEP', redo],
            ['--render=song,images,videos,final|all', 'Also render: the song, the pictures, the clips, the final video. all = images, videos, final'],
            ...rendering,
            ...planning,
            ['--show=STEP,clips', 'Print the details of these cached steps; clips = the clip prompts'],
            ['--export=mlt,openshot|all', 'Write a timeline for Shotcut/Kdenlive and/or OpenShot'],
            ['--gallery', 'Write gallery.html, an overview of the assets so far; runs nothing else'],
            ...servers,
            ['--llm-parallel=N', 'LLM calls at the same time'],
            ['--legacy-moments', 'Skip blocking and shotMoments, spread beat.moments across the shots the old way'],
            ['--debug-audio', 'Also cut one listenable wav per track and clip into output/audio'],
        ],
        steps: [
            ['Song', 'songStyle, music, stems, instrumentStems, transcript, lyricsTiming, propActivity'],
            ['Story', 'story, summary, cast, singing, beats'],
            ['Look', 'lookBrief, characterLooks, characterDescriptions, characterLookVariants, characterDescriptionVariants, locationLooks, locationDescriptions, locationAnchors, locationLayouts'],
            ['Cut', 'timeline, mapping'],
            ['Shot planning', 'blocking (floor plan per beat), shotMoments (the shots, keeps the blocking), shotViews'],
        ],
        notes: [
            'A run reuses finished steps and rendered files. After a stopped or failed run, repeat the command without --redo: it goes on where it stopped.',
            'See what a redo reaches first: bun index.ts <id> --redo=shotMoments --dry-run',
        ],
    },
    film: {
        options: [
            ['--redo=STEP,STEP', redo],
            ['--render=images,videos,final|all', 'Also render: the pictures, the clips, the film. all = all three'],
            ...rendering,
            ['--scenes=s6,s7', 'With --redo=coverage: plan only these scenes again; the other shots and their clips stay'],
            ['--fix-script', 'Repair a handed-in screenplay; by default its contradictions are only reported'],
            ['--allow-import-gaps', 'Go on when importing a screenplay lost a line, instead of stopping'],
            ...planning,
            ...servers,
        ],
        steps: [
            ['Script', 'brief, outline, screenplay, scriptNotes, scriptFixes, subtitles'],
            ['Cast', 'cast, summary, props'],
            ['Look', 'lookBrief, characterLooks, characterDescriptions, locationLooks, locationDescriptions, locationViews'],
            ['Shot planning', 'coverage'],
        ],
        notes: [
            'A run reuses finished steps and rendered files. After a stopped or failed run, repeat the command without --redo: it goes on where it stopped.',
            'See what a redo reaches first: bun film.ts <id> --redo=coverage --dry-run',
        ],
    },
}

const list = (rows: [string, string][]) => {
    const width = Math.max(...rows.map(([name]) => name.length)) + 2
    return rows.map(([name, text]) => `  ${name.padEnd(width)}${text}`).join('\n')
}

/** The part of --help between the usage line and the common options, empty for a command without one. */
export function helpDetails(command: string) {
    const help = commandHelp[command]
    return help ? `\n\nOptions:\n${list(help.options)}${help.steps.length ? `\n\nSteps for --redo:\n${list(help.steps)}` : ''}\n\n${help.notes.join('\n')}` : ''
}
