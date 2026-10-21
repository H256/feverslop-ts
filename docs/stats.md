# Performance statistics

`bun run stats` shows a compact overview, up to eight render groups and eight LLM groups, then queue/phase coverage. Grouping defaults to workflow variant and GPU. Long groups become cards in narrow terminals. Use `--details` for all groups, cleaned p90, baseline names and token breakdowns by model, step and project. `--json` returns the full report without human headers or a footer; `--top` also limits JSON rows when explicitly supplied.

```sh
bun run stats --since=7d --sort=p90 --top=10
bun run stats --project=my-project --kind=clip --details
bun run stats --by=variant,gpu --compare --baseline="NVIDIA GeForce RTX 5090"
bun run stats --kind=llm --json
bun run stats --since=2026-10-01 --json > stats.json
```

| Option | Meaning |
| --- | --- |
| `--by=variant,gpu` | Comma-separated workflow, variant, resolution, server or gpu. LLM duration rows always group by model. |
| `--kind=clip` | Select clip, picture, song, interpolation or llm across the **entire** report. |
| `--project=id` | Select one project across the entire report. |
| `--since=7d` | Positive relative hours/days/weeks, an ISO date (UTC midnight), or ISO timestamp with timezone. Undated old measurements cannot match a time window. |
| `--sort=p90` | name ascending; median, p90, n or failed descending. p90 sorting uses inclusive warm p90. |
| `--top=10` | Limit each duration table after selecting its baseline. Token details and summary still cover the entire selection. |
| `--compare` | Compare benchmark medians to the first alphabetic group with warm samples. With several dimensions, compare within the first dimension. |
| `--baseline="name"` | Select a GPU/final dimension value or exact full group key; implies compare. Applies to renders, or LLM rows with `--kind=llm`. An absent baseline is an error. |
| `--details` | Expand duration and token details. |
| `--json` | One report document on stdout, including empty selections. Failures are JSON on stderr and exit 1. |

## Read the numbers correctly

- **Benchmark median and n:** successful warm jobs, excluding durations over twice the preliminary warm median when there are at least four warm samples. This retains the existing benchmark definition.
- **p90 warm and warm n:** all successful warm jobs, **including slow outliers**. Cold starts are counted separately. This represents the warm-job tail, not end-to-end latency including cold starts and failures.
- **p90 clean:** the previous, outlier-filtered p90, available under `--details` and as `p90` in JSON. Inclusive p90 is `warmP90` in JSON. Percentiles use linear interpolation.
- **Small sample:** fewer than five benchmark samples; differences are descriptive, not evidence of statistical significance.
- **Comparisons:** percentages appear only when both rows have one matching known workload (kind, workflow/model, variant, workflow hash when recorded, frames, size and endpoint). Mixed or unknown workloads are marked and not ranked by a speedup percentage. Same hardware alone does not make two jobs comparable. Baseline selection happens before sorting and limiting; missing baselines within one subgroup are marked rather than silently replaced.
- **Failed attempts, retries and manual reruns:** separate recorded events, not a count of unique jobs permanently lost. No job-level failure rate is inferred without job IDs.
- **Measured job time:** sum of recorded durations, including failed/retry attempts where known. Jobs may overlap; this is not elapsed wall time or GPU utilization.
- **Queue and phases:** successful render measurements only, with a sample count per field. Zero is a real measurement; missing is not zero. Phase bars divide by the sum of recorded phase seconds and exclude queue/missing phases. They are not a complete wall-clock breakdown.
- **Tokens:** only endpoint-reported values are summed, including paid failed/retried calls when they report usage. Coverage distinguishes complete input+output usage, partial usage and missing usage. Cached input is part of input; reasoning is part of output, never added twice.
- **Costs:** approximate input/output rates from the settings `prices` map, applied only to complete usage. Each currency is totaled separately and shows priced-call coverage. No price or usage means unavailable, not free. Cached tokens currently use the configured input rate; provider billing and cache discounts can differ.

The source remains the central timings JSONL (`FEVERSLOP_TIMINGS` overrides its path). Like the previous stats command, legacy project timing files are migrated into that store before reading. Invalid duration values are excluded from metrics and counted in the overview; malformed JSON lines retain the existing reader behavior of being ignored.
