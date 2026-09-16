<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import AppIcon from '@/components/AppIcon.vue'
import { hasPermission } from '@/config/permissions'
import { statusLabels } from '@/config/modules'
import { mockService } from '@/services/mock'
import { useAuthStore } from '@/stores/auth'
import type { EntityRecord } from '@/types'

echarts.use([PieChart, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer])

const auth = useAuthStore()
const distributionElement = ref<HTMLElement>()
let distributionChart: ReturnType<typeof echarts.init> | undefined
const counts = ref<Record<string, number>>({})
const tasks = ref<EntityRecord[]>([])
const deviceDistribution = ref<Array<{ name: string; value: number }>>([])
const updatedAt = ref('')
const period = ref<'today' | '7d' | '30d'>('today')
const sourceUsers = ref<EntityRecord[]>([])
const sourceDevices = ref<EntityRecord[]>([])
const sourceRepairs = ref<EntityRecord[]>([])
const sourceMessages = ref<EntityRecord[]>([])
const periodLabel = computed(() => ({ today: '今日', '7d': '近 7 天', '30d': '近 30 天' })[period.value])

function inPeriod(record: EntityRecord, field = 'createdAt') {
  const date = new Date(String(record[field] || record.createdAt)).getTime()
  const start = new Date(); start.setHours(0, 0, 0, 0)
  if (period.value === 'today') return date >= start.getTime()
  return date >= Date.now() - (period.value === '7d' ? 7 : 30) * 86_400_000
}

function recalculatePeriod() {
  counts.value.todayUsers = sourceUsers.value.filter((item) => inPeriod(item)).length
  counts.value.todayDevices = sourceDevices.value.filter((item) => inPeriod(item)).length
  counts.value.repairsCompleted = sourceRepairs.value.filter((item) => item.status === 'completed' && inPeriod(item, 'completedAt')).length
  counts.value.messagesCompleted = sourceMessages.value.filter((item) => item.status === 'completed' && inPeriod(item, 'updatedAt')).length
}

const metrics = computed(() => [
  { label: '注册用户总数', value: counts.value.users || 0, icon: 'users', meta: '当前数据域', delta: '实时', tone: 'blue', route: '/users' },
  { label: '今日新增用户', value: counts.value.todayUsers || 0, icon: 'user-round', meta: '较昨日', delta: String((counts.value.todayUsers || 0) - (counts.value.yesterdayUsers || 0)), tone: 'green' },
  { label: '绑定设备总数', value: counts.value.devices || 0, icon: 'cpu', meta: '当前数据域', delta: '实时', tone: 'purple', route: '/devices' },
  { label: '新增设备数量', value: counts.value.todayDevices || 0, icon: 'package-plus', meta: periodLabel.value, delta: '按录入时间', tone: 'cyan', route: '/devices' },
  { label: '待处理报修', value: counts.value.repairsPending || 0, icon: 'wrench', meta: '当前状态', delta: '需处理', tone: 'red', route: '/repairs?tab=pending' },
  { label: '待处理留言', value: counts.value.messagesPending || 0, icon: 'messages-square', meta: '当前状态', delta: '需回复', tone: 'red', route: '/messages?tab=unreplied' },
  { label: '经销商总数', value: counts.value.dealers || 0, icon: 'store', meta: '当前数据域', delta: '实时', tone: 'blue', route: '/dealers' },
])

const overviewMetrics = computed(() => [
  { label: '新增注册用户', value: counts.value.todayUsers || 0, unit: '人', delta: '实时', tone: 'blue', points: '2,36 15,40 29,27 42,31 55,18 69,23 82,11 96,18 112,5 126,13' },
  { label: '新增设备', value: counts.value.todayDevices || 0, unit: '台', delta: '按录入时间', tone: 'green', points: '2,34 15,18 29,39 43,28 57,17 70,24 84,12 98,18 112,4 126,22' },
  { label: '报修处理数', value: counts.value.repairsCompleted || 0, unit: '单', delta: '实时', tone: 'orange', points: '2,17 15,29 28,36 42,20 56,37 70,24 84,32 98,8 112,27 126,20' },
  { label: '留言回复数', value: counts.value.messagesCompleted || 0, unit: '条', delta: '实时', tone: 'blue', points: '2,31 15,35 29,13 43,33 57,19 70,30 84,21 98,36 112,7 126,28' },
])

