<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type UploadFile } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import DomainDetailPanel from '@/components/DomainDetailPanel.vue'
import { moduleConfigs, navGroups, statusLabels } from '@/config/modules'
import { actionPermission, hasPermission } from '@/config/permissions'
import { assetUrl } from '@/services/assets'
import { mockService } from '@/services/mock'
import {
  compressBanner,
  downloadDeviceTemplate,
  downloadMaterialTemplate,
  downloadOutboundTemplate,
  downloadProductTemplate,
  exportRecords,
  parseDeviceFile,
  parseMaterialFile,
  parseOutboundFile,
  parseProductFile,
  parseProductText,
  type DeviceImportRow,
  type DeviceOutboundRow,
  type MaterialImportRow,
  type ProductImportRow,
} from '@/services/excel'
import { useAuthStore } from '@/stores/auth'
import { usePreferencesStore } from '@/stores/preferences'
import type { ActionConfig, ColumnConfig, EntityRecord, FieldConfig, RelatedNavigationItem } from '@/types'

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
const relationFilters = reactive<Record<string, string | string[]>>({})
const relatedLinks = ref<Record<string, RelatedNavigationItem[]>>({})
const dynamicOptions = reactive<Record<string, Array<{ label: string; value: string }>>>({})
const query = reactive({ pageNum: 1, pageSize: preferences.pageSize, keyword: '', status: '', tab: 'all', orderByColumn: '', isAsc: 'desc' as 'asc' | 'desc', filters: filterValues, relationFilters })

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
const outboundRows = ref<DeviceOutboundRow[]>([])
const materialImportRows = ref<MaterialImportRow[]>([])
const productImportRows = ref<ProductImportRow[]>([])
const productPaste = ref('')
const importName = ref('')
const outboundForm = reactive({ targetDealerId: '', summary: '' })

const actionLabels: Record<string, string> = {
  detail: '查看详情', edit: '编辑', delete: '删除', toggle: '禁用/启用', unbind: '强制解绑', 'remote-disable': '远程禁用', 'remote-enable': '远程启用', 'change-region': '修改销售地区',
  'reset-password': '重置默认密码', assign: '分配处理', reply: '回复用户', forward: '转发经销商', complete: '标记完成', approve: '审批通过',
  reject: '审批拒绝', ship: '物料发货', 'finance-confirm': '财务确认', 'purchase-ship': '仓库发货', 'confirm-outbound': '确认出库', 'reject-outbound': '驳回出库', 'record-expense': '财务确认', 'record-bill': '登记维修账单', publish: '发布/撤回', process: '调货审批', test: '测试查询', permissions: '配置权限', escalate: '转单到总部',
  'confirm-transfer': '确认售后转移', 'approve-transfer-fee': '通过费用审批', 'reject-transfer-fee': '拒绝费用审批',
  'approve-original': '审批通过', 'reject-original': '审批拒绝', 'confirm-receipt': '确认收货', 'complete-replacement': '登记更换', 'confirm-purchase-receipt': '确认采购收货', 'start-production': '导入生产', 'complete-production': '确认生产完成', 'finance-verify': '核实本期付款', 'record-payment': '登记付款', resolve: '处理异常',
}

const prototypeLabels: Record<string, string> = {
  'device-create': '录入设备', 'import-devices': '批量导入设备', 'ota-release': '发布 OTA 固件',
  'dealer-edit': '编辑经销商', 'project-edit': '编辑项目', 'assign-repair': '分配报修工单',
  'message-reply': '回复用户留言', 'complaint-detail-modal': '处理投诉', 'material-approve': '物料申请审批',
  'material-edit': '编辑物料', 'courier-edit': '编辑物流公司', 'courier-test': '测试物流轨迹',
  'sn-swap': '维修物料替换', 'service-transfer': '发起售后转移', 'warranty-edit': '编辑质保规则',
  'flow-edit': '编辑审批流程', 'banner-edit': '编辑 Banner', 'admin-edit': '编辑管理员',
  'reset-password': '重置管理员密码', 'role-permissions': '配置角色权限', 'stock-in': '设备入库',
  'outbound-create': '创建出库单', 'transfer-approve': '库存调货审批', 'force-unbind': '强制解绑设备',
  'remote-disable': '远程禁用设备', 'notifications': '通知中心', 'domain-switch': '切换数据域', 'account-menu': '账号菜单',
}

