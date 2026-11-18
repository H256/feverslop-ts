import {expect, test} from 'bun:test'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readFineWaveform} from './waveform.ts'

// #1159: the lyrics timing and the requests of a plan run read the loudness of the same vocals - decoded once
test('the loudness of a file is decoded once per process; a file that is not there has none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'waveform-'))
    const file = join(dir, 'vocals.wav')
    expect(await readFineWaveform(file, 100)).toBeUndefined()
    expect(Bun.spawnSync(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', file]).exitCode).toBe(0)
    const [a, b] = await Promise.all([readFineWaveform(file, 100), readFineWaveform(file, 100)])
    expect(a).toBeDefined()
    expect(a).toBe(b)
    expect(a!.length).toBe(100)
    expect((await readFineWaveform(file, 10))!.length).toBe(10)
    // ffmpeg's first start on a cold machine can take longer than the default 5 s
}, 30_000)