const quickEntries = computed(() => [
  { route: 'users', label: '用户管理', description: '管理平台注册用户信息与权限', icon: 'users', tone: 'blue', permission: 'users:view' },
  { route: 'devices', label: '设备管理', description: '管理设备信息、绑定与状态', icon: 'cpu', tone: 'green', permission: 'devices:view' },
  { route: 'repairs', label: '故障报修', description: '处理用户报修工单与进度', icon: 'wrench', tone: 'orange', permission: 'repairs:view' },
  { route: 'dealers', label: '经销商管理', description: '管理经销商信息与销售数据', icon: 'store', tone: 'purple', permission: 'dealers:view' },
].filter((item) => hasPermission(auth.permissions, item.permission)))

function statusMeta(value: unknown) {
  return statusLabels[String(value)] || { label: String(value || '-'), tone: 'neutral' }
}

function renderDistribution() {
  if (!distributionElement.value) return
  distributionChart?.dispose()
  distributionChart = echarts.init(distributionElement.value)
  const total = deviceDistribution.value.reduce((sum, item) => sum + item.value, 0)
  const colors = ['#2e73f8', '#12b76a', '#36bffa', '#f79009', '#7f56d9', '#84adff']
  distributionChart.setOption({
    color: colors,
    title: { text: String(total), subtext: '设备总数', left: '29%', top: '39%', textAlign: 'center', textStyle: { color: '#101828', fontSize: 22, fontWeight: 700 }, subtextStyle: { color: '#667085', fontSize: 12 } },
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', right: 6, top: 24, itemWidth: 8, itemHeight: 8, itemGap: 14, textStyle: { color: '#475467', fontSize: 12 }, formatter: (name: string) => { const row = deviceDistribution.value.find((item) => item.name === name); return `${name}    ${row?.value || 0}` } },
    series: [{ type: 'pie', radius: ['51%', '71%'], center: ['29%', '50%'], avoidLabelOverlap: true, label: { show: false }, emphasis: { scaleSize: 4 }, data: deviceDistribution.value }],
  })
}

async function load() {
  const [users, devices, dealers, repairsPending, messagesPending, repairsCompleted, messagesCompleted, repairResult, deviceResult, userResult] = await Promise.all([
    mockService.count('users'), mockService.count('devices', 'bound'), mockService.count('dealers', 'active'), mockService.count('repairs', 'pending'), mockService.count('messages', 'pending'), mockService.count('repairs', 'completed'), mockService.count('messages', 'completed'), mockService.list('repairs', { pageNum: 1, pageSize: 5, tab: 'pending' }), mockService.all('devices'), mockService.all('users'),
  ])
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  counts.value = {
    users, devices, dealers, repairsPending, messagesPending, repairsCompleted, messagesCompleted,
    todayUsers: userResult.data.filter((item) => item.createdAt.startsWith(today)).length,
    yesterdayUsers: userResult.data.filter((item) => item.createdAt.startsWith(yesterday)).length,
    todayDevices: deviceResult.data.filter((item) => item.createdAt.startsWith(today)).length,
  }
  tasks.value = repairResult.rows
  sourceUsers.value = userResult.data
  sourceDevices.value = deviceResult.data
  sourceRepairs.value = (await mockService.all('repairs')).data
  sourceMessages.value = (await mockService.all('messages')).data
  recalculatePeriod()
  const typeMap = new Map<string, number>()
  deviceResult.data.forEach((device) => typeMap.set(device.name, (typeMap.get(device.name) || 0) + 1))
  deviceDistribution.value = [...typeMap.entries()].map(([name, value]) => ({ name: name.replace(/\s[A-Z]{2}-\d+$/, ''), value }))
  updatedAt.value = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date())
  await nextTick()
  renderDistribution()
}

function resize() { distributionChart?.resize() }
onMounted(() => { load(); window.addEventListener('resize', resize) })
watch(period, recalculatePeriod)
onBeforeUnmount(() => { window.removeEventListener('resize', resize); distributionChart?.dispose() })
</script>

