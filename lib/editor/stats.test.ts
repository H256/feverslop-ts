import {expect, test} from 'bun:test'
import {statsView} from './stats.ts'

// #836: the Stats page asks with the command's own filters - a kind it does not know is refused in its words
test('the Stats page takes the kinds and windows of bun run stats', async () => {
    await expect(statsView({kind: 'dance'})).rejects.toThrow('no such kind "dance" - clip, picture, song, interpolation, llm')
    await expect(statsView({since: 'yesterday-ish'})).rejects.toThrow()
})
