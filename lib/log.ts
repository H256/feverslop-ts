import {closeSync, mkdirSync, openSync, writeSync} from "node:fs";
import {dirname} from "node:path";
import {format, stripVTControlCharacters, styleText} from "node:util";

type Format = Parameters<typeof styleText>[0]
export const style = (format: Format) => (text: string) => process.env.NO_COLOR !== undefined || !process.stdout.isTTY ? text : styleText(format, text)
export const styles = {
    section: style(['bold', 'white', 'bgMagenta']),
    label: style(['bold', 'magenta']),
    name: style(['bold', 'cyan']),
    muted: style('dim'),
    thinking: style(['dim', 'italic']),
    answer: style(['bold', 'green']),
    warning: style(['bold', 'yellow']),
    border: style('magenta'),
}

// a terminal that reports 0 columns (some ptys, CI) gets the width of one without a size
const boxColumns = () => Math.max(1, Math.min(process.stdout.columns || 100, 120) - 4)

export function wrap(text: string, width: number) {
    return text.split('\n').flatMap(paragraph => {
        const lines: string[] = []
        let line = ''
        for (const word of stripVTControlCharacters(paragraph).split(' ')) {
            if (line && Bun.stringWidth(line + ' ' + word) > width) {
                lines.push(line)
                line = word
            } else {
                line = line ? `${line} ${word}` : word
            }
            while (Bun.stringWidth(line) > width) {
                let part = ''
                for (const char of line) {
                    if (Bun.stringWidth(part + char) > width) break
                    part += char
                }
                if (!part) { part = [...line][0]! }
                lines.push(part)
                line = line.slice(part.length)
            }
        }
        lines.push(line)
        return lines
    })
}

// What the terminal shows: by default the details of a step taken from project.json (its texts, lists and boxes) are
// left out - they go only into the run's log file (keepLogIn). -v/--verbose shows everything, --show=<step> one step.
let verbose = false
let shown = new Set<string>()
let detailsHidden = false
let quiet = false
let json = false
let debug = false
let errorHint = ''

export function configureOutput(options: {quiet?: boolean, json?: boolean, debug?: boolean, hint?: string}) {
    quiet = options.quiet ?? false
    json = options.json ?? false
    debug = options.debug ?? false
    errorHint = options.hint ?? ''
}
export const jsonOutput = () => json

export function setOutput(options: { verbose?: boolean, show?: Iterable<string> }) {
    verbose = options.verbose ?? verbose
    shown = new Set(options.show ?? [])
}

/** Whether the details of this step (or of `clips`, the clip prompts) are shown in the terminal. */
export const showsDetails = (name: string) => verbose || shown.has(name)

/** From now until the next section, details only go into the log file (a cached step, the clip prompts). */
export function hideDetails(hidden = true) {
    detailsHidden = hidden && !verbose
}

// every log line clears the status board first and redraws it after, so the board stays the last line
function print(line: string, always = false, diagnostic = false) {
    if (json || (!diagnostic && (quiet || (detailsHidden && !always)))) {
        toLog(`${line}\n`)
        return
    }
    clearBoard()
    if (diagnostic) console.error(line)
    else console.log(line)
    drawBoard()
}

/** Warns about keys in `obj` that aren't in `allowed` - `prefix` is prepended to each reported key, e.g. "llm.". */
export function warnUnknownKeys(obj: object, allowed: string[], where: string, prefix = '') {
    const unknown = Object.keys(obj).filter(key => !allowed.includes(key))
    if (unknown.length) log.warn(`${where}: unknown field(s) ${prefix}${unknown.join(`, ${prefix}`)} - ignored`)
}

/** The "FEVERSLOP" ASCII logo, printed once at the start of the interactive CLIs - silent when not in a terminal. */
export function printBanner() {
    if (!process.stdout.isTTY || quiet || json || bannerPrinted) return
    bannerPrinted = true
    print(bannerLines(process.stdout.columns || 100).map(line => styles.name(line)).join('\n'), true)
}
let bannerPrinted = false

