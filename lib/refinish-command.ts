import type {CommandSchema} from './command-schema.ts'

// The options of `bun run refinish`, written down once (#826): tools/refinish.ts parses by them, the workspace's server builds the
// arguments of its request from them (lib/editor/runs.ts), lib/cli.ts shows them. No imports of the pipeline: --help stays instant.

export const refinishCommand: CommandSchema = {
    command: 'refinish',
    script: 'tools/refinish.ts',
    positionals: '<id>',
    options: {
        film: {kind: 'flag', help: 'the id is a film'},
        preset: {kind: 'text', shown: 'grade|smooth|fullhd', pattern: /^[a-z-]+$/, help: 'a set of the options below'},
        upscale: {kind: 'choice', choices: ['none', 'refine', 'latent', 'model'], help: 'how the clips are made larger'},
        size: {kind: 'text', shown: 'fullhd|2x|WxH', pattern: /^(fullhd|2x|\d+x\d+)$/, help: 'the size they are made to'},
        model: {kind: 'text', shown: '<file>', pattern: /^[^\n\r\0]+$/, help: 'the upscale model, with --upscale=model'},
        denoise: {kind: 'text', shown: '0.2', pattern: /^(0(\.\d+)?|1)$/, help: 'how much a refine may change, 0-1'},
        fps: {kind: 'text', shown: '48', pattern: /^\d+$/, help: 'more frames by interpolation'},
        finish: {kind: 'flag', help: 'the grade, sharpen and grain of the finish'},
        only: {kind: 'text', shown: 'slot-001,...', pattern: /^[a-z]+-\d+(,[a-z]+-\d+)*$/, help: 'only these clips'},
        again: {kind: 'flag', help: 'made again, the old ones put away', terminalOnly: true},
        comfy: {kind: 'text', shown: 'URL', help: 'the ComfyUI servers - the workspace chooses them on its own', terminalOnly: true},
    },
}
