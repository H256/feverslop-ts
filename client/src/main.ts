import {createApp} from 'vue'
import {createRouter, createWebHistory} from 'vue-router'
import App from './App.vue'
import MigrationPage from './MigrationPage.vue'
import './style.css'

// The asset base is /workspace-assets/; document routes deliberately remain at /.
const router = createRouter({
  history: createWebHistory('/'),
  routes: [
    {path: '/', component: MigrationPage, props: {title: 'Projects'}},
    {path: '/library', component: MigrationPage, props: {title: 'Library'}},
    {path: '/p/:kind(music|film)/:id/:page?', component: MigrationPage, props: {title: 'Project'}},
    {path: '/:pathMatch(.*)*', component: MigrationPage, props: {title: 'Page not found'}},
  ],
})

createApp(App).use(router).mount('#app')
