import {describe, expect, test} from "bun:test";
import {matchFilter} from "./colormatch.ts";

describe('matchFilter - a continuing clip matched to the clip before', () => {
    test('stretches the luma from its own black and white to those of the clip before, shifts the chroma (tides slot-013 -> 014)', () => {
        const ref = {ylow: 33, yhigh: 156.8, uavg: 121.8, vavg: 132.3}
        const cur = {ylow: 29, yhigh: 150.8, uavg: 122.3, vavg: 132}
        expect(matchFilter(ref, cur)).toBe("lutyuv=y='clip((val-29)*1.016+33,16,235)':u='clip(val+-0.5,16,240)':v='clip(val+0.3,16,240)'")
    })
    test('the same picture is left as it is', () => {
        const s = {ylow: 20, yhigh: 200, uavg: 128, vavg: 128}
        expect(matchFilter(s, s)).toBe("lutyuv=y='clip((val-20)*1+20,16,235)':u='clip(val+0,16,240)':v='clip(val+0,16,240)'")
    })
})
