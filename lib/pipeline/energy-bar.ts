import {styles} from '../log.ts'

/** The energy of a section, a beat or a clip (0-1) as a bar of eight blocks, for the run's listings. */
export function energyBar(value: number) {
    const filled = Math.round(value * 8)
    return styles.answer('█'.repeat(filled)) + styles.muted('░'.repeat(8 - filled))
}
