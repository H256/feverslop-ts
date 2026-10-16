// A static HTML overview of what a project has generated so far - `bun index.ts --gallery`. It is a view of the
// files on disk and project.json, written next to them as gallery.html with relative links, so it opens straight
// from the folder without a server. Only what exists is listed; nothing here renders anything.
import {existsSync, readdirSync} from "node:fs";
import {basename, join} from "node:path";
import type {Project} from "./project.ts";
import {boundaryFrameAsset} from "./compose.ts";
import {plainText} from "./refs.ts";

type Card = { title: string, subtitle?: string, images?: { src: string, label?: string }[], videos?: { src: string, label?: string }[], text?: string, wide?: boolean }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!)
const url = (file: string) => file.split('/').map(encodeURIComponent).join('/')

const media = (dir: string, file: string) => existsSync(join(dir, file)) ? file : undefined

// a group character's member images are named <id>-v<member>.png, see groupMemberId in lib/compose.ts
const memberOf = (id: string, known: Set<string>) => known.has(id) ? undefined : id.match(/^(.+)-v(\d+)$/)?.[2]

function castCards(dir: string, kind: 'character' | 'location', cast: { id: string, name: string, role?: string }[]): Card[] {
    const folder = `assets/${kind}s`
    const files = existsSync(join(dir, folder)) ? readdirSync(join(dir, folder)).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)) : []
    const known = new Set(cast.map(c => c.id))
    const order = (id: string) => cast.findIndex(c => c.id === id || id.startsWith(`${c.id}-v`))
    return files
        .filter(id => order(id) >= 0)
        .sort((a, b) => order(a) - order(b) || a.localeCompare(b, undefined, {numeric: true}))
        .map(id => {
            const owner = cast[order(id)]!
            const member = memberOf(id, known)
            const sequence = `assets/sequence/${kind}s/${id}`
            const anchor = media(dir, `${sequence}/anchor.png`)
            const video = media(dir, `${sequence}/sequence.mp4`)
            return {
                title: member ? `${owner.name} #${Number(member) + 1}` : owner.name,
                subtitle: owner.role,
                images: [{src: `${folder}/${id}.png`, label: anchor ? 'sheet' : undefined}, ...(anchor ? [{src: anchor, label: 'anchor'}] : [])],
                videos: video ? [{src: video, label: 'sequence'}] : [],
                wide: !!(anchor || video),
            }
        })
}

function storyboardCards(dir: string, data: Project): Card[] {
    const beats = new Map((data.beats ?? []).map(b => [b.id, b]))
    const beatOf = new Map((data.mapping ?? []).map(m => [m.slotId, m.beatId]))
    return (data.timeline?.slots ?? []).flatMap(slot => {
        const first = media(dir, boundaryFrameAsset(slot.id, 'ff'))
        const last = media(dir, boundaryFrameAsset(slot.id, 'lf'))
        if (!first && !last) return []
        const beat = beats.get(beatOf.get(slot.id) ?? '')
        return [{
            title: slot.id,
            subtitle: `${slot.section} · ${slot.start.toFixed(1)}s – ${slot.end.toFixed(1)}s`,
            images: [...(first ? [{src: first, label: 'first frame'}] : []), ...(last ? [{src: last, label: 'last frame'}] : [])],
            // the beats write their characters as {Name} - the page shows the names
            text: beat?.summary && plainText(beat.summary, data.cast?.characters ?? []),
        }]
    })
}

function videoCards(dir: string, data: Project): Card[] {
    // the final video is named after the project - projects rendered before that still have a final.mp4
    const final = media(dir, `${basename(dir)}.mp4`) ?? media(dir, 'final.mp4')
    const clips = (data.timeline?.slots ?? []).flatMap(slot => {
        const file = media(dir, `videos/${slot.id}.mp4`)
        return file ? [{title: slot.id, subtitle: `${slot.section} · ${slot.start.toFixed(1)}s – ${slot.end.toFixed(1)}s`, videos: [{src: file}]}] : []
    })
    return [...(final ? [{title: 'Final video', videos: [{src: final}]}] : []), ...clips]
}

