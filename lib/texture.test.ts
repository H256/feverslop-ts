import {expect, test} from "bun:test";
import {type Gray, laplacianEnergy, median, perLink, shrink, textureOf} from "./texture.ts";

// a reproducible noisy picture: a soft gradient with grain of the given strength
const picture = (grain: number, width = 96, height = 64, seed = 7): Gray => {
    let s = seed
    const random = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    const data = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = Math.max(0, Math.min(255, Math.round(60 + x + (random() - 0.5) * grain)))
    return {data, width, height}
}
const blurred = ({data, width, height}: Gray): Gray => {
    const out = new Uint8Array(width * height)
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        let s = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += data[(y + dy) * width + x + dx]!
        out[y * width + x] = Math.round(s / 9)
    }
    return {data: out, width, height}
}

test('a flat picture has no texture, a grainier one more than a softer one', () => {
    expect(laplacianEnergy({data: new Uint8Array(64 * 64).fill(128), width: 64, height: 64})).toBe(0)
    expect(laplacianEnergy(picture(60))).toBeGreaterThan(laplacianEnergy(picture(20)))
    expect(laplacianEnergy(blurred(picture(60)))).toBeLessThan(laplacianEnergy(picture(60)))
})

test('more contrast alone is not more texture - the energy is divided by the local contrast', () => {
    const soft = picture(40)
    const strong = {...soft, data: soft.data.map(v => Math.min(255, Math.round((v - 60) * 2 + 20)))}
    expect(laplacianEnergy(strong) / laplacianEnergy(soft)).toBeCloseTo(1, 1)
})

test('the structure scale is the picture shrunk by 4, each pixel the mean of the ones it covers', () => {
    const small = shrink({data: Uint8Array.from({length: 16}, (_, i) => i), width: 4, height: 4}, 2)
    expect([...small.data]).toEqual([2.5, 4.5, 10.5, 12.5])
    const t = textureOf(picture(60, 128, 96))
    expect(t.fine).toBeGreaterThan(0)
    expect(t.structure).toBeGreaterThan(0)
})

test('per link: the factor that takes the first value of a chain to its last', () => {
    expect(perLink([1, 1.3, 1.69])).toBeCloseTo(1.3, 6)
    expect(perLink([2])).toBe(1)
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
})
