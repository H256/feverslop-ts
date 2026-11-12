import type {CommandSchema} from '../command-schema.ts'
import {CORNERS, LABEL_MODES} from './config.ts'

// The options of the post-work commands, each written down once (#826): tools/label.ts and tools/intro.ts parse by them, the
// workspace's server builds their arguments from them (lib/editor/runs.ts), lib/cli.ts shows them.

// the file name of a final video of the project (lib/postwork/video.ts VIDEO_NAME): never a path
const VIDEO = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/

const kept = {
    save: {kind: 'flag', help: 'keep the options given in the config.json of the project'},
    'save-default': {kind: 'flag', help: 'keep them in the settings file, for every project'},
    'dry-run': {kind: 'flag', help: 'say what would be done, write nothing', terminalOnly: true},
} as const

export const labelCommand: CommandSchema = {
    command: 'label',
    script: 'tools/label.ts',
    positionals: '<id>',
    either: [['save', 'save-default']],
    options: {
        film: {kind: 'flag', help: 'the id is a film'},
        from: {kind: 'text', shown: '<video>', pattern: VIDEO, help: 'the final video to start from'},
        // a preset, or the path of a PNG on this machine: the page and the server are the same machine
        marker: {
            kind: 'text',
            shown: 'generated-white|<png>',
            pattern: /^[^\n\r\0]+\.png$|^[a-z]+-(white|black)(50)?$/i,
            help: 'an EU icon or a PNG of your own',
        },
        mode: {kind: 'choice', choices: LABEL_MODES, help: 'when it is shown'},
        seconds: {kind: 'number', shown: '5', help: 'how long at the start'},
        interval: {kind: 'number', shown: '60', help: 'every so many seconds, with --mode=interval'},
        corner: {kind: 'choice', choices: CORNERS, help: 'where it sits'},
        size: {kind: 'number', shown: '6', help: 'its height in percent of the video'},
        margin: {kind: 'number', shown: '3', help: 'its distance from the edge in percent of the height'},
        ...kept,
    },
}

export const introCommand: CommandSchema = {
    command: 'intro',
    script: 'tools/intro.ts',
    positionals: '<id>',
    either: [['save', 'save-default']],
    options: {
        film: {kind: 'flag', help: 'the id is a film'},
        from: {kind: 'text', shown: '<video>', pattern: VIDEO, help: 'the final video to start from'},
        // a path on this machine; without it input/intro.<ext> of the project
        file: {kind: 'text', shown: '<video>', emptyMeans: 'input/intro.<ext> of the project', help: 'the intro clip'},
        fade: {kind: 'number', shown: '0.5', help: 'seconds of fade from the intro into the video'},
        ...kept,
    },
}

export const creditsCommand: CommandSchema = {
    command: 'credits',
    script: 'tools/credits.ts',
    positionals: '<id>',
    either: [['save', 'save-default']],
    options: {
        film: {kind: 'flag', help: 'the id is a film'},
        from: {kind: 'text', shown: '<video>', pattern: VIDEO, help: 'the final video to start from'},
        title: {kind: 'text', shown: '<text>', help: 'the title on the title card'},
        artist: {kind: 'text', shown: '<text>', help: 'who made the song (a music video)'},
        director: {kind: 'text', shown: '<text>', help: 'who directed it (a film)'},
        disclosure: {kind: 'text', shown: '<text>', help: 'the words that say it is made with AI'},
        marker: {kind: 'text', shown: 'generated-white|<png>', help: 'a marker on the title card'},
        line: {kind: 'list', shown: 'TEXT', none: 'no-lines', field: 'extra', help: 'a line of your own in the credits'},
        hardware: {kind: 'text', shown: '<text>', help: 'your words on the hardware it was made with'},
        facts: {kind: 'switch', help: 'say what it was made with: the models and the hardware'},
        opening: {kind: 'switch', help: 'the title card before the video'},
        end: {kind: 'switch', help: 'the credits after it'},
        'opening-seconds': {kind: 'number', shown: '4', help: 'how long the title card is'},
        'end-seconds': {kind: 'number', shown: '0', help: 'how long the credits are - 0: as long as they need'},
        sound: {kind: 'text', shown: '<file>', help: 'a sound under the credits'},
        font: {kind: 'text', shown: '<ttf>', help: 'the font of the cards'},
        ...kept,
    },
}

export const descriptionCommand: CommandSchema = {
    command: 'description',
    script: 'tools/description.ts',
    positionals: '<id>',
    either: [['save', 'save-default']],
    options: {
        film: {kind: 'flag', help: 'the id is a film'},
        from: {kind: 'text', shown: '<video>', pattern: VIDEO, help: 'the finished video you publish'},
        story: {kind: 'switch', help: 'a teaser of the story'},
        'new-story': {kind: 'flag', help: 'the teaser written anew'},
        facts: {kind: 'switch', help: 'say how it was made: the models, the hardware, the time per phase'},
        hardware: {kind: 'text', shown: '<text>', help: 'your words on the hardware'},
        line: {kind: 'list', shown: 'TEXT', none: 'no-lines', field: 'extra', help: 'a line of your own'},
        tag: {kind: 'list', shown: 'TAG', none: 'no-tags', field: 'tags', help: 'a hashtag'},
        ...kept,
    },
}
