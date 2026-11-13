// Lint for the CLI (lib/, tools/, comfy/, the entry points) and the workspace client (client/src), type-aware (#737).
// Formatting is Prettier's (.prettierrc): eslint-config-prettier turns every rule off that it would fight with.
// bun run lint / lint:fix - there is no CI gate, run it before a PR.
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'

// the no-unsafe-* rules, for code where an any says nothing about the code (#891)
const UNSAFE_OFF = Object.fromEntries(
    ['no-unsafe-assignment', 'no-unsafe-member-access', 'no-unsafe-argument', 'no-unsafe-call', 'no-unsafe-return'].map(rule => [
        `@typescript-eslint/${rule}`,
        'off',
    ]),
)

export default tseslint.config(
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            'client/public/**',
            'lib/editor/public/**',
            'comfy/nodes.ts',
            'projects/**',
            'films/**',
            'library/**',
            'coverage/**',
            'client/playwright-report/**',
            'client/test-results/**',
            // generated or plain JS helpers: not part of the typed code
            '**/*.js',
            '**/*.mjs',
            '**/*.cjs',
        ],
    },
    ...tseslint.configs.recommendedTypeChecked,
    ...pluginVue.configs['flat/recommended'],
    {
        languageOptions: {
            parserOptions: {
                // each file is checked with the tsconfig nearest to it: the root one for the CLI, client/tsconfig.json for the client
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: ['.vue'],
            },
        },
    },
    {
        // the client's tests and configs are typed by its tsconfig.node.json, which the project service does not look for
        files: ['client/tests/**/*.ts', 'client/*.config.ts'],
        languageOptions: {parserOptions: {projectService: false, project: ['client/tsconfig.node.json'], tsconfigRootDir: import.meta.dirname}},
    },
    {
        files: ['**/*.vue'],
        languageOptions: {parserOptions: {parser: tseslint.parser}},
    },
    {
        rules: {
            // they find real bugs here: a forgotten await (project.save(), uploads, ComfyUI calls), async callbacks nobody awaits,
            // a union member a switch misses (the 'size' source that broke the client build, #733)
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            // a switch with a default branch has decided what the other cases do
            '@typescript-eslint/switch-exhaustiveness-check': ['error', {considerDefaultExhaustiveForUnions: true}],
            // typeof import(...) names the type of a workflow loaded at run time (loadWorkflow) - there is nothing to import
            '@typescript-eslint/consistent-type-imports': ['error', {disallowTypeAnnotations: false}],
            // ({focus, ...shot}) => shot leaves fields out on purpose
            '@typescript-eslint/no-unused-vars': [
                'error',
                {argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true},
            ],
            // a ternary or && as a statement (toggle a set member, play or stop) is how the code is written
            '@typescript-eslint/no-unused-expressions': ['error', {allowTernary: true, allowShortCircuit: true}],
            // let {seed, size} where only seed changes
            'prefer-const': ['error', {destructuring: 'all'}],
            // a caught error is thrown on as it came
            '@typescript-eslint/only-throw-error': ['error', {allowThrowingUnknown: true}],
            '@typescript-eslint/ban-ts-comment': ['error', {'ts-ignore': 'allow-with-description'}],
            // async marks a function that returns a promise by contract (a handler, a stub) - an await in it is not the point
            '@typescript-eslint/require-await': 'off',
            // the forms edit a reactive draft object their page owns, on purpose (CastMemberForm, CreditsForm, ...)
            'vue/no-mutating-props': 'off',
            // it calls assertions unnecessary that tsc needs (its fix broke the typecheck: 'music' as EditorKind, the OpenAI delta)
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
            // -1 | number says what -1 means
            '@typescript-eslint/no-redundant-type-constituents': 'off',
            eqeqeq: ['error', 'smart'],
            // noUncheckedIndexedAccess: x[i]! is deliberate
            '@typescript-eslint/no-non-null-assertion': 'off',
            // any from JSON.parse and ComfyUI answers - told, to be tightened step by step
            '@typescript-eslint/no-unsafe-assignment': 'warn',
            '@typescript-eslint/no-unsafe-member-access': 'warn',
            '@typescript-eslint/no-unsafe-argument': 'warn',
            '@typescript-eslint/no-unsafe-call': 'warn',
            '@typescript-eslint/no-unsafe-return': 'warn',
            // String(x) and template strings of unknown values checked before (LLM answers, JSON, form fields) - told, not an error
            '@typescript-eslint/restrict-template-expressions': ['warn', {allowNumber: true, allowBoolean: true}],
            '@typescript-eslint/no-base-to-string': 'warn',
            '@typescript-eslint/unbound-method': 'off',
            // candidates after the rollout
            '@typescript-eslint/no-unnecessary-condition': 'off',
            '@typescript-eslint/prefer-nullish-coalescing': 'off',
        },
    },
    {
        // bun:test types expect().rejects without a promise; tests may use any and assert what they build
        files: ['**/*.test.ts', 'client/tests/**/*.ts', 'tests/**/*.ts'],
        rules: {
            '@typescript-eslint/await-thenable': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
            // JSON.parse and test data as any: a test asserts what it built, an unsafe access only fails the test (#891)
            ...UNSAFE_OFF,
        },
    },
    {
        // a .vue module is resolved by vue-tsc (bun run client:check), not by the TypeScript service ESLint asks: every value of a
        // component - a ref to it, its exposed methods - is an "error typed value" here, which says nothing about the code (#891).
        // Types the .ts files need live in .ts files (features/timeline/beatCast.ts), so that these rules still see them there.
        files: ['client/src/**/*.vue', 'client/src/main.ts', 'client/src/router.ts'],
        rules: UNSAFE_OFF,
    },
    {
        // the node types are generated from a server (comfy/nodes.ts, not in git): without them the workflow helpers are any
        files: ['comfy/**/*.ts'],
        // and every node call is any then: the warnings said nothing but that the file is missing (#891)
        rules: {'@typescript-eslint/no-explicit-any': 'off', ...UNSAFE_OFF},
    },
    prettier,
)