const currentTab = computed(() => config.value.tabs.find((item) => item.key === query.tab) || config.value.tabs[0])
const fieldDisplayLabel = (field: FieldConfig) => auth.session?.domain === 'global' ? field.label.replace('（元）', '（美元）') : field.label
const activeFields = computed(() => config.value.tabFields?.[query.tab] || config.value.fields)
const editorFields = computed(() => activeFields.value.filter((field) => {
  if (!field.visibleWhen) return true
  const current = editorForm.value[field.visibleWhen.field]
  return field.visibleWhen.values ? field.visibleWhen.values.includes(current as never) : current === field.visibleWhen.value
}))
const activeFilters = computed(() => config.value.tabFilters?.[query.tab] || config.value.filters)
const activeColumns = computed(() => (config.value.tabColumns?.[query.tab] || config.value.columns).filter((column) => props.moduleKey !== 'product-catalog' || auth.session?.role !== 'tier2' || !['tier1Price', 'referencePrice'].includes(column.field)))
const activeRowActions = computed(() => config.value.tabRowActions?.[query.tab] ?? config.value.rowActions ?? ['detail'])
const activePrimaryLabel = computed(() => config.value.primaryByTab ? config.value.primaryByTab[query.tab] : config.value.primaryLabel)
const canCreate = computed(() => {
  if (!activePrimaryLabel.value || !hasPermission(auth.permissions, `${props.moduleKey}:create`)) return false
  if (props.moduleKey === 'warehouse') return query.tab === 'transfer' ? auth.session?.role !== 'platform' : auth.session?.role === 'platform'
  if (props.moduleKey === 'dealers' && auth.session?.role === 'tier1' && query.tab === 'tier1') return false
  if (['materials', 'product-purchase', 'sn-replacement', 'warranty'].includes(props.moduleKey)) return auth.session?.role !== 'platform'
  if (props.moduleKey === 'service-transfer') return ['platform', 'custom', 'tier1', 'tier2'].includes(String(auth.session?.role))
  return true
})
const isOutboundImport = computed(() => props.moduleKey === 'warehouse' && query.tab === 'outbound')
const isMaterialImport = computed(() => props.moduleKey === 'material-catalog')
const isProductImport = computed(() => props.moduleKey === 'product-catalog')
const canBatchImport = computed(() => auth.session?.role === 'platform' && (['material-catalog', 'product-catalog'].includes(props.moduleKey) || props.moduleKey === 'warehouse' && ['stock', 'outbound'].includes(query.tab)))
const canExport = computed(() => config.value.exportable !== false && hasPermission(auth.permissions, `${props.moduleKey}:export`))
const batchImportLabel = computed(() => isMaterialImport.value ? '批量导入物料' : isProductImport.value ? '批量导入产品' : props.moduleKey === 'devices' ? '批量导入' : isOutboundImport.value ? '表格出库' : '批量入库')
const drawerTabs = computed(() => config.value.detailTabs.filter((tab) => {
  if (props.moduleKey === 'service-transfer' && detailRecord.value && !detailRecord.value.hasFee) return tab.key !== 'expenses'
  if (props.moduleKey !== 'materials' || !detailRecord.value) return true
  if (detailRecord.value.category === '设备采购') return true
  return tab.key !== 'expenses'
}))
const currentDetailTab = computed(() => drawerTabs.value.find((item) => item.key === detailTab.value) || drawerTabs.value[0])
const currentAction = computed<ActionConfig | undefined>(() => moduleConfigs[riskTargetModule.value || props.moduleKey]?.actions?.find((item) => item.key === riskAction.value))
const currentActionFields = computed(() => (currentAction.value?.fields || []).filter((field) => {
  if (!field.visibleWhen) return true
  const current = actionForm.value[field.visibleWhen.field]
  return field.visibleWhen.values ? field.visibleWhen.values.includes(current as never) : current === field.visibleWhen.value
}))
const riskActionLabel = computed(() => {
  if (riskRecord.value && ['toggle', 'publish', 'approve'].includes(riskAction.value)) return rowActionLabel(riskAction.value, riskRecord.value)
  return currentAction.value?.label || actionLabels[riskAction.value] || '确认操作'
})
const permissionTreeRef = ref<{ getCheckedKeys: () => unknown[]; setCheckedKeys: (keys: unknown[]) => void }>()
const permissionActionLabels: Record<string, string> = {
  create: '新增', edit: '编辑', delete: '删除', toggle: '禁用/启用', 'reset-password': '重置默认密码',
  assign: '分配处理', reply: '回复用户', forward: '转发经销商', escalate: '转单到总部', complete: '标记完成',
  approve: '业务确认通过', reject: '审批拒绝', ship: '物料发货', 'finance-confirm': '财务确认', 'purchase-ship': '仓库发货', 'record-expense': '财务确认', process: '流程处理',
  'confirm-transfer': '确认售后转移', 'approve-transfer-fee': '通过费用审批', 'reject-transfer-fee': '拒绝费用审批',
  'approve-original': '审批通过', 'reject-original': '审批拒绝', 'confirm-receipt': '确认收货', 'complete-replacement': '登记更换', 'confirm-purchase-receipt': '确认采购收货', 'start-production': '导入生产', 'complete-production': '确认生产完成', 'finance-verify': '核实本期付款', 'record-payment': '登记付款', resolve: '处理异常',
  publish: '发布/撤回', test: '测试查询', permissions: '配置权限', 'remote-disable': '远程禁用', 'remote-enable': '远程启用',
  unbind: '强制解绑', 'change-region': '修改销售地区',
  export: '导出数据',
}
const permissionRoutes = new Set<string>()
const permissionTree = navGroups.map((group, groupIndex) => ({
  id: `group-${groupIndex}`,
  label: group.label,
  children: group.items.filter((item) => {
    if (permissionRoutes.has(item.route)) return false
    permissionRoutes.add(item.route)
    return true
  }).map((item) => {
    const module = moduleConfigs[item.route]
    const actions = new Set<string>()
    if (module?.primaryLabel && !module.primaryLabel.includes('导出')) actions.add('create')
    if (module?.exportable !== false) actions.add('export')
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
const activeImportRows = computed(() => isProductImport.value ? productImportRows.value : isMaterialImport.value ? materialImportRows.value : isOutboundImport.value ? outboundRows.value : importRows.value)
const validImportCount = computed(() => activeImportRows.value.filter((item) => item.valid).length)
const invalidImportCount = computed(() => activeImportRows.value.length - validImportCount.value)
const canConfirmImport = computed(() => validImportCount.value > 0 && (!isOutboundImport.value || (!invalidImportCount.value && Boolean(outboundForm.targetDealerId))))
const hasFilters = computed(() => Boolean(query.keyword || query.status || Object.values(filterValues).some((value) => Array.isArray(value) ? value.length : String(value ?? '').trim())))
const hasRelationContext = computed(() => Object.values(relationFilters).some((value) => Array.isArray(value) ? value.length : Boolean(value)))
const relationSourceTitle = computed(() => moduleConfigs[String(route.query.fromModule || '')]?.title || String(route.query.fromTitle || '关联页面'))
const relationSourceLabel = computed(() => String(route.query.fromLabel || route.query.fromCode || '业务记录'))
const relationDescription = computed(() => String(route.query.relationLabel || '关联数据'))
const hasRelatedLinks = computed(() => Object.values(relatedLinks.value).some((items) => items.length > 0))
const operationColumnWidth = computed(() => {
  const actionSlots = activeRowActions.value.length > 3 ? 3 : activeRowActions.value.length
  return Math.max(140, Math.min(460, actionSlots * 86 + (hasRelatedLinks.value ? 172 : 0)))
})
const pageStart = computed(() => total.value ? (query.pageNum - 1) * query.pageSize + 1 : 0)
const pageEnd = computed(() => Math.min(total.value, query.pageNum * query.pageSize))

function emptyForm() {
  const result: Record<string, unknown> = {}
  activeFields.value.forEach((field) => {
    if (field.type === 'switch') result[field.field] = false
    else if (field.type === 'multiSelect') result[field.field] = []
    else if (field.type === 'lineItems') result[field.field] = [{ itemKey: '', quantity: 1, unitPrice: 0 }]
    else if (field.type === 'componentItems') result[field.field] = [{ serialNumber: '', specification: '' }]
    else if (field.type === 'priceItems') result[field.field] = []
    else if (field.type === 'number') result[field.field] = 0
    else if (field.field === 'status') result[field.field] = field.options?.[0]?.value || 'normal'
    else result[field.field] = ''
  })
  if (props.moduleKey === 'dealers') result.defaultWarrantyYears = auth.session?.domain === 'global' ? 1 : 2
  return result
}

type PurchaseLine = { itemKey: string; quantity: number; unitPrice: number }
function purchaseLines(field: FieldConfig) {
  const value = editorForm.value[field.field]
  if (!Array.isArray(value)) editorForm.value[field.field] = []
  return editorForm.value[field.field] as PurchaseLine[]
}
function addPurchaseLine(field: FieldConfig) { purchaseLines(field).push({ itemKey: '', quantity: 1, unitPrice: 0 }) }
function removePurchaseLine(field: FieldConfig, index: number) { if (purchaseLines(field).length > 1) purchaseLines(field).splice(index, 1) }

type DeviceComponentLine = { serialNumber: string; specification: string }
function componentLines(field: FieldConfig) {
  const value = editorForm.value[field.field]
  if (!Array.isArray(value)) editorForm.value[field.field] = []
  return editorForm.value[field.field] as DeviceComponentLine[]
}
function addComponentLine(field: FieldConfig) { componentLines(field).push({ serialNumber: '', specification: '' }) }
function removeComponentLine(field: FieldConfig, index: number) {
  if (componentLines(field).length > 1) componentLines(field).splice(index, 1)
}

type PriceLine = { name: string; price: number }
function priceLines(field: FieldConfig) {
  if (!Array.isArray(editorForm.value[field.field])) editorForm.value[field.field] = []
  return editorForm.value[field.field] as PriceLine[]
}
function addPriceLine(field: FieldConfig) { priceLines(field).push({ name: '', price: 0 }) }
function removePriceLine(field: FieldConfig, index: number) { priceLines(field).splice(index, 1) }

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
    await loadOptions(activeFilters.value, filterValues)
    const response = await mockService.list(props.moduleKey, query)
    rows.value = response.rows
    total.value = response.total
    const navigation = rows.value.length ? await mockService.relatedNavigation(props.moduleKey, rows.value.map((item) => item.id)) : null
    relatedLinks.value = navigation?.code === 200 ? navigation.data : {}
    if (rows.value.length === 0 && query.pageNum > 1) {
      query.pageNum -= 1
      await load()
    }
    const detailId = routeScalar(route.query.detail)
    if (detailId && !detailOpen.value) {
      const detail = await mockService.get(props.moduleKey, detailId)
      if (detail.data) {
        detailRecord.value = detail.data
        detailTab.value = routeScalar(route.query.detailTab) || 'overview'
        detailOpen.value = true
      }
    }
  } finally {
    loading.value = false
  }
}

function routeScalar(value: unknown) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

function buildRouteQuery() {
  const next: Record<string, string | string[] | undefined> = {
    tab: query.tab,
    keyword: query.keyword || undefined,
    pageNum: query.pageNum > 1 ? String(query.pageNum) : undefined,
    pageSize: query.pageSize !== preferences.pageSize ? String(query.pageSize) : undefined,
    sort: query.orderByColumn || undefined,
    dir: query.orderByColumn ? query.isAsc : undefined,
  }
  for (const filter of activeFilters.value) {
    const value = filterValues[filter.field]
    if (Array.isArray(value) ? value.length : String(value ?? '').trim()) next[`f_${filter.field}`] = Array.isArray(value) ? value.map(String) : String(value)
  }
  for (const [field, value] of Object.entries(relationFilters)) if (Array.isArray(value) ? value.length : value) next[`rel_${field}`] = value
  for (const key of ['fromModule', 'fromTitle', 'fromCode', 'fromLabel', 'relationLabel', 'returnTo']) {
    const value = route.query[key]
    if (value) next[key] = Array.isArray(value) ? value.map(String) : String(value)
  }
  return next
}

function applyRouteQuery() {
  Object.keys(filterValues).forEach((key) => { delete filterValues[key] })
  Object.keys(relationFilters).forEach((key) => { delete relationFilters[key] })
  const requestedTab = String(route.query.tab || config.value.tabs[0]?.key || 'all')
  query.tab = config.value.tabs.some((item) => item.key === requestedTab) ? requestedTab : (config.value.tabs[0]?.key || 'all')
  activeFilters.value.forEach((filter) => {
    const value = route.query[`f_${filter.field}`]
    filterValues[filter.field] = value === undefined ? '' : filter.type === 'dateRange' ? (Array.isArray(value) ? value.map(String) : [String(value)]) : routeScalar(value)
  })
  for (const [key, value] of Object.entries(route.query)) {
    if (!key.startsWith('rel_') || value === undefined || value === null) continue
    relationFilters[key.slice(4)] = Array.isArray(value) ? value.map(String) : String(value)
  }
  query.keyword = String(route.query.keyword || '')
  query.pageNum = Math.max(1, Number(route.query.pageNum || 1) || 1)
  query.pageSize = [10, 20, 50].includes(Number(route.query.pageSize)) ? Number(route.query.pageSize) : preferences.pageSize
  query.orderByColumn = routeScalar(route.query.sort)
  query.isAsc = route.query.dir === 'asc' ? 'asc' : 'desc'
}

async function replaceListQuery(next = buildRouteQuery()) {
  const previous = route.fullPath
  await router.replace({ query: next })
  if (route.fullPath === previous) await load()
}

async function changeTab(tab: string | number) {
  query.tab = String(tab)
  query.pageNum = 1
  Object.keys(filterValues).forEach((key) => { delete filterValues[key] })
  activeFilters.value.forEach((filter) => { filterValues[filter.field] = '' })
  await replaceListQuery()
}

async function search() {
  query.pageNum = 1
  await replaceListQuery()
}

async function changeFilter(field: string) {
  if (props.moduleKey === 'warehouse' && query.tab === 'stock' && field === 'deviceType') filterValues.deviceModel = ''
  await loadOptions(activeFilters.value, filterValues)
  await search()
}

async function resetFilters() {
  query.keyword = ''
  query.status = ''
  Object.keys(filterValues).forEach((key) => { filterValues[key] = '' })
  query.orderByColumn = ''
  query.isAsc = 'desc'
  query.pageNum = 1
  await replaceListQuery()
}

async function changeSort({ prop, order }: { prop: string; order: 'ascending' | 'descending' | null }) {
  query.orderByColumn = order ? prop : ''
  query.isAsc = order === 'ascending' ? 'asc' : 'desc'
  query.pageNum = 1
  await replaceListQuery()
}

async function changePage() {
  await replaceListQuery()
}

function primaryRelated(record: EntityRecord) {
  return relatedLinks.value[record.id]?.find((item) => item.level === 'primary')
}

function secondaryRelated(record: EntityRecord) {
  return (relatedLinks.value[record.id] || []).filter((item) => item !== primaryRelated(record))
}

async function navigateRelated(item: RelatedNavigationItem, record: EntityRecord) {
  const returnQuery = { ...route.query }
  if (detailOpen.value && detailRecord.value) {
    returnQuery.detail = detailRecord.value.id
    returnQuery.detailTab = detailTab.value
  }
  const returnTo = router.resolve({ name: props.moduleKey, query: returnQuery }).fullPath
  detailOpen.value = false
  const targetQuery: Record<string, string | string[]> = {
    tab: item.targetTab || moduleConfigs[item.targetModule]?.tabs[0]?.key || 'all',
    fromModule: props.moduleKey,
    fromTitle: config.value.title,
    fromCode: record.code,
    fromLabel: record.name,
    relationLabel: item.label,
    returnTo,
  }
  for (const [field, value] of Object.entries(item.relationFilters)) targetQuery[`rel_${field}`] = value
  if (typeof item.relationFilters.id === 'string') targetQuery.detail = item.relationFilters.id
  await router.push({ name: item.targetModule, query: targetQuery })
}

async function clearDetailRouteState() {
  if (!route.query.detail && !route.query.detailTab) return
  const next = { ...route.query }
  delete next.detail
  delete next.detailTab
  await router.replace({ query: next })
}

async function navigateRelatedByKey(record: EntityRecord, key: string) {
  const item = relatedLinks.value[record.id]?.find((link) => link.key === key)
  if (item) await navigateRelated(item, record)
}

async function clearRelationContext() {
  Object.keys(relationFilters).forEach((key) => { delete relationFilters[key] })
  query.pageNum = 1
  const next = buildRouteQuery()
  for (const key of ['fromModule', 'fromTitle', 'fromCode', 'fromLabel', 'relationLabel', 'returnTo']) delete next[key]
  await replaceListQuery(next)
}

async function returnToSource() {
  const returnTo = routeScalar(route.query.returnTo)
  if (returnTo.startsWith('/')) await router.push(returnTo)
  else if (route.query.fromModule) await router.push({ name: String(route.query.fromModule) })
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
    if (['projects', 'warehouse'].includes(props.moduleKey)) {
      const resolved = await mockService.resolveFields(props.moduleKey, editorForm.value)
      editorForm.value = { ...resolved.data }
    }
  } else editorForm.value = emptyForm()
  await loadOptions(activeFields.value, editorForm.value)
  editorOpen.value = true
  nextTick(() => editorRef.value?.clearValidate())
}

async function refreshDerivedFields(changedField = '') {
  if (['projects', 'warehouse'].includes(props.moduleKey) && changedField === 'deviceType') {
    editorForm.value.deviceModel = ''
    editorForm.value.deviceSN = ''
    editorForm.value.deviceName = ''
    editorForm.value.specification = ''
  }
  if (['projects', 'warehouse'].includes(props.moduleKey) && changedField === 'deviceModel') {
    editorForm.value.deviceSN = ''
    editorForm.value.deviceName = ''
    editorForm.value.specification = ''
  }
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
  actionForm.value = Object.fromEntries((moduleConfigs[targetModule]?.actions?.find((item) => item.key === action)?.fields || []).map((field) => [field.field, field.type === 'number' ? 0 : field.type === 'switch' ? false : field.type === 'multiSelect' ? [] : '']))
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

function availableRowActions(record: EntityRecord) {
  return activeRowActions.value.filter((action) => canRunAction(action, record))
}

function inlineRowActions(record: EntityRecord) {
  const actions = availableRowActions(record)
  return actions.length > 3 ? actions.slice(0, 2) : actions
}

function overflowRowActions(record: EntityRecord) {
  const actions = availableRowActions(record)
  return actions.length > 3 ? actions.slice(2) : []
}

async function confirmRisk() {
  if (!riskRecord.value) return
  const requiredField = currentActionFields.value.find((field) => {
    if (!field.required) return false
    const value = actionForm.value[field.field]
    return Array.isArray(value) ? value.length === 0 : !String(value ?? '').trim()
  })
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
  const response = await mockService.exportRows(props.moduleKey, query)
  if (response.code !== 200) {
    ElMessage.error(response.msg)
    return
  }
  await exportRecords(`${config.value.title}-${currentTab.value.label}`, response.data, activeColumns.value)
  ElMessage.success(`已导出 ${response.data.length} 条当前筛选记录`)
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

async function onActionImageFile(upload: UploadFile, field: string) {
  if (!upload.raw) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(upload.raw.type)) {
    ElMessage.error('凭证图片仅支持 PNG、JPG 或 WebP')
    return
  }
  if (upload.raw.size > 2 * 1024 * 1024) {
    ElMessage.error('凭证图片不能超过 2 MB')
    return
  }
  try {
    actionForm.value[field] = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('图片读取失败'))
      reader.readAsDataURL(upload.raw!)
    })
    ElMessage.success('图片已添加')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '图片读取失败')
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

async function onPdfFile(upload: UploadFile) {
  if (!upload.raw) return
  if (upload.raw.type !== 'application/pdf' && !upload.raw.name.toLowerCase().endsWith('.pdf')) {
    ElMessage.error('常见问题文件仅支持 PDF')
    return
  }
  if (upload.raw.size > 4 * 1024 * 1024) {
    ElMessage.error('PDF 文件不能超过 4 MB')
    return
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('PDF 文件读取失败'))
    reader.readAsDataURL(upload.raw!)
  }).catch((error) => {
    ElMessage.error(error instanceof Error ? error.message : 'PDF 文件读取失败')
    return ''
  })
  if (!dataUrl) return
  editorForm.value.pdfFile = upload.raw.name
  editorForm.value.fileName = upload.raw.name
  editorForm.value.pdfData = dataUrl
  ElMessage.success('PDF 文件已读取，可保存发布')
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importBusy.value = true
  importName.value = file.name
  try {
    if (isOutboundImport.value) {
      importRows.value = []
      materialImportRows.value = []
      const available = (await mockService.inventoryDevices()).data
      outboundRows.value = await parseOutboundFile(file, available)
    } else if (isProductImport.value) {
      productImportRows.value = await parseProductFile(file, (await mockService.all('product-catalog')).data)
    } else if (isMaterialImport.value) {
      importRows.value = []
      outboundRows.value = []
      const existing = (await mockService.all('material-catalog')).data.flatMap((item) => [String(item.code), String(item.materialCode || '')]).filter(Boolean)
      materialImportRows.value = await parseMaterialFile(file, existing)
    } else {
      outboundRows.value = []
      materialImportRows.value = []
      const devices = (await mockService.deviceImportIdentities()).data
      const existing = devices.map((item) => item.code)
      const existingComponentSerials = devices.flatMap((item) => Array.isArray(item.components) ? item.components.map((component) => String((component as DeviceComponentLine).serialNumber || '')) : []).filter(Boolean)
      importRows.value = await parseDeviceFile(file, existing, existingComponentSerials)
    }
  } catch (error) {
    importRows.value = []
    outboundRows.value = []
    materialImportRows.value = []
    productImportRows.value = []
    ElMessage.error(error instanceof Error ? error.message : '文件解析失败')
  } finally {
    importBusy.value = false
    input.value = ''
  }
}

