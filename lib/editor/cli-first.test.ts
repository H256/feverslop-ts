import {describe, expect, test} from 'bun:test'
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {LIBRARY_ROUTES, PROJECT_ROUTES} from './project-routes.ts'

// CLI first: whatever the workspace changes, a command changes the same way. The pages either start a command (RunControl) or call
// the very function a command calls - one place for what a change does, so that the page and the terminal cannot drift apart.
// The routes say what they change a project with (lib/editor/project-routes.ts, #840); this checks that a command calls each of them.

const root = join(import.meta.dir, '..', '..')
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const routes = [...PROJECT_ROUTES, ...LIBRARY_ROUTES]

describe('CLI first', () => {
    test('every POST route says what it changes, a GET route changes nothing', () => {
        for (const route of routes) expect({path: route.path, says: route.changes !== undefined}).toEqual({path: route.path, says: route.method === 'POST'})
    })
    test('every function a workspace route changes a project with is one a command calls too', () => {
        const commands = [
            ...readdirSync(join(root, 'tools'))
                .filter(f => f.endsWith('.ts'))
                .map(f => read(`tools/${f}`)),
            read('index.ts'),
            read('film.ts'),
        ].join('\n')
        const changes = [...new Set(routes.flatMap(route => (typeof route.changes === 'object' ? route.changes.map(change => change.name) : [])))]
        // the table still names them
        for (const name of [
            'writeCast',
            'writeLook',
            'writeStory',
            'writeSinging',
            'writeTiming',
            'pickVersion',
            'writeOverride',
            'writeCastingEntry',
            'writeConfig',
        ])
            expect(changes).toContain(name)
        expect(changes).toContain('changeLibrary')
        const pageOnly = changes.filter(name => !commands.includes(`${name}(`))
        expect(pageOnly).toEqual([])
    })
    // #830: a change of the direction and the build of the prompts are one request - a page never takes, restores, drops or edits
    // and then starts the plan run itself: a failure or a closed page in between would leave the prompts as they were
    test('no page starts the plan run itself after changing the direction', () => {
        const changes = ['saveDirection', 'saveDirectionEdits', 'takeDirection', 'dropDirection', 'restoreDirection', 'shotPeople']
        const files: string[] = []
        const walk = (dir: string) => {
            for (const entry of readdirSync(join(root, dir), {withFileTypes: true}))
                if (entry.isDirectory()) walk(`${dir}/${entry.name}`)
                else if (entry.name.endsWith('.vue') || entry.name.endsWith('.ts')) files.push(`${dir}/${entry.name}`)
        }
        walk('client/src')
        // one action: a declaration of the page's script, from its line on to the next one
        const actionsOf = (text: string) => {
            const actions: string[] = []
            for (const line of text.split('\n'))
                if (actions.length === 0 || ['const ', 'function ', 'async function '].some(start => line.startsWith(start))) actions.push(line)
                else actions[actions.length - 1] += `\n${line}`
            return actions
        }
        const found = files.flatMap(file =>
            actionsOf(read(file))
                .filter(action => changes.some(name => action.includes(`api.${name}(`)) && action.includes("start({type: 'plan'"))
                .map(action => `${file}: ${action.split('\n')[0]}`),
        )
        expect(found).toEqual([])
    })
})
