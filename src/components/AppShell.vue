<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import { navGroups } from '@/config/modules'
import { hasPermission } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'
import { usePreferencesStore } from '@/stores/preferences'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const database = useDatabaseStore()
const preferences = usePreferencesStore()
const collapsed = ref(window.innerWidth < 1280 || preferences.collapsed)
const notificationsOpen = ref(false)
const prototypeMenu = ref('')
const globalSearch = ref('')
const expandedGroups = ref(new Set(preferences.expandedGroups))
const visibleGroups = computed(() => navGroups.map((group) => ({ ...group, items: group.items.filter((item) => hasPermission(auth.permissions, item.permission)) })).filter((group) => group.items.length))
const currentTitle = computed(() => String(route.meta.title || '首页'))
const breadcrumbParent = computed(() => currentTitle.value === '首页' ? '首页' : visibleGroups.value.find((group) => group.items.some((item) => item.route === route.name))?.label || '运营管理')
const notifications = computed(() => {
  const session = auth.session
  if (!session) return []
  return database.records('notifications')
    .filter((item) => item.domain === session.domain && (session.dataScope === 'all' || item.ownerId === session.ownerId || item.ownerId === 'platform'))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 20)
})
const unreadNotifications = computed(() => notifications.value.filter((item) => item.status === 'unread').length)

function runSearch() {
  if (!globalSearch.value.trim()) return
  router.push({ name: 'devices', query: { keyword: globalSearch.value.trim() } })
}

async function switchDomain(command: 'cn' | 'global') {
  auth.setDomain(command)
  ElMessage.success(command === 'cn' ? '已切换至国内数据域' : '已切换至海外数据域')
  router.replace({ path: route.path, query: {} })
}

async function handleAccount(command: string) {
  if (command === 'logout') { auth.logout(); await router.push('/login'); return }
  if (command === 'reset') {
    await ElMessageBox.confirm('这会清除当前所有本地修改并恢复初始示例数据。', '恢复示例数据', { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' })
    database.reset(); ElMessage.success('示例数据已恢复'); router.go(0)
  }
  if (command === 'password') router.push('/first-password')
}

function handlePrototypeEvent(event: Event) {
  const action = (event as CustomEvent<{ action?: string }>).detail?.action
  if (action === 'notifications') notificationsOpen.value = true
  if (action === 'domain-switch' || action === 'account-menu') prototypeMenu.value = action
}

function openNotifications() {
  notificationsOpen.value = true
  notifications.value.filter((item) => item.status === 'unread').forEach((item) => database.update('notifications', item.id, { status: 'read' }))
}

function toggleSidebar() {
  collapsed.value = !collapsed.value
  preferences.setCollapsed(collapsed.value)
}

function toggleNavGroup(label: string) {
  const next = new Set(expandedGroups.value)
  if (next.has(label)) next.delete(label)
  else next.add(label)
  expandedGroups.value = next
  preferences.setExpandedGroups([...next])
}

function isGroupExpanded(label: string) {
  return collapsed.value || expandedGroups.value.has(label)
}

function revealCurrentGroup() {
  const current = visibleGroups.value.find((group) => group.items.some((item) => item.route === route.name))
  if (!current || expandedGroups.value.has(current.label)) return
  const next = new Set(expandedGroups.value)
  next.add(current.label)
  expandedGroups.value = next
  preferences.setExpandedGroups([...next])
}

function handleResize() {
  if (window.innerWidth < 1280) collapsed.value = true
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
  window.addEventListener('prototype-open', handlePrototypeEvent)
})
watch(() => route.name, revealCurrentGroup, { immediate: true })
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('prototype-open', handlePrototypeEvent)
})
</script>