async function confirmImport() {
  const validRows = activeImportRows.value.filter((item) => item.valid)
  if (!validRows.length) return ElMessage.warning('没有可导入的数据')
  if (isOutboundImport.value && invalidImportCount.value) return ElMessage.warning('请修正表格中的错误行后重新上传')
  if (isOutboundImport.value && !outboundForm.targetDealerId) return ElMessage.warning('请选择接收经销商')
  importBusy.value = true
  try {
    const response = isOutboundImport.value
      ? await mockService.create('warehouse', {
          category: '出库',
          selectedDevices: (validRows as DeviceOutboundRow[]).map((item) => item.sn),
          targetDealerId: outboundForm.targetDealerId,
          summary: outboundForm.summary || `通过表格创建 ${validRows.length} 台设备出库单`,
        })
      : isProductImport.value
        ? await mockService.importProducts(validRows as ProductImportRow[])
      : isMaterialImport.value
        ? await mockService.importMaterials(validRows as MaterialImportRow[])
        : await mockService.importDevices(validRows as DeviceImportRow[], props.moduleKey === 'warehouse' ? 'warehouse' : 'devices')
    if (response.code !== 200) throw new Error(response.msg)
    ElMessage.success(isOutboundImport.value ? `已创建包含 ${validRows.length} 台设备的待确认出库单` : response.msg)
    importOpen.value = false
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入失败')
  } finally {
    importBusy.value = false
  }
}

