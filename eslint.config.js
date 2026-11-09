// Lint for the CLI (lib/, tools/, comfy/, the entry points) and the workspace client (client/src), type-aware (#737).
// Formatting is Prettier's (.prettierrc): eslint-config-prettier turns every rule off that it would fight with.
// bun run lint / lint:fix - there is no CI gate, run it before a PR.
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
    {
        ignores: [
            '**/node_modules/**', '**/dist/**', 'client/public/**', 'lib/editor/public/**', 'comfy/nodes.ts',
            'projects/**', 'films/**', 'library/**', 'coverage/**', 'client/playwright-report/**', 'client/test-results/**',
            // generated or plain JS helpers: not part of the typed code
            '**/*.js', '**/*.mjs', '**/*.cjs',
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
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_'}],
            eqeqeq: ['error', 'smart'],
            // noUncheckedIndexedAccess: x[i]! is deliberate
            '@typescript-eslint/no-non-null-assertion': 'off',
            // any from JSON.parse and ComfyUI answers - told, to be tightened step by step
            '@typescript-eslint/no-unsafe-assignment': 'warn',
            '@typescript-eslint/no-unsafe-member-access': 'warn',
            '@typescript-eslint/no-unsafe-argument': 'warn',
            '@typescript-eslint/no-unsafe-call': 'warn',
            '@typescript-eslint/no-unsafe-return': 'warn',
            '@typescript-eslint/restrict-template-expressions': ['error', {allowNumber: true, allowBoolean: true}],
            '@typescript-eslint/unbound-method': 'off',
            // candidates after the rollout
            '@typescript-eslint/no-unnecessary-condition': 'off',
            '@typescript-eslint/prefer-nullish-coalescing': 'off',
        },
    },
    prettier,
)
