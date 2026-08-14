<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type UploadFile } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import DomainDetailPanel from '@/components/DomainDetailPanel.vue'
import { moduleConfigs, navGroups, statusLabels } from '@/config/modules'
import { actionPermission, hasPermission } from '@/config/permissions'
import { mockService } from '@/services/mock'
import { compressBanner, downloadDeviceTemplate, exportRecords, parseDeviceFile, type DeviceImportRow } from '@/services/excel'
import { useAuthStore } from '@/stores/auth'
import { usePreferencesStore } from '@/stores/preferences'
import type { ActionConfig, ColumnConfig, EntityRecord, FieldConfig } from '@/types'

const props = defineProps<{ moduleKey: string }>()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const preferences = usePreferencesStore()
const config = computed(() => moduleConfigs[props.moduleKey])
const loading = ref(false)
const rows = ref<EntityRecord[]>([])
const total = ref(0)
const selected = ref<EntityRecord[]>([])
const filterValues = reactive<Record<string, unknown>>({})
const dynamicOptions = reactive<Record<string, Array<{ label: string; value: string }>>>({})
const query = reactive({ pageNum: 1, pageSize: preferences.pageSize, keyword: '', status: '', tab: 'all', orderByColumn: '', isAsc: 'desc' as 'asc' | 'desc', filters: filterValues })

const editorOpen = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editorForm = ref<Record<string, unknown>>({})
const editorRef = ref<FormInstance>()
const saving = ref(false)
const detailOpen = ref(false)
const detailRecord = ref<EntityRecord | null>(null)
const detailTab = ref('overview')
const detailRevision = ref(0)
const riskOpen = ref(false)
const riskRecord = ref<EntityRecord | null>(null)
const riskAction = ref('')
const riskTargetModule = ref('')
const actionForm = ref<Record<string, unknown>>({})
const prototypeOpen = ref(false)
const prototypeAction = ref('')
const prototypeTitle = ref('业务操作')
const prototypeTab = ref('base')
const importOpen = ref(false)
const importBusy = ref(false)
const importRows = ref<DeviceImportRow[]>([])
const importName = ref('')

const actionLabels: Record<string, string> = {
  detail: '查看详情', edit: '编辑', delete: '删除', toggle: '禁用/启用', unbind: '强制解绑', 'remote-disable': '远程禁用', 'remote-enable': '远程启用', 'change-region': '修改销售地区',
  'reset-password': '重置默认密码', assign: '分配处理', reply: '回复用户', forward: '转发经销商', complete: '标记完成', approve: '审批通过',
  reject: '审批拒绝', ship: '填写发货', publish: '发布/撤回', process: '流程处理', test: '测试查询', permissions: '配置权限', escalate: '转单到总部',
}

const prototypeLabels: Record<string, string> = {
  'device-create': '录入设备', 'import-devices': '批量导入设备', 'ota-release': '发布 OTA 固件',
  'dealer-edit': '编辑经销商', 'project-edit': '编辑项目', 'assign-repair': '分配报修工单',
  'message-reply': '回复用户留言', 'complaint-detail-modal': '处理投诉', 'material-approve': '物料申请审批',
  'material-edit': '编辑物料', 'courier-edit': '编辑物流公司', 'courier-test': '测试物流轨迹',
  'sn-swap': '更换设备 SN', 'service-transfer': '发起售后转移', 'warranty-edit': '编辑质保规则',
  'flow-edit': '编辑审批流程', 'banner-edit': '编辑 Banner', 'admin-edit': '编辑管理员',
  'reset-password': '重置管理员密码', 'role-permissions': '配置角色权限', 'stock-in': '设备入库',
  'outbound-create': '创建出库单', 'transfer-approve': '库存调货审批', 'force-unbind': '强制解绑设备',
  'remote-disable': '远程禁用设备', 'notifications': '通知中心', 'domain-switch': '切换数据域', 'account-menu': '账号菜单',
}