// a card with a reference sheet leads with it at full width (it is a wide multi-angle composite), the anchor and the
// sequence video it was made from sit small below
const renderCard = (c: Card) => `<figure class="card${c.wide ? ' sheet' : ''}">
${(c.images ?? []).map(i => `<a href="${url(i.src)}" target="_blank"><img loading="lazy" src="${url(i.src)}" alt="${esc(i.label ?? c.title)}">${i.label ? `<span>${esc(i.label)}</span>` : ''}</a>`).join('\n')}
${(c.videos ?? []).map(v => `<div><video controls preload="metadata" src="${url(v.src)}"></video>${v.label ? `<span>${esc(v.label)}</span>` : ''}</div>`).join('\n')}
<figcaption><b>${esc(c.title)}</b>${c.subtitle ? ` <small>${esc(c.subtitle)}</small>` : ''}${c.text ? `<p>${esc(c.text)}</p>` : ''}</figcaption>
</figure>`

const renderSection = (heading: string, cards: Card[]) => cards.length
    ? `<h2>${heading}</h2>\n<div class="grid">\n${cards.map(renderCard).join('\n')}\n</div>`
    : ''

/** Writes `<dir>/gallery.html` and returns its path, plus how many items each tab shows. */
export async function writeGallery(dir: string, id: string, data: Project) {
    const cast = data.cast
    const tabs = [
        {id: 'cast', name: 'Cast', empty: 'No locations or characters rendered yet - run with --render=images.', html: [
            renderSection('Locations', castCards(dir, 'location', cast?.locations ?? [])),
            renderSection('Characters', castCards(dir, 'character', cast?.characters ?? [])),
        ].join('\n')},
        {id: 'storyboard', name: 'Storyboard', empty: 'No clip frames yet - they appear once clips are rendered (--render=videos).', html: renderSection('First &amp; last frames', storyboardCards(dir, data))},
        {id: 'videos', name: 'Videos', empty: 'No videos yet - run with --render=videos, then --render=final.', html: renderSection('Clips', videoCards(dir, data))},
    ].map(t => ({...t, html: t.html.trim()}))

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(id)} · gallery</title>
<style>
:root { color-scheme: dark; --bg: #14121a; --panel: #1f1c28; --text: #e8e6ee; --muted: #9a96a8; --accent: #c05ccf; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.4 system-ui, sans-serif; }
header { padding: 20px 24px 0; }
h1 { margin: 0 0 12px; font-size: 20px; }
h2 { margin: 24px 24px 12px; font-size: 16px; color: var(--muted); font-weight: 600; }
nav { display: flex; gap: 4px; border-bottom: 1px solid var(--panel); padding: 0 24px; }
nav button { background: none; border: 0; border-bottom: 3px solid transparent; color: var(--muted); font: inherit; padding: 8px 16px; cursor: pointer; }
nav button[aria-selected=true] { color: var(--text); border-color: var(--accent); }
section[hidden] { display: none; }
.empty { margin: 24px; color: var(--muted); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; padding: 0 24px; }
.card { margin: 0; background: var(--panel); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.card a { position: relative; display: block; }
.card.sheet { grid-column: span 2; flex-direction: row; flex-wrap: wrap; }
.card.sheet > a:first-child, .card.sheet figcaption { flex: 1 0 100%; }
.card.sheet > a, .card.sheet > div { flex: 1 1 0; min-width: 0; }
.card img, .card video { width: 100%; display: block; border-radius: 4px; background: #000; }
.card span { color: var(--muted); font-size: 12px; }
.card a span { position: absolute; left: 6px; top: 6px; background: #000a; color: var(--text); padding: 1px 6px; border-radius: 3px; }
figcaption small { color: var(--muted); }
figcaption p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<header><h1>${esc(id)}</h1></header>
<nav role="tablist">${tabs.map((t, i) => `<button role="tab" data-tab="${t.id}" aria-selected="${i === 0}">${t.name}</button>`).join('')}</nav>
${tabs.map((t, i) => `<section id="${t.id}"${i === 0 ? '' : ' hidden'}>${t.html || `<p class="empty">${t.empty}</p>`}</section>`).join('\n')}
<script>
const select = name => {
    for (const b of document.querySelectorAll('nav button')) b.setAttribute('aria-selected', String(b.dataset.tab === name))
    for (const s of document.querySelectorAll('section')) s.hidden = s.id !== name
    for (const v of document.querySelectorAll('video')) if (v.closest('section').hidden) v.pause()
    history.replaceState(null, '', '#' + name)
}
for (const b of document.querySelectorAll('nav button')) b.onclick = () => select(b.dataset.tab)
if (document.getElementById(location.hash.slice(1))) select(location.hash.slice(1))
</script>
</body>
</html>
`
    const file = join(dir, 'gallery.html')
    await Bun.write(file, html)
    return {file, counts: Object.fromEntries(tabs.map(t => [t.name, (t.html.match(/<figure/g) ?? []).length]))}
}
