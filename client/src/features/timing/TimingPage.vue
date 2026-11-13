<script setup lang="ts">
import SplitLayout from '../../components/SplitLayout.vue'
import ResourceState from '../../components/ResourceState.vue'
import {useProject} from '../project/session'
import {usePageData} from '../project/usePageData'
import TimingWorkbench from './TimingWorkbench.vue'

/** The timing of the lyrics, and the vocals at 100 values a second: fine enough to see where a word starts. */
const {api} = useProject()
const {data, loading, error, reload, refresh} = usePageData(async signal => {
  const [{timing}, wave] = await Promise.all([api.timing(signal), api.timingWave(signal).catch(() => ({peaks: null}))])
  return {timing, peaks: wave.peaks ?? undefined}
})
</script>

<template>
  <TimingWorkbench v-if="data?.timing" :view="data.timing" :peaks="data.peaks" :refresh="refresh" />
  <SplitLayout v-else full>
    <ResourceState :loading="loading" :error="error" :loaded="!!data" @retry="reload" />
    <div v-if="data && !data.timing" class="empty">The lyrics have no timing in this project: "alignLyrics" is off, or the plan has not aligned them yet.</div>
  </SplitLayout>
</template>
