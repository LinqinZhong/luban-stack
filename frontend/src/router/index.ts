import { createRouter, createWebHistory } from 'vue-router'
import { useProjectStore } from '../stores/project'
import MainLayout from '../layouts/MainLayout.vue'
import { PRODUCT_NAME } from '../constants/brand'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'welcome',
      component: () => import('../views/WelcomeView.vue'),
      meta: { title: '选择项目' },
    },
    {
      path: '/ai-assistant',
      name: 'ai-assistant',
      component: () => import('../views/AiAssistantView.vue'),
      meta: { title: 'AI 助手', requiresProject: true },
    },
    {
      path: '/',
      component: MainLayout,
      meta: { requiresProject: true },
      children: [
        {
          path: 'workspace',
          name: 'workspace',
          component: () => import('../views/WorkspaceView.vue'),
          meta: { title: '工作区' },
        },
      ],
    },
  ],
})

router.beforeEach((to) => {
  const projectStore = useProjectStore()

  if (to.matched.some((record) => record.meta.requiresProject) && !projectStore.hasProject) {
    return { name: 'welcome' }
  }

  return true
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} - ${PRODUCT_NAME}` : PRODUCT_NAME
})

export default router