const currentTab = computed(() => config.value.tabs.find((item) => item.key === query.tab) || config.value.tabs[0])
const activeFields = computed(() => config.value.tabFields?.[query.tab] || config.value.fields)
const activeFilters = computed(() => config.value.tabFilters?.[query.tab] || config.value.filters)
const activeColumns = computed(() => config.value.tabColumns?.[query.tab] || config.value.columns)
const activeRowActions = computed(() => config.value.tabRowActions?.[query.tab] ?? config.value.rowActions ?? ['detail'])
const activePrimaryLabel = computed(() => config.value.primaryByTab ? config.value.primaryByTab[query.tab] : config.value.primaryLabel)
const canCreate = computed(() => {
  if (!activePrimaryLabel.value || !hasPermission(auth.permissions, `${props.moduleKey}:create`)) return false
  if (props.moduleKey === 'warehouse') return query.tab === 'transfer' ? auth.session?.role !== 'platform' : auth.session?.role === 'platform'
  if (props.moduleKey === 'dealers' && auth.session?.role === 'tier1' && query.tab === 'tier1') return false
  if (['materials', 'sn-replacement', 'service-transfer', 'warranty'].includes(props.moduleKey)) return auth.session?.role !== 'platform'
  return true
})
const canBatchImport = computed(() => auth.session?.role === 'platform' && (props.moduleKey === 'devices' || props.moduleKey === 'warehouse' && query.tab === 'stock'))
const drawerTabs = computed(() => config.value.detailTabs)
const currentDetailTab = computed(() => drawerTabs.value.find((item) => item.key === detailTab.value) || drawerTabs.value[0])
const currentAction = computed<ActionConfig | undefined>(() => moduleConfigs[riskTargetModule.value || props.moduleKey]?.actions?.find((item) => item.key === riskAction.value))
const riskActionLabel = computed(() => {
  if (riskRecord.value && ['toggle', 'publish'].includes(riskAction.value)) return rowActionLabel(riskAction.value, riskRecord.value)
  return currentAction.value?.label || actionLabels[riskAction.value] || '确认操作'
})
const permissionTreeRef = ref<{ getCheckedKeys: () => unknown[]; setCheckedKeys: (keys: unknown[]) => void }>()
const permissionActionLabels: Record<string, string> = {
  create: '新增', edit: '编辑', delete: '删除', toggle: '禁用/启用', 'reset-password': '重置默认密码',
  assign: '分配处理', reply: '回复用户', forward: '转发经销商', escalate: '转单到总部', complete: '标记完成',
  approve: '审批通过', reject: '审批拒绝', ship: '填写发货', process: '流程处理',
  publish: '发布/撤回', test: '测试查询', permissions: '配置权限', 'remote-disable': '远程禁用', 'remote-enable': '远程启用',
  unbind: '强制解绑', 'change-region': '修改销售地区',
}
const permissionTree = navGroups.map((group, groupIndex) => ({
  id: `group-${groupIndex}`,
  label: group.label,
  children: group.items.map((item) => {
    const module = moduleConfigs[item.route]
    const actions = new Set<string>()
    if (module?.primaryLabel && !module.primaryLabel.includes('导出')) actions.add('create')
    for (const key of module?.rowActions || []) if (!['detail'].includes(key)) actions.add(key)
    for (const key of Object.values(module?.tabRowActions || {}).flat()) if (!['detail'].includes(key)) actions.add(key)
    return {
      id: `module-${item.route}`,
      label: item.label,
      children: [
        { id: item.permission, label: '查看页面' },
        ...[...actions].map((key) => ({ id: actionPermission(item.route, key), label: permissionActionLabels[key] || actionLabels[key] || key })),
      ],
    }
  }),
}))
const validImportCount = computed(() => importRows.value.filter((item) => item.valid).length)
const hasFilters = computed(() => Boolean(query.keyword || query.status || Object.values(filterValues).some((value) => Array.isArray(value) ? value.length : String(value ?? '').trim())))
const pageStart = computed(() => total.value ? (query.pageNum - 1) * query.pageSize + 1 : 0)
const pageEnd = computed(() => Math.min(total.value, query.pageNum * query.pageSize))

function emptyForm() {
  const result: Record<string, unknown> = {}
  activeFields.value.forEach((field) => {
    if (field.type === 'switch') result[field.field] = false
    else if (field.type === 'multiSelect') result[field.field] = []
    else if (field.type === 'number') result[field.field] = 0
    else if (field.field === 'status') result[field.field] = field.options?.[0]?.value || 'normal'
    else result[field.field] = ''
  })
  return result
}

function fieldOptions(field: Pick<FieldConfig, 'options' | 'optionSource'>) {
  return field.optionSource ? dynamicOptions[field.optionSource] || [] : field.options || []
}

async function loadOptions(fields: Array<Pick<FieldConfig, 'optionSource'>>, context: Record<string, unknown> = {}) {
  const sources = [...new Set(fields.map((field) => field.optionSource).filter(Boolean) as string[])]
  await Promise.all(sources.map(async (source) => {
    const response = await mockService.options(source, context)
    dynamicOptions[source] = response.data
  }))
}

async function load() {
  loading.value = true
  try {
    await loadOptions(activeFilters.value)
    const response = await mockService.list(props.moduleKey, query)
    rows.value = response.rows
    total.value = response.total
    if (rows.value.length === 0 && query.pageNum > 1) {
      query.pageNum -= 1
      await load()
    }
  } finally {
    loading.value = false
  }
}

function applyRouteQuery() {
  Object.keys(filterValues).forEach((key) => { delete filterValues[key] })
  const requestedTab = String(route.query.tab || config.value.tabs[0]?.key || 'all')
  query.tab = config.value.tabs.some((item) => item.key === requestedTab) ? requestedTab : (config.value.tabs[0]?.key || 'all')
  activeFilters.value.forEach((filter) => { filterValues[filter.field] = '' })
  query.keyword = String(route.query.keyword || '')
  query.pageNum = 1
}

