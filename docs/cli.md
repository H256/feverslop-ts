# Command-line output

All TypeScript commands in `package.json`, plus `bun index.ts`, share these options:

| Option | Behavior |
| --- | --- |
| `--help`, `-h` | Print command usage and common options, without doing work. |
| `--verbose`, `-v` | Include cached step details in the terminal. |
| `--debug` | Include the stack trace on failure. Also available as `FEVERSLOP_DEBUG=1`. |
| `--quiet` | Suppress human progress/results, but retain warnings, errors and interactive questions. Child pipelines inherit this mode. |
| `--banner` | Show the large ASCII wordmark in a terminal. Setup and init show it by default. |

The normal view starts with the command, positional context and selected mode. Human output uses the shared logger so it cooperates with the live activity board. Success includes elapsed wall time and warning count, plus output/next command when the command supplies them. A cancelled wizard does not print a success footer. Warnings and errors use stderr. `NO_COLOR` disables colors; redirected output has no colors, banner or cursor animation.

Long-running concurrent jobs use a bounded multi-line board at the bottom of a terminal. Narrow windows clip individual statuses by display width, not by byte or JavaScript string length. Extra active jobs are counted when they do not fit. Their durations are elapsed job times, not a total-time percentage or an ETA. Persistent logs contain events and cached details, never animated board frames.

`status <project> --json`, `inspect <project> <clip> --json` and `stats --json` produce exactly one JSON value on stdout, even with `--quiet`. Errors in those modes are JSON on stderr with a nonzero exit code. Human headers and summaries are suppressed. See [statistics](stats.md) for filtering and metric definitions. Other tools do not claim JSON support unless their help lists it.

```sh
bun index.ts --help
bun run status my-project
bun run inspect my-project slot-001 --json
bun index.ts my-project --render=videos --quiet
bun run init --banner
```

On a pipeline failure, completed outputs remain available. Correct the reported cause and repeat the command to reuse completed steps. Use `bun run status <project>` to inspect missing/stale outputs before changing redo or refresh flags. `--debug` adds a stack trace; the error also links the full run log when one is open.

Contributor convention: use `log.step`/`log.line` for step details, `log.info` for unconditional human content, `log.warn`/`log.error` for diagnostics, `log.output`/`log.next` for artifacts and actionable commands, and `log.json` exclusively for machine output. Keep Clack for interactive input rather than parallel logging APIs. Common options are consumed before tool-specific parsing; `--` ends common-option handling.