/** A six-line ASCII wordmark, with a stacked version for ordinary terminals. */
export function bannerLines(width: number): string[] {
    const letters: Record<string, string[]> = {
        F: [' ______', '|  ____|', '| |__  ', '|  __| ', '| |    ', '|_|    '],
        E: [' ______', '|  ____|', '| |__  ', '|  __| ', '| |____', '|______|'],
        V: ['__      __', '\\ \\    / /', ' \\ \\  / / ', '  \\ \\/ /  ', '   \\  /   ', '    \\/    '],
        R: [' _____ ', '|  __ \\', '| |__) |', '|  _  /', '| | \\ \\', '|_|  \\_\\'],
        S: ['  _____', ' / ____|', '| (___ ', ' \\___ \\', ' ____) |', '|_____/'],
        L: [' _     ', '| |    ', '| |    ', '| |    ', '| |____', '|______|'],
        O: ['  ____ ', ' / __ \\', '| |  | |', '| |  | |', '| |__| |', ' \\____/'],
        P: [' _____ ', '|  __ \\', '| |__) |', '|  ___/', '| |    ', '|_|    '],
    }
    const word = (text: string) => Array.from({length: 6}, (_, row) => [...text].map(c => {
        const glyph = letters[c]!
        return glyph[row]!.padEnd(Math.max(...glyph.map(line => line.length)))
    }).join(' ').trimEnd())
    const wide = word('FEVERSLOP')
    const stacked = [...word('FEVER'), '', ...word('SLOP')]
    const lines = Math.max(...wide.map(l => l.length)) <= width ? wide
        : Math.max(...stacked.map(l => l.length)) <= width ? stacked : ['FEVERSLOP']
    return [...lines, 'STORIES INTO MOTION / TS VIDEO CLI'].map(line => fitLine(line, width))
}

/** Clip by terminal cells, not UTF-16 offsets (emoji and CJK can use two cells). */
export function fitLine(text: string, width: number) {
    if (width <= 0) return ''
    if (Bun.stringWidth(text) <= width) return text
    let result = ''
    for (const char of stripVTControlCharacters(text)) {
        if (Bun.stringWidth(result + char) > width - 1) break
        result += char
    }
    return result + '…'
}

// the warnings of this run, for its summary at the end
const warnings: string[] = []
export const runWarnings = () => [...warnings]
const result: {output?: string, next?: string, nextShown?: boolean, cancelled?: boolean} = {}
export const runResult = () => ({...result})

export const log = {
    /** Human output which must not inherit a cached step's hidden-detail state. */
    info: (...args: unknown[]) => print(format(...args), true),
    prompt: (message: string) => print(message, true, true),
    error: (...args: unknown[]) => {
        const message = format(...args)
        if (json) console.error(JSON.stringify({error: message, hint: errorHint || undefined}))
        else print(`${styles.warning('✗ Failed')} ${message}${errorHint ? `\n${errorHint}` : ''}`, true, true)
    },
    json: (value: unknown) => console.log(JSON.stringify(value, null, 2)),
    success: (message: string) => print(`${styles.answer('✔ Done')} ${message}`, true),
    next: (command: string) => { result.next = command; result.nextShown = true; print(`${styles.label('→ Next')} ${command}`, true) },
    output: (path: string) => { result.output = path; print(`${styles.label('▸ Output')} ${path}`, true) },
    cancel: (message: string) => { result.cancelled = true; print(`${styles.warning('⊘ Cancelled')} ${message}`, true, true) },
    section: (title: string) => {
        detailsHidden = false
        print(`\n${styles.section(`  ${title}  `)}\n`)
    },
    /** A step taken from project.json, as one line - its details only go into the log file, unless shown (see setOutput). */
    cached: (name: string, title: string) => {
        detailsHidden = false
        print(`${styles.answer('✔')} ${title} ${styles.muted(`· cached (--redo=${name})`)}`)
        if (!showsDetails(name)) detailsHidden = true
    },
    /** One line of a listing - a detail like log.step. */
    line: (text: string) => print(text),
    step: (label: string, value: string = '') => {
        if (label === 'Saved' || label === 'Output') result.output = stripVTControlCharacters(value)
        print(`${styles.label(`▸ ${label}`)} ${value}`)
    },
    warn: (message: string) => {
        warnings.push(message)
        print(`${styles.warning('▸ Warning')} ${styles.warning(message)}`, true, true)
    },
    box: (title: string, content: string) => {
        const boxWidth = boxColumns()
        title = fitLine(title, Math.max(1, boxWidth - 1))
        const border = styles.border
        const lines = [border(`╭─ `) + styles.label(title) + border(` ${'─'.repeat(Math.max(0, boxWidth - title.length - 1))}╮`)]
        for (const line of wrap(content.trim(), boxWidth)) {
            lines.push(`${border('│')} ${line.padEnd(boxWidth)} ${border('│')}`)
        }
        lines.push(border(`╰${'─'.repeat(boxWidth + 2)}╯`))
        print(lines.join('\n'))
    },
    /** A bad --flag/argument: a loud red box with the problem and how to call the script correctly, then exits. */
    usageError: (message: string, usage: string): never => errorBox(' ✗ BAD USAGE ', [
        {text: message, style: styles.warning},
        {text: usage, style: styles.muted},
    ]),
    /** Any other uncaught runtime failure (a rejected step, a missing file, ...) - the same loud red box, just
     * without a usage line, instead of Bun's raw stack-trace dump. */
    fatal: (message: string): never => errorBox(' ✗ FAILED ', [{text: message, style: styles.warning}]),
}

