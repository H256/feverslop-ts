import {createApp} from 'vue'
import {createRouter, createWebHistory} from 'vue-router'
import App from './App.vue'
import MigrationPage from './MigrationPage.vue'
import ProjectsPage from './features/projects/ProjectsPage.vue'
import LibraryPage from './features/library/LibraryPage.vue'
import './style.css'

// The asset base is /workspace-assets/; document routes deliberately remain at /.
const router = createRouter({
  history: createWebHistory('/'),
  routes: [
    {path: '/', component: ProjectsPage},
    {path: '/library', component: LibraryPage},
    {path: '/:pathMatch(.*)*', component: MigrationPage, props: {title: 'Page not found'}},
  ],
})

createApp(App).use(router).mount('#app')
