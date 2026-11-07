import {createRouter, createWebHistory} from 'vue-router'
import ProjectsPage from './features/projects/ProjectsPage.vue'
import NotFoundPage from './components/NotFoundPage.vue'

// The asset base is /workspace-assets/; the pages stay at /. A project's pages load when they are first opened.
export const router = createRouter({
  history: createWebHistory('/'),
  routes: [
    {path: '/', name: 'home', component: ProjectsPage},
    {path: '/library', name: 'library', component: () => import('./features/library/LibraryPage.vue')},
    {
      path: '/p/:kind(music|film)/:id',
      component: () => import('./features/project/ProjectLayout.vue'),
      children: [
        {path: '', name: 'timeline', component: () => import('./features/timeline/TimelinePage.vue')},
        {path: 'story', name: 'story', component: () => import('./features/story/StoryPage.vue')},
        {path: 'casting', name: 'casting', component: () => import('./features/casting/CastingPage.vue')},
        {path: 'look', name: 'look', component: () => import('./features/look/LookPage.vue')},
        {path: 'direction', name: 'direction', component: () => import('./features/direction/DirectionPage.vue')},
        {path: 'settings', name: 'settings', component: () => import('./features/settings/SettingsPage.vue')},
        {path: 'references', name: 'references', component: () => import('./features/references/ReferencesPage.vue')},
        {path: 'singers', name: 'singers', component: () => import('./features/singers/SingersPage.vue')},
        {path: 'timing', name: 'timing', component: () => import('./features/timing/TimingPage.vue')},
      ],
    },
    {path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundPage},
  ],
})