async function changeTab(tab: string | number) {
  query.tab = String(tab)
  query.pageNum = 1
  Object.keys(filterValues).forEach((key) => { delete filterValues[key] })
  activeFilters.value.forEach((filter) => { filterValues[filter.field] = '' })
  await router.replace({ query: { ...route.query, tab: query.tab, keyword: query.keyword || undefined } })
  await load()
}

function search() {
  query.pageNum = 1
  router.replace({ query: { ...route.query, tab: query.tab, keyword: query.keyword || undefined } })
  load()
}

function resetFilters() {
  query.keyword = ''
  query.status = ''
  Object.keys(filterValues).forEach((key) => { filterValues[key] = '' })
  query.orderByColumn = ''
  query.isAsc = 'desc'
  query.pageNum = 1
  router.replace({ query: { tab: query.tab } })
  load()
}

function changeSort({ prop, order }: { prop: string; order: 'ascending' | 'descending' | null }) {
  query.orderByColumn = order ? prop : ''
  query.isAsc = order === 'ascending' ? 'asc' : 'desc'
  load()
}

async function primaryAction() {
  if (activePrimaryLabel.value?.includes('导出')) return exportAll()
  if (!activePrimaryLabel.value) return
  await openEditor()
  if (props.moduleKey === 'warehouse') {
    editorForm.value.category = query.tab === 'stock' ? '在库' : query.tab === 'outbound' ? '出库' : '调货'
    editorForm.value.status = query.tab === 'stock' ? 'normal' : 'pending'
  }
  const tab = currentTab.value
  if (tab?.field && tab.value) editorForm.value[tab.field] = tab.value
  await refreshDerivedFields()
}

async function openEditor(record?: EntityRecord) {
  editorMode.value = record ? 'edit' : 'create'
  if (record) {
    const response = await mockService.get(props.moduleKey, record.id)
    editorForm.value = response.data ? { ...response.data } : { ...record }
  } else editorForm.value = emptyForm()
  await loadOptions(activeFields.value, editorForm.value)
  editorOpen.value = true
  nextTick(() => editorRef.value?.clearValidate())
}

async function refreshDerivedFields() {
  const response = await mockService.resolveFields(props.moduleKey, editorForm.value)
  editorForm.value = { ...response.data }
  await loadOptions(activeFields.value, editorForm.value)
}

