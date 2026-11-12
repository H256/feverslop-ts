<script setup lang="ts">
import {ref, watch} from 'vue'
import type {StatsRow} from '../../../../shared/workspace'
import {workspace} from '../../api/workspace'
import CopyCommand from '../../components/CopyCommand.vue'
import PageBar from '../../components/PageBar.vue'
import ResourceState from '../../components/ResourceState.vue'
import SegmentedControl from '../../components/SegmentedControl.vue'
import {useResource} from '../../composables/useResource'
import {usePageTitle} from '../../services/chrome'

/**
 * The measured times of this machine (#836): what `bun run stats --json` reports - every render and every call of the language
 * model a run timed, per workflow variant and GPU, with failures and retries. Read only; nothing here starts anything.
 */
usePageTitle('Stats', 'Stats · Workspace')
const SINCE = [
  {value: '7d', label: '7 days'},
  {value: '30d', label: '30 days'},
  {value: 'all', label: 'All'},
] as const
const KINDS = [
  {value: 'all', label: 'All'},
  {value: 'clip', label: 'Clips'},
  {value: 'picture', label: 'Pictures'},
  {value: 'interpolation', label: 'Interpolation'},
  {value: 'llm', label: 'Language model'},
] as const
const since = ref<(typeof SINCE)[number]['value']>('30d')
const kind = ref<(typeof KINDS)[number]['value']>('all')
const filters = () => ({since: since.value === 'all' ? undefined : since.value, kind: kind.value === 'all' ? undefined : kind.value})
const {data, loading, error, reload} = useResource(signal => workspace.stats(filters(), signal))
watch([since, kind], () => void reload())

const command = () =>
  ['bun run stats', since.value !== 'all' && `--since=${since.value}`, kind.value !== 'all' && `--kind=${kind.value}`].filter(Boolean).join(' ')
const seconds = (s: number) => (s >= 90 ? `${(s / 60).toFixed(1)} min` : `${s.toFixed(s < 10 ? 1 : 0)} s`)
const tables = (rows: {renders: StatsRow[]; llm: StatsRow[]}) =>
  [
    {title: 'Renders - per workflow variant and GPU', rows: rows.renders},
    {title: 'Language model - per model', rows: rows.llm},
  ].filter(t => t.rows.length)
</script>

<template>
  <div class="scrollpage view">
    <PageBar title="Stats">
      <SegmentedControl v-model="since" :options="SINCE" label="Since" />
      <SegmentedControl v-model="kind" :options="KINDS" label="Kind" />
    </PageBar>
    <p class="muted st-intro">
      How long the jobs of this machine took, as the runs measured them: the median and the slowest tenth, the first job of a cold server apart, and what failed
      or was tried again.
    </p>
    <ResourceState :loading="loading" :error="error" :loaded="!!data" @retry="reload" />
    <template v-if="data">
      <dl class="st-summary">
        <div>
          <dt>Measured</dt>
          <dd class="num">{{ data.summary.measurements }}</dd>
        </div>
        <div>
          <dt>Projects</dt>
          <dd class="num">{{ data.summary.projects }}</dd>
        </div>
        <div>
          <dt>Failed</dt>
          <dd :class="['num', {'st-bad': data.summary.failed}]">{{ data.summary.failed }}</dd>
        </div>
        <div>
          <dt>Retried</dt>
          <dd class="num">{{ data.summary.retries }}</dd>
        </div>
        <div>
          <dt>Made again</dt>
          <dd class="num">{{ data.summary.again }}</dd>
        </div>
        <div>
          <dt>GPU and model time</dt>
          <dd class="num">{{ data.summary.jobHours.toFixed(1) }} h</dd>
        </div>
      </dl>
      <p v-if="!data.summary.measurements" class="muted">Nothing measured in this window. Every render and plan run adds to it.</p>
      <section v-for="table in tables(data)" :key="table.title" class="st-section">
        <h2>{{ table.title }}</h2>
        <table class="st-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Jobs</th>
              <th>Median</th>
              <th title="The slowest tenth took longer than this">90 %</th>
              <th title="First jobs on a server with other models loaded">Cold</th>
              <th>Retried</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in table.rows" :key="row.key">
              <td class="st-key">{{ row.key }}</td>
              <td class="num">{{ row.n }}</td>
              <td class="num">{{ row.n ? seconds(row.median) : '-' }}</td>
              <td class="num">{{ row.n ? seconds(row.p90) : '-' }}</td>
              <td class="num">{{ row.cold }}</td>
              <td class="num">{{ row.retries }}</td>
              <td :class="['num', {'st-bad': row.failed}]">{{ row.failed }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <div class="st-section">
        <h2>In the terminal</h2>
        <CopyCommand :command="command()" />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* prefixed (st-): component classes inherit the rules of workspace.css otherwise */
.st-intro {
  margin: 0 0 12px;
  max-width: 70ch;
}
.st-summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3, 12px);
  margin: 0 0 16px;
}
.st-summary div {
  padding: 8px 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-m, 8px);
}
.st-summary dt {
  color: var(--muted);
}
.st-summary dd {
  margin: 0;
  font-weight: 600;
}
.st-section {
  margin-bottom: 20px;
}
.st-section h2 {
  margin-bottom: 6px;
}
.st-table {
  width: 100%;
  border-collapse: collapse;
}
.st-table th,
.st-table td {
  padding: 4px 10px;
  border-bottom: 1px solid var(--line);
  text-align: right;
  white-space: nowrap;
}
.st-table th:first-child,
.st-table td:first-child {
  text-align: left;
}
.st-table th {
  color: var(--muted);
  font-weight: 500;
}
.st-key {
  white-space: normal;
  overflow-wrap: anywhere;
}
.st-bad {
  color: var(--danger);
}
</style>
