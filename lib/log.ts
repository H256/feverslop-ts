import {closeSync, mkdirSync, openSync, writeSync} from "node:fs";
import {dirname} from "node:path";
import {format, stripVTControlCharacters, styleText} from "node:util";

type Format = Parameters<typeof styleText>[0]
export const style = (format: Format) => (text: string) => styleText(format, text)
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
const boxWidth = Math.min(process.stdout.columns || 100, 120) - 4

function wrap(text: string, width: number) {
    return text.split('\n').flatMap(paragraph => {
        const lines: string[] = []
        let line = ''
        for (const word of paragraph.split(' ')) {
            if (line && line.length + word.length + 1 > width) {
                lines.push(line)
                line = word
            } else {
                line = line ? `${line} ${word}` : word
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

export function setOutput(options: { verbose?: boolean, show?: Iterable<string> }) {
    verbose = options.verbose ?? false
    shown = new Set(options.show ?? [])
}

/** Whether the details of this step (or of `clips`, the clip prompts) are shown in the terminal. */
export const showsDetails = (name: string) => verbose || shown.has(name)

/** From now until the next section, details only go into the log file (a cached step, the clip prompts). */
export function hideDetails(hidden = true) {
    detailsHidden = hidden && !verbose
}

// every log line clears the status board first and redraws it after, so the board stays the last line
function print(line: string, always = false) {
    if (detailsHidden && !always) {
        toLog(`${line}\n`)
        return
    }
    clearBoard()
    console.log(line)
    drawBoard()
}

/** Warns about keys in `obj` that aren't in `allowed` - `prefix` is prepended to each reported key, e.g. "llm.". */
export function warnUnknownKeys(obj: object, allowed: string[], where: string, prefix = '') {
    const unknown = Object.keys(obj).filter(key => !allowed.includes(key))
    if (unknown.length) log.warn(`${where}: unknown field(s) ${prefix}${unknown.join(`, ${prefix}`)} - ignored`)
}

/** The "FEVERSLOP" ASCII logo, printed once at the start of the interactive CLIs - silent when not in a terminal. */
export function printBanner() {
    if (!process.stdout.isTTY) return
    const logo = [
        '╔═╗╔═╗╦  ╦╔═╗╦═╗╔═╗╦  ╔═╗╔═╗',
        '╠╣ ║╣ ╚╗╔╝║╣ ╠╦╝╚═╗║  ║ ║╠═╝',
        '╚  ╚═╝ ╚╝ ╚═╝╩╚═╚═╝╩═╝╚═╝╩  ',
    ]
    console.log()
    for (const line of logo) console.log(`  ${styles.name(line)}`)
    console.log(`  ${styles.muted('TS · video cli')}`)
}

export const log = {
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
    step: (label: string, value: string = '') => print(`${styles.label(`▸ ${label}`)} ${value}`),
    warn: (message: string) => print(`${styles.warning('▸ Warning')} ${styles.warning(message)}`, true),
    box: (title: string, content: string) => {
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

function errorBox(heading: string, sections: { text: string, style: (s: string) => string }[]): never {
    clearBoard()
    if (logFile) sections = [...sections, {text: `The whole run: ${logFile.path}`, style: styles.muted}]
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
let drawn = false

function drawBoard() {
    if (!process.stdout.isTTY) return
    const elapsed = (entry: BoardEntry) => styles.muted(`${((Date.now() - entry.start) / 1000).toFixed(1)}s`)
    const running = [...board].filter(e => !e.note).map(e => [e.status(), e] as const).filter(([status]) => status)
    const notes = [...board].filter(e => e.note).map(e => e.status()).filter(Boolean)
    if (!running.length && !notes.length) return
    const parts = [
        ...(running.length > 1 ? [`${running.length} running`] : []),
        ...running.map(([status, entry]) => `${status} ${elapsed(entry)}`),
        ...notes.map(note => styles.muted(note)),
    ]
    let line = `${styles.label(frames[frame++ % frames.length]!)} ${parts.join(styles.muted(' · '))}`
    // a line that wraps can't be cleared with \r any more - cut it to the terminal width
    const width = (process.stdout.columns || 100) - 1
    if (Bun.stringWidth(line) > width) line = stripVTControlCharacters(line).slice(0, width - 1) + '…'
    process.stdout.write(`\r\x1b[2K${line}`)
    drawn = true
}

function clearBoard() {
    if (drawn) process.stdout.write('\r\x1b[2K')
    drawn = false
}

/** Adds an entry to the status board - returns the function that removes it again. */
export function startSpinner(getStatus: () => string, options: { note?: boolean } = {}) {
    const entry: BoardEntry = {status: getStatus, start: Date.now(), note: options.note ?? false}
    board.add(entry)
    if (process.stdout.isTTY) timer ??= setInterval(drawBoard, 80)
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
        if (!logFile) return
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
