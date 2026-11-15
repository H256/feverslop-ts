import type {CommandSchema} from './command-schema.ts'

// The options of `bun run lipsync` (#1016), written down once like lib/refinish-command.ts: tools/lipsync.ts parses by them, the workspace's server builds
// the arguments of its request from them, lib/cli.ts shows them. No imports of the pipeline: --help stays instant.
// The settings of the preview live in config.json (lipsyncScale, lipsyncDummies, lipsyncDummy, lipsyncDummy2) and on the Settings page; the options
// below say another value for this run only.

export const lipsyncCommand: CommandSchema = {
    command: 'lipsync',
    script: 'tools/lipsync.ts',
    positionals: '<project-id>',
    options: {
        only: {kind: 'text', shown: 'slot-001,...', pattern: /^[a-z]+-\d+(,[a-z]+-\d+)*$/, help: 'only these clips of the cut'},
        again: {kind: 'flag', help: 'render them again, the old ones put away'},
        scale: {
            kind: 'text',
            shown: '0.125',
            pattern: /^(0?\.\d+|1(\.0+)?)$/,
            help: 'the factor on the pixels of the video size, this run only',
            terminalOnly: true,
        },
        dummies: {kind: 'choice', choices: ['1', '2'], help: 'one dummy, or a second one for the second singer, this run only', terminalOnly: true},
        dummy: {kind: 'text', shown: 'TEXT', help: 'what the first dummy looks like, this run only', terminalOnly: true},
        dummy2: {kind: 'text', shown: 'TEXT', help: 'what the second dummy looks like, this run only', terminalOnly: true},
        json: {kind: 'flag', help: 'print the clips of the preview and their state instead of rendering', terminalOnly: true},
        comfy: {kind: 'text', shown: 'URL', help: 'the ComfyUI servers - the workspace chooses them on its own', terminalOnly: true},
    },
}