/**
 * The handler for an uncaught failure of a whole run: the message in the red box, and with --debug (or FEVERSLOP_DEBUG=1)
 * the stack trace below it. The flag is read from the raw arguments - the handlers are set up before parseArgs runs.
 */
export function failRun(e: unknown): never {
    const showDebug = debug || process.env.FEVERSLOP_DEBUG === '1' || Bun.argv.includes('--debug')
    if (showDebug && !json && e instanceof Error && e.stack) {
        clearBoard()
        console.error(styles.muted(e.stack))
    }
    return log.fatal(e instanceof Error ? e.message : String(e))
}

function errorBox(heading: string, sections: { text: string, style: (s: string) => string }[]): never {
    clearBoard()
    if (json) {
        console.error(JSON.stringify({error: sections[0]?.text, usage: sections[1]?.text, hint: errorHint || undefined, log: logFile?.path}))
        process.exit(1)
    }
    if (logFile) sections = [...sections, {text: `The whole run: ${logFile.path}`, style: styles.muted}]
    if (errorHint) sections = [...sections, {text: errorHint, style: styles.muted}]
    if (!process.stderr.isTTY) {
        console.error(`${heading.trim()}\n${sections.map(s => s.text).join('\n')}`)
        process.exit(1)
    }
    const boxWidth = boxColumns()
    const border = style('red')
    const title = style(['bold', 'white', 'bgRed'])
    console.error(`\n${border('╭─')}${title(heading)}${border(`${'─'.repeat(Math.max(0, boxWidth - heading.length))}╮`)}`)
    sections.forEach(({text, style: lineStyle}, i) => {
        if (i > 0) console.error(border(`├${'─'.repeat(boxWidth + 2)}┤`))
        for (const line of wrap(text.trim(), boxWidth)) console.error(`${border('│')} ${lineStyle(line.padEnd(boxWidth))} ${border('│')}`)
    })
    console.error(border(`╰${'─'.repeat(boxWidth + 2)}╯\n`))
    process.exit(1)
}

/**
 * The status board: one line at the bottom with everything that is running right now, e.g.
 * `⠋ 2 running · clip slot-003 @gpu1 step 4/8 12s · clip slot-004 @gpu2 loading 3s · 1 queued`.
 * Entries return '' to be hidden for a moment; notes (like "1 queued") come last and aren't counted as running.
 */
type BoardEntry = { status: () => string, start: number, note: boolean }
const board = new Set<BoardEntry>()
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
let frame = 0
let timer: ReturnType<typeof setInterval> | undefined
let drawn = 0

