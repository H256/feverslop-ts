// Creates a random example project - one of 10 built-in ideas - and generates a 1-minute song for it.
// usage: bun run example [--no-render]
import slugify from "slugify";
import {styles} from "../lib/log.ts";
import {projectExists, writeProject} from "../lib/project-setup.ts";

const examples = [
    {name: 'gothic trio', idea: 'Three grave-robbers break into a sealed crypt for the legendary well of eternal youth, and find out too late what actually guards it.', style: 'gothic, candlelit stone, desaturated blues and gold', musicStyle: 'dark folk, cello and choir'},
    {name: 'neon courier', idea: 'A bike courier in a rain-soaked megacity carries a package everyone with a badge or a gun wants back.', style: 'cyberpunk, neon reflections on wet asphalt', musicStyle: 'synthwave, driving arpeggios'},
    {name: 'last lighthouse', idea: 'The keeper of the last lighthouse on a drowning coast refuses to leave, and the sea starts answering back.', style: 'muted coastal grey, storm light', musicStyle: 'slow post-rock, swelling strings'},
    {name: 'clockwork heist', idea: 'A crew of thieves steals the mechanical heart that powers an entire steampunk city, one gear at a time.', style: 'brass and steam, warm amber lantern light', musicStyle: 'upbeat orchestral swing'},
    {name: 'desert duel', idea: 'Two bounty hunters who used to be partners face off at high noon over the same fugitive.', style: 'spaghetti western, dust and long shadows', musicStyle: 'twangy guitar, whistled melody'},
    {name: 'deep signal', idea: 'A lone astronaut on a dying space station picks up a signal that repeats her own voice, from before she was born.', style: 'cold sci-fi, sterile white and starlight', musicStyle: 'ambient electronic, sparse pulses'},
    {name: 'wolf wedding', idea: 'A bride discovers her new husband\'s family turns into wolves at the wedding feast - and that she was invited on purpose.', style: 'dark fairy tale, candlelit forest hall', musicStyle: 'folk waltz, fiddle and drone'},
    {name: 'iron miners', idea: 'Deep-earth miners strike a vein that sings, and the deeper they dig the more the mountain wants them to stay.', style: 'industrial gothic, torchlit tunnels', musicStyle: 'heavy rhythmic chanting, low drums'},
    {name: 'rooftop chase', idea: 'A cat burglar being chased across a city\'s rooftops at dawn realizes the person chasing her wants to join her, not arrest her.', style: 'golden hour noir, sharp city silhouettes', musicStyle: 'jazzy upbeat, brass stabs'},
    {name: 'last harvest', idea: 'A farming family holds a harvest festival for a scarecrow that has started walking the fields at night, and they\'re not sure if it still protects them.', style: 'rural folk horror, autumn gold and shadow', musicStyle: 'acoustic, unsettling minor key'},
] as const

const render = !Bun.argv.includes('--no-render')

const example = examples[Math.floor(Math.random() * examples.length)]!
let id: string
do {
    id = `${slugify(example.name, {lower: true, strict: true})}-${Math.random().toString(36).slice(2, 6)}`
} while (projectExists(id))

console.log(`${styles.label('▸ Example')} ${styles.name(id)}`)
console.log(`${styles.label('▸ Idea')} ${example.idea}`)
console.log(`${styles.label('▸ Style')} ${example.style}`)

await writeProject(id, {
    idea: example.idea,
    style: example.style,
    musicStyle: example.musicStyle,
    config: {songDuration: 60},
})

if (!render) {
    console.log(`\nCreated - run it with:\n\n  bun index.ts ${id} --render=song,images,videos,final\n`)
    process.exit(0)
}

console.log(styles.muted(`\nGenerating the song - bun index.ts ${id} --render=song\n`))
const result = Bun.spawnSync(['bun', 'index.ts', id, '--render=song'], {stdio: ['inherit', 'inherit', 'inherit']})
if (result.exitCode === 0) {
    console.log(`\nSong ready - continue with:\n\n  bun index.ts ${id} --render=images,videos,final\n`)
}
process.exit(result.exitCode ?? 1)
