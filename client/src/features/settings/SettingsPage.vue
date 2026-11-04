<script setup lang="ts">
import ResourceState from '../../components/ResourceState.vue'
import {useProject} from '../project/session'
import {usePageData} from '../project/usePageData'
import SettingsEditor from './SettingsEditor.vue'

/**
 * The render settings of the project - what config.json has of them: workflows, sizes, retries, the final frame rate. A change is
 * checked as the loader checks it and says what it makes stale before it is saved; nothing is rendered or planned by it.
 */
const {api} = useProject()
const {data, loading, error, reload, refresh} = usePageData(async signal => (await api.config(signal)).settings)
</script>

<template>
  <SettingsEditor v-if="data" :settings="data" :refresh="refresh" />
  <div v-else class="scrollpage view"><ResourceState :loading="loading" :error="error" :loaded="false" @retry="reload" /></div>
</template>
