import {expect, test} from 'bun:test'
import {readdirSync, readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

// #838: a gap, a radius and a font size come from the scales in :root (styles/tokens.css) - docs/design-system.md.
const src = fileURLToPath(new URL('../../src/', import.meta.url))
const files = readdirSync(src, {recursive: true, encoding: 'utf8'}).filter(f => f.endsWith('.css') || f.endsWith('.vue'))
const tokens = readFileSync(`${src}styles/tokens.css`, 'utf8').split(':root {')[1]!.split('}')[0]!

test('no literal gap, radius or font size outside the scales', () => {
  const literal = /(?:\b(?:row-|column-)?gap|border-radius|font-size): *[\d.]+(?:px|rem|%)|\bfont: *(?:\d+ )?[\d.]+px/g
  const found = files.flatMap(f => {
    const text = readFileSync(`${src}${f}`, 'utf8').replace(tokens, '')
    return [...text.matchAll(literal)].map(m => `${f}: ${m[0]}`)
  })
  expect(found).toEqual([])
})

// #838: a page's layout is said by its classes on the scales, never by an inline style - a bound :style (a position computed) is fine
test('no inline style attribute with a fixed value', () => {
  const found = files
    .filter(f => f.endsWith('.vue'))
    .flatMap(f => [...readFileSync(`${src}${f}`, 'utf8').matchAll(/(?<![:\w-])style="[^"]*"/g)].map(m => `${f}: ${m[0]}`))
  expect(found).toEqual([])
})
