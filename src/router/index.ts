import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { moduleConfigs } from '@/config/modules'
import { hasPermission } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'

const AuthView = () => import('@/views/AuthView.vue')
const AppShell = () => import('@/components/AppShell.vue')
const DashboardView = () => import('@/views/DashboardView.vue')
const ModuleView = () => import('@/views/ModuleView.vue')
const ConfigView = () => import('@/views/ConfigView.vue')
const LaunchConfigView = () => import('@/views/LaunchConfigView.vue')
const NotFoundView = () => import('@/views/NotFoundView.vue')

const moduleRoutes: RouteRecordRaw[] = Object.values(moduleConfigs).map((config) => ({
  path: config.route,
  name: config.route,
  component: ModuleView,
  props: { moduleKey: config.route },
  meta: { permission: config.permission, title: config.title },
}))

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: AuthView, props: { mode: 'login' } },
  { path: '/first-password', name: 'first-password', component: AuthView, props: { mode: 'first-password' } },
  {
    path: '/',
    component: AppShell,
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', name: 'dashboard', component: DashboardView, meta: { permission: 'dashboard:view', title: '首页' } },
      { path: 'analytics', redirect: '/dashboard' },
      ...moduleRoutes,
      { path: 'payment-settings', name: 'payment-settings', component: ConfigView, meta: { permission: 'payment-settings:view', title: '支付配置' } },
      { path: 'launch-settings', name: 'launch-settings', component: LaunchConfigView, meta: { permission: 'launch-settings:view', title: 'APP 启动页' } },
      { path: '403', name: 'forbidden', component: NotFoundView, props: { forbidden: true } },
      { path: ':pathMatch(.*)*', name: 'not-found', component: NotFoundView },
    ],
  },
]

const router = createRouter({ history: createWebHashHistory(), routes })

router.beforeEach((to) => {
  const auth = useAuthStore()
  const authRoute = ['login', 'first-password'].includes(String(to.name))
  if (auth.isAuthenticated) auth.refreshSession()
  if (!auth.isAuthenticated && !authRoute) return { name: 'login', query: { redirect: to.fullPath } }
  if (auth.isAuthenticated && to.name === 'login') return { name: auth.session?.firstLogin ? 'first-password' : 'dashboard' }
  if (auth.isAuthenticated && auth.session?.firstLogin && to.name !== 'first-password') return { name: 'first-password' }
  if (to.meta.permission && !hasPermission(auth.permissions, String(to.meta.permission))) return { name: 'forbidden' }
  return true
})

router.afterEach((to) => { document.title = `${String(to.meta.title || '运营管理')} - 鲨鱼妹妹` })

export default router
