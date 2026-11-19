import type {CommandSchema} from './command-schema.ts'
import {filmCommand, planCommand} from './pipeline-commands.ts'

// What --help says beyond the usage line. No imports of the pipeline: help stays instant. The options of the two pipelines are
// those of their schema (lib/pipeline-commands.ts), in its order; lib/cli-help.test.ts checks every step is named here.
type Help = {options: [string, string][]; steps: [string, string][]; notes: string[]}

/** The options of a schema as rows of the help: --name=shown and what it does. */
const optionRows = (schema: CommandSchema): [string, string][] =>
    Object.entries(schema.options).map(([name, spec]) => [`--${name}${spec.kind === 'flag' ? '' : `=${'shown' in spec ? spec.shown : ''}`}`, spec.help])

/** What a run renders and what it leaves (#937) - the same note in both helps. */
const renderNote =
    'What --render renders is what is missing. A stale one - made from an older plan - stays as it is until --refresh=images,videos renders it again; --again renders the ones in --only once more, with a new seed. Nothing else is rendered: GPU time only for what is asked.'

export const commandHelp: Record<string, Help> = {
    direction: {
        options: [
            [
                '--add=TEXT --scope=SCOPE',
                'Scopes: global, character:ID, beat:ID (music), scene:ID (film), shot:ID, time:START-END (music song seconds). --character=ID intersects any scope.',
            ],
            ['--edit=ID --text=TEXT', 'Edit verbatim intent; --scope=SCOPE explicitly rebinds to the current plan.'],
            ['--remove=ID', 'Remove future intent, leaving accepted action intact.'],
            ['--json | --set=FILE', 'Round-trip {rules:[{id,text,scope,characterId?,binding?}]}. Omit binding only to explicitly rebind.'],
            ['--preview | --take | --drop', 'Ask the LLM for a structured proposal, accept a conflict-free current proposal, or discard it.'],
            ['--restore=VERSION', 'Restore an accepted plan version or baseline; retains rules and existing renders.'],
        ],
        steps: [],
        notes: [
            'Specificity: shot > beat/scene/time > character > global. Equal-priority contradictions and continuity conflicts block take.',
            'New source plans require review; scene/shot bindings never silently follow reused IDs.',
            'Take/restore do not render. Run the pipeline to rebuild requests, then selectively render stale clips.',
        ],
    },
    plan: {
        options: optionRows(planCommand),
        steps: [
            ['Song', 'songStyle, music, stems, instrumentStems, transcript, lyricsTiming, propActivity, shotActivity'],
            ['Story', 'story, summary, cast, props (propPictures), singing, beats'],
            [
                'Look',
                'lookBrief, characterLooks, characterDescriptions, characterLookVariants, characterDescriptionVariants, locationLooks, locationDescriptions, locationAnchors, locationLayouts',
            ],
            ['Cut', 'timeline, mapping'],
            ['Shot planning', 'blocking (floor plan per beat), shotMoments (the shots, keeps the blocking), shotViews'],
        ],
        notes: [
            'A run reuses finished steps and rendered files. After a stopped or failed run, repeat the command without --redo: it goes on where it stopped.',
            'See what a redo reaches first: bun index.ts <id> --redo=shotMoments --dry-run',
            renderNote,
        ],
    },
    film: {
        options: optionRows(filmCommand),
        steps: [
            ['Script', 'brief, outline, screenplay, scriptNotes, scriptFixes, subtitles'],
            ['Cast', 'cast, summary, props'],
            ['Look', 'lookBrief, characterLooks, characterDescriptions, locationLooks, locationDescriptions, locationViews'],
            ['Shot planning', 'coverage'],
        ],
        notes: [
            'A run reuses finished steps and rendered files. After a stopped or failed run, repeat the command without --redo: it goes on where it stopped.',
            'See what a redo reaches first: bun film.ts <id> --redo=coverage --dry-run',
            renderNote,
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