<template>
  <section class="page dashboard-page">
    <div class="dashboard-statusbar">
      <div><span class="health-dot"></span><strong>运营工作台</strong><span>{{ auth.session?.domain === 'cn' ? '国内数据域' : '海外数据域' }}</span></div>
      <div><span>实时更新：{{ updatedAt || '正在同步' }}</span><button class="icon-button" title="刷新数据" @click="load"><AppIcon name="refresh-cw" :size="16" /></button></div>
    </div>

    <div class="metric-grid">
      <component :is="metric.route ? 'RouterLink' : 'article'" v-for="metric in metrics" :key="metric.label" :to="metric.route" class="metric-card">
        <span class="metric-icon" :data-tone="metric.tone"><AppIcon :name="metric.icon" :size="22" /></span>
        <div><span>{{ metric.label }}</span><strong>{{ metric.value.toLocaleString() }}</strong><small>{{ metric.meta }} <b>{{ metric.delta }}</b></small></div>
      </component>
    </div>

    <div class="dashboard-primary-grid">
      <section class="surface overview-panel">
        <div class="section-head"><div><h2>数据概览</h2><p>{{ periodLabel }}核心业务变化，按创建/完成时间统计</p></div><el-select v-model="period" aria-label="统计周期" style="width:110px"><el-option label="今日" value="today" /><el-option label="近 7 天" value="7d" /><el-option label="近 30 天" value="30d" /></el-select></div>
        <div class="overview-metric-grid">
          <article v-for="metric in overviewMetrics" :key="metric.label" class="overview-metric" :data-tone="metric.tone">
            <span>{{ metric.label }}</span><div><strong>{{ metric.value }}</strong><small>{{ metric.unit }}</small></div><p>数据口径 <b>{{ metric.delta }}</b></p>
            <svg class="sparkline" viewBox="0 0 128 44" preserveAspectRatio="none" aria-hidden="true"><polyline :points="metric.points" /></svg>
          </article>
        </div>
      </section>
      <section class="surface distribution-panel"><div class="section-head"><div><h2>平台统计</h2><p>按设备类型统计</p></div></div><div ref="distributionElement" class="distribution-chart"></div></section>
    </div>

    <div class="dashboard-secondary-grid dashboard-secondary-single">
      <section class="surface pending-panel">
        <div class="section-head"><div class="title-with-count"><h2>待处理报修</h2><span>{{ counts.repairsPending || 0 }}</span></div><RouterLink to="/repairs">查看更多 <AppIcon name="chevron-right" :size="14" /></RouterLink></div>
        <div class="dashboard-table-wrap"><table class="dashboard-table"><thead><tr><th>报修单号</th><th>设备名称</th><th>故障描述</th><th>报修用户</th><th>报修时间</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="task in tasks" :key="task.id"><td><code>{{ task.code }}</code></td><td><strong>{{ task.name }}</strong></td><td>{{ task.description || task.summary }}</td><td>{{ task.account }}</td><td>{{ String(task.createdAt).slice(5, 16).replace('T', ' ') }}</td><td><span class="status-chip" :data-tone="statusMeta(task.status).tone"><i></i>{{ statusMeta(task.status).label }}</span></td><td><RouterLink :to="`/repairs?keyword=${task.code}`">查看</RouterLink></td></tr></tbody></table></div>
      </section>
    </div>

    <section class="surface dashboard-quick-section">
      <div class="section-head"><div><h2>快捷入口</h2><p>按当前账号权限展示</p></div></div>
      <div class="quick-grid"><RouterLink v-for="item in quickEntries" :key="item.route" :to="`/${item.route}`" :data-tone="item.tone"><div><strong>{{ item.label }}</strong><span v-if="item.route === 'repairs' && counts.repairsPending" class="quick-count">{{ counts.repairsPending }}</span><p>{{ item.description }}</p><span class="quick-arrow"><AppIcon name="arrow-right" :size="14" /></span></div><AppIcon :name="item.icon" variant="feature" :size="64" /></RouterLink></div>
    </section>
  </section>
</template>
