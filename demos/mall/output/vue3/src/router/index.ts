import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    redirect: '/home',
  },
  {
    path: '/home',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
  },
  {
    path: '/goods-detail',
    name: 'goods-detail',
    component: () => import('../views/GoodsDetailView.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
