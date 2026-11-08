import {describe, expect, test} from 'bun:test';
import type {AskOptions} from './llm.ts';
import {genderNote} from './gender-check.ts';

describe('genderNote', () => {
    const request: AskOptions[] = []
    const answering = (answer: unknown) => async <T>(options: AskOptions) => {
        request.push(options)
        return answer as T
    }

    test('notes conflicting known genders and names the supplied text noun', async () => {
        request.length = 0
        const note = await genderNote('Mara', 'She walks into the room.', 'A man in a blue coat.', 'script', answering({story: 'female', picture: 'male'}))
        expect(note).toContain('Mara as a woman')
        expect(note).toContain('new picture shows a man')
        expect(note).toContain('pronouns in the script stay as they are')
        expect(request[0]!.schema).toMatchObject({properties: {story: {enum: ['female', 'male', 'unknown']}}})
    })

    test('agrees or unknown answers do not produce a note', async () => {
        expect(await genderNote('Mara', 'She sings.', 'A woman sings.', 'story', answering({story: 'female', picture: 'female'}))).toBeUndefined()
        expect(await genderNote('Mara', 'They sing.', 'A person sings.', 'story', answering({story: 'unknown', picture: 'female'}))).toBeUndefined()
    })
})
