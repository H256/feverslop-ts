import {stripVTControlCharacters, styleText} from "node:util";

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

const boxWidth = Math.min(process.stdout.columns ?? 100, 120) - 4

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

// every log line clears the status board first and redraws it after, so the board stays the last line
function print(line: string) {
    clearBoard()
    console.log(line)
    drawBoard()
}

/** Warns about keys in `obj` that aren't in `allowed` - `prefix` is prepended to each reported key, e.g. "llm.". */
export function warnUnknownKeys(obj: object, allowed: string[], where: string, prefix = '') {
    const unknown = Object.keys(obj).filter(key => !allowed.includes(key))
    if (unknown.length) log.warn(`${where}: unknown field(s) ${prefix}${unknown.join(`, ${prefix}`)} - ignored`)
}

export const log = {
    section: (title: string) => print(`\n${styles.section(`  ${title}  `)}\n`),
    step: (label: string, value: string = '') => print(`${styles.label(`▸ ${label}`)} ${value}`),
    warn: (message: string) => print(`${styles.warning('▸ Warning')} ${styles.warning(message)}`),
    box: (title: string, content: string) => {
        const border = styles.border
        const lines = [border(`╭─ `) + styles.label(title) + border(` ${'─'.repeat(Math.max(0, boxWidth - title.length - 1))}╮`)]
        for (const line of wrap(content.trim(), boxWidth)) {
            lines.push(`${border('│')} ${line.padEnd(boxWidth)} ${border('│')}`)
        }
        lines.push(border(`╰${'─'.repeat(boxWidth + 2)}╯`))
        print(lines.join('\n'))
    },
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
    const width = (process.stdout.columns ?? 100) - 1
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