async function openImportDialog() {
  importRows.value = []
  outboundRows.value = []
  materialImportRows.value = []
  productImportRows.value = []
  productPaste.value = ''
  importName.value = ''
  outboundForm.targetDealerId = ''
  outboundForm.summary = ''
  if (isOutboundImport.value) await loadOptions([{ optionSource: 'dealers' }])
  importOpen.value = true
}

function resetImportDialog() {
  importRows.value = []
  outboundRows.value = []
  materialImportRows.value = []
  productImportRows.value = []
  productPaste.value = ''
  importName.value = ''
  outboundForm.targetDealerId = ''
  outboundForm.summary = ''
}

async function previewProductText() {
  importBusy.value = true
  try {
    productImportRows.value = await parseProductText(productPaste.value, (await mockService.all('product-catalog')).data)
    importName.value = '粘贴文本'
  } catch (error) {
    productImportRows.value = []
    ElMessage.error(error instanceof Error ? error.message : '文本解析失败')
  } finally {
    importBusy.value = false
  }
}

function fieldRules(field: FieldConfig) {
  const required = field.required || (editorMode.value === 'create' && field.requiredOnCreate)
  return required ? [{ required: true, message: `请填写${field.label}`, trigger: ['select', 'multiSelect', 'lineItems', 'componentItems'].includes(field.type) ? 'change' : 'blur' }] : []
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
  if (action === 'approve' && ['materials', 'product-purchase'].includes(props.moduleKey) && record.category === '设备采购') {
    return record.purchaseStage === 'rd_confirmation' ? '研发确认' : '销售确认'
  }
  if (action === 'approve') return actionLabels[action] || action
  return config.value.actions?.find((item) => item.key === action)?.label || actionLabels[action] || action
}

