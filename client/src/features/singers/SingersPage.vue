<script setup lang="ts">
import ResourceState from '../../components/ResourceState.vue'
import {useProject} from '../project/session'
import {usePageData} from '../project/usePageData'
import SingersEditor from './SingersEditor.vue'

/**
 * Who sings which line. What is changed here replaces the language model's answer (step singing); the beats it touches lose their shot
 * plan, and the next plan run plans just those again.
 */
const {api} = useProject()
const {data, loading, error, reload, refresh} = usePageData(async signal => (await api.singing(signal)).singing)
</script>

<template>
  <SingersEditor v-if="data" :view="data" :refresh="refresh" />
  <div v-else class="split view">
    <div class="scrollpage">
      <ResourceState :loading="loading" :error="error" :loaded="data !== undefined" @retry="reload" />
      <div v-if="data === null" class="empty">Nobody sings in this project: "singers" in config.json is empty, or the plan has not chosen them yet.</div>
    </div>
    <aside class="detail" />
  </div>
</template>