function drawBoard() {
    if (!process.stdout.isTTY || quiet || json) return
    const elapsed = (entry: BoardEntry) => styles.muted(`${((Date.now() - entry.start) / 1000).toFixed(1)}s`)
    const running = [...board].filter(e => !e.note).map(e => [e.status(), e] as const).filter(([status]) => status)
    const notes = [...board].filter(e => e.note).map(e => e.status()).filter(Boolean)
    if (!running.length && !notes.length) return
    // A bounded board retains concurrent jobs instead of truncating all but the first.
    const width = (process.stdout.columns || 100) - 1
    const limit = Math.max(1, Math.min(6, (process.stdout.rows || 24) - 5))
    const entries = running.map(([status, entry]) => `  ${status} ${elapsed(entry)}`)
    const visible = entries.slice(0, Math.max(0, limit - 1))
    const hidden = entries.length - visible.length
    const lines = [`${styles.label(frames[frame++ % frames.length]!)} ${running.length} running${notes.length ? ` · ${notes.join(' · ')}` : ''}${hidden ? ` · ${hidden} more active` : ''}`, ...visible].map(line => fitLine(line, width))
    clearBoard()
    boardWrite = true
    process.stdout.write(lines.join('\n'))
    boardWrite = false
    drawn = lines.length
}

function clearBoard() {
    boardWrite = true
    if (drawn) process.stdout.write(`\r\x1b[2K${'\x1b[1A\r\x1b[2K'.repeat(drawn - 1)}`)
    boardWrite = false
    drawn = 0
}

/** Adds an entry to the status board - returns the function that removes it again. */
export function startSpinner(getStatus: () => string, options: { note?: boolean } = {}) {
    const entry: BoardEntry = {status: getStatus, start: Date.now(), note: options.note ?? false}
    board.add(entry)
    if (process.stdout.isTTY && !quiet && !json) timer ??= setInterval(drawBoard, 100)
    return () => {
        board.delete(entry)
        clearBoard()
        if (board.size) {
            drawBoard()
        } else {
            clearInterval(timer)
            timer = undefined
        }
    }
}

/** 12.3s under a minute, 3m 05s above, 1h 40m from an hour - for the "how long did it take" suffixes. */
export function formatDuration(ms: number) {
    const seconds = ms / 1000
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const whole = Math.round(seconds)
    if (whole >= 3600) return `${Math.floor(whole / 3600)}h ${String(Math.floor(whole % 3600 / 60)).padStart(2, '0')}m`
    return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`
}

/** "41 t/s" - '' when the count or the time is unknown, so the suffix can be left out silently. */
export function formatRate(tokens: number | undefined, ms: number) {
    if (!tokens || ms <= 0) return ''
    const rate = tokens / (ms / 1000)
    return `${rate < 10 ? rate.toFixed(1) : Math.round(rate)} t/s`
}

export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length

/** Joins the non-empty parts as one short muted suffix: `12.3s · 41 t/s`. */
export const suffix = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ')

/**
 * The log of a run: everything it prints - console.log/error/warn and direct writes (the prompts of --review) - also goes
 * into this file, without colour codes and without the redraws of the status line. Opened once per run.
 */
let logFile: { path: string, fd: number } | undefined
let boardWrite = false

/** Into the log file only - what the terminal leaves out. */
function toLog(text: string) {
    if (!logFile) return
    try {
        writeSync(logFile.fd, stripVTControlCharacters(text))
    } catch {
        // a log that cannot be written is no reason to stop a run
    }
}

export function keepLogIn(path: string) {
    mkdirSync(dirname(path), {recursive: true})
    logFile = {path, fd: openSync(path, 'a')}
    const toFile = (text: string) => {
        if (!logFile || boardWrite) return
        // the status line is drawn as "\r" + the line, and cleared with "\r" - neither is part of the log
        if (text.startsWith('\r') && !text.includes('\n')) return
        try {
            writeSync(logFile.fd, stripVTControlCharacters(text).replace(/\r/g, ''))
        } catch {
            // a log that cannot be written is no reason to stop a run
        }
    }
    for (const method of ['log', 'error', 'warn', 'info'] as const) {
        const original = console[method].bind(console)
        console[method] = (...args: unknown[]) => {
            original(...args)
            toFile(`${format(...args)}\n`)
        }
    }
    for (const stream of [process.stdout, process.stderr]) {
        const original = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean
        stream.write = ((chunk: unknown, ...rest: unknown[]) => {
            if (typeof chunk === 'string' || chunk instanceof Uint8Array) toFile(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
            return original(chunk, ...rest)
        }) as typeof stream.write
    }
    process.on('exit', () => {
        if (logFile) closeSync(logFile.fd)
    })
    return path
}

/** The file the run logs into, if it keeps one. */
export const runLogFile = () => logFile?.path