function statusMeta(value: unknown) {
  if (props.moduleKey === 'payments') {
    const paymentStatuses: Record<string, { label: string; tone: string }> = {
      pending: { label: '待付款/继续付款', tone: 'warning' }, verifying: { label: '待财务核实', tone: 'warning' }, verified: { label: '已付清', tone: 'success' },
    }
    if (paymentStatuses[String(value)]) return paymentStatuses[String(value)]
  }
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
    void router.push({ name: 'warehouse', query: { tab: 'stock' } })
    return
  }
  if (action === 'device-create') {
    void router.push({ name: 'warehouse', query: { tab: 'stock' } })
    return
  }
  if (['ota-release', 'dealer-edit', 'project-edit', 'material-edit', 'courier-edit', 'warranty-edit', 'flow-edit', 'banner-edit', 'admin-edit'].includes(action)) {
    openEditor(action === 'ota-release' ? undefined : rows.value[0])
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

watch(() => [props.moduleKey, route.fullPath], async () => { applyRouteQuery(); await load() })
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
        <el-button v-if="canBatchImport" @click="openImportDialog"><AppIcon name="file-spreadsheet" :size="16" />{{ batchImportLabel }}</el-button>
        <el-button v-if="activePrimaryLabel && canCreate" type="primary" @click="primaryAction"><AppIcon :name="activePrimaryLabel.includes('导出') ? 'download' : 'plus'" :size="16" />{{ activePrimaryLabel }}</el-button>
      </div>
    </header>

    <div v-if="hasRelationContext" class="relation-context-bar">
      <div class="relation-context-main">
        <span class="relation-context-icon"><AppIcon name="arrow-left-right" :size="18" /></span>
        <div><strong>来自{{ relationSourceTitle }} · {{ relationSourceLabel }}</strong><p>{{ relationDescription }}，当前匹配 {{ total }} 条数据。</p></div>
      </div>
      <div class="relation-context-actions"><el-button v-if="route.query.returnTo || route.query.fromModule" @click="returnToSource"><AppIcon name="chevron-left" :size="16" />返回来源</el-button><el-button @click="clearRelationContext">清除关联条件</el-button></div>
    </div>

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
          <el-select v-else-if="filter.type === 'select'" v-model="filterValues[filter.field]" clearable :placeholder="`全部${filter.label}`" class="domain-filter-control" @change="changeFilter(filter.field)">
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
          <el-button v-if="canExport" text title="导出当前筛选结果" @click="exportAll"><AppIcon name="download" :size="16" /></el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="rows" row-key="id" class="business-table" @selection-change="selected = $event" @sort-change="changeSort">
        <el-table-column type="selection" width="48" />
        <el-table-column v-for="column in activeColumns" :key="column.field" :prop="column.field" :label="column.label" :width="columnWidth(column)" :min-width="columnMinWidth(column)" sortable="custom" show-overflow-tooltip>
          <template #default="scope">
            <div v-if="column.type === 'main'" class="main-cell"><strong>{{ displayColumn(column, scope.row) }}</strong><small>{{ scope.row.code }}</small></div>
            <code v-else-if="column.type === 'mono'" class="mono-cell">{{ displayColumn(column, scope.row) }}</code>
            <span v-else-if="column.type === 'status'" class="status-chip" :data-tone="statusMeta(scope.row[column.field]).tone"><i></i>{{ statusMeta(scope.row[column.field]).label }}</span>
            <span v-else-if="column.type === 'money'" class="money-cell"><small v-if="moduleKey === 'product-catalog' && ['retailPrice', 'tier1Price'].includes(column.field) && scope.row[`${column.field}Name`] && scope.row[`${column.field}Name`] !== column.label" class="price-alias">{{ scope.row[`${column.field}Name`] }}</small>{{ scope.row.currency === 'USD' || !scope.row.currency && auth.session?.domain === 'global' ? '$' : '¥' }}{{ Number(scope.row[column.field] || 0).toLocaleString() }}</span>
            <span v-else-if="column.type === 'number'">{{ Number(scope.row[column.field] || 0).toLocaleString() }}</span>
            <el-button v-else-if="column.type === 'link'" link type="primary" @click="openDetailTab(scope.row, 'devices')">{{ Number(scope.row[column.field] || 0).toLocaleString() }}</el-button>
            <img v-else-if="column.type === 'image'" class="table-image" :src="assetUrl(String(scope.row[column.field] || './assets/backgrounds/banner-maintenance.png'))" alt="Banner">
            <span v-else>{{ displayColumn(column, scope.row) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="activeRowActions.length || hasRelatedLinks" label="操作" fixed="right" :width="operationColumnWidth">
          <template #default="scope">
            <div class="row-actions">
              <el-button v-for="action in inlineRowActions(scope.row)" :key="action" link :type="['delete', 'remote-disable', 'unbind', 'reject', 'reject-outbound', 'reject-transfer-fee', 'escalate'].includes(action) ? 'danger' : 'primary'" @click="runRowAction(action, scope.row)">{{ rowActionLabel(action, scope.row) }}</el-button>
              <el-dropdown v-if="overflowRowActions(scope.row).length" trigger="click" @command="(action: string) => runRowAction(action, scope.row)">
                <el-button link type="primary" class="related-menu-trigger">更多操作<AppIcon name="chevron-down" :size="14" /></el-button>
                <template #dropdown><el-dropdown-menu><el-dropdown-item v-for="action in overflowRowActions(scope.row)" :key="action" :command="action" :class="{ 'danger-menu-item': ['delete', 'remote-disable', 'unbind', 'reject', 'reject-outbound', 'reject-transfer-fee', 'escalate'].includes(action) }">{{ rowActionLabel(action, scope.row) }}</el-dropdown-item></el-dropdown-menu></template>
              </el-dropdown>
              <el-button v-if="primaryRelated(scope.row)" link type="primary" class="related-primary-action" @click="navigateRelated(primaryRelated(scope.row)!, scope.row)">{{ primaryRelated(scope.row)!.label }}</el-button>
              <el-dropdown v-if="secondaryRelated(scope.row).length" trigger="click" @command="(key: string) => navigateRelatedByKey(scope.row, key)">
                <el-button link type="primary" class="related-menu-trigger">关联数据<AppIcon name="chevron-down" :size="14" /></el-button>
                <template #dropdown><el-dropdown-menu class="related-data-menu"><el-dropdown-item v-for="item in secondaryRelated(scope.row)" :key="item.key" :command="item.key"><AppIcon :name="item.icon" :size="16" /><span>{{ item.label }}</span><small>{{ item.count }}</small></el-dropdown-item></el-dropdown-menu></template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
        <template #empty><div class="empty-state"><AppIcon name="inbox" :size="34" /><strong>{{ hasRelationContext ? '关联数据已发生变化或当前无权查看' : hasFilters ? '没有匹配的结果' : '暂无数据' }}</strong><p>{{ hasRelationContext ? '可返回来源页面核对业务记录，或清除关联条件查看全部数据。' : hasFilters ? '请调整筛选条件后重试。' : '当前数据域下还没有记录。' }}</p><el-button v-if="hasRelationContext" @click="clearRelationContext">清除关联条件</el-button><el-button v-else-if="hasFilters" @click="resetFilters">清除筛选</el-button></div></template>
      </el-table>

      <footer class="pagination-bar">
        <span>显示 {{ pageStart }}-{{ pageEnd }} 条，共 {{ total }} 条</span>
        <el-pagination v-model:current-page="query.pageNum" v-model:page-size="query.pageSize" layout="sizes, prev, pager, next" :page-sizes="[10, 20, 50]" :total="total" @change="changePage" />
      </footer>
    </div>

    <el-dialog v-model="editorOpen" :title="editorMode === 'create' ? activePrimaryLabel || `新增${config.title}` : `编辑${config.title}`" width="760px" align-center append-to-body destroy-on-close class="entity-dialog">
      <el-form ref="editorRef" :model="editorForm" label-position="top" class="entity-form">
        <el-form-item v-for="field in editorFields" :key="field.field" :label="fieldDisplayLabel(field)" :prop="field.field" :rules="fieldRules(field)" :class="{ 'span-two': field.span === 2 }">
          <el-input v-if="field.type === 'text'" v-model="editorForm[field.field]" :placeholder="field.placeholder || `请输入${field.label}`" :disabled="field.readonly" />
          <el-input v-else-if="field.type === 'password'" v-model="editorForm[field.field]" type="password" show-password :placeholder="`请输入${field.label}`" autocomplete="new-password" />
          <el-input v-else-if="field.type === 'textarea'" v-model="editorForm[field.field]" type="textarea" :rows="4" maxlength="300" show-word-limit />
          <el-select v-else-if="field.type === 'select'" v-model="editorForm[field.field]" :disabled="field.readonly" :filterable="Boolean(field.optionSource)" :placeholder="field.placeholder || '请选择'" style="width: 100%" @change="refreshDerivedFields(field.field)"><el-option v-for="option in fieldOptions(field)" :key="option.value" :label="option.label" :value="option.value" /></el-select>
          <el-select v-else-if="field.type === 'multiSelect'" v-model="editorForm[field.field]" :disabled="field.readonly" :filterable="Boolean(field.optionSource)" multiple collapse-tags collapse-tags-tooltip :placeholder="field.placeholder || '请选择'" style="width: 100%" @change="refreshDerivedFields(field.field)"><el-option v-for="option in fieldOptions(field)" :key="option.value" :label="option.label" :value="option.value" /></el-select>
          <div v-else-if="field.type === 'lineItems'" class="line-items-editor">
            <div v-for="(line, index) in purchaseLines(field)" :key="index" class="line-item-row"><el-select v-model="line.itemKey" filterable placeholder="选择设备或物料" @change="refreshDerivedFields"><el-option v-for="option in fieldOptions(field)" :key="option.value" :label="option.label" :value="option.value" /></el-select><el-input-number v-model="line.quantity" :min="1" controls-position="right" aria-label="数量" @change="refreshDerivedFields" /><el-input-number v-model="line.unitPrice" :min="0.01" :precision="2" controls-position="right" aria-label="参考单价" @change="refreshDerivedFields" /><el-button title="删除明细" :disabled="purchaseLines(field).length === 1" @click="removePurchaseLine(field, index)"><AppIcon name="trash-2" :size="16" /></el-button></div>
            <el-button @click="addPurchaseLine(field)"><AppIcon name="plus" :size="16" />添加采购明细</el-button>
          </div>
          <div v-else-if="field.type === 'componentItems'" class="component-items-editor">
            <div v-for="(component, index) in componentLines(field)" :key="index" class="component-item-row">
              <el-input v-model="component.serialNumber" placeholder="子物料序列号" />
              <el-input v-model="component.specification" placeholder="规格/型号" />
              <el-button title="删除子物料" :disabled="componentLines(field).length === 1" @click="removeComponentLine(field, index)"><AppIcon name="trash-2" :size="16" /></el-button>
            </div>
            <el-button @click="addComponentLine(field)"><AppIcon name="plus" :size="16" />添加子物料</el-button>
          </div>
          <div v-else-if="field.type === 'priceItems'" class="price-items-editor">
            <div v-for="(price, index) in priceLines(field)" :key="index" class="price-item-row">
              <el-input v-model="price.name" placeholder="价格名称" :aria-label="`自定义价格 ${index + 1} 名称`" />
              <el-input-number v-model="price.price" :min="0.01" :precision="2" controls-position="right" :aria-label="`自定义价格 ${index + 1} 金额`" />
              <el-button title="删除价格" :aria-label="`删除自定义价格 ${index + 1}`" @click="removePriceLine(field, index)"><AppIcon name="trash-2" :size="16" /></el-button>
            </div>
            <el-button @click="addPriceLine(field)"><AppIcon name="plus" :size="16" />添加价格</el-button>
          </div>
          <el-date-picker v-else-if="field.type === 'date'" v-model="editorForm[field.field]" :disabled="field.readonly || props.moduleKey === 'projects' && field.field === 'dealerWarrantyUntil' && auth.session?.ownerId === 'platform'" type="date" value-format="YYYY-MM-DD" style="width: 100%" @change="refreshDerivedFields(field.field)" />
          <el-input-number v-else-if="field.type === 'number'" v-model="editorForm[field.field]" :disabled="field.readonly" :min="field.min ?? 0" :max="field.max" controls-position="right" style="width: 100%" @change="refreshDerivedFields" />
          <el-switch v-else-if="field.type === 'switch'" v-model="editorForm[field.field]" />
          <el-upload v-else-if="field.type === 'image'" action="#" :auto-upload="false" :show-file-list="false" accept="image/png,image/jpeg,image/webp" :on-change="onBannerFile">
            <div class="image-uploader"><img v-if="editorForm[field.field]" :src="assetUrl(String(editorForm[field.field]))" alt="Banner 预览"><div v-else><AppIcon name="image-plus" :size="28" /><strong>选择 Banner 图片</strong><small>PNG/JPG/WebP，最大 2 MB，自动裁切为 3:1</small></div></div>
          </el-upload>
          <el-upload v-else-if="field.type === 'firmware'" action="#" :auto-upload="false" :limit="1" accept=".bin,.zip,.img" :on-change="onFirmwareFile"><el-button><AppIcon name="file-up" :size="16" />选择固件文件</el-button><template #tip><div class="el-upload__tip">{{ editorForm[field.field] || '支持 .bin、.zip、.img，最大 50 MB；静态版不保存文件二进制。' }}</div></template></el-upload>
          <el-upload v-else-if="field.type === 'pdf'" action="#" :auto-upload="false" :limit="1" accept="application/pdf,.pdf" :on-change="onPdfFile"><el-button><AppIcon name="file-up" :size="16" />选择 PDF 文件</el-button><template #tip><div class="el-upload__tip">{{ editorForm[field.field] || '仅支持 PDF，最大 4 MB；保存后由 APP 常见问题入口展示。' }}</div></template></el-upload>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="editorOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveEditor">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="detailOpen" :title="`${config.title}详情`" width="860px" align-center append-to-body destroy-on-close :show-close="false" class="detail-dialog" @closed="clearDetailRouteState">
      <template v-if="detailRecord">
        <div class="detail-summary">
          <div class="summary-icon"><AppIcon :name="config.icon" :size="28" /></div>
          <div><div class="eyebrow">{{ detailRecord.code }}</div><h2>{{ detailRecord.name }}</h2><p>{{ detailRecord.summary }}</p></div>
          <div class="detail-summary-actions"><span class="status-chip" :data-tone="statusMeta(detailRecord.status).tone"><i></i>{{ statusMeta(detailRecord.status).label }}</span><el-button v-if="primaryRelated(detailRecord)" type="primary" plain @click="navigateRelated(primaryRelated(detailRecord)!, detailRecord)">{{ primaryRelated(detailRecord)!.label }}</el-button><el-dropdown v-if="secondaryRelated(detailRecord).length" trigger="click" @command="(key: string) => navigateRelatedByKey(detailRecord!, key)"><el-button>关联数据<AppIcon name="chevron-down" :size="14" /></el-button><template #dropdown><el-dropdown-menu class="related-data-menu"><el-dropdown-item v-for="item in secondaryRelated(detailRecord)" :key="item.key" :command="item.key"><AppIcon :name="item.icon" :size="16" /><span>{{ item.label }}</span><small>{{ item.count }}</small></el-dropdown-item></el-dropdown-menu></template></el-dropdown></div>
        </div>
        <el-tabs v-model="detailTab" class="detail-tabs">
          <el-tab-pane v-for="tab in drawerTabs" :key="tab.key" :label="tab.label" :name="tab.key">
            <DomainDetailPanel v-if="currentDetailTab && currentDetailTab.key === tab.key" :key="`${detailRecord.id}-${tab.key}-${detailRevision}`" :module-key="moduleKey" :record="detailRecord" :tab="currentDetailTab" :navigation="relatedLinks[detailRecord.id] || []" @action="runRelatedAction" @navigate="navigateRelated($event, detailRecord)" />
          </el-tab-pane>
        </el-tabs>
      </template>
      <template #footer>
        <div class="detail-dialog-footer">
          <el-button @click="detailOpen = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="riskOpen" :title="riskActionLabel" width="620px" align-center append-to-body class="risk-dialog">
      <div class="impact-callout"><AppIcon name="triangle-alert" :size="22" /><div><strong>请确认影响范围</strong><p>{{ currentAction?.impact || `对象：${riskRecord?.name}（${riskRecord?.code}）。操作会同步更新关联数据和审计日志。` }}</p></div></div>
      <el-form label-position="top" class="action-form">
        <el-form-item v-if="riskAction === 'permissions'" label="菜单与操作权限" class="permission-action-field"><el-tree ref="permissionTreeRef" show-checkbox default-expand-all node-key="id" :data="permissionTree" /></el-form-item>
        <el-form-item v-for="field in currentActionFields" :key="field.field" :label="fieldDisplayLabel(field)" :required="field.required">
          <el-input v-if="field.type === 'text'" v-model="actionForm[field.field]" :placeholder="`请输入${field.label}`" />
          <el-input v-else-if="field.type === 'textarea'" v-model="actionForm[field.field]" type="textarea" :rows="3" :placeholder="`请输入${field.label}`" maxlength="300" show-word-limit />
          <el-select v-else-if="field.type === 'select'" v-model="actionForm[field.field]" :filterable="Boolean(field.optionSource)" placeholder="请选择" style="width: 100%"><el-option v-for="option in fieldOptions(field)" :key="option.value" :label="option.label" :value="option.value" /></el-select>
          <el-select v-else-if="field.type === 'multiSelect'" v-model="actionForm[field.field]" :filterable="Boolean(field.optionSource)" multiple collapse-tags placeholder="请选择" style="width: 100%"><el-option v-for="option in fieldOptions(field)" :key="option.value" :label="option.label" :value="option.value" /></el-select>
          <el-input-number v-else-if="field.type === 'number'" v-model="actionForm[field.field]" :min="field.min || 0" :max="field.max" style="width: 100%" />
          <el-date-picker v-else-if="field.type === 'date'" v-model="actionForm[field.field]" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          <el-switch v-else-if="field.type === 'switch'" v-model="actionForm[field.field]" />
          <el-upload v-else-if="field.type === 'image'" action="#" :auto-upload="false" :show-file-list="false" accept="image/png,image/jpeg,image/webp" :on-change="(upload: UploadFile) => onActionImageFile(upload, field.field)">
            <div class="action-image-uploader"><img v-if="actionForm[field.field]" :src="String(actionForm[field.field])" :alt="`${field.label}预览`"><div v-else><AppIcon name="image-plus" :size="24" /><strong>选择{{ field.label }}</strong><small>PNG/JPG/WebP，最大 2 MB</small></div></div>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="riskOpen = false">取消</el-button><el-button :type="currentAction?.tone === 'danger' ? 'danger' : 'primary'" :loading="saving" @click="confirmRisk">{{ riskActionLabel }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="importOpen" :title="isProductImport ? '批量导入产品' : isMaterialImport ? '批量导入物料' : isOutboundImport ? '表格批量出库' : moduleKey === 'warehouse' ? '批量设备入库' : '批量导入设备'" width="860px" align-center append-to-body class="import-dialog" @closed="resetImportDialog">
      <div class="import-steps"><span class="active">1 选择文件</span><i></i><span :class="{ active: activeImportRows.length }">2 校验数据</span><i></i><span>3 {{ isOutboundImport ? '创建出库单' : '完成导入' }}</span></div>
      <div v-if="isOutboundImport" class="impact-callout info outbound-import-tip"><AppIcon name="info" :size="20" /><div><strong>出库流程说明</strong><p>表格用于批量创建待确认出库单。确认出库后，系统才会更新设备库存、经销商归属和归属历史。</p></div></div>
      <div class="drop-zone" :class="{ ready: activeImportRows.length }">
        <AppIcon name="file-spreadsheet" :size="32" /><strong>{{ importName || '选择 Excel 或 CSV 文件' }}</strong><p>{{ isProductImport ? '需要包含产品编号、名称、设备类型、型号、规格和两类价格七列。' : isMaterialImport ? '需要包含物料编号、名称、适用设备、采购价和库存数量五列。' : isOutboundImport ? '需要包含 SN 一列；设备必须处于平台仓库在库状态，文件内不可重复。' : '需要包含 SN、设备型号、销售地区三列；可增加仓库/机构、库位及成对填写的子物料序列号和规格。' }}</p>
        <label class="el-button el-button--primary"><input type="file" :accept="isProductImport ? '.xlsx,.csv,.txt' : '.xlsx,.csv'" hidden @change="onImportFile">选择文件</label><el-button link type="primary" @click="isProductImport ? downloadProductTemplate() : isMaterialImport ? downloadMaterialTemplate() : isOutboundImport ? downloadOutboundTemplate() : downloadDeviceTemplate()">下载{{ isProductImport ? '产品导入' : isMaterialImport ? '物料导入' : isOutboundImport ? '出库' : '导入' }}模板</el-button>
      </div>
      <div v-if="isProductImport" class="outbound-upload-form">
        <el-input v-model="productPaste" type="textarea" :rows="4" placeholder="粘贴含表头的产品表格：产品编号、产品名称、设备类型、设备型号、规格、终端零售价、一级经销商价（用制表符或逗号分列）" />
        <el-button :loading="importBusy" :disabled="!productPaste.trim()" @click="previewProductText">预览粘贴内容</el-button>
      </div>
      <div v-if="activeImportRows.length" class="import-result">
        <div class="result-summary"><span>共 {{ activeImportRows.length }} 行</span><b class="success-text">{{ validImportCount }} 行校验通过</b><b v-if="invalidImportCount" class="error-text">{{ invalidImportCount }} 行需修正</b></div>
        <el-table v-if="isOutboundImport" :data="outboundRows" max-height="280"><el-table-column prop="row" label="行号" width="70" /><el-table-column prop="sn" label="SN" min-width="170" /><el-table-column prop="model" label="设备型号" min-width="160" /><el-table-column prop="warehouseLocation" label="当前库位" width="120" /><el-table-column label="校验结果" min-width="210"><template #default="scope"><span :class="scope.row.valid ? 'success-text' : 'error-text'">{{ scope.row.valid ? '通过' : scope.row.error }}</span></template></el-table-column></el-table>
        <el-table v-else-if="isMaterialImport" :data="materialImportRows" max-height="280"><el-table-column prop="row" label="行号" width="70" /><el-table-column prop="materialCode" label="物料编号" width="140" /><el-table-column prop="name" label="物料名称" min-width="160" /><el-table-column prop="category" label="适用设备" min-width="150" /><el-table-column prop="stock" label="库存" width="80" /><el-table-column label="校验结果" min-width="190"><template #default="scope"><span :class="scope.row.valid ? 'success-text' : 'error-text'">{{ scope.row.valid ? '通过' : scope.row.error }}</span></template></el-table-column></el-table>
        <el-table v-else-if="isProductImport" :data="productImportRows" max-height="280"><el-table-column prop="row" label="行号" width="70" /><el-table-column prop="code" label="产品编号" width="140" /><el-table-column prop="name" label="产品名称" min-width="140" /><el-table-column prop="deviceModel" label="设备型号" min-width="130" /><el-table-column prop="retailPrice" label="终端零售价" width="120" /><el-table-column prop="tier1Price" label="一级经销商价" width="135" /><el-table-column label="校验结果" min-width="190"><template #default="scope"><span :class="scope.row.valid ? 'success-text' : 'error-text'">{{ scope.row.valid ? '通过' : scope.row.error }}</span></template></el-table-column></el-table>
        <el-table v-else :data="importRows" max-height="280"><el-table-column prop="row" label="行号" width="70" /><el-table-column prop="sn" label="SN" min-width="160" /><el-table-column prop="deviceType" label="设备类型" min-width="150" /><el-table-column prop="model" label="设备型号" min-width="150" /><el-table-column prop="specification" label="产品规格" min-width="160" /><el-table-column label="子物料" width="90"><template #default="scope">{{ scope.row.components.length }} 项</template></el-table-column><el-table-column prop="warehouseName" label="仓库" width="140" /><el-table-column prop="warehouseLocation" label="库位" width="100" /><el-table-column label="校验结果" min-width="190"><template #default="scope"><span :class="scope.row.valid ? 'success-text' : 'error-text'">{{ scope.row.valid ? '通过' : scope.row.error }}</span></template></el-table-column></el-table>
      </div>
      <el-form v-if="isOutboundImport && activeImportRows.length" label-position="top" class="outbound-upload-form">
        <el-form-item label="接收经销商" required><el-select v-model="outboundForm.targetDealerId" filterable placeholder="请选择正常状态的接收经销商" style="width: 100%"><el-option v-for="option in dynamicOptions.dealers || []" :key="option.value" :label="option.label" :value="option.value" /></el-select></el-form-item>
        <el-form-item label="出库说明"><el-input v-model="outboundForm.summary" type="textarea" :rows="3" maxlength="300" show-word-limit placeholder="请输入本次批量出库说明" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="importOpen = false">取消</el-button><el-button type="primary" :loading="importBusy" :disabled="!canConfirmImport" @click="confirmImport">{{ isProductImport ? `导入 ${validImportCount} 条产品` : isMaterialImport ? `导入 ${validImportCount} 条物料` : isOutboundImport ? `创建出库单（${validImportCount} 台）` : `${moduleKey === 'warehouse' ? '入库' : '导入'} ${validImportCount} 台设备` }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="prototypeOpen" :title="prototypeTitle" width="700px" align-center append-to-body class="entity-dialog prototype-dialog">
      <el-tabs v-model="prototypeTab"><el-tab-pane label="基本信息" name="base" /><el-tab-pane label="权限与范围" name="permissions" /><el-tab-pane label="操作记录" name="history" /></el-tabs>
      <div v-if="prototypeAction === 'role-permissions'" class="permission-tree"><el-tree show-checkbox default-expand-all node-key="id" :default-checked-keys="['devices:view', 'repairs:view']" :data="[{ id: 'business', label: '业务管理', children: [{ id: 'devices:view', label: '设备管理' }, { id: 'repairs:view', label: '故障报修' }, { id: 'materials:view', label: '物料申请' }] }, { id: 'system', label: '系统管理', children: [{ id: 'admins:view', label: '管理员账号' }, { id: 'logs:view', label: '操作日志' }] }]" /></div>
      <el-form v-else label-position="top" class="entity-form"><el-form-item label="处理对象"><el-input :model-value="rows[0]?.name || config.title" /></el-form-item><el-form-item label="影响范围"><el-select model-value="current" style="width: 100%"><el-option label="当前记录" value="current" /><el-option label="当前数据域" value="domain" /></el-select></el-form-item><el-form-item label="处理说明" class="span-two"><el-input type="textarea" :rows="4" placeholder="请输入本次操作说明" /></el-form-item></el-form>
      <template #footer><el-button @click="prototypeOpen = false">取消</el-button><el-button type="primary" @click="savePrototypeAction">确认</el-button></template>
    </el-dialog>
  </section>
</template>
