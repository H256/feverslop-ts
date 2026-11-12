import {createRouter, createWebHistory, type RouteComponent} from 'vue-router'
import {PROJECT_PAGES, type ProjectPage} from '../../shared/workspace'
import ProjectsPage from './features/projects/ProjectsPage.vue'
import NotFoundPage from './components/NotFoundPage.vue'

// A project's pages: the list is shared/workspace.ts (PROJECT_PAGES, which the server serves too), each page loads when it is first
// opened - one for every name of the list, or this does not compile (#840).
const PAGES: Record<ProjectPage, () => Promise<RouteComponent>> = {
  story: () => import('./features/story/StoryPage.vue'),
  casting: () => import('./features/casting/CastingPage.vue'),
  singers: () => import('./features/singers/SingersPage.vue'),
  timing: () => import('./features/timing/TimingPage.vue'),
  look: () => import('./features/look/LookPage.vue'),
  direction: () => import('./features/direction/DirectionPage.vue'),
  references: () => import('./features/references/ReferencesPage.vue'),
  postwork: () => import('./features/postwork/PostworkPage.vue'),
  settings: () => import('./features/settings/SettingsPage.vue'),
}

// The asset base is /workspace-assets/; the pages stay at /.
export const router = createRouter({
  history: createWebHistory('/'),
  routes: [
    {path: '/', name: 'home', component: ProjectsPage},
    {path: '/library', name: 'library', component: () => import('./features/library/LibraryPage.vue')},
    {path: '/stats', name: 'stats', component: () => import('./features/stats/StatsPage.vue')},
    {
      path: '/p/:kind(music|film)/:id',
      component: () => import('./features/project/ProjectLayout.vue'),
      children: [
        {path: '', name: 'timeline', component: () => import('./features/timeline/TimelinePage.vue')},
        ...PROJECT_PAGES.map(page => ({path: page, name: page, component: PAGES[page]})),
      ],
    },
    {path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundPage},
  ],
})
