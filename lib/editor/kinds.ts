import {join} from 'node:path'
import {defaults, loadProjectConfig, type ProjectConfig, type RenderConfig} from '../config.ts'
import {filmDefaults, loadFilmConfig, type LoadedFilmConfig} from '../film/config.ts'
import {filmRenderConfig} from '../film/pictures.ts'
import {filmDir, filmExists, filmIds} from '../film/setup.ts'
import {FILM_STEP_NAMES} from '../film/store.ts'
import {listProjects, projectDir, projectExists} from '../project-setup.ts'
import {STEP_NAMES} from '../project.ts'
import {filmStatus, projectStatus, type Status} from '../status.ts'
import type {EditorKind} from './project.ts'

// What differs between a music video and a film where the workspace and its tools serve both (#840): the folder, the pipeline and the
// flag the shared tools take, the step names, the config and what a render goes by, the status. One object per kind - code that
// serves both asks it, instead of a `kind === 'film'` of its own. The two pipelines themselves stay apart (index.ts, film.ts).

export type ProjectKind = {
    kind: EditorKind
    /** a film: what a tool's `film` option is set to */
    film: boolean
    /** what such a project is called in a message */
    word: 'music video' | 'film'
    /** the pipeline that plans and renders it */
    pipeline: 'index.ts' | 'film.ts'
    /** what the tools that serve both are told on their command line: nothing for a music video */
    flag: readonly string[]
    /** the steps of its plan, for --redo */
    stepNames: readonly string[]
    dir: (id: string) => string
    exists: (id: string) => boolean
    ids: () => string[]
    status: (id: string) => Promise<Status>
    /** its config.json as the pipeline reads it */
    config: (dir: string) => Promise<ProjectConfig | LoadedFilmConfig>
    /** the defaults of that config */
    defaults: object
    /** what rendering its pictures and clips goes by */
    renderConfig: (dir: string) => Promise<RenderConfig>
    /** the language model the project asks, when it names one */
    llmModel: (dir: string) => Promise<string | undefined>
    /** where the jobs of its pictures are listed */
    picturesFile: (dir: string) => string
}

export const KINDS: Record<EditorKind, ProjectKind> = {
    music: {
        kind: 'music',
        film: false,
        word: 'music video',
        pipeline: 'index.ts',
        flag: [],
        stepNames: STEP_NAMES,
        dir: projectDir,
        exists: projectExists,
        ids: listProjects,
        status: projectStatus,
        config: loadProjectConfig,
        defaults,
        renderConfig: loadProjectConfig,
        llmModel: async dir => (await loadProjectConfig(dir)).llm.model,
        picturesFile: dir => join(dir, 'output', 'assets.json'),
    },
    film: {
        kind: 'film',
        film: true,
        word: 'film',
        pipeline: 'film.ts',
        flag: ['--film'],
        stepNames: FILM_STEP_NAMES,
        dir: filmDir,
        exists: filmExists,
        ids: filmIds,
        status: filmStatus,
        config: loadFilmConfig,
        defaults: filmDefaults,
        renderConfig: async dir => filmRenderConfig(await loadFilmConfig(dir)),
        llmModel: async dir => (await loadFilmConfig(dir)).llm.model,
        picturesFile: dir => join(dir, 'assets.json'),
    },
}

/** The kind of a project, as an object: what differs for it. */
export const kindOf = (target: {kind: EditorKind}): ProjectKind => KINDS[target.kind]