async function saveEditor() {
  const valid = await editorRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    const payload = { ...editorForm.value }
    for (const field of activeFields.value.filter((item) => item.sensitive)) {
      const secret = String(payload[field.field] || '')
      if (secret) payload[`${field.field}Masked`] = `********${secret.slice(-4)}`
      delete payload[field.field]
    }
    if (props.moduleKey === 'warehouse' && Array.isArray(payload.selectedDevices)) payload.deviceSN = payload.selectedDevices.join('、')
    const response = editorMode.value === 'create'
      ? await mockService.create(props.moduleKey, payload)
      : await mockService.update(props.moduleKey, String(editorForm.value.id), payload)
    if (response.code !== 200) throw new Error(response.msg)
    ElMessage.success(response.msg)
    editorOpen.value = false
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function openDetail(record: EntityRecord) {
  const response = await mockService.get(props.moduleKey, record.id)
  detailRecord.value = response.data
  detailTab.value = 'overview'
  detailOpen.value = true
}

async function openDetailTab(record: EntityRecord, tab: string) {
  await openDetail(record)
  detailTab.value = tab
}

async function runRowAction(action: string, record: EntityRecord, targetModule = props.moduleKey) {
  if (action === 'detail') return openDetail(record)
  if (action === 'edit') return openEditor(record)
  riskRecord.value = record
  riskAction.value = action
  riskTargetModule.value = targetModule
  actionForm.value = Object.fromEntries((moduleConfigs[targetModule]?.actions?.find((item) => item.key === action)?.fields || []).map((field) => [field.field, field.type === 'number' ? 0 : field.type === 'switch' ? false : '']))
  await loadOptions(currentAction.value?.fields || [], { recordId: record.id, moduleKey: targetModule })
  riskOpen.value = true
  if (action === 'permissions') nextTick(() => permissionTreeRef.value?.setCheckedKeys(Array.isArray(record.permissions) ? record.permissions : []))
}

function runRelatedAction(payload: { moduleKey: string; action: string; record: EntityRecord }) {
  runRowAction(payload.action, payload.record, payload.moduleKey)
}

function canRunAction(action: string, record: EntityRecord) {
  if (props.moduleKey === 'warranty' && action === 'edit' && auth.session?.role === 'platform') return false
  const definition = config.value.actions?.find((item) => item.key === action)
  const statusAllowed = !definition?.allowedStatuses?.length || definition.allowedStatuses.includes(record.status)
  if (!statusAllowed) return false
  return statusAllowed && mockService.canAction(props.moduleKey, record, action).allowed
}

async function confirmRisk() {
  if (!riskRecord.value) return
  const requiredField = currentAction.value?.fields?.find((field) => field.required && !String(actionForm.value[field.field] ?? '').trim())
  if (requiredField) {
    ElMessage.warning(`请填写${requiredField.label}`)
    return
  }
  saving.value = true
  try {
    if (riskAction.value === 'permissions') actionForm.value.permissions = permissionTreeRef.value?.getCheckedKeys() || []
    const response = riskAction.value === 'delete'
      ? await mockService.remove(riskTargetModule.value || props.moduleKey, riskRecord.value.id, String(actionForm.value.reason || '业务操作'))
      : await mockService.action(riskTargetModule.value || props.moduleKey, riskRecord.value.id, riskAction.value, actionForm.value)
    if (response.code !== 200) throw new Error(response.msg)
    riskOpen.value = false
    detailRevision.value += 1
    ElMessage.success(response.msg)
    await load()
    auth.refreshSession()
    if (!hasPermission(auth.permissions, config.value.permission)) await router.replace('/dashboard')
    if (detailOpen.value && detailRecord.value) {
      const refreshed = await mockService.get(props.moduleKey, detailRecord.value.id)
      if (refreshed.data) detailRecord.value = refreshed.data
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    saving.value = false
  }
}

async function exportAll() {
  const response = await mockService.all(props.moduleKey)
  await exportRecords(config.value.title, response.data)
  ElMessage.success(`已导出 ${response.data.length} 条记录`)
}

async function onBannerFile(upload: UploadFile) {
  if (!upload.raw) return
  try {
    editorForm.value.image = await compressBanner(upload.raw)
    ElMessage.success('图片已裁切压缩为 1200 × 400')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '图片处理失败')
  }
}

function onFirmwareFile(upload: UploadFile) {
  if (!upload.raw) return
  const extension = upload.raw.name.split('.').pop()?.toLowerCase()
  if (!['bin', 'zip', 'img'].includes(extension || '')) {
    ElMessage.error('固件仅支持 .bin、.zip 或 .img 文件')
    return
  }
  if (upload.raw.size > 50 * 1024 * 1024) {
    ElMessage.error('固件文件不能超过 50 MB')
    return
  }
  editorForm.value.firmwareFile = `${upload.raw.name} · ${(upload.raw.size / 1024 / 1024).toFixed(2)} MB · 校验通过`
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importBusy.value = true
  importName.value = file.name
  try {
    const existing = (await mockService.all('devices')).data.map((item) => item.code)
    importRows.value = await parseDeviceFile(file, existing)
  } catch (error) {
    importRows.value = []
    ElMessage.error(error instanceof Error ? error.message : '文件解析失败')
  } finally {
    importBusy.value = false
    input.value = ''
  }
}

async function confirmImport() {
  const validRows = importRows.value.filter((item) => item.valid)
  if (!validRows.length) return ElMessage.warning('没有可导入的数据')
  importBusy.value = true
  try {
    const response = await mockService.importDevices(validRows, props.moduleKey === 'warehouse' ? 'warehouse' : 'devices')
    if (response.code !== 200) throw new Error(response.msg)
    ElMessage.success(response.msg)
    importOpen.value = false
    importRows.value = []
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入失败')
  } finally {
    importBusy.value = false
  }
}

function fieldRules(field: FieldConfig) {
  const required = field.required || (editorMode.value === 'create' && field.requiredOnCreate)
  return required ? [{ required: true, message: `请填写${field.label}`, trigger: ['select', 'multiSelect'].includes(field.type) ? 'change' : 'blur' }] : []
}

function displayValue(value: unknown) {
  if (value === true) return '是'
  if (value === false) return '否'
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

function maskAccount(value: unknown) {
  const account = displayValue(value)
  if (account === '-') return account
  if (account.includes('@')) {
    const [name, domain] = account.split('@')
    return `${name.slice(0, 2)}${'*'.repeat(Math.max(3, name.length - 2))}@${domain}`
  }
  if (account.length >= 7) return `${account.slice(0, 3)}****${account.slice(-4)}`
  return `${account.slice(0, 2)}***${account.slice(-1)}`
}

function displayColumn(column: ColumnConfig, record: EntityRecord) {
  return column.mask === 'account' ? maskAccount(record[column.field]) : displayValue(record[column.field])
}

function rowActionLabel(action: string, record: EntityRecord) {
  if (action === 'toggle') return record.status === 'disabled' ? '启用' : '禁用'
  if (action === 'publish') return record.status === 'published' ? '撤回' : '发布'
  return actionLabels[action] || action
}

function statusMeta(value: unknown) {
  const base = statusLabels[String(value)] || { label: displayValue(value), tone: 'neutral' }
  return { ...base, tone: config.value.statusTones?.[String(value)] || base.tone }
}

function columnWidth(column: ColumnConfig) {
  return ['mono', 'number', 'money', 'date', 'status', 'image'].includes(column.type || '') ? column.width : undefined
}

function columnMinWidth(column: ColumnConfig) {
  return column.minWidth || column.width
}

function handlePrototypeEvent(event: Event) {
  const detail = (event as CustomEvent<{ action?: string; tab?: string }>).detail || {}
  if (!detail.action) return
  const action = detail.action
  if (['notifications', 'domain-switch', 'account-menu'].includes(action)) return
  if (action === 'import-devices') {
    importOpen.value = true
    return
  }
  if (['device-create', 'ota-release', 'dealer-edit', 'project-edit', 'material-edit', 'courier-edit', 'warranty-edit', 'flow-edit', 'banner-edit', 'admin-edit'].includes(action)) {
    openEditor(action === 'device-create' || action === 'ota-release' ? undefined : rows.value[0])
    return
  }
  if (action !== 'complaint-detail-modal' && (['device-detail', 'user-detail', 'dealer-detail', 'project-detail', 'repair-detail', 'complaint-detail', 'payment-detail', 'log-detail'].some((item) => action.includes(item)) || action.endsWith('-drawer'))) {
    if (rows.value[0]) void openDetail(rows.value[0]).then(() => { detailTab.value = detail.tab || 'overview' })
    return
  }
  const actionMap: Record<string, string> = { 'assign-repair': 'assign', 'message-reply': 'reply', 'material-approve': 'approve', 'courier-test': 'test', 'transfer-approve': 'process', 'force-unbind': 'unbind', 'remote-disable': 'remote-disable', 'role-permissions': 'permissions' }
  if (actionMap[action] && rows.value[0]) {
    runRowAction(actionMap[action], rows.value[0])
    return
  }
  prototypeAction.value = action
  prototypeTitle.value = prototypeLabels[action] || actionLabels[action] || '业务操作'
  prototypeTab.value = detail.tab || 'base'
  prototypeOpen.value = true
}

function savePrototypeAction() {
  prototypeOpen.value = false
  ElMessage.success(`${prototypeTitle.value}已完成（本地模拟）`)
}

watch(() => props.moduleKey, async () => { applyRouteQuery(); await load() })
watch(() => route.query.tab, async (value) => {
  const requestedTab = String(value || config.value.tabs[0]?.key || 'all')
  if (requestedTab === query.tab) return
  applyRouteQuery()
  await load()
})
watch(() => route.query.keyword, (value) => { if (String(value || '') !== query.keyword) { query.keyword = String(value || ''); search() } })
watch(() => query.pageSize, (value) => preferences.setPageSize(value))

onMounted(() => {
  applyRouteQuery()
  load()
  window.addEventListener('prototype-open', handlePrototypeEvent)
})
onBeforeUnmount(() => window.removeEventListener('prototype-open', handlePrototypeEvent))
</script>

<template>
  <section class="module-page">
    <header class="page-heading">
      <div>
        <div class="eyebrow">{{ config.eyebrow }}</div>
        <h1>{{ config.title }}</h1>
        <p>{{ config.description }}</p>
      </div>
      <div class="heading-actions">
        <el-button v-if="canBatchImport" @click="importOpen = true"><AppIcon name="file-spreadsheet" :size="16" />{{ moduleKey === 'warehouse' ? '批量入库' : '批量导入' }}</el-button>
        <el-button v-if="activePrimaryLabel && canCreate" type="primary" @click="primaryAction"><AppIcon :name="activePrimaryLabel.includes('导出') ? 'download' : 'plus'" :size="16" />{{ activePrimaryLabel }}</el-button>
      </div>
    </header>

    <div class="page-panel data-panel">
      <el-tabs :model-value="query.tab" class="module-tabs" @tab-change="changeTab">
        <el-tab-pane v-for="tab in config.tabs" :key="tab.key" :name="tab.key">
          <template #label><span>{{ tab.label }}</span></template>
        </el-tab-pane>
      </el-tabs>

      <form class="filter-bar domain-filter-bar" @submit.prevent="search">
        <label v-for="filter in activeFilters" :key="filter.field" class="filter-field">
          <span class="filter-label">{{ filter.label }}</span>
          <el-input v-if="filter.type === 'text'" v-model="filterValues[filter.field]" clearable :aria-label="filter.label" :placeholder="filter.placeholder || `请输入${filter.label}`" class="filter-search domain-filter-control">
            <template #prefix><AppIcon name="search" :size="16" /></template>
          </el-input>
          <el-select v-else-if="filter.type === 'select'" v-model="filterValues[filter.field]" clearable :placeholder="`全部${filter.label}`" class="domain-filter-control" @change="search">
            <el-option v-for="option in fieldOptions(filter)" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          <el-date-picker v-else v-model="filterValues[filter.field]" type="daterange" unlink-panels range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" value-format="YYYY-MM-DD" class="domain-date-filter" @change="search" />
        </label>
        <div class="filter-actions"><el-button @click="resetFilters">重置</el-button><el-button native-type="submit" type="primary"><AppIcon name="search" :size="16" />查询</el-button></div>
      </form>

      <div class="table-toolbar">
        <div><strong>数据列表</strong><span>{{ currentTab.label }} · 共 {{ total }} 条</span><span v-if="selected.length" class="selected-count">已选择 {{ selected.length }} 条</span></div>
        <div>
          <el-button text title="刷新" @click="load"><AppIcon name="refresh-cw" :size="16" /></el-button>
          <el-button text title="导出当前模块" @click="exportAll"><AppIcon name="download" :size="16" /></el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="rows" row-key="id" class="business-table" @selection-change="selected = $event" @sort-change="changeSort">
        <el-table-column type="selection" width="48" />
        <el-table-column v-for="column in activeColumns" :key="column.field" :prop="column.field" :label="column.label" :width="columnWidth(column)" :min-width="columnMinWidth(column)" sortable="custom" show-overflow-tooltip>
          <template #default="scope">
            <div v-if="column.type === 'main'" class="main-cell"><strong>{{ displayColumn(column, scope.row) }}</strong><small>{{ scope.row.code }}</small></div>
            <code v-else-if="column.type === 'mono'" class="mono-cell">{{ displayColumn(column, scope.row) }}</code>
            <span v-else-if="column.type === 'status'" class="status-chip" :data-tone="statusMeta(scope.row[column.field]).tone"><i></i>{{ statusMeta(scope.row[column.field]).label }}</span>
            <span v-else-if="column.type === 'money'" class="money-cell">¥{{ Number(scope.row[column.field] || 0).toLocaleString() }}</span>
            <span v-else-if="column.type === 'number'">{{ Number(scope.row[column.field] || 0).toLocaleString() }}</span>
            <el-button v-else-if="column.type === 'link'" link type="primary" @click="openDetailTab(scope.row, 'devices')">{{ Number(scope.row[column.field] || 0).toLocaleString() }}</el-button>
            <img v-else-if="column.type === 'image'" class="table-image" :src="String(scope.row[column.field] || '/assets/backgrounds/banner-maintenance.png')" alt="Banner">
            <span v-else>{{ displayColumn(column, scope.row) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="activeRowActions.length" label="操作" fixed="right" :width="Math.max(130, Math.min(420, activeRowActions.length * 86))">
          <template #default="scope"><div class="row-actions"><el-button v-for="action in activeRowActions.filter((item) => canRunAction(item, scope.row))" :key="action" link :type="['delete', 'remote-disable', 'unbind', 'reject', 'escalate'].includes(action) ? 'danger' : 'primary'" @click="runRowAction(action, scope.row)">{{ rowActionLabel(action, scope.row) }}</el-button></div></template>
        </el-table-column>
        <template #empty><div class="empty-state"><AppIcon name="inbox" :size="34" /><strong>{{ hasFilters ? '没有匹配的结果' : '暂无数据' }}</strong><p>{{ hasFilters ? '请调整筛选条件后重试。' : '当前数据域下还没有记录。' }}</p><el-button v-if="hasFilters" @click="resetFilters">清除筛选</el-button></div></template>
      </el-table>

      <footer class="pagination-bar">
        <span>显示 {{ pageStart }}-{{ pageEnd }} 条，共 {{ total }} 条</span>
        <el-pagination v-model:current-page="query.pageNum" v-model:page-size="query.pageSize" layout="sizes, prev, pager, next" :page-sizes="[10, 20, 50]" :total="total" @change="load" />
      </footer>
    </div>

    <el-dialog v-model="editorOpen" :title="editorMode === 'create' ? activePrimaryLabel || `新增${config.title}` : `编辑${config.title}`" width="760px" align-center append-to-body destroy-on-close class="entity-dialog">
      <el-form ref="editorRef" :model="editorForm" label-position="top" class="entity-form">
        <el-form-item v-for="field in activeFields" :key="field.field" :label="field.label" :prop="field.field" :rules="fieldRules(field)" :class="{ 'span-two': field.span === 2 }">
          <el-input v-if="field.type === 'text'" v-model="editorForm[field.field]" :placeholder="field.placeholder || `请输入${field.label}`" :disabled="field.readonly" @blur="refreshDerivedFields" />
          <el-input v-else-if="field.type === 'password'" v-model="editorForm[field.field]" type="password" show-password :placeholder="`请输入${field.label}`" autocomplete="new-password" />
          <el-input v-else-if="field.type === 'textarea'" v-model="editorForm[field.field]" type="textarea" :rows="4" maxlength="300" show-word-limit />
          <el-select v-else-if="field.type === 'select'" v-model="editorForm[field.field]" :disabled="field.readonly" placeholder="请选择" style="width: 100%" @change="refreshDerivedFields"><el-option v-for="option in fieldOptions(field)" :key="option.value" :label="option.label" :value="option.value" /></el-select>
          <el-select v-else-if="field.type === 'multiSelect'" v-model="editorForm[field.field]" :disabled="field.readonly" multiple collapse-tags collapse-tags-tooltip placeholder="请选择" style="width: 100%" @change="refreshDerivedFields"><el-option v-for="option in fieldOptions(field)" :key="option.value" :label="option.label" :value="option.value" /></el-select>
          <el-date-picker v-else-if="field.type === 'date'" v-model="editorForm[field.field]" :disabled="field.readonly" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          <el-input-number v-else-if="field.type === 'number'" v-model="editorForm[field.field]" :disabled="field.readonly" :min="field.min ?? 0" :max="field.max" controls-position="right" style="width: 100%" />
          <el-switch v-else-if="field.type === 'switch'" v-model="editorForm[field.field]" />
          <el-upload v-else-if="field.type === 'image'" action="#" :auto-upload="false" :show-file-list="false" accept="image/png,image/jpeg,image/webp" :on-change="onBannerFile">
            <div class="image-uploader"><img v-if="editorForm[field.field]" :src="String(editorForm[field.field])" alt="Banner 预览"><div v-else><AppIcon name="image-plus" :size="28" /><strong>选择 Banner 图片</strong><small>PNG/JPG/WebP，最大 2 MB，自动裁切为 3:1</small></div></div>
          </el-upload>
          <el-upload v-else-if="field.type === 'firmware'" action="#" :auto-upload="false" :limit="1" accept=".bin,.zip,.img" :on-change="onFirmwareFile"><el-button><AppIcon name="file-up" :size="16" />选择固件文件</el-button><template #tip><div class="el-upload__tip">{{ editorForm[field.field] || '支持 .bin、.zip、.img，最大 50 MB；静态版不保存文件二进制。' }}</div></template></el-upload>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="editorOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveEditor">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="detailOpen" :title="`${config.title}详情`" width="860px" align-center append-to-body destroy-on-close class="detail-dialog">
      <template v-if="detailRecord">
        <div class="detail-summary">
          <div class="summary-icon"><AppIcon :name="config.icon" :size="28" /></div>
          <div><div class="eyebrow">{{ detailRecord.code }}</div><h2>{{ detailRecord.name }}</h2><p>{{ detailRecord.summary }}</p></div>
          <span class="status-chip" :data-tone="statusMeta(detailRecord.status).tone"><i></i>{{ statusMeta(detailRecord.status).label }}</span>
        </div>
        <el-tabs v-model="detailTab" class="detail-tabs">
          <el-tab-pane v-for="tab in drawerTabs" :key="tab.key" :label="tab.label" :name="tab.key">
            <DomainDetailPanel v-if="currentDetailTab && currentDetailTab.key === tab.key" :key="`${detailRecord.id}-${tab.key}-${detailRevision}`" :module-key="moduleKey" :record="detailRecord" :tab="currentDetailTab" @action="runRelatedAction" />
          </el-tab-pane>
        </el-tabs>
      </template>
      <template #footer>
        <div class="detail-dialog-footer">
          <div><strong>{{ config.crud === 'readonly' ? '只读详情' : '风险操作' }}</strong><p>{{ config.crud === 'readonly' ? '审计数据仅供查询，不支持直接修改。' : '状态变更、解绑与删除都会写入操作日志。' }}</p></div>
          <el-button @click="detailOpen = false">关闭</el-button>
          <el-button v-if="detailRecord && config.rowActions?.includes('edit') && canRunAction('edit', detailRecord)" @click="detailOpen = false; openEditor(detailRecord)">编辑</el-button>
          <el-button v-if="detailRecord && config.rowActions?.includes('delete')" type="danger" plain @click="detailOpen = false; runRowAction('delete', detailRecord)">删除</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="riskOpen" :title="riskActionLabel" width="620px" align-center append-to-body class="risk-dialog">
      <div class="impact-callout"><AppIcon name="triangle-alert" :size="22" /><div><strong>请确认影响范围</strong><p>{{ currentAction?.impact || `对象：${riskRecord?.name}（${riskRecord?.code}）。操作会同步更新关联数据和审计日志。` }}</p></div></div>
      <el-form label-position="top" class="action-form">
        <el-form-item v-if="riskAction === 'permissions'" label="菜单与操作权限" class="permission-action-field"><el-tree ref="permissionTreeRef" show-checkbox default-expand-all node-key="id" :data="permissionTree" /></el-form-item>
        <el-form-item v-for="field in currentAction?.fields" :key="field.field" :label="field.label" :required="field.required">
          <el-input v-if="field.type === 'text'" v-model="actionForm[field.field]" :placeholder="`请输入${field.label}`" />
          <el-input v-else-if="field.type === 'textarea'" v-model="actionForm[field.field]" type="textarea" :rows="3" :placeholder="`请输入${field.label}`" maxlength="300" show-word-limit />
          <el-select v-else-if="field.type === 'select'" v-model="actionForm[field.field]" placeholder="请选择" style="width: 100%"><el-option v-for="option in fieldOptions(field)" :key="option.value" :label="option.label" :value="option.value" /></el-select>
          <el-select v-else-if="field.type === 'multiSelect'" v-model="actionForm[field.field]" multiple collapse-tags placeholder="请选择" style="width: 100%"><el-option v-for="option in fieldOptions(field)" :key="option.value" :label="option.label" :value="option.value" /></el-select>
          <el-input-number v-else-if="field.type === 'number'" v-model="actionForm[field.field]" :min="field.min || 0" :max="field.max" style="width: 100%" />
          <el-switch v-else-if="field.type === 'switch'" v-model="actionForm[field.field]" />
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="riskOpen = false">取消</el-button><el-button :type="currentAction?.tone === 'danger' ? 'danger' : 'primary'" :loading="saving" @click="confirmRisk">确认{{ riskActionLabel }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="importOpen" :title="moduleKey === 'warehouse' ? '批量设备入库' : '批量导入设备'" width="860px" align-center append-to-body class="import-dialog">
      <div class="import-steps"><span class="active">1 选择文件</span><i></i><span :class="{ active: importRows.length }">2 校验数据</span><i></i><span>3 完成导入</span></div>
      <div class="drop-zone" :class="{ ready: importRows.length }">
        <AppIcon name="file-spreadsheet" :size="32" /><strong>{{ importName || '选择 Excel 或 CSV 文件' }}</strong><p>需要包含 SN、设备型号、销售地区三列；SN 必须全局唯一。</p>
        <label class="el-button el-button--primary"><input type="file" accept=".xlsx,.csv" hidden @change="onImportFile">选择文件</label><el-button link type="primary" @click="downloadDeviceTemplate">下载导入模板</el-button>
      </div>
      <div v-if="importRows.length" class="import-result"><div class="result-summary"><span>共 {{ importRows.length }} 行</span><b class="success-text">{{ validImportCount }} 行可导入</b><b v-if="importRows.length - validImportCount" class="error-text">{{ importRows.length - validImportCount }} 行需修正</b></div><el-table :data="importRows" max-height="280"><el-table-column prop="row" label="行号" width="70" /><el-table-column prop="sn" label="SN" min-width="160" /><el-table-column prop="model" label="设备型号" min-width="160" /><el-table-column prop="region" label="销售地区" width="120" /><el-table-column label="校验结果" min-width="190"><template #default="scope"><span :class="scope.row.valid ? 'success-text' : 'error-text'">{{ scope.row.valid ? '通过' : scope.row.error }}</span></template></el-table-column></el-table></div>
      <template #footer><el-button @click="importOpen = false">取消</el-button><el-button type="primary" :loading="importBusy" :disabled="!validImportCount" @click="confirmImport">{{ moduleKey === 'warehouse' ? '入库' : '导入' }} {{ validImportCount }} 台设备</el-button></template>
    </el-dialog>

    <el-dialog v-model="prototypeOpen" :title="prototypeTitle" width="700px" align-center append-to-body class="entity-dialog prototype-dialog">
      <el-tabs v-model="prototypeTab"><el-tab-pane label="基本信息" name="base" /><el-tab-pane label="权限与范围" name="permissions" /><el-tab-pane label="操作记录" name="history" /></el-tabs>
      <div v-if="prototypeAction === 'role-permissions'" class="permission-tree"><el-tree show-checkbox default-expand-all node-key="id" :default-checked-keys="['devices:view', 'repairs:view']" :data="[{ id: 'business', label: '业务管理', children: [{ id: 'devices:view', label: '设备管理' }, { id: 'repairs:view', label: '故障报修' }, { id: 'materials:view', label: '物料申请' }] }, { id: 'system', label: '系统管理', children: [{ id: 'admins:view', label: '管理员账号' }, { id: 'logs:view', label: '操作日志' }] }]" /></div>
      <el-form v-else label-position="top" class="entity-form"><el-form-item label="处理对象"><el-input :model-value="rows[0]?.name || config.title" /></el-form-item><el-form-item label="影响范围"><el-select model-value="current" style="width: 100%"><el-option label="当前记录" value="current" /><el-option label="当前数据域" value="domain" /></el-select></el-form-item><el-form-item label="处理说明" class="span-two"><el-input type="textarea" :rows="4" placeholder="请输入本次操作说明" /></el-form-item></el-form>
      <template #footer><el-button @click="prototypeOpen = false">取消</el-button><el-button type="primary" @click="savePrototypeAction">确认</el-button></template>
    </el-dialog>
  </section>
</template>
