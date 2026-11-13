import {describe, expect, test} from 'bun:test'
import {idProblem, languageLabel, newProjectDraft, newProjectProblem, newProjectRequest, suggestedId} from '../../src/features/projects/newProject'

// #939: the form of a new music video in the words of a person, each choice still what `bun run init` takes
describe('a new music video from the form', () => {
  test('the id is suggested from the name: lowercase, digits and "-"', () => {
    expect(suggestedId('Well of Youth')).toBe('well-of-youth')
    expect(suggestedId('  Größe & Café!  ')).toBe('grosse-cafe')
    expect(suggestedId('???')).toBe('')
    expect(suggestedId('a'.repeat(60))).toHaveLength(48)
  })

  test('an id that is no folder name, or one there is already, is said - empty is not yet', () => {
    expect(idProblem('', ['rain'])).toBeUndefined()
    expect(idProblem('rain', ['rain'])).toContain('There is a project "rain" already')
    expect(idProblem('Rain Song', [])).toContain('Lowercase letters, digits and "-" only')
    expect(idProblem('-rain', [])).toContain('not at the start or the end')
    expect(idProblem('rain-2', ['rain'])).toBeUndefined()
  })

  test('who sings: nobody, chosen by the plan, or these people - what the command took before', () => {
    const draft = {...newProjectDraft(), id: 'rain', from: 'idea' as const, idea: 'rain'}
    expect(newProjectRequest({...draft, singersMode: 'nobody', singers: 'Lira'}).singers).toBeUndefined()
    expect(newProjectRequest({...draft, singersMode: 'auto'}).singers).toBe('auto')
    expect(newProjectRequest({...draft, singersMode: 'names', singers: ' Lira, Kael '}).singers).toBe('Lira, Kael')
    expect(newProjectProblem({...draft, singersMode: 'names', singers: ' '})).toContain('Who sings')
  })

  test('the language: any code, named when it is one; one that is none is said before it is sent', () => {
    expect(languageLabel('de')).toBe('German')
    expect(languageLabel('is')).toBe('Icelandic')
    expect(languageLabel('xx-not')).toBeUndefined()
    const draft = {...newProjectDraft(), id: 'rain', from: 'idea' as const, idea: 'rain'}
    expect(newProjectProblem({...draft, language: 'gsw'})).toBeUndefined()
    expect(newProjectProblem({...draft, language: 'klingonish'})).toContain('no language code')
    expect(newProjectRequest({...draft, language: ' de '}).language).toBe('de')
  })

  test('a song: chosen and sent, or a path typed - the path the server put it at is what init gets', () => {
    const draft = {...newProjectDraft(), id: 'rain', lyrics: 'la'}
    expect(newProjectProblem(draft)).toContain('The song: choose its file, or type where it is')
    const sent = {...draft, song: '/tmp/workspace-song-x/song.mp3', sent: {name: 'my song.mp3', bytes: 4}}
    expect(newProjectProblem(sent)).toBeUndefined()
    expect(newProjectRequest(sent).song).toBe('/tmp/workspace-song-x/song.mp3')
    expect(newProjectProblem({...sent, id: 'rain'}, ['rain'])).toContain('already')
    expect(newProjectProblem({...sent, id: ''})).toContain('The id')
  })
})
