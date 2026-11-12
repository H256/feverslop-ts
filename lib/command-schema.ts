import {parseArgs} from 'node:util'

// One description per option of a command (#826). An option used to be written down six times - the parser and the usage text of
// the tool, the table of lib/cli.ts, the help, the check of the workspace's server and the request of the page - and a new one
// meant six edits. From a schema come: the parser, the usage line, and the arguments the server builds from a request of the page.
// No imports of the pipeline: --help and a usage error stay instant.

type Common = {
    /** what it does, in a few words - for the help */
    help: string
    /** the workspace may not ask for it (--dry-run prints for a terminal) */
    terminalOnly?: boolean
    /** the field of the page's request, where it is not the option's name in camelCase */
    field?: string
}
export type OptionSpec = Common &
    (
        | {kind: 'flag'}
        /**
         * a text: `shown` is what the usage line gives as its value, `pattern` what the workspace's server lets through.
         * `emptyMeans`: an empty value is a value of its own and is passed on as `--name=` (the intro without a file: the one of the project)
         */
        | {kind: 'text'; shown: string; pattern?: RegExp; emptyMeans?: string}
        | {kind: 'number'; shown: string}
        | {kind: 'choice'; choices: readonly string[]}
        /** on, off or not said: --name / --no-name - a request's true or false, undefined leaves it to the settings */
        | {kind: 'switch'}
        /**
         * a text given again and again (--line=… --line=…): a request's list. `none` names the flag that says "none of them"
         * (--no-lines) - an empty list of the request; one line of text each, `pattern` what the server lets through
         */
        | {kind: 'list'; shown: string; none: string; pattern?: RegExp}
    )
export type CommandSchema = {
    /** as in `bun run <command>` */
    command: string
    /** the file the workspace starts */
    script: string
    /** the positional arguments, as the usage line shows them */
    positionals: string
    /** groups of options of which only one can be given, shown as [--a | --b] */
    either?: string[][]
    options: Record<string, OptionSpec>
}

export class UsageError extends Error {}

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
const fieldOf = (name: string, spec: OptionSpec) => spec.field ?? camel(name)
const shownOf = (name: string, spec: OptionSpec) =>
    spec.kind === 'flag'
        ? `--${name}`
        : spec.kind === 'switch'
          ? `--${name} | --no-${name}`
          : spec.kind === 'list'
            ? `--${name}=${spec.shown}]... [--${spec.none}`
            : `--${name}=${spec.kind === 'choice' ? spec.choices.join('|') : spec.shown}`

/** "<id> [--film] [--from=<video>] … [--save | --save-default]" - what follows the command in a usage line. */
export function usageArgs(schema: CommandSchema): string {
    const grouped = new Set((schema.either ?? []).flat())
    const single = Object.entries(schema.options)
        .filter(([name]) => !grouped.has(name))
        .map(([name, spec]) => `[${shownOf(name, spec)}]`)
    const groups = (schema.either ?? []).map(group => `[${group.map(name => shownOf(name, schema.options[name]!)).join(' | ')}]`)
    // the groups where their first option stands in the schema
    const order = Object.keys(schema.options)
    const parts: {at: number; text: string}[] = [
        ...Object.keys(schema.options)
            .filter(name => !grouped.has(name))
            .map((name, n) => ({at: order.indexOf(name), text: single[n]!})),
        ...(schema.either ?? []).map((group, n) => ({at: order.indexOf(group[0]!), text: groups[n]!})),
    ]
    return [schema.positionals, ...parts.sort((a, b) => a.at - b.at).map(p => p.text)].join(' ')
}
export const usageOf = (schema: CommandSchema) => `usage: bun run ${schema.command} ${usageArgs(schema)}`

export type Parsed = {
    positionals: string[]
    flag: (name: string) => boolean
    text: (name: string) => string | undefined
    number: (name: string) => number | undefined
    /** a switch: true (--name), false (--no-name), or undefined - neither said */
    switched: (name: string) => boolean | undefined
    /** a list: its texts, [] for --no-<none>, undefined when neither is given */
    list: (name: string) => string[] | undefined
}

