import {describe, expect, test} from 'bun:test'
import {workflowDir, workflowPath, workflowProblem} from './config.ts'
import {join} from 'node:path'

describe('workflow paths', () => {
    test('resolves a workflow name inside comfy/workflows', () => {
        expect(workflowPath('h3-ref2video')).toBe(join(workflowDir, 'h3-ref2video.ts'))
        expect(workflowProblem('videoWorkflow', 'h3-ref2video')).toBeUndefined()
    })

    test('rejects slash and backslash traversal before checking or importing files', () => {
        for (const name of ['../lib/settings', '..\\lib\\settings', '/tmp/workflow', 'C:\\temp\\workflow', '']) {
            expect(workflowPath(name)).toBeUndefined()
            expect(workflowProblem('videoWorkflow', name)).toContain('no workflow comfy/workflows/')
        }
    })
})
