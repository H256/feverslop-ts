import {expect, test} from 'bun:test'
import {blocksOf} from '../../src/lib/markdown'

test('blocksOf: headings, paragraphs, rules, bold and italic', () => {
  const blocks = blocksOf('# The Convergence\n\nThe cathedral\nhad no ceiling.\n\n---\n\n**Maren** stood in the *mist*.')
  expect(blocks).toEqual([
    {type: 'heading', level: 1, runs: [{text: 'The Convergence'}]},
    {type: 'paragraph', runs: [{text: 'The cathedral had no ceiling.'}]},
    {type: 'rule'},
    {type: 'paragraph', runs: [{text: 'Maren', strong: true}, {text: ' stood in the '}, {text: 'mist', em: true}, {text: '.'}]},
  ])
})

test('blocksOf: markup of HTML stays text, a lone asterisk stays', () => {
  expect(blocksOf('<script>alert(1)</script> 5 * 3')).toEqual([{type: 'paragraph', runs: [{text: '<script>alert(1)</script> 5 * 3'}]}])
  expect(blocksOf('snake_case_word')).toEqual([{type: 'paragraph', runs: [{text: 'snake_case_word'}]}])
})
