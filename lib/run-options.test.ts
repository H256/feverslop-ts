import {expect, test} from 'bun:test'
import {helpDetails} from './cli-help.ts'
import {FILM_RENDER, MUSIC_RENDER, readRunOptions, type RunOptionValues} from './run-options.ts'

const none: RunOptionValues = {
    render: '',
    only: '',
    again: false,
    preview: false,
    retake: '',
    'new-anchor': false,
    'picture-prompt': '',
    'picture-anchor': '',
    'picture-description': '',
    'describe-picture': false,
    refresh: '',
    strict: false,
    review: false,
    until: '',
    'dry-run': false,
    json: false,
}
const read = (given: Partial<RunOptionValues>, renderable = MUSIC_RENDER, terminal = true) => readRunOptions({...none, ...given}, renderable, terminal)

// #841: the options of a run both pipelines take, checked in one place
test('what is rendered: "all" is pictures, clips and the final video; a music video also has its song, a film not', () => {
    expect([...read({render: 'all'}).render]).toEqual(['images', 'videos', 'final'])
    expect([...read({render: 'song,videos'}).render]).toEqual(['song', 'videos'])
    expect(() => read({render: 'song'}, FILM_RENDER)).toThrow('--render: unknown "song" - use images, videos, final or all')
    expect(() => read({render: 'movie'})).toThrow('use song, images, videos, final or all')
    expect([...read({refresh: 'pictures,clips'}).refresh]).toEqual(['pictures', 'clips'])
    expect(() => read({refresh: 'films'}, FILM_RENDER)).toThrow('--refresh: unknown "films" - use images, videos (or pictures, clips)')
})

// #937: --render said images and videos, --refresh pictures and clips - each takes both words, and means the same as before
test('the words of what is rendered: images and pictures, videos and clips, are the same in --render and --refresh', () => {
    expect([...read({refresh: 'images,videos'}).refresh]).toEqual(['pictures', 'clips'])
    expect([...read({refresh: 'videos,clips'}).refresh]).toEqual(['clips'])
    expect([...read({render: 'pictures,clips'}).render]).toEqual(['images', 'videos'])
    expect([...read({render: 'clips', again: true, only: 'slot-001'}).render]).toEqual(['videos'])
})

test('how the options go together', () => {
    expect(() => read({again: true, only: 'slot-001'})).toThrow('--again goes with --render=videos or --render=images')
    expect(() => read({again: true, render: 'videos'})).toThrow('--again needs --only=slot-001,...')
    expect(() => read({again: true, render: 'videos'}, FILM_RENDER)).toThrow('--again needs --only=clip-005,...')
    expect(() => read({preview: true})).toThrow('--preview goes with --render=videos or --render=final')
    // two commands to run as they are (#937)
    expect(() => readRunOptions({...none, preview: true, render: 'videos,final'}, MUSIC_RENDER, true, 'tides')).toThrow(
        'two runs: bun index.ts tides --render=videos --preview, then bun index.ts tides --render=final --preview',
    )
    expect(() => readRunOptions({...none, preview: true, render: 'all'}, FILM_RENDER, true, 'heist')).toThrow('bun film.ts heist --render=final --preview')
    expect(() => read({retake: 'slot-007:1-2', render: 'videos'})).toThrow('--retake is a run of its own')
    expect(read({retake: 'slot-007:shot2'}).retake).toEqual({clip: 'slot-007', shot: 2})
    expect(() => read({'picture-anchor': 'a.png', render: 'images', again: true, only: 'a,b'})).toThrow('one picture in --only')
    expect(() => read({'describe-picture': true})).toThrow('go with --picture-anchor')
    expect(() => read({review: true}, MUSIC_RENDER, false)).toThrow('--review asks in the terminal')
    expect(() => read({json: true})).toThrow('--json goes with --dry-run')
    expect(() => read({review: true, 'dry-run': true})).toThrow('--review and --dry-run do not go together')
    expect(read({until: 'look'}).until).toBe('look')
    expect(() => read({until: 'beats'})).toThrow('--until: unknown "beats"')
})

test('the help says what "all" leaves out and what a run renders: missing, stale, again (#937)', () => {
    const plan = helpDetails('plan')
    expect(plan).toContain('never the song: --render=song makes a new one')
    for (const command of ['plan', 'film']) {
        const help = helpDetails(command)
        expect(help).toContain('What --render renders is what is missing')
        expect(help).toContain('--refresh=images,videos')
        expect(help).toContain('--again renders the ones in --only once more')
    }
})
