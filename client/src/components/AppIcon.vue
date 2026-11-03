<script setup lang="ts">
/** The line icons of the workspace; `filled` ones are solid shapes. */
const ICONS = {
  play: {d: ['M7 4v16l13-8z'], filled: true},
  pause: {d: ['M7 4h3.5v16H7zM13.5 4H17v16h-3.5z'], filled: true},
  prev: {d: ['M6 5v14M19 5l-10 7 10 7z'], filled: false},
  next: {d: ['M18 5v14M5 5l10 7-10 7z'], filled: false},
  sound: {d: ['M4 9v6h4l5 4V5L8 9z', 'M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11'], filled: false},
  muted: {d: ['M4 9v6h4l5 4V5L8 9z'], filled: false},
  copy: {d: ['M9 11a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2z', 'M5 15V6a2 2 0 0 1 2-2h9'], filled: false},
  system: {d: ['M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M8 21h8M12 17v4'], filled: false},
  light: {d: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'], filled: false},
  dark: {d: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z'], filled: false},
} as const
export type IconName = keyof typeof ICONS
const props = defineProps<{name: IconName, size?: number}>()
</script>

<template>
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" :style="props.size ? {width: `${props.size}px`, height: `${props.size}px`} : undefined">
    <path v-for="d in ICONS[props.name].d" :key="d" :d="d" v-bind="ICONS[props.name].filled ? {fill: 'currentColor', stroke: 'none'} : {}" />
  </svg>
</template>