<template>
  <div class="app-shell" :class="{ collapsed }">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark"><AppIcon name="waves" :size="20" /></span><div v-show="!collapsed"><strong>鲨鱼妹妹</strong><small>设备运营管理平台</small></div></div>
      <nav class="sidebar-scroll" aria-label="主导航">
        <section v-for="group in visibleGroups" :key="group.label" class="nav-group" :class="{ open: isGroupExpanded(group.label), active: group.items.some((item) => item.route === route.name) }">
          <button v-if="!collapsed" class="nav-group-trigger" type="button" :aria-expanded="isGroupExpanded(group.label)" @click="toggleNavGroup(group.label)">
            <span>{{ group.label }}</span><AppIcon name="chevron-down" :size="14" />
          </button>
          <div class="nav-group-items">
            <template v-for="(item, index) in group.items" :key="item.route">
              <div v-if="!collapsed && item.section && item.section !== group.items[index - 1]?.section" class="nav-subgroup-title">{{ item.section }}</div>
              <RouterLink :to="`/${item.route}`" class="nav-item" :class="{ 'nav-item--third-level': item.section }" :title="collapsed ? item.label : ''">
                <AppIcon :name="item.icon" :size="18" /><span v-show="!collapsed">{{ item.label }}</span>
              </RouterLink>
            </template>
          </div>
        </section>
      </nav>
      <div class="sidebar-foot"><span class="health-dot"></span><span v-show="!collapsed">{{ auth.session?.domain === 'cn' ? '国内服务正常' : '海外服务正常' }} · v3.2</span></div>
    </aside>
    <header class="topbar">
      <button class="icon-button" type="button" title="折叠侧栏" aria-label="折叠或展开侧栏" @click="toggleSidebar"><AppIcon name="menu" /></button>
      <div class="breadcrumb"><span>{{ breadcrumbParent }}</span><b>/</b><strong>{{ currentTitle === '首页' ? '工作台' : currentTitle }}</strong></div>
      <form class="global-search" @submit.prevent="runSearch"><AppIcon name="search" /><input v-model="globalSearch" aria-label="全局搜索" placeholder="搜索设备 SN、用户、工单或订单"></form>
      <el-dropdown v-if="auth.session?.role === 'platform'" trigger="click" @command="switchDomain">
        <button class="domain-button"><span class="health-dot"></span>{{ auth.session?.domain === 'cn' ? '国内 · CST' : '海外 · PST' }}<AppIcon name="chevron-down" :size="14" /></button>
        <template #dropdown><el-dropdown-menu><el-dropdown-item command="cn">国内数据域 · CST</el-dropdown-item><el-dropdown-item command="global">海外数据域 · PST</el-dropdown-item></el-dropdown-menu></template>
      </el-dropdown>
      <button class="icon-button notify-button" type="button" title="通知中心" aria-label="打开通知中心" @click="openNotifications"><AppIcon name="bell" /><span v-if="unreadNotifications">{{ unreadNotifications > 99 ? '99+' : unreadNotifications }}</span></button>
      <el-dropdown trigger="click" @command="handleAccount">
        <button class="account-button" type="button" :aria-label="`${auth.session?.displayName}账号菜单`"><span class="avatar">{{ auth.session?.displayName.slice(0, 1) }}</span><strong>{{ auth.session?.displayName }}</strong><AppIcon name="chevron-down" :size="14" /></button>
        <template #dropdown><el-dropdown-menu><el-dropdown-item disabled class="account-menu-summary"><span class="avatar">{{ auth.session?.displayName.slice(0, 1) }}</span><div><strong>{{ auth.session?.displayName }}</strong><small>{{ auth.session?.roleLabel }}</small><small>{{ auth.session?.account }} · {{ auth.session?.domain === 'cn' ? '国内数据域' : '海外数据域' }}</small></div></el-dropdown-item><el-dropdown-item command="password">修改密码</el-dropdown-item><el-dropdown-item v-if="auth.session?.role === 'platform'" command="reset">恢复示例数据</el-dropdown-item><el-dropdown-item divided command="logout">退出登录</el-dropdown-item></el-dropdown-menu></template>
      </el-dropdown>
    </header>
    <main class="main-content"><RouterView :key="`${route.path}-${auth.session?.domain}-${database.revision}`" /></main>
    <div v-if="prototypeMenu" class="prototype-topmenu" :class="prototypeMenu" @click.stop>
      <template v-if="prototypeMenu === 'domain-switch'">
        <strong>切换数据域</strong><button @click="switchDomain('cn'); prototypeMenu = ''"><span class="health-dot"></span><span>国内数据域<small>Asia/Shanghai · 当前</small></span><AppIcon name="check" :size="15" /></button><button @click="switchDomain('global'); prototypeMenu = ''"><span class="domain-globe"><AppIcon name="globe-2" :size="16" /></span><span>海外数据域<small>America/Los_Angeles</small></span></button>
      </template>
      <template v-else>
        <div class="menu-account"><span class="avatar">{{ auth.session?.displayName.slice(0, 1) }}</span><div><strong>{{ auth.session?.displayName }}</strong><small>{{ auth.session?.roleLabel }} · {{ auth.session?.account }}</small><small>{{ auth.session?.domain === 'cn' ? '国内数据域' : '海外数据域' }}</small></div></div><button @click="handleAccount('password'); prototypeMenu = ''"><AppIcon name="key-round" :size="16" /><span>修改密码</span></button><button @click="handleAccount('reset'); prototypeMenu = ''"><AppIcon name="rotate-ccw" :size="16" /><span>恢复示例数据</span></button><button class="danger" @click="handleAccount('logout')"><AppIcon name="log-out" :size="16" /><span>退出登录</span></button>
      </template>
    </div>
    <el-dialog v-model="notificationsOpen" title="通知中心" width="560px" align-center append-to-body class="notification-dialog">
      <div class="notification-list">
        <article v-for="notice in notifications" :key="notice.id"><span class="notice-dot" :class="notice.category === 'risk' ? 'error' : notice.category === 'warning' ? 'warning' : 'info'"></span><div><strong>{{ notice.name }}</strong><p>{{ notice.summary }}</p></div><time>{{ notice.createdAt.slice(11, 16) }}</time></article>
        <div v-if="!notifications.length" class="detail-empty"><strong>暂无通知</strong><p>业务分配、回复和高风险操作结果会显示在这里。</p></div>
      </div>
      <template #footer><el-button type="primary" @click="notificationsOpen = false">知道了</el-button></template>
    </el-dialog>
  </div>
</template>