/** The arguments of a command line read by its schema. Throws a UsageError for what the schema does not allow. */
export function parseCommand(schema: CommandSchema, argv: string[]): Parsed {
    let parsed: ReturnType<typeof parseArgs>
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            options: Object.fromEntries(
                Object.entries(schema.options).flatMap(([name, spec]): [string, {type: 'boolean' | 'string'; multiple?: boolean}][] =>
                    spec.kind === 'flag'
                        ? [[name, {type: 'boolean' as const}]]
                        : spec.kind === 'switch'
                          ? [
                                [name, {type: 'boolean' as const}],
                                [`no-${name}`, {type: 'boolean' as const}],
                            ]
                          : spec.kind === 'list'
                            ? [
                                  [name, {type: 'string' as const, multiple: true}],
                                  [spec.none, {type: 'boolean' as const}],
                              ]
                            : [[name, {type: 'string' as const}]],
                ),
            ),
        })
    } catch (e) {
        throw new UsageError(e instanceof Error ? e.message : String(e))
    }
    const values = parsed.values as Record<string, string | string[] | boolean | undefined>
    for (const [name, spec] of Object.entries(schema.options)) {
        const value = values[name]
        if (typeof value !== 'string') continue
        if (spec.kind === 'number' && (value.trim() === '' || !Number.isFinite(Number(value))))
            throw new UsageError(`--${name} must be a number, got "${value}"`)
        if (spec.kind === 'choice' && !spec.choices.includes(value)) throw new UsageError(`--${name} must be one of ${spec.choices.join(', ')}, got "${value}"`)
    }
    for (const [name, spec] of Object.entries(schema.options)) {
        if (spec.kind === 'switch' && values[name] && values[`no-${name}`]) throw new UsageError(`--${name} and --no-${name}: one of them, not both`)
        if (spec.kind === 'list' && values[name] && values[spec.none]) throw new UsageError(`--${name} and --${spec.none}: one of them, not both`)
    }
    for (const group of schema.either ?? []) {
        const given = group.filter(name => values[name] !== undefined && values[name] !== false)
        if (given.length > 1) throw new UsageError(`${given.map(name => `--${name}`).join(' and ')}: one of them, not both`)
    }
    const spec = (name: string) => {
        if (!schema.options[name]) throw new Error(`${schema.command} has no option --${name}`)
        return schema.options[name]
    }
    return {
        positionals: parsed.positionals,
        flag: name => (spec(name), values[name] === true),
        text: name => (spec(name), typeof values[name] === 'string' ? values[name] : undefined),
        number: name => (spec(name), typeof values[name] === 'string' ? Number(values[name]) : undefined),
        switched: name => (spec(name), values[`no-${name}`] ? false : values[name] ? true : undefined),
        list: name => {
            const of = spec(name)
            if (of.kind === 'list' && values[of.none]) return []
            return Array.isArray(values[name]) ? values[name] : undefined
        },
    }
}

/**
 * The options a request of the workspace's page comes to, as arguments of the command - each field checked by the schema: never
 * a line of shell, never an option the schema does not have. A field that is undefined or '' is left out. Throws on a value
 * the schema does not allow.
 */
export function requestArgs(schema: CommandSchema, request: Record<string, unknown>): string[] {
    const args: string[] = []
    for (const [name, spec] of Object.entries(schema.options)) {
        if (spec.terminalOnly) continue
        const value = request[fieldOf(name, spec)]
        if (value === '' && spec.kind === 'text' && spec.emptyMeans) {
            args.push(`--${name}=`)
            continue
        }
        if (spec.kind === 'switch') {
            if (value === undefined) continue
            if (typeof value !== 'boolean') throw new Error(`no such ${name}: ${JSON.stringify(value)}`)
            args.push(value ? `--${name}` : `--no-${name}`)
            continue
        }
        if (spec.kind === 'list') {
            if (value === undefined) continue
            if (!Array.isArray(value)) throw new Error(`${name}: a list of lines`)
            if (!value.length) args.push(`--${spec.none}`)
            for (const line of value as unknown[]) {
                if (typeof line !== 'string' || /[\n\r\0]/.test(line) || (spec.pattern && !spec.pattern.test(line)))
                    throw new Error(`${name}: one line of text each`)
                args.push(`--${name}=${line}`)
            }
            continue
        }
        if (value === undefined || value === '' || value === false) continue
        if (spec.kind === 'flag') {
            if (value !== true) throw new Error(`no such ${name}: ${String(value)}`)
            args.push(`--${name}`)
            continue
        }
        const said = typeof value === 'number' ? String(value) : value
        if (typeof said !== 'string' || /[\n\r\0]/.test(said)) throw new Error(`no such ${name}: ${JSON.stringify(value)}`)
        const allowed =
            spec.kind === 'number'
                ? /^\d+(\.\d+)?$/.test(said)
                : spec.kind === 'choice'
                  ? spec.choices.includes(said)
                  : !spec.pattern || spec.pattern.test(said)
        if (!allowed) throw new Error(`no such ${name}: ${said}`)
        args.push(`--${name}=${said}`)
    }
    return args
}
