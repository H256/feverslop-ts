// Regenerates docs/style-examples.md from lib/styles.ts - edit the styles there, not in the doc.
import {STYLES} from "../lib/styles.ts";

const intro = `# Style examples for \`input/style.txt\`

Generated from [lib/styles.ts](../lib/styles.ts) by \`bun run styles:doc\` - edit the styles there.

\`input/style.txt\` is optional. Without it, the first run has the LLM shortlist 5 styles from this list that fit the
story, draws one at random and writes it to \`input/style.txt\` - edit or replace the file to use a different one (the
look brief is then redone). \`bun run init\` can also choose one from this list. With the file, the look brief keeps your medium, style and named references exactly and only extends them (world,
palette, lighting, camera language, texture). Copy one of the examples below, or mix its building blocks into your own.

What works well with Krea 2 (stills) and MiniMax H3 (clips):

- **Name the medium first**, then say how it is shot, drawn or built (stock, lens, line work, shading, materials).
- **Describe visible things, not moods.** "Sodium-vapor streetlights, wet asphalt" beats "gritty and atmospheric".
- **Commit to one style.** Mixing ("photorealistic anime") confuses both models.
- **Anime and stylized looks:** name the rendering ("flat cel shading, two-tone shadows, clean dark linework"), not just
  the genre.
- Two to four sentences are plenty. The look brief adds the rest.
`

const outro = `## Adding your own constraints

A style line can also carry story-specific rules, just like the examples in \`projects/*/input/style.txt\`:

- a recurring visual motif ("a door with chipped paint appears in every location")
- a palette rule ("only color is the red of the poppies")
- a cast rule ("the four band members must stay visually distinct in every scene")
`

const groups = [...new Set(STYLES.map(s => s.group))]
let n = 0
const body = groups.map(group => {
    const items = STYLES.filter(s => s.group === group).map(s => `**${++n}. ${s.name}** (\`${s.id}\`)\n${s.text}`)
    return `## ${group}\n\n${items.join('\n\n')}`
}).join('\n\n')

await Bun.write('docs/style-examples.md', `${intro}\n${body}\n\n${outro}`)
console.log(`docs/style-examples.md - ${STYLES.length} styles`)
