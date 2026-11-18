/** One run of a line: plain, bold or italic. */
export type Run = {text: string; strong?: boolean; em?: boolean}
/** A part of a story as it is read (#1169): a heading, a paragraph or the rule between scenes. */
export type Block = {type: 'heading'; level: 1 | 2 | 3; runs: Run[]} | {type: 'paragraph'; runs: Run[]} | {type: 'rule'}

const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const HEADING = /^(#{1,3})\s+(.*?)\s*#*\s*$/

/** `**bold**` and `*italic*` (or `_italic_`) in a line; the marks go, anything else stays as the text it is. */
export function runsOf(line: string): Run[] {
  const runs: Run[] = []
  for (const part of line.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|(?<![\w])_[^_\n]+_(?![\w]))/)) {
    if (!part) continue
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) runs.push({text: part.slice(2, -2), strong: true})
    else if ((part.startsWith('*') && part.endsWith('*') && part.length > 2) || (part.startsWith('_') && part.endsWith('_') && part.length > 2))
      runs.push({text: part.slice(1, -1), em: true})
    else runs.push({text: part})
  }
  return runs
}

/**
 * The Markdown of a story as blocks: headings (# to ###), paragraphs (lines up to a blank one), a rule (---), bold and italic. Nothing
 * else is read, and the result is data, never HTML: whatever is in the text is shown as text.
 */
export function blocksOf(text: string): Block[] {
  const blocks: Block[] = []
  let lines: string[] = []
  const flush = () => {
    if (lines.length) blocks.push({type: 'paragraph', runs: runsOf(lines.join(' '))})
    lines = []
  }
  for (const line of text.replaceAll('\r\n', '\n').split('\n')) {
    const heading = HEADING.exec(line)
    if (!line.trim()) flush()
    else if (RULE.test(line)) {
      flush()
      blocks.push({type: 'rule'})
    } else if (heading) {
      flush()
      blocks.push({type: 'heading', level: heading[1]!.length as 1 | 2 | 3, runs: runsOf(heading[2]!)})
    } else lines.push(line.trim())
  }
  flush()
  return blocks
}
