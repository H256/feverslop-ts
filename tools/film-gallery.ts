import {cli} from '../lib/cli.ts';
import {log} from '../lib/log.ts';
import {existsSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {FILMS_DIR} from "../lib/film/store.ts";
import type {FilmProject} from "../lib/film/types.ts";
cli('film:gallery')


// bun run film:gallery - films/index.html: every film of films/ on one page - the film to watch, its cast and places, and the files of the plan.
// A static page with relative links: open it from the disk, nothing is served.

const escape = (value: string) => value.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]!))
const link = (film: string, file: string, label: string) => existsSync(join(FILMS_DIR, film, file)) ? `<a href="${encodeURI(`${film}/${file}`)}">${escape(label)}</a>` : ''
const seconds = (project: FilmProject) => Math.round((project.coverage ?? []).reduce((sum, c) => sum + c.shots.reduce((s, x) => s + x.seconds, 0), 0))
const clock = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`

function card(id: string) {
    const dir = join(FILMS_DIR, id)
    const project: FilmProject = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
    const title = project.brief?.title ?? id
    const final = existsSync(join(dir, `${id}.mp4`)) ? `${id}.mp4` : existsSync(join(dir, `${id}-partial.mp4`)) ? `${id}-partial.mp4` : undefined
    const rendered = existsSync(join(dir, 'videos')) ? readdirSync(join(dir, 'videos')).filter(f => f.endsWith('.mp4')).length : 0
    const clips = existsSync(join(dir, 'output/clips')) ? readdirSync(join(dir, 'output/clips')).filter(f => /^clip-\d+\.json$/.test(f)).length : 0
    const style = existsSync(join(dir, 'input/style.txt')) ? readFileSync(join(dir, 'input/style.txt'), 'utf8').trim().split(/(?<=[.!?])\s/)[0] ?? '' : ''
    const picture = (kind: 'characters' | 'locations', name: string, entry: string) => {
        const file = ['png', 'jpg', 'jpeg', 'webp'].map(ext => `assets/${kind}/${entry}.${ext}`).find(f => existsSync(join(dir, f)))
        return file ? `<figure><img loading="lazy" src="${encodeURI(`${id}/${file}`)}" alt="${escape(name)}"><figcaption>${escape(name)}</figcaption></figure>` : ''
    }
    const cast = (project.cast?.characters ?? []).filter(c => !c.voiceOnly).map(c => picture('characters', c.name, c.id)).join('')
    const places = (project.cast?.locations ?? []).map(l => picture('locations', l.name, l.id)).join('')
    return `<article>
  <h2>${escape(title)}</h2>
  <p class="meta">${escape(id)} · ${project.brief ? escape(`${project.brief.genre} · ${project.brief.tone}`) : 'not planned yet'}${project.coverage ? ` · planned ${clock(seconds(project))}` : ''} · ${rendered} of ${clips} clips rendered</p>
  ${project.brief ? `<p>${escape(project.brief.logline)}</p>` : ''}
  ${style ? `<p class="style">Look: ${escape(style)}</p>` : ''}
  ${final ? `<video controls preload="metadata" src="${encodeURI(`${id}/${final}`)}"></video>` : '<p class="muted">No film assembled yet.</p>'}
  ${cast || places ? `<div class="pictures">${cast}${places}</div>` : ''}
  <p class="files">${[link(id, 'output/shotlist.md', 'shot list'), link(id, 'screenplay.fountain', 'screenplay'), link(id, `${id}.srt`, 'subtitles'), link(id, 'project.json', 'project.json')].filter(Boolean).join(' · ')}</p>
</article>`
}

const films = existsSync(FILMS_DIR) ? readdirSync(FILMS_DIR, {withFileTypes: true}).filter(d => d.isDirectory() && existsSync(join(FILMS_DIR, d.name, 'project.json'))).map(d => d.name).sort() : []
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Films</title>
<style>
:root{--bg:#fafaf7;--fg:#1c1c1a;--muted:#6b6b66;--card:#fff;--line:#e2e2dc;--accent:#8a3b12}
@media (prefers-color-scheme: dark){:root{--bg:#161614;--fg:#ececE6;--muted:#9a9a92;--card:#1f1f1c;--line:#33332f;--accent:#e0a070}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px}h1{font-size:1.6rem;margin:0 0 16px}
article{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 20px}
h2{margin:0 0 4px;font-size:1.25rem}.meta,.muted,.style{color:var(--muted);font-size:.9rem;margin:2px 0 8px}
video{display:block;width:100%;max-height:70vh;background:#000;border-radius:6px;margin:8px 0}
.pictures{display:flex;gap:8px;overflow-x:auto;padding:4px 0}figure{margin:0;flex:0 0 auto;width:120px}
figure img{width:120px;height:120px;object-fit:cover;border-radius:6px;display:block;background:var(--line)}
figcaption{font-size:.75rem;color:var(--muted);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.files{font-size:.9rem}a{color:var(--accent)}
</style></head><body><main>
<h1>Films</h1>
${films.length ? films.map(card).join('\n') : '<p class="muted">No films yet - create one with: bun run film:init</p>'}
</main></body></html>
`
const target = join(FILMS_DIR, 'index.html')
writeFileSync(target, html)
log.info(`${target}: ${films.length} film${films.length === 1 ? '' : 's'}`)
log.output(target)
