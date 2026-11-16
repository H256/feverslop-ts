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
  light: {
    d: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
    filled: false,
  },
  dark: {d: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z'], filled: false},
  save: {
    d: [
      'M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
      'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7',
      'M7 3v4a1 1 0 0 0 1 1h7',
    ],
    filled: false,
  },
  remove: {d: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2', 'M10 11L10 17', 'M14 11L14 17'], filled: false},
  undo: {d: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11'], filled: false},
  redo: {d: ['m15 14 5-5-5-5', 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13'], filled: false},
  close: {d: ['M18 6 6 18', 'm6 6 12 12'], filled: false},
  add: {d: ['M5 12h14', 'M12 5v14'], filled: false},
  repeat: {d: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'], filled: false},
  plan: {
    d: [
      'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
      'M20 3v4',
      'M22 5h-4',
      'M4 17v2',
      'M5 18H3',
    ],
    filled: false,
  },
  edit: {
    d: ['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z', 'm15 5 4 4'],
    filled: false,
  },
  download: {d: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15L12 3'], filled: false},
  library: {
    d: [
      'M4 3h6a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z',
      'M7 3v18',
      'M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z',
    ],
    filled: false,
  },
  stop: {d: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z'], filled: false},
  render: {
    d: [
      'M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z',
      'm6.2 5.3 3.1 3.9',
      'm12.4 3.4 3.1 4',
      'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
    ],
    filled: false,
  },
  preview: {
    d: ['M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0', 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0z'],
    filled: false,
  },
  check: {d: ['M20 6 9 17l-5-5'], filled: false},
  search: {d: ['M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0z', 'm21 21-4.3-4.3'], filled: false},
  refresh: {
    d: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
    filled: false,
  },
  settings: {
    d: [
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
      'M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0z',
    ],
    filled: false,
  },
  folder: {
    d: ['M12 10v6', 'M9 13h6', 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
    filled: false,
  },
  listen: {d: ['M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3'], filled: false},
  cut: {
    d: ['M3 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0z', 'M8.12 8.12 12 12', 'M20 4 8.12 15.88', 'M3 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0z', 'M14.8 14.8 20 20'],
    filled: false,
  },
  upload: {d: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3L12 15'], filled: false},
} as const
export type IconName = keyof typeof ICONS
const props = defineProps<{name: IconName; size?: number}>()
</script>

<template>
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" :style="props.size ? {width: `${props.size}px`, height: `${props.size}px`} : undefined">
    <path v-for="d in ICONS[props.name].d" :key="d" :d="d" v-bind="ICONS[props.name].filled ? {fill: 'currentColor', stroke: 'none'} : {}" />
  </svg>
</template>
