import { moduleConfigs } from '@/config/modules'
import { actionPermission, hasActionPermission, hasPermission } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'
import type { ApiResult, DataDomain, EntityRecord, FieldConfig, PageQuery, TableDataInfo } from '@/types'

const sleep = (ms = 25) => new Promise((resolve) => window.setTimeout(resolve, ms))
const ok = <T>(data: T, msg = '操作成功'): ApiResult<T> => ({ code: 200, msg, data })
const fail = <T>(code: number, msg: string, data: T): ApiResult<T> => ({ code, msg, data })
const businessCodePrefixes: Record<string, string> = {
  projects: 'PRJ', warehouse: 'WH', materials: 'MAT', 'service-transfer': 'AST',
  'approval-flow': 'APF', 'material-catalog': 'MTR', couriers: 'EXP', banners: 'BAN',
  admins: 'ADM', roles: 'ROL', dealers: 'DLR', ota: 'OTA',
}

function includes(value: unknown, keyword: string) {
  return String(value ?? '').toLocaleLowerCase('zh-CN').includes(keyword.toLocaleLowerCase('zh-CN'))
}

function generateBusinessCode(moduleKey: string, payload: Partial<EntityRecord>) {
  if (moduleKey === 'devices') return String(payload.code || '')
  const database = useDatabaseStore()
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const warehousePrefix = payload.category === '出库' ? 'OUT' : payload.category === '调货' ? 'TRF' : 'IN'
  const prefix = moduleKey === 'warehouse' ? warehousePrefix : businessCodePrefixes[moduleKey] || moduleKey.slice(0, 3).toUpperCase()
  let serial = database.records(moduleKey).filter((item) => String(item.code).startsWith(`${prefix}-${today}`)).length + 1
  while (database.records(moduleKey).some((item) => item.code === `${prefix}-${today}${String(serial).padStart(3, '0')}`)) serial += 1
  return `${prefix}-${today}${String(serial).padStart(3, '0')}`
}

function organizationIds() {
  const auth = useAuthStore()
  const session = auth.session
  if (!session || session.dataScope === 'all') return null
  const ids = new Set([session.ownerId])
  if (session.dataScope === 'descendants') {
    const dealers = useDatabaseStore().records('dealers')
    let changed = true
    while (changed) {
      changed = false
      for (const dealer of dealers) {
        if (!ids.has(String(dealer.parentDealerId || ''))) continue
        const id = String(dealer.organizationId || dealer.ownerId)
        if (!ids.has(id)) {
          ids.add(id)
          changed = true
        }
      }
    }
  }
  return ids
}

function isVisibleRecord(moduleKey: string, record: EntityRecord) {
  return visibleRecords(moduleKey).some((item) => item.id === record.id)
}

function actionDecision(moduleKey: string, record: EntityRecord, actionKey: string) {
  const auth = useAuthStore()
  const session = auth.session
  if (!session) return { allowed: false, reason: '登录状态已失效', code: 401 }
  const required = actionPermission(moduleKey, actionKey)
  if (!hasActionPermission(auth.permissions, moduleKey, actionKey)) return { allowed: false, reason: `缺少权限：${required}`, code: 403 }
  if (!isVisibleRecord(moduleKey, record)) return { allowed: false, reason: '记录不存在或超出当前数据范围', code: 403 }

  const definition = moduleConfigs[moduleKey]?.actions?.find((item) => item.key === actionKey)
  if (definition?.allowedStatuses?.length && !definition.allowedStatuses.includes(record.status)) {
    return { allowed: false, reason: `当前状态不能执行${definition.label}`, code: 409 }
  }
  if (moduleKey === 'devices' && ['remote-disable', 'remote-enable'].includes(actionKey) && session.role !== 'platform') return { allowed: false, reason: '远程启用/禁用仅限平台管理员', code: 403 }
  if (moduleKey === 'devices' && actionKey === 'unbind') {
    if (session.role === 'platform') return { allowed: true, reason: '', code: 200 }
    const dealer = useDatabaseStore().records('dealers').find((item) => item.organizationId === record.ownerId || item.ownerId === record.ownerId)
    const allowed = session.role === 'tier1' && dealer?.tier === '二级' && organizationIds()?.has(record.ownerId)
    return { allowed: Boolean(allowed), reason: allowed ? '' : '一级经销商只能解绑所属二级经销商设备', code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'materials' && ['approve', 'reject'].includes(actionKey)) {
    const allowed = record.currentApproverId === session.accountId
    return { allowed, reason: allowed ? '' : `当前审批人为${record.currentApproverName || '其他账号'}`, code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'warehouse' && actionKey === 'process' && record.category === '调货') {
    const allowed = record.currentApproverId === session.accountId
    return { allowed, reason: allowed ? '' : `当前审批人为${record.currentApproverName || '其他账号'}`, code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'service-transfer' && actionKey === 'process') {
    const allowed = record.currentApproverId === session.accountId
    return { allowed, reason: allowed ? '' : `当前确认人为${record.currentApproverName || '其他账号'}`, code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'sn-replacement' && actionKey === 'process') {
    const allowed = record.ownerId === session.ownerId
    return { allowed, reason: allowed ? '' : '只有设备当前归属经销商可以确认换 SN', code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'warranty' && actionKey === 'edit') {
    const allowed = session.role !== 'platform' && String(record.dealerId || record.ownerId) === session.ownerId
    return { allowed, reason: allowed ? '' : '经销商只能编辑自身质保规则', code: allowed ? 200 : 403 }
  }
  if (session.role === 'platform') return { allowed: true, reason: '', code: 200 }
  if (['repairs', 'messages', 'complaints'].includes(moduleKey) && ['reply', 'complete'].includes(actionKey)) {
    const allowed = record.ownerId === session.ownerId || record.assigneeId === session.accountId
    return { allowed, reason: allowed ? '' : '只有当前归属方或处理人可以执行该操作', code: allowed ? 200 : 403 }
  }
  return { allowed: true, reason: '', code: 200 }
}

function createDecision(moduleKey: string) {
  const auth = useAuthStore()
  if (!auth.session) return { allowed: false, reason: '登录状态已失效' }
  const allowedModules = new Set(['dealers', 'devices', 'warehouse', 'ota', 'materials', 'material-catalog', 'couriers', 'sn-replacement', 'service-transfer', 'warranty', 'approval-flow', 'banners', 'admins'])
  if (!allowedModules.has(moduleKey)) return { allowed: false, reason: 'V3.2 未定义该模块的新增操作' }
  const required = `${moduleKey}:create`
  return hasPermission(auth.permissions, required) ? { allowed: true, reason: '' } : { allowed: false, reason: `缺少权限：${required}` }
}

const editableModules = new Set([
  'dealers', 'projects', 'material-catalog', 'couriers', 'warranty',
  'approval-flow', 'banners', 'admins', 'payment-settings',
])

function configuredFields(moduleKey: string, payload: Partial<EntityRecord>) {
  const config = moduleConfigs[moduleKey]
  if (!config) return []
  if (moduleKey === 'warehouse') {
    const tab = payload.category === '出库' ? 'outbound' : payload.category === '调货' ? 'transfer' : 'stock'
    return config.tabFields?.[tab] || config.fields
  }
  return config.fields
}

function validateConfiguredFields(moduleKey: string, payload: Partial<EntityRecord>, creating: boolean) {
  for (const field of configuredFields(moduleKey, payload)) {
    if (!field.required && !(creating && field.requiredOnCreate)) continue
    const value = payload[field.field]
    const sensitiveValue = field.sensitive ? payload[`${field.field}Masked`] : undefined
    const missing = Array.isArray(value)
      ? value.length === 0
      : value === undefined || value === null || String(value).trim() === ''
    const sensitiveMissing = sensitiveValue === undefined || sensitiveValue === null || String(sensitiveValue).trim() === ''
    if (missing && (!field.sensitive || sensitiveMissing)) return `请填写${field.label}`
    if (field.type === 'number' && value !== undefined && Number(value) < Number(field.min ?? 0)) return `${field.label}不能小于 ${field.min ?? 0}`
  }
  return ''
}

function validateActionFields(fields: FieldConfig[] | undefined, payload: Record<string, unknown>) {
  for (const field of fields || []) {
    if (!field.required) continue
    const value = payload[field.field]
    const missing = Array.isArray(value)
      ? value.length === 0
      : value === undefined || value === null || typeof value === 'string' && !value.trim()
    if (missing) return `请填写${field.label}`
    if (field.type === 'number' && Number(value) < Number(field.min ?? 0)) return `${field.label}不能小于 ${field.min ?? 0}`
  }
  return ''
}

function visibleRecords(moduleKey: string) {
  const database = useDatabaseStore()
  const session = useAuthStore().session
  if (!session) return []
  let records = [...database.records(moduleKey)]
  if (moduleKey !== 'roles') records = records.filter((item) => item.domain === session.domain)
  const ids = organizationIds()
  if (ids && moduleKey !== 'roles') {
    const relatedUserAccounts = moduleKey === 'users'
      ? new Set([
          ...database.records('devices').filter((item) => item.domain === session.domain && ids.has(item.ownerId)).map((item) => String(item.account || '')),
          ...['repairs', 'messages', 'complaints'].flatMap((key) => database.records(key)).filter((item) => item.domain === session.domain && ids.has(item.ownerId)).map((item) => String(item.account || '')),
        ].filter((item) => item && item !== '-'))
      : null
    records = records.filter((item) => {
      if (moduleKey === 'devices') return ids.has(item.ownerId)
      if (moduleKey === 'users') return relatedUserAccounts!.has(String(item.account || ''))
      if (moduleKey === 'service-transfer') return ids.has(item.ownerId) || ids.has(String(item.sourceDealerId || '')) || ids.has(String(item.targetDealerId || ''))
      return ids.has(item.ownerId) || item.ownerId === 'platform' && moduleKey === 'notifications'
    })
  }
  return records
}

function maskContact(value: unknown) {
  const text = String(value || '')
  if (!text || text === '-' || text.includes('*')) return text
  if (text.includes('@')) {
    const [name, domain] = text.split('@')
    return `${name.slice(0, 1)}***@${domain}`
  }
  const digits = text.replace(/\D/g, '')
  if (digits.length >= 7) return `${digits.slice(0, 3)}****${digits.slice(-4)}`
  return text
}

function forDisplay(moduleKey: string, record: EntityRecord) {
  const masked = { ...record }
  const database = useDatabaseStore()
  if (moduleKey === 'users') masked.deviceCount = visibleRecords('devices').filter((item) => item.bindingStatus === 'bound' && item.account === record.account).length
  if (moduleKey === 'dealers') masked.deviceCount = visibleRecords('devices').filter((item) => item.ownerId === String(record.organizationId || record.ownerId)).length
  if (moduleKey === 'ownership-history') {
    const device = database.records('devices').find((item) => item.id === record.deviceId || item.code === record.deviceSN)
    masked.currentOwner = device?.owner || '-'
  }
  if (['devices', 'repairs', 'messages', 'complaints'].includes(moduleKey)) {
    if (masked.account) masked.account = maskContact(masked.account)
    if (masked.contact) masked.contact = maskContact(masked.contact)
  }
  if (!['users', 'dealers', 'payments'].includes(moduleKey)) return masked
  for (const field of ['account', 'phone', 'email', 'contact']) if (masked[field]) masked[field] = maskContact(masked[field])
  return masked
}

function activeFilters(moduleKey: string, tabKey?: string) {
  const config = moduleConfigs[moduleKey]
  return config?.tabFilters?.[String(tabKey || '')] || config?.filters || []
}

function filterRows(moduleKey: string, source: EntityRecord[], query: PageQuery, sourceKey = moduleKey) {
  const config = moduleConfigs[moduleKey]
  let rows = source
  if (query.tab && config && sourceKey === moduleKey) {
    const tab = config.tabs.find((item) => item.key === query.tab)
    if (tab?.field && tab.value) rows = rows.filter((item) => String(item[tab.field!]) === tab.value)
    if (tab?.field && tab.excludeValues?.length) rows = rows.filter((item) => !tab.excludeValues!.includes(String(item[tab.field!])))
  }
  if (query.status) rows = rows.filter((item) => item.status === query.status)
  if (query.keyword?.trim()) {
    const keyword = query.keyword.trim()
    rows = rows.filter((item) => Object.values(item).some((value) => includes(value, keyword)))
  }
  const filters = activeFilters(moduleKey, query.tab)
  for (const [field, rawValue] of Object.entries(query.filters || {})) {
    if (rawValue === '' || rawValue === undefined || rawValue === null || (Array.isArray(rawValue) && !rawValue.length)) continue
    const filter = filters.find((item) => item.field === field)
    if (filter?.type === 'dateRange' && Array.isArray(rawValue)) {
      const [start, end] = rawValue.map(String)
      rows = rows.filter((item) => {
        const value = String(item[field] || '')
        return (!start || value >= start) && (!end || value.slice(0, 10) <= end)
      })
      continue
    }
    const fields = filter?.fields?.length ? filter.fields : [field]
    rows = rows.filter((item) => fields.some((target) => filter?.exact ? String(item[target] ?? '') === String(rawValue) : includes(item[target], String(rawValue))))
  }
  return rows
}

function createRelation(moduleKey: string, subject: EntityRecord, payload: Partial<EntityRecord>) {
  return useDatabaseStore().create(moduleKey, {
    name: String(payload.name || subject.name),
    status: String(payload.status || 'normal'),
    subjectId: subject.id,
    subjectCode: subject.code,
    owner: subject.owner,
    ownerId: subject.ownerId,
    domain: subject.domain,
    ...payload,
  })
}

function subjectLogs(record: EntityRecord) {
  return visibleRecords('logs').filter((item) => item.subjectId === record.id || item.subjectCode === record.code || includes(item.content, record.code) || (record.account && includes(item.content, String(record.account))))
}

function serviceRecords(record: EntityRecord) {
  return ['repairs', 'complaints', 'materials'].flatMap((key) => visibleRecords(key)).filter((item) => item.deviceSN === record.deviceSN || item.deviceSN === record.code)
}

function relatedRecords(record: EntityRecord, source = ''): EntityRecord[] {
  if (source === 'user-devices') return visibleRecords('devices').filter((item) => item.account === record.account)
  if (source === 'waypoints') return visibleRecords('waypoints').filter((item) => item.userId === record.id)
  if (source === 'subject-logs' || source === 'logs') return subjectLogs(record)
  if (source === 'ownership-history') return visibleRecords('ownership-history').filter((item) => item.deviceId === record.id || item.deviceSN === record.code)
  if (source === 'firmware-history') return visibleRecords('firmware-history').filter((item) => item.deviceId === record.id || item.deviceSN === record.code)
  if (source === 'device-service' || source === 'project-service') return serviceRecords(record)
  if (source === 'dealer-devices') return visibleRecords('devices').filter((item) => item.ownerId === record.organizationId || item.ownerId === record.ownerId)
  if (source === 'dealer-service') return ['repairs', 'messages', 'complaints', 'materials'].flatMap((key) => visibleRecords(key)).filter((item) => item.ownerId === record.organizationId || item.ownerId === record.ownerId)
  if (source === 'dealer-accounts') return visibleRecords('admins').filter((item) => item.ownerId === record.organizationId || item.ownerId === record.ownerId)
  if (source === 'project-devices') return visibleRecords('devices').filter((item) => item.code === record.deviceSN)
  if (source === 'project-warranty') return [{ ...record, id: `${record.id}-warranty`, code: String(record.deviceSN || record.code), productType: record.deviceModel, dealer: record.owner, warrantyUntil: record.warrantyUntil }]
  if (source === 'warehouse-devices') {
    const selected = Array.isArray(record.selectedDevices) ? record.selectedDevices.map(String) : String(record.deviceSN || '').split(/[、,]/).filter(Boolean)
    return visibleRecords('devices').filter((item) => selected.includes(item.code))
  }
  if (source === 'ota-devices') return visibleRecords('devices').filter((item) => item.name === record.deviceType)
  if (source === 'workflow-events') return visibleRecords('workflow-events').filter((item) => item.subjectId === record.id)
  if (source === 'approval-steps') return visibleRecords('approval-steps').filter((item) => item.subjectId === record.id).sort((left, right) => Number(left.sequence) - Number(right.sequence))
  if (source === 'replies') return visibleRecords('replies').filter((item) => item.subjectId === record.id)
  if (source === 'logistics-records') return visibleRecords('logistics-records').filter((item) => item.subjectId === record.id)
  if (source === 'role-permissions' && Array.isArray(record.permissions)) return record.permissions.map((permission, index) => ({ ...record, id: `${record.id}-permission-${index}`, code: String(permission), name: String(permission), category: String(permission).endsWith('view') ? '菜单访问' : '业务操作' }))
  return []
}

function option(label: unknown, value: unknown) {
  return { label: String(label), value: String(value) }
}

function uniqueOptions(items: Array<{ label: string; value: string }>) {
  return [...new Map(items.map((item) => [item.value, item])).values()]
}

function resolveDealer(value: unknown) {
  return useDatabaseStore().records('dealers').find((item) => item.id === value || item.organizationId === value || item.ownerId === value || item.name === value)
}

function resolveAssignee(value: unknown) {
  const database = useDatabaseStore()
  return database.records('auth-accounts').find((item) => item.id === value || item.account === value)
    || database.records('dealers').find((item) => item.id === value || item.organizationId === value || item.name === value)
}

function accountFor(moduleKey: string, record: EntityRecord) {
  if (moduleKey === 'users') {
    const accounts = useDatabaseStore().records('user-auth-accounts')
    return accounts.find((item) => item.account === record.account) || accounts.find((item) => item.subjectId === record.id)
  }
  const accounts = useDatabaseStore().records('auth-accounts')
  return accounts.find((item) => item.account === record.account)
    || accounts.find((item) => item.subjectId === record.id)
    || (moduleKey === 'dealers' ? accounts.find((item) => item.ownerId === record.organizationId) : undefined)
}

function linkedAccounts(moduleKey: string, record: EntityRecord) {
  if (moduleKey === 'users') {
    return useDatabaseStore().records('user-auth-accounts').filter((item) => item.account === record.account || item.subjectId === record.id)
  }
  return useDatabaseStore().records('auth-accounts').filter((item) => item.account === record.account
    || item.subjectId === record.id
    || moduleKey === 'dealers' && item.ownerId === String(record.organizationId || record.ownerId))
}

function updateLinkedAccount(moduleKey: string, account: EntityRecord, patch: Partial<EntityRecord>) {
  return useDatabaseStore().update(moduleKey === 'users' ? 'user-auth-accounts' : 'auth-accounts', account.id, patch)
}

function createAccount(record: EntityRecord, payload: Partial<EntityRecord>, subjectType: 'admin' | 'dealer') {
  const database = useDatabaseStore()
  if (database.records('auth-accounts').some((item) => item.account === record.account)) return
  const role = database.records('roles').find((item) => item.id === payload.roleId)
    || database.records('roles').find((item) => item.roleKey === (payload.tier === '二级' ? 'tier2' : payload.tier === '一级' ? 'tier1' : 'platform'))
    || database.records('roles')[0]
  database.create('auth-accounts', {
    code: String(record.account),
    name: record.name,
    account: record.account,
    password: String(payload.initialPassword || 'Reset123!'),
    displayName: record.name,
    roleId: role.id,
    roleKey: role.roleKey,
    roleLabel: role.name,
    dataScope: role.dataScope,
    ownerId: record.ownerId,
    domain: record.domain,
    firstLogin: true,
    failedAttempts: 0,
    lockedUntil: 0,
    subjectType,
    subjectId: record.id,
    status: record.status === 'disabled' ? 'disabled' : 'normal',
  })
}

function deriveFields(moduleKey: string, payload: Partial<EntityRecord>) {
  const database = useDatabaseStore()
  const next = { ...payload }
  if (moduleKey === 'devices' && next.region) {
    const region = String(next.region).trim()
    next.region = region
    next.country = region.split(/[·/-]/)[0]?.trim() || region
  }
  if (moduleKey === 'projects' && next.deviceSN) {
    const device = database.records('devices').find((item) => item.code === next.deviceSN)
    if (device) {
      next.deviceModel = device.name
      next.owner = device.owner
      next.ownerId = device.ownerId
      next.domain = device.domain
      const rule = database.records('warranty').find((item) => (item.productType === device.name || item.category === device.name) && String(item.dealerId || item.ownerId) === String(device.ownerId) && item.status === 'normal')
      const start = new Date(String(device.activationDate || device.createdAt))
      const months = Number(rule?.materialMonths || 24)
      next.warrantyUntil = new Date(start.getFullYear(), start.getMonth() + months, start.getDate()).toISOString().slice(0, 10)
    }
  }
  if (moduleKey === 'dealers' && next.parentDealerId) {
    const parent = resolveDealer(next.parentDealerId)
    next.parentDealer = parent?.name || ''
  }
  if (moduleKey === 'dealers' && next.tier === '一级') {
    next.parentDealerId = ''
    next.parentDealer = '-'
  }
  if (moduleKey === 'service-transfer' && next.deviceSN) {
    const device = database.records('devices').find((item) => item.code === next.deviceSN)
    next.sourceDealer = device?.owner || ''
    next.sourceDealerId = device?.ownerId || ''
  }
  if (moduleKey === 'materials') {
    const material = database.records('material-catalog').find((item) => item.id === next.materialId)
    if (material) next.materialName = material.name
    const session = useAuthStore().session
    const dealer = database.records('dealers').find((item) => String(item.organizationId || item.ownerId) === session?.ownerId)
    next.dealer ||= dealer?.name || session?.displayName || ''
  }
  if (moduleKey === 'warehouse' && Array.isArray(next.selectedDevices) && next.selectedDevices.length) {
    const selectedDevices = next.selectedDevices as unknown[]
    const device = database.records('devices').find((item) => item.code === selectedDevices[0])
    next.sourceDealer = device?.owner || '平台中心仓'
    next.sourceDealerId = device?.ownerId || 'platform'
  }
  if (next.targetDealerId) {
    const dealer = resolveDealer(next.targetDealerId)
    next.targetDealer = dealer?.name || ''
  }
  if (next.assigneeId) {
    const assignee = resolveAssignee(next.assigneeId)
    next.assignee = assignee?.displayName || assignee?.name || ''
  }
  if (moduleKey === 'banners') {
    if (next.target !== undefined || next.legacyTarget !== undefined) next.target = String(next.target || next.legacyTarget || '')
    delete next.targetKey
    delete next.targetLabel
    delete next.audience
    delete next.audienceLabel
  }
  if (moduleKey === 'approval-flow') {
    next.flowType = 'materials'
    next.flowTypeLabel = '物料申请'
    const approverFields = ['level1ApproverId', 'level2ApproverId', 'platformApproverId']
    if (approverFields.some((field) => Object.hasOwn(next, field))) {
      const ids = [next.level1ApproverId, next.level2ApproverId, next.platformApproverId].filter(Boolean).map(String)
      const names = ids.map((id) => {
        const assignee = resolveAssignee(id)
        return String(assignee?.displayName || assignee?.name || id)
      })
      next.members = ids
      next.memberNames = names.join('、')
    }
    next.category ||= '流程配置'
  }
  if (moduleKey === 'warranty' && next.dealerId) {
    const dealer = resolveDealer(next.dealerId)
    next.dealer = dealer?.name || ''
    next.ownerId = String(dealer?.organizationId || dealer?.ownerId || next.dealerId)
    next.owner = dealer?.name || next.owner
    next.domain = dealer?.domain || next.domain
  }
  if (moduleKey === 'couriers') next.category ||= '快递公司'
  if (moduleKey === 'ota') next.category ||= '固件版本'
  return next
}

function validatePayload(moduleKey: string, payload: Partial<EntityRecord>, creating = true) {
  const database = useDatabaseStore()
  if (moduleKey === 'dealers' && payload.tier === '二级') {
    const parent = resolveDealer(payload.parentDealerId)
    if (!parent || parent.tier !== '一级' || parent.status !== 'normal') return '二级经销商必须选择正常的一级经销商作为上级'
    const session = useAuthStore().session
    if (session?.role === 'tier1' && String(parent.organizationId || parent.ownerId) !== session.ownerId) return '一级经销商只能在自身组织下新增二级经销商'
  }
  if (moduleKey === 'dealers' && useAuthStore().session?.role === 'tier1' && payload.tier !== '二级') return '一级经销商只能新增二级经销商'
  if (moduleKey === 'devices' && !String(payload.country || payload.region || '').trim()) return '请填写销售地区'
  if (moduleKey === 'ota' && !/^v?\d+\.\d+\.\d+$/.test(String(payload.name || ''))) return '版本号格式应为 1.0.0'
  if (moduleKey === 'projects' && !String(payload.deviceSN || '').trim()) return '项目必须绑定设备 SN'
  if (moduleKey === 'materials' && Number(payload.quantity || 0) < 1) return '申请数量必须大于 0'
  if (moduleKey === 'materials') {
    const material = visibleRecords('material-catalog').find((item) => item.id === payload.materialId && item.status !== 'disabled')
    if (!material) return '请选择有效且已启用的物料'
    const available = Number(material.stock || 0)
    if (Number(payload.quantity || 0) > available) return `可申请库存不足，当前可用 ${Math.max(0, available)}`
  }
  if (moduleKey === 'warehouse' && ['出库', '调货'].includes(String(payload.category))) {
    const session = useAuthStore().session
    if (payload.category === '调货' && session?.role === 'platform') return '调货申请必须由经销商账号发起'
    if (payload.category === '出库' && session?.role !== 'platform') return '设备出库只能由平台管理员操作'
    const selected = Array.isArray(payload.selectedDevices) ? payload.selectedDevices.map(String) : []
    const allowed = payload.category === '出库'
      ? visibleRecords('devices').filter((item) => item.inventoryStatus === 'in_stock' && item.ownerId === 'platform')
      : visibleRecords('devices').filter((item) => item.ownerId !== 'platform' && item.inventoryStatus !== 'in_stock')
    if (!selected.length || selected.some((sn) => !allowed.some((item) => item.code === sn))) return '所选设备不存在、已出库或超出当前数据范围'
    const target = resolveDealer(payload.targetDealerId)
    if (!target || target.status !== 'normal') return '接收经销商不存在或已禁用'
    if (payload.category === '调货' && allowed.some((item) => selected.includes(item.code) && item.ownerId === (target.organizationId || target.ownerId))) return '目标经销商不能与设备当前归属相同'
  }
  if (moduleKey === 'warehouse' && payload.category === '在库' && useAuthStore().session?.role !== 'platform') return '设备入库只能由平台管理员操作'
  if (['admins', 'dealers'].includes(moduleKey)) {
    const account = String(payload.account || '').trim()
    if (account.length < 4 || account.length > 20) return '登录账号长度必须为 4-20 位'
  }
  if (['admins', 'dealers'].includes(moduleKey) && creating && (String(payload.initialPassword || '').length < 6 || String(payload.initialPassword || '').length > 20)) return '初始密码长度必须为 6-20 位'
  if (moduleKey === 'sn-replacement') {
    if (useAuthStore().session?.role === 'platform') return '换 SN 必须由设备当前归属经销商发起'
    const original = visibleRecords('devices').find((item) => item.code === payload.originalSN)
    if (!original) return '原 SN 不存在或不属于当前数据范围'
    if (database.records('devices').some((item) => item.code === payload.newSN)) return '新 SN 已存在，不能用于换机'
  }
  if (moduleKey === 'service-transfer') {
    const device = visibleRecords('devices').find((item) => item.code === payload.deviceSN)
    const target = resolveDealer(payload.targetDealerId)
    if (!device) return '设备不存在或不属于当前数据范围'
    const session = useAuthStore().session
    const sourceDealerId = String(device.ownerId)
    if (session?.role === 'platform' || sourceDealerId !== session?.ownerId) return '只有设备当前归属经销商可以发起转移'
    if (!target || target.status !== 'normal') return '目标经销商不可用'
    if (target.organizationId === device.ownerId || target.ownerId === device.ownerId) return '目标经销商不能与原经销商相同'
    const source = resolveDealer(device.ownerId)
    const targetId = String(target.organizationId || target.ownerId)
    const eligible = source?.tier === '二级' && targetId === source.parentDealerId || Boolean(source && target.tier === source.tier)
    if (!eligible) return '目标经销商必须是当前经销商的上级或同级经销商'
  }
  if (moduleKey === 'approval-flow') {
    const accounts = database.records('auth-accounts').filter((item) => item.status === 'normal')
    const ids = [payload.level1ApproverId, payload.level2ApproverId, payload.platformApproverId].filter(Boolean).map(String)
    if (!ids.length || ids.some((id) => !accounts.some((item) => item.id === id))) return '审批人员不存在、已禁用或超出可选范围'
    const platform = accounts.find((item) => item.id === payload.platformApproverId)
    if (!platform || platform.roleKey !== 'platform') return '平台审核人员必须选择有效的平台管理员账号'
    const requiredCount = payload.levels === '二级 → 一级 → 平台' ? 3 : payload.levels === '一级 → 平台' ? 2 : 1
    if (new Set(ids).size !== requiredCount) return `当前审核层级需要配置 ${requiredCount} 个不同的审核账号`
  }
  if (moduleKey === 'warranty') {
    const session = useAuthStore().session
    const dealer = resolveDealer(payload.dealerId)
    if (!dealer) return '请选择有效经销商'
    if (session?.role === 'platform') return '平台管理员仅查看全部质保规则，规则必须由经销商自行设置'
    if (String(dealer.organizationId || dealer.ownerId) !== session?.ownerId) return '经销商只能维护自身质保规则'
    if (database.records('warranty').some((item) => item.id !== payload.id && String(item.dealerId || item.ownerId) === session.ownerId && item.productType === payload.productType)) return '当前设备类型已配置质保规则，请直接编辑原规则'
  }
  return ''
}

function transferDevices(subject: EntityRecord, targetDealerId: unknown, operationType: string) {
  const database = useDatabaseStore()
  const auth = useAuthStore()
  const target = resolveDealer(targetDealerId || subject.targetDealerId)
  if (!target) throw new Error('接收经销商不存在或已被移除')
  const selected = Array.isArray(subject.selectedDevices) ? subject.selectedDevices.map(String) : String(subject.deviceSN || '').split(/[、,]/).filter(Boolean)
  if (!selected.length) throw new Error('业务单没有可变更归属的设备')
  for (const sn of selected) {
    const device = database.records('devices').find((item) => item.code === sn)
    if (!device) throw new Error(`设备 ${sn} 不存在`)
    const oldOwner = device.owner
    const oldOwnerId = device.ownerId
    database.update('devices', device.id, {
      owner: target.name,
      ownerId: String(target.organizationId || target.ownerId),
      inventoryStatus: operationType === '设备出库' ? 'outbound' : 'transferred',
      status: 'offline',
    })
    if (operationType === '设备出库') {
      const stockRow = database.records('warehouse').find((item) => item.category === '在库' && item.deviceSN === device.code)
      if (stockRow) database.remove('warehouse', stockRow.id)
      database.create('stock-movements', {
        code: `STK-${Date.now().toString().slice(-8)}-${device.code.slice(-4)}`,
        name: device.name,
        category: '设备出库',
        deviceId: device.id,
        deviceSN: device.code,
        quantity: -1,
        fromOwner: oldOwner,
        toOwner: target.name,
        subjectId: subject.id,
        subjectCode: subject.code,
        status: 'completed',
        owner: target.name,
        ownerId: String(target.organizationId || target.ownerId),
        domain: device.domain,
      })
    } else {
      database.create('stock-movements', {
        code: `STK-${Date.now().toString().slice(-8)}-${device.code.slice(-4)}`,
        name: device.name,
        category: operationType,
        deviceId: device.id,
        deviceSN: device.code,
        quantity: 1,
        fromOwner: oldOwner,
        fromOwnerId: oldOwnerId,
        toOwner: target.name,
        toOwnerId: String(target.organizationId || target.ownerId),
        subjectId: subject.id,
        subjectCode: subject.code,
        status: 'completed',
        owner: target.name,
        ownerId: String(target.organizationId || target.ownerId),
        domain: device.domain,
      })
    }
    createRelation('ownership-history', device, {
      deviceId: device.id,
      deviceSN: device.code,
      fromOwner: oldOwner,
      fromOwnerId: oldOwnerId,
      toOwner: target.name,
      toOwnerId: String(target.organizationId || target.ownerId),
      operationType,
      operator: auth.session!.displayName,
      status: 'completed',
      owner: target.name,
      ownerId: String(target.organizationId || target.ownerId),
    })
  }
}

function activeMaterialCatalog(record: EntityRecord) {
  const database = useDatabaseStore()
  const name = String(record.materialName || record.name).split(' × ')[0]
  return database.records('material-catalog').find((item) => item.id === record.materialId || item.name === name)
}

function configuredApprovers(flowType: string) {
  const database = useDatabaseStore()
  const accounts = database.records('auth-accounts').filter((item) => item.status === 'normal')
  if (flowType === 'warehouse') {
    const platform = accounts.find((item) => item.roleKey === 'platform')
    if (!platform) throw new Error('没有可用的平台审批账号')
    return [platform]
  }
  const configured = database.records('approval-flow').find((item) => item.status === 'normal' && item.flowType === flowType)
  const configuredIds = [configured?.level1ApproverId, configured?.level2ApproverId, configured?.platformApproverId].filter(Boolean).map(String)
  const approvers = [...new Map(configuredIds.map((id) => accounts.find((item) => item.id === id)).filter(Boolean).map((item) => [item!.id, item!])).values()]
  if (!approvers.length) throw new Error(`没有可用的${configured?.flowTypeLabel || '业务'}审批账号，请先配置审批流程`)
  return approvers
}

function createApproval(record: EntityRecord, flowType: string, sourceModule: string) {
  const database = useDatabaseStore()
  let approvers = flowType === 'service-transfer' ? [] : configuredApprovers(flowType).filter((item) => item.ownerId !== record.ownerId)
  if (flowType === 'service-transfer') {
    const targetAccount = database.records('auth-accounts').find((item) => item.status === 'normal' && item.ownerId === record.targetDealerId)
    if (!targetAccount) throw new Error('目标经销商没有可用的确认账号')
    approvers = [targetAccount, ...approvers]
  }
  approvers = [...new Map(approvers.map((item) => [item.id, item])).values()]
  const instance = database.create('approval-instances', {
    code: `APR-${record.code}`,
    name: `${record.code} ${String(record.name || '')}审批`,
    subjectId: record.id,
    subjectCode: record.code,
    sourceModule,
    currentStep: 1,
    totalSteps: approvers.length,
    status: 'pending',
    owner: record.owner,
    ownerId: record.ownerId,
    domain: record.domain,
  })
  approvers.forEach((approver, index) => database.create('approval-steps', {
    code: `${instance.code}-${index + 1}`,
    name: `第 ${index + 1} 级审批`,
    subjectId: record.id,
    subjectCode: record.code,
    instanceId: instance.id,
    sequence: index + 1,
    approverAccountId: approver.id,
    approverName: approver.displayName || approver.name,
    status: index === 0 ? 'pending' : 'waiting',
    owner: record.owner,
    ownerId: record.ownerId,
    domain: record.domain,
  }))
  database.update(sourceModule, record.id, {
    approvalInstanceId: instance.id,
    currentApproverId: approvers[0].id,
    currentApproverName: approvers[0].displayName || approvers[0].name,
  })
  return instance
}

function advanceConfiguredApproval(record: EntityRecord, decision: 'approve' | 'reject', reason: unknown) {
  const database = useDatabaseStore()
  const auth = useAuthStore()
  const instance = database.records('approval-instances').find((item) => item.id === record.approvalInstanceId)
  const steps = database.records('approval-steps').filter((item) => item.instanceId === instance?.id).sort((left, right) => Number(left.sequence) - Number(right.sequence))
  const current = steps.find((item) => item.status === 'pending')
  if (!instance || !current || current.approverAccountId !== auth.session?.accountId) throw new Error('当前账号不是该业务的审批或确认人')
  const timestamp = new Date().toISOString()
  if (decision === 'reject') {
    database.update('approval-steps', current.id, { status: 'rejected', reason, decidedAt: timestamp })
    steps.filter((item) => item.status === 'waiting').forEach((item) => database.update('approval-steps', item.id, { status: 'skipped' }))
    database.update('approval-instances', instance.id, { status: 'rejected', completedAt: timestamp })
    return { final: true, approved: false, patch: { status: 'rejected', currentApproverId: '', currentApproverName: '', rejectionReason: reason } }
  }
  database.update('approval-steps', current.id, { status: 'approved', reason, decidedAt: timestamp })
  const next = steps.find((item) => item.status === 'waiting')
  if (next) {
    database.update('approval-steps', next.id, { status: 'pending' })
    database.update('approval-instances', instance.id, { currentStep: next.sequence })
    return { final: false, approved: true, patch: { status: 'pending', currentApproverId: next.approverAccountId, currentApproverName: next.approverName, approvalReason: reason } }
  }
  database.update('approval-instances', instance.id, { status: 'approved', completedAt: timestamp })
  return { final: true, approved: true, patch: { status: 'completed', currentApproverId: '', currentApproverName: '', approvalReason: reason } }
}

function deductMaterialStock(record: EntityRecord) {
  const database = useDatabaseStore()
  const catalog = activeMaterialCatalog(record)
  if (!catalog || catalog.status === 'disabled') throw new Error('关联物料不存在或已停用')
  const quantity = Number(record.quantity || 0)
  if (quantity < 1) throw new Error('物料数量必须大于 0')
  if (Number(catalog.stock || 0) < quantity) throw new Error('物料实际库存不足，无法发货')
  const before = Number(catalog.stock || 0)
  database.update('material-catalog', catalog.id, {
    stock: before - quantity,
    status: before - quantity <= Number(catalog.warningThreshold || 10) ? 'low' : 'normal',
  })
  database.create('stock-movements', {
    code: `MAT-${Date.now().toString().slice(-8)}`,
    name: catalog.name,
    category: '物料发货',
    subjectId: record.id,
    subjectCode: record.code,
    materialId: catalog.id,
    quantity: -quantity,
    beforeStock: before,
    afterStock: before - quantity,
    status: 'completed',
    owner: record.owner,
    ownerId: record.ownerId,
    domain: record.domain,
  })
}

function advanceMaterialApproval(record: EntityRecord, decision: 'approve' | 'reject', reason: unknown) {
  const database = useDatabaseStore()
  const auth = useAuthStore()
  const instance = database.records('approval-instances').find((item) => item.id === record.approvalInstanceId)
  const steps = database.records('approval-steps')
    .filter((item) => item.instanceId === instance?.id)
    .sort((left, right) => Number(left.sequence) - Number(right.sequence))
  const current = steps.find((item) => item.status === 'pending')
  if (!instance || !current || current.approverAccountId !== auth.session?.accountId) throw new Error('当前账号不是该申请的审批人')
  const timestamp = new Date().toISOString()
  if (decision === 'reject') {
    database.update('approval-steps', current.id, { status: 'rejected', reason, decidedAt: timestamp })
    steps.filter((item) => item.status === 'waiting').forEach((item) => database.update('approval-steps', item.id, { status: 'skipped' }))
    database.update('approval-instances', instance.id, { status: 'rejected', completedAt: timestamp })
    return { status: 'rejected', currentApproverId: '', currentApproverName: '', rejectionReason: reason }
  }
  database.update('approval-steps', current.id, { status: 'approved', reason, decidedAt: timestamp })
  const next = steps.find((item) => item.status === 'waiting')
  if (next) {
    database.update('approval-steps', next.id, { status: 'pending' })
    database.update('approval-instances', instance.id, { currentStep: next.sequence })
    return { status: 'pending', currentApproverId: next.approverAccountId, currentApproverName: next.approverName, approvalReason: reason }
  }
  database.update('approval-instances', instance.id, { status: 'approved', completedAt: timestamp })
  return { status: 'approved', currentApproverId: '', currentApproverName: '', approvalReason: reason }
}

function transferDeviceDealer(record: EntityRecord) {
  const database = useDatabaseStore()
  const target = resolveDealer(record.targetDealerId)
  const device = database.records('devices').find((item) => item.code === record.deviceSN)
  if (!target || !device) throw new Error('目标经销商或设备不存在')
  const targetId = String(target.organizationId || target.ownerId)
  const oldOwner = device.owner
  const oldOwnerId = device.ownerId
  database.update('devices', device.id, { owner: target.name, ownerId: targetId })
  database.create('ownership-history', {
    code: `OWN-${Date.now().toString().slice(-8)}`,
    name: device.name,
    deviceId: device.id,
    deviceSN: device.code,
    fromOwner: oldOwner,
    fromOwnerId: oldOwnerId,
    toOwner: target.name,
    toOwnerId: targetId,
    operationType: '售后转移',
    operator: useAuthStore().session?.displayName || '',
    status: 'completed', owner: target.name, ownerId: targetId, domain: device.domain,
  })
  for (const moduleKey of ['repairs', 'complaints', 'materials']) {
    database.records(moduleKey).filter((item) => item.deviceSN === device.code && !['completed', 'rejected'].includes(item.status)).forEach((item) => database.update(moduleKey, item.id, { owner: target.name, ownerId: targetId }))
  }
}

export const mockService = {
  canAction(moduleKey: string, record: EntityRecord, actionKey: string) {
    return actionDecision(moduleKey, record, actionKey)
  },
  async list(moduleKey: string, query: PageQuery): Promise<TableDataInfo<EntityRecord>> {
    await sleep()
    if (!hasPermission(useAuthStore().permissions, `${moduleKey}:view`)) return { code: 403, msg: '无权查看该模块', rows: [], total: 0 }
    const tab = moduleConfigs[moduleKey]?.tabs.find((item) => item.key === query.tab)
    const sourceKey = tab?.source || moduleKey
    const rows = filterRows(moduleKey, visibleRecords(sourceKey), query, sourceKey)
    if (query.orderByColumn) {
      const field = query.orderByColumn
      const direction = query.isAsc === 'desc' ? -1 : 1
      rows.sort((left, right) => String(left[field] ?? '').localeCompare(String(right[field] ?? ''), 'zh-CN') * direction)
    } else rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    const total = rows.length
    const start = Math.max(0, (query.pageNum - 1) * query.pageSize)
    return { code: 200, msg: '查询成功', rows: rows.slice(start, start + query.pageSize).map((item) => forDisplay(sourceKey, item)), total }
  },
  async all(moduleKey: string) {
    await sleep(10)
    if (!hasPermission(useAuthStore().permissions, `${moduleKey}:view`)) return fail(403, '无权查看该模块', [] as EntityRecord[])
    return ok(visibleRecords(moduleKey).map((item) => forDisplay(moduleKey, item)))
  },
  async importDevices(rows: Array<{ sn: string; model: string; region: string }>, target: 'devices' | 'warehouse' = 'devices') {
    await sleep()
    const moduleKey = target === 'warehouse' ? 'warehouse' : 'devices'
    const permission = createDecision(moduleKey)
    if (!permission.allowed) return fail(403, permission.reason, [] as EntityRecord[])
    const database = useDatabaseStore()
    const session = useAuthStore().session
    if (!session) return fail(401, '登录状态已失效', [] as EntityRecord[])
    if (target === 'warehouse' && session.role !== 'platform') return fail(403, '设备入库只能由平台管理员操作', [] as EntityRecord[])
    if (!rows.length) return fail(422, '没有可导入的数据', [] as EntityRecord[])

    const allowedModels = new Set(moduleConfigs.devices.fields.find((item) => item.field === 'name')?.options?.map((item) => item.value) || [])
    const seen = new Set(database.records('devices').map((item) => String(item.code)))
    const normalized = rows.map((item) => ({ sn: item.sn.trim(), model: item.model.trim(), region: item.region.trim() }))
    for (const item of normalized) {
      if (!item.sn) return fail(422, 'SN 不能为空', [] as EntityRecord[])
      if (seen.has(item.sn)) return fail(409, `SN ${item.sn} 已存在或文件内重复`, [] as EntityRecord[])
      if (!allowedModels.has(item.model)) return fail(422, `设备型号 ${item.model} 无效`, [] as EntityRecord[])
      if (!item.region) return fail(422, `设备 ${item.sn} 的销售地区不能为空`, [] as EntityRecord[])
      seen.add(item.sn)
    }

    const created = database.transaction(() => normalized.map((item) => {
      const country = item.region.split(/[·/-]/)[0]?.trim() || item.region
      const device = database.create('devices', {
        code: item.sn, name: item.model, country, region: item.region, firmware: 'v1.0.0', activation: 'inactive', activationDate: '',
        bindingStatus: 'unbound', account: '-', inventoryStatus: target === 'warehouse' ? 'in_stock' : '', warehouseLocation: '',
        status: 'offline', owner: target === 'warehouse' ? '平台中心仓' : session.displayName,
        ownerId: target === 'warehouse' ? 'platform' : session.ownerId, domain: session.domain,
      })
      if (target === 'devices') return device
      const inboundCode = generateBusinessCode('warehouse', { category: '在库' })
      const warehouse = database.create('warehouse', {
        code: inboundCode, name: item.model, category: '在库', deviceId: device.id, deviceSN: item.sn, deviceModel: item.model,
        country, region: item.region, quantity: 1, warehouseLocation: '', inboundAt: new Date().toISOString(), status: 'normal',
        owner: '平台中心仓', ownerId: 'platform', domain: session.domain,
      })
      database.create('stock-movements', {
        code: `STK-${inboundCode}`, name: item.model, category: '设备入库', deviceId: device.id, deviceSN: item.sn, quantity: 1,
        subjectId: warehouse.id, subjectCode: warehouse.code, status: 'completed', owner: '平台中心仓', ownerId: 'platform', domain: session.domain,
      })
      return warehouse
    }))
    database.audit(target === 'warehouse' ? '批量设备入库' : '批量录入设备', `${created.length} 台 · ${created.map((item) => item.code).join('、')}`, session.displayName, false, created[0])
    return ok(created, target === 'warehouse' ? `成功入库 ${created.length} 台设备` : `成功录入 ${created.length} 台设备`)
  },
  async get(moduleKey: string, id: string) {
    await sleep()
    if (!hasPermission(useAuthStore().permissions, `${moduleKey}:view`)) return fail(403, '无权查看该模块', null)
    const record = visibleRecords(moduleKey).find((item) => item.id === id)
    if (!record) return fail(404, '记录不存在或无权访问', null)
    const derived = forDisplay(moduleKey, record)
    if (moduleKey === 'users') return ok(derived, '查询成功')
    return ok(useAuthStore().session?.role === 'platform' ? { ...record, deviceCount: derived.deviceCount ?? record.deviceCount } : derived, '查询成功')
  },
  async related(moduleKey: string, id: string, source?: string) {
    await sleep()
    if (!hasPermission(useAuthStore().permissions, `${moduleKey}:view`)) return fail(403, '无权查看关联数据', [] as EntityRecord[])
    const record = visibleRecords(moduleKey).find((item) => item.id === id)
    if (!record) return fail(404, '记录不存在或无权访问', [] as EntityRecord[])
    return ok(relatedRecords(record, source), '查询成功')
  },
  async options(optionSource: string, context: Record<string, unknown> = {}) {
    await sleep(5)
    let options: Array<{ label: string; value: string }> = []
    if (optionSource === 'tier1-dealers') options = visibleRecords('dealers').filter((item) => item.tier === '一级' && item.status === 'normal').map((item) => option(item.name, item.organizationId || item.ownerId))
    if (optionSource === 'dealers') options = visibleRecords('dealers').filter((item) => item.status === 'normal' && item.category !== '注册申请').map((item) => option(`${item.name} · ${item.tier}`, item.organizationId || item.ownerId))
    if (optionSource === 'service-target-dealers') {
      const session = useAuthStore().session
      const database = useDatabaseStore()
      const device = database.records('devices').find((item) => item.code === context.deviceSN)
      const sourceId = String(device?.ownerId || session?.ownerId || '')
      const source = database.records('dealers').find((item) => String(item.organizationId || item.ownerId) === sourceId)
      const activeOwners = new Set(database.records('auth-accounts').filter((item) => item.status === 'normal').map((item) => item.ownerId))
      options = database.records('dealers')
        .filter((item) => {
          const id = String(item.organizationId || item.ownerId)
          const isParent = source?.tier === '二级' && id === source.parentDealerId
          const isPeer = Boolean(source && item.tier === source.tier)
          return item.domain === session?.domain && item.status === 'normal' && item.category !== '注册申请' && id !== sourceId && activeOwners.has(id) && (isParent || isPeer)
        })
        .map((item) => option(`${item.name} · ${item.tier}`, item.organizationId || item.ownerId))
    }
    if (optionSource === 'transfer-target-dealers') {
      const session = useAuthStore().session
      const database = useDatabaseStore()
      const selected = Array.isArray(context.selectedDevices) ? context.selectedDevices.map(String) : []
      const sourceDevice = database.records('devices').find((item) => selected.includes(String(item.code)))
      const sourceId = String(sourceDevice?.ownerId || session?.ownerId || '')
      options = database.records('dealers')
        .filter((item) => item.domain === session?.domain && item.status === 'normal' && String(item.organizationId || item.ownerId) !== sourceId)
        .map((item) => option(`${item.name} · ${item.tier}`, item.organizationId || item.ownerId))
    }
    if (optionSource === 'dealer-organizations') options = [option('平台中心', 'platform'), ...visibleRecords('dealers').filter((item) => item.status === 'normal').map((item) => option(item.name, item.organizationId || item.ownerId))]
    if (optionSource === 'warehouse-devices') options = visibleRecords('devices').filter((item) => item.inventoryStatus === 'in_stock' && item.ownerId === 'platform').map((item) => option(`${item.code} · ${item.name} · ${item.warehouseLocation || '未分配库位'}`, item.code))
    if (optionSource === 'dealer-devices') options = visibleRecords('devices').filter((item) => item.ownerId !== 'platform' && item.inventoryStatus !== 'in_stock').map((item) => option(`${item.code} · ${item.name} · ${item.owner}`, item.code))
    if (optionSource === 'accessible-devices') options = visibleRecords('devices').map((item) => option(`${item.code} · ${item.name} · ${item.owner}`, item.code))
    if (optionSource === 'enabled-couriers') options = visibleRecords('couriers').filter((item) => item.category === '快递公司' && item.status === 'normal').map((item) => option(item.name, item.id))
    if (optionSource === 'active-materials') options = visibleRecords('material-catalog')
      .filter((item) => item.status !== 'disabled' && Number(item.stock || 0) > 0)
      .map((item) => option(`${item.name} · 库存 ${Number(item.stock || 0)}`, item.id))
    if (optionSource === 'assignees') options = visibleRecords('auth-accounts').filter((item) => item.status === 'normal').map((item) => option(`${item.displayName || item.name} · ${item.roleLabel || ''}`, item.id))
    if (optionSource === 'platform-assignees') options = useDatabaseStore().records('auth-accounts').filter((item) => item.status === 'normal' && item.roleKey === 'platform').map((item) => option(`${item.displayName || item.name} · ${item.roleLabel || ''}`, item.id))
    if (optionSource === 'warranty-dealers') {
      const session = useAuthStore().session
      options = session?.role === 'platform'
        ? visibleRecords('dealers').filter((item) => item.status === 'normal').map((item) => option(item.name, item.organizationId || item.ownerId))
        : visibleRecords('dealers').filter((item) => String(item.organizationId || item.ownerId) === session?.ownerId).map((item) => option(item.name, item.organizationId || item.ownerId))
    }
    if (optionSource === 'roles') options = visibleRecords('roles').filter((item) => item.status === 'normal').map((item) => option(`${item.name} · ${item.dataScope}`, item.id))
    return ok(uniqueOptions(options), '选项加载成功')
  },
  async resolveFields(moduleKey: string, form: Partial<EntityRecord>) {
    await sleep(5)
    return ok(deriveFields(moduleKey, form), '关联字段已更新')
  },
  async create(moduleKey: string, input: Partial<EntityRecord>) {
    await sleep()
    const permission = createDecision(moduleKey)
    if (!permission.allowed) return fail(403, permission.reason, null)
    const database = useDatabaseStore()
    const auth = useAuthStore()
    const session = auth.session || { ownerId: 'platform', displayName: '注册申请人', domain: 'cn' as DataDomain }
    const payload = deriveFields(moduleKey, input)
    payload.code ||= generateBusinessCode(moduleKey, payload)
    if (moduleKey === 'material-catalog') payload.materialCode ||= payload.code
    if (moduleKey === 'materials') payload.name ||= `${payload.materialName || '物料'} × ${payload.quantity || 1}`
    if (moduleKey === 'service-transfer') payload.name ||= `${payload.sourceDealer || '原经销商'} → ${payload.targetDealer || '目标经销商'}`
    if (moduleKey === 'sn-replacement') payload.name ||= `${payload.originalSN} → ${payload.newSN}`
    if (moduleKey === 'warranty') {
      payload.name ||= `${payload.dealer || '经销商'} · ${payload.productType || '设备'}质保`
      payload.category ||= String(payload.productType || '')
    }
    if (auth.session && auth.session.role !== 'platform') {
      payload.ownerId = session.ownerId
      payload.owner = session.displayName
      payload.domain = session.domain
    }
    const configuredValidation = validateConfiguredFields(moduleKey, payload, true)
    if (configuredValidation) return fail(422, configuredValidation, null)
    const validation = validatePayload(moduleKey, payload, true)
    if (validation) return fail(422, validation, null)
    if (payload.code && database.records(moduleKey).some((item) => item.code === payload.code)) return fail(409, '业务编号已存在', null)
    if (payload.account && [...database.records(moduleKey), ...database.records('auth-accounts')].some((item) => item.account === payload.account)) return fail(409, '账号已存在', null)

    if (moduleKey === 'warehouse' && payload.category === '在库') {
      const quantity = 1
      const baseSN = String(payload.deviceSN)
      const sns = [baseSN]
      if (database.records('devices').some((item) => item.code === baseSN)) return fail(409, '入库 SN 已存在', null)
      let first: EntityRecord | null = null
      database.transaction(() => {
        sns.forEach((sn, index) => {
          const device = database.create('devices', { code: sn, name: String(payload.deviceModel), country: String(payload.region || '').split(/[·]/)[0].trim(), region: String(payload.region || ''), activation: 'inactive', activationDate: '', bindingStatus: 'unbound', account: '-', firmware: 'v1.0.0', inventoryStatus: 'in_stock', warehouseLocation: '', status: 'offline', owner: '平台中心仓', ownerId: 'platform', domain: session.domain })
          const row = database.create('warehouse', { ...payload, code: index === 0 ? payload.code : `${payload.code}-${index + 1}`, name: device.name, deviceId: device.id, deviceSN: sn, quantity: 1, inboundAt: new Date().toISOString(), status: 'normal', owner: '平台中心仓', ownerId: 'platform', domain: session.domain })
          database.create('stock-movements', { code: `STK-${String(payload.code)}-${index + 1}`, name: device.name, category: '设备入库', deviceId: device.id, deviceSN: sn, quantity: 1, subjectId: row.id, subjectCode: row.code, status: 'completed', owner: '平台中心仓', ownerId: 'platform', domain: session.domain })
          first ||= row
        })
      })
      database.audit('设备入库', `${payload.code} · ${quantity} 台`, session.displayName, false, first || undefined)
      return ok(first!, `成功入库 ${quantity} 台设备`)
    }

    if (moduleKey === 'materials') {
      if (session.ownerId === 'platform') return fail(403, '物料申请必须由经销商账号发起', null)
      const device = database.records('devices').find((item) => item.code === payload.deviceSN)
      const rule = device ? database.records('warranty').find((item) => (item.productType === device.name || item.category === device.name) && String(item.dealerId || item.ownerId) === device.ownerId && item.status === 'normal') : undefined
      const activationDate = device?.activationDate ? new Date(String(device.activationDate)) : null
      const warrantyEnd = activationDate && rule ? new Date(activationDate.getFullYear(), activationDate.getMonth() + Number(rule.materialMonths || 0), activationDate.getDate()) : null
      payload.warrantyResult = !device ? '未找到设备' : warrantyEnd && warrantyEnd < new Date() ? '已过期，需自费' : '质保有效'
      payload.status = 'pending'
      payload.applyTime = new Date().toISOString()
      payload.dealer ||= session.displayName
    }
    if (moduleKey === 'devices') Object.assign(payload, { country: String(payload.region || '').split(/[·]/)[0].trim(), firmware: 'v1.0.0', activation: 'inactive', activationDate: '', bindingStatus: 'unbound', account: '-', status: 'offline' })
    if (moduleKey === 'warranty' && auth.session?.role === 'platform') return fail(403, '平台管理员仅查看全部质保规则，经销商只能维护自身规则', null)
    if (moduleKey === 'couriers' && payload.apiKey) {
      payload.apiKeyMasked = `********${String(payload.apiKey).slice(-4)}`
      delete payload.apiKey
    }
    if (moduleKey === 'dealers') Object.assign(payload, { category: payload.tier, mustChangePassword: true, deviceCount: 0, organizationId: `dealer-${Date.now().toString(36)}` })
    if (moduleKey === 'sn-replacement') {
      const original = visibleRecords('devices').find((item) => item.code === payload.originalSN)!
      Object.assign(payload, { status: 'pending', owner: original.owner, ownerId: original.ownerId, domain: original.domain })
    }
    if (moduleKey === 'service-transfer') Object.assign(payload, { status: 'pending', owner: payload.sourceDealer, ownerId: payload.sourceDealerId })
    if (moduleKey === 'warehouse' && ['出库', '调货'].includes(String(payload.category))) Object.assign(payload, { status: 'pending', deviceSN: Array.isArray(payload.selectedDevices) ? payload.selectedDevices.join('、') : '' })
    if (moduleKey === 'roles') Object.assign(payload, { roleKey: 'custom', permissions: [], permissionCount: 0 })
    if (moduleKey === 'admins') {
      const role = database.records('roles').find((item) => item.id === payload.roleId)!
      Object.assign(payload, { role: role.name, dataScope: role.dataScope, category: payload.ownerId === 'platform' ? '平台' : '经销商' })
    }
    const record = database.create(moduleKey, { ...payload, ownerId: payload.ownerId || session.ownerId, owner: payload.owner || session.displayName, domain: payload.domain || session.domain })
    if (moduleKey === 'dealers') {
      database.update('dealers', record.id, { ownerId: String(record.organizationId), owner: record.name })
      record.ownerId = String(record.organizationId)
      record.owner = record.name
      createAccount(record, payload, 'dealer')
    }
    if (moduleKey === 'admins') createAccount(record, payload, 'admin')
    if (moduleKey === 'materials') {
      try {
        database.transaction(() => createApproval(record, 'materials', 'materials'))
      } catch (error) {
        database.remove('materials', record.id)
        return fail(422, error instanceof Error ? error.message : '审批流程初始化失败', null)
      }
    }
    if (moduleKey === 'warehouse' && record.category === '调货') {
      try { database.transaction(() => createApproval(record, 'warehouse', 'warehouse')) } catch (error) { database.remove('warehouse', record.id); return fail(422, error instanceof Error ? error.message : '调货审批流程初始化失败', null) }
    }
    if (moduleKey === 'service-transfer') {
      try { database.transaction(() => createApproval(record, 'service-transfer', 'service-transfer')) } catch (error) { database.remove('service-transfer', record.id); return fail(422, error instanceof Error ? error.message : '售后转移流程初始化失败', null) }
    }
    database.audit(`新增${moduleConfigs[moduleKey]?.title || moduleKey}`, record.code, session.displayName, false, record)
    return ok(database.records(moduleKey).find((item) => item.id === record.id) || record, '新增成功')
  },
  async update(moduleKey: string, id: string, input: Partial<EntityRecord>) {
    await sleep()
    if (!editableModules.has(moduleKey)) return fail(405, 'V3.2 未定义该模块的直接编辑操作', null)
    if (!hasPermission(useAuthStore().permissions, `${moduleKey}:edit`)) return fail(403, '无权编辑该模块', null)
    const database = useDatabaseStore()
    const auth = useAuthStore()
    const record = visibleRecords(moduleKey).find((item) => item.id === id)
    if (!record) return fail(403, '记录不存在或无权修改', null)
    if (moduleKey === 'warranty' && (auth.session?.role === 'platform' || String(record.dealerId || record.ownerId) !== auth.session?.ownerId)) {
      return fail(403, '经销商只能编辑自身质保规则', null)
    }
    const payload = deriveFields(moduleKey, { ...input, id })
    if (auth.session?.role !== 'platform') {
      delete payload.ownerId
      delete payload.owner
      delete payload.domain
    }
    const configuredValidation = validateConfiguredFields(moduleKey, { ...record, ...payload }, false)
    if (configuredValidation) return fail(422, configuredValidation, null)
    const validation = validatePayload(moduleKey, { ...record, ...payload }, false)
    if (validation) return fail(422, validation, null)
    if (payload.code && database.records(moduleKey).some((item) => item.id !== id && item.code === payload.code)) return fail(409, '业务编号已存在', null)
    const currentAccounts = linkedAccounts(moduleKey, record)
    if (payload.account) {
      const primaryAccount = accountFor(moduleKey, record)
      const duplicatedBusiness = database.records(moduleKey).some((item) => item.id !== id && item.account === payload.account)
      const duplicatedLogin = database.records('auth-accounts').some((item) => item.id !== primaryAccount?.id && item.account === payload.account)
      if (duplicatedBusiness || duplicatedLogin) return fail(409, '账号已存在', null)
    }
    if (moduleKey === 'admins' && payload.roleId) {
      const role = database.records('roles').find((item) => item.id === payload.roleId)
      Object.assign(payload, { role: role?.name, dataScope: role?.dataScope, category: payload.ownerId === 'platform' ? '平台' : '经销商' })
    }
    if (moduleKey === 'couriers' && payload.apiKey) {
      payload.apiKeyMasked = `********${String(payload.apiKey).slice(-4)}`
      delete payload.apiKey
    }
    const updated = database.update(moduleKey, id, payload)!
    if (currentAccounts.length && ['admins', 'dealers'].includes(moduleKey)) {
      const dealerRoleKey = updated.tier === '二级' ? 'tier2' : 'tier1'
      const role = moduleKey === 'admins'
        ? database.records('roles').find((item) => item.id === updated.roleId)
        : database.records('roles').find((item) => item.roleKey === dealerRoleKey)
      for (const authAccount of currentAccounts) database.update('auth-accounts', authAccount.id, {
        ...(authAccount.account === record.account ? { account: String(updated.account || ''), code: String(updated.account || '') } : {}),
        displayName: updated.name,
        name: updated.name,
        roleId: String(role?.id || authAccount.roleId),
        roleKey: role?.roleKey || authAccount.roleKey,
        roleLabel: role?.name || authAccount.roleLabel,
        dataScope: role?.dataScope || authAccount.dataScope,
        ownerId: String(updated.organizationId || updated.ownerId),
        domain: updated.domain,
        status: updated.status,
      })
    }
    database.audit(`编辑${moduleConfigs[moduleKey]?.title || moduleKey}`, record.code, auth.session!.displayName, false, record)
    if (currentAccounts.some((item) => item.id === auth.session?.accountId)) auth.refreshSession()
    return ok(updated, '保存成功')
  },
  async remove(moduleKey: string, id: string, reason: string) {
    await sleep()
    if (!hasPermission(useAuthStore().permissions, `${moduleKey}:delete`)) return fail(403, '无权删除该模块记录', false)
    const database = useDatabaseStore()
    const auth = useAuthStore()
    const record = visibleRecords(moduleKey).find((item) => item.id === id)
    if (!record) return fail(403, '记录不存在或无权删除', false)
    if (!['projects', 'material-catalog', 'banners'].includes(moduleKey)) return fail(405, '该业务属于审计数据，不允许删除', false)
    if (!reason.trim()) return fail(422, '请填写删除原因', false)
    const removed = database.remove(moduleKey, id)
    database.audit(`删除${moduleConfigs[moduleKey]?.title || moduleKey}`, `${record.code} · ${reason}`, auth.session!.displayName, true, record)
    return ok(removed, '删除成功')
  },
  async action(moduleKey: string, id: string, actionKey: string, input: Record<string, unknown> | string = {}) {
    await sleep()
    const database = useDatabaseStore()
    const auth = useAuthStore()
    const payload = typeof input === 'string' ? { reason: input, result: input, replyContent: input } : input
    const record = visibleRecords(moduleKey).find((item) => item.id === id)
    if (!record) return fail(403, '记录不存在或无权操作', null)
    const authorization = actionDecision(moduleKey, record, actionKey)
    if (!authorization.allowed) return fail(authorization.code, authorization.reason, null)
    const actionConfig = moduleConfigs[moduleKey]?.actions?.find((item) => item.key === actionKey)
    if (actionConfig?.allowedStatuses?.length && !actionConfig.allowedStatuses.includes(record.status)) return fail(409, `当前状态“${record.status}”不能执行${actionConfig.label}`, null)
    const actionValidation = validateActionFields(actionConfig?.fields, payload)
    if (actionValidation) return fail(422, actionValidation, null)
    const patch: Partial<EntityRecord> = {}

    if (actionKey === 'toggle') {
      patch.status = record.status === 'disabled' ? 'normal' : 'disabled'
      for (const login of linkedAccounts(moduleKey, record)) updateLinkedAccount(moduleKey, login, { status: patch.status })
      database.notify(`${record.name}账号状态已变更`, `当前状态：${patch.status === 'normal' ? '正常' : '已禁用'}`, record, 'risk')
    }
    if (actionKey === 'reset-password') {
      Object.assign(patch, { passwordResetAt: new Date().toISOString(), mustChangePassword: true, ...(record.status === 'locked' ? { status: 'normal' } : {}) })
      const login = accountFor(moduleKey, record)
      if (login) updateLinkedAccount(moduleKey, login, { password: 'Reset123!', firstLogin: true, failedAttempts: 0, lockedUntil: 0, status: record.status === 'disabled' ? 'disabled' : 'normal' })
      else return fail(404, '未找到关联登录账号', null)
      database.notify('登录密码已重置', `${record.name}下次登录必须修改密码，临时密码为 Reset123!`, record, 'risk')
    }
    if (actionKey === 'change-region') Object.assign(patch, { country: payload.country, region: payload.region, regionChangedAt: new Date().toISOString(), regionChangeReason: payload.reason })
    if (actionKey === 'assign' || actionKey === 'forward') {
      const assignee = resolveAssignee(payload.assigneeId)
      if (!assignee || assignee.status !== 'normal') return fail(422, '请选择有效且正常的处理对象', null)
      const session = auth.session!
      const allowedIds = organizationIds()
      const assigneeOwnerId = String(assignee.organizationId || assignee.ownerId)
      if (session.role !== 'platform' && (!allowedIds || !allowedIds.has(assigneeOwnerId))) return fail(403, '处理对象超出当前组织数据范围', null)
      const name = String(assignee.displayName || assignee.name)
      const ownerId = String(assignee.organizationId || assignee.ownerId)
      if (actionKey === 'assign') Object.assign(patch, { status: 'processing', assignee: name, assigneeId: assignee.id, owner: name, ownerId })
      else Object.assign(patch, { status: 'forwarded', forwardedTo: name, assigneeId: assignee.id, owner: name, ownerId })
      database.notify(actionKey === 'assign' ? '收到新的处理任务' : '收到转发留言', `${record.code} · ${record.name}`, { ...record, ownerId, owner: name })
    }
    if (actionKey === 'escalate') Object.assign(patch, { status: 'processing', owner: '总部售后中心', ownerId: 'platform' })
    if (actionKey === 'complete') {
      Object.assign(patch, { status: 'completed', result: payload.result || payload.reason, completedAt: new Date().toISOString() })
      database.notify('业务处理已完成', `${record.code} · ${String(payload.result || payload.reason || '处理完成')}`, record)
    }
    if (actionKey === 'approve' && moduleKey !== 'materials') Object.assign(patch, { status: moduleKey === 'dealers' ? 'normal' : 'approved', approvalReason: payload.reason })
    if (actionKey === 'reject' && moduleKey !== 'materials') Object.assign(patch, { status: 'rejected', rejectionReason: payload.reason })
    if (moduleKey === 'materials' && ['approve', 'reject'].includes(actionKey)) {
      try {
        Object.assign(patch, database.transaction(() => advanceMaterialApproval(record, actionKey as 'approve' | 'reject', payload.reason)))
      } catch (error) {
        return fail(422, error instanceof Error ? error.message : '审批处理失败', null)
      }
      database.notify(actionKey === 'approve' ? '物料审批节点已通过' : '物料申请已拒绝', `${record.code} · ${String(payload.reason || '')}`, record, actionKey === 'reject' ? 'risk' : 'info')
    }
    if (actionKey === 'publish') Object.assign(patch, { status: record.status === 'published' ? 'withdrawn' : 'published', releaseAt: record.status === 'published' ? record.releaseAt : new Date().toISOString() })
    if (['remote-disable', 'remote-enable'].includes(actionKey)) {
      patch.status = actionKey === 'remote-disable' ? 'disabled' : 'online'
      database.create('device-commands', {
        code: `CMD-${Date.now().toString().slice(-8)}`,
        name: patch.status === 'disabled' ? '远程禁用' : '远程启用',
        deviceId: record.id,
        deviceSN: record.code,
        requestedStatus: patch.status,
        reason: payload.reason,
        result: 'simulated_success',
        resultLabel: '纯前端模拟成功',
        status: 'completed',
        owner: record.owner,
        ownerId: record.ownerId,
        domain: record.domain,
      })
    }
    if (actionKey === 'reply') {
      createRelation('replies', record, { sourceModule: moduleKey, content: payload.replyContent, operator: auth.session!.displayName, channel: '站内信', status: 'completed' })
      patch.lastReply = payload.replyContent
      if (moduleKey === 'messages') patch.status = 'completed'
      database.notify('业务回复已发送', `${record.code} · ${String(payload.replyContent).slice(0, 60)}`, record)
    }
    if (actionKey === 'unbind') {
      const targetSN = `${record.code}-1`
      if (database.records('devices').some((item) => item.id !== record.id && item.code === targetSN)) return fail(409, `目标 SN ${targetSN} 已存在，请先处理编号冲突`, null)
      const oldAccount = String(record.account || '-')
      Object.assign(patch, { code: targetSN, account: '-', bindingStatus: 'unbound', boundAt: '' })
      createRelation('ownership-history', record, { deviceId: record.id, deviceSN: targetSN, fromOwner: oldAccount, toOwner: '未绑定', operationType: '强制解绑', operator: auth.session!.displayName, status: 'completed' })
      database.notify('设备已强制解绑', `${record.code} 已归档为 ${targetSN}`, record, 'risk')
    }
    if (actionKey === 'ship') {
      const courier = database.records('couriers').find((item) => item.id === payload.courierId && item.category === '快递公司' && item.status === 'normal')
      if (!courier) return fail(422, '请选择已启用的快递公司', null)
      if (!String(payload.trackingNo || '').trim()) return fail(422, '请填写物流单号', null)
      if (database.records('logistics-records').some((item) => item.trackingNo === payload.trackingNo)) return fail(409, '物流单号已被使用', null)
      Object.assign(patch, { status: 'shipped', courier: courier.name, courierId: courier.id, trackingNo: payload.trackingNo, shippedAt: new Date().toISOString() })
      try {
        database.transaction(() => {
          deductMaterialStock(record)
          createRelation('logistics-records', record, { courier: courier.name, courierId: courier.id, trackingNo: payload.trackingNo, content: '已揽收，等待转运', status: 'shipped' })
          database.create('issuance', { code: `ISS-${Date.now().toString().slice(-8)}`, name: String(record.materialName || record.name), materialName: record.materialName, materialId: record.materialId, quantity: record.quantity, sourceRequestId: record.id, sourceRequestCode: record.code, courier: courier.name, courierId: courier.id, trackingNo: payload.trackingNo, recipient: record.dealer || record.owner, issuedAt: new Date().toISOString(), replacedAt: '', status: 'shipped', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
        })
      } catch (error) {
        return fail(422, error instanceof Error ? error.message : '库存扣减失败', null)
      }
      database.notify('物料已发货', `${record.code} · ${courier.name} · ${payload.trackingNo}`, record)
    }
    if (actionKey === 'test') {
      database.create('external-call-logs', { code: `EXT-${Date.now().toString().slice(-8)}`, name: '快递100轨迹测试', category: '物流接口', provider: '快递100', requestRef: payload.trackingNo, responseTime: 286, result: 'simulated_success', resultLabel: '静态模拟成功', status: 'completed', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
    }
    if (actionKey === 'permissions') {
      const permissions = Array.isArray(payload.permissions) ? payload.permissions.map(String).filter((item) => item.includes(':')) : []
      Object.assign(patch, { permissionUpdatedAt: new Date().toISOString(), permissions, permissionCount: permissions.length })
    }
    if (actionKey === 'process') {
      if (moduleKey === 'sn-replacement') {
        const original = visibleRecords('devices').find((item) => item.code === record.originalSN)
        if (!original) return fail(403, '原 SN 不存在或不属于当前经销商数据范围', null)
        const archivedSN = `${original.code}-1`
        if (database.records('devices').some((item) => item.id !== original.id && [archivedSN, record.newSN].includes(item.code))) return fail(409, '归档 SN 或新 SN 已存在', null)
        const oldAccount = String(original.account || '-')
        database.transaction(() => {
          database.update('devices', original.id, { code: archivedSN, account: '-', bindingStatus: 'unbound' })
          const replacement = database.create('devices', { code: String(record.newSN), name: original.name, region: original.region, country: original.country, firmware: original.firmware, activation: original.activation, activationDate: original.activationDate, account: oldAccount, bindingStatus: 'bound', boundAt: new Date().toISOString(), status: 'online', owner: original.owner, ownerId: original.ownerId, domain: original.domain })
          createRelation('ownership-history', replacement, { deviceId: replacement.id, deviceSN: replacement.code, fromOwner: '换机备件', toOwner: replacement.owner, operationType: '换 SN', operator: auth.session!.displayName, status: 'completed' })
          database.records('projects').filter((item) => item.deviceSN === original.code).forEach((item) => database.update('projects', item.id, { deviceSN: replacement.code, deviceModel: replacement.name }))
          database.records('waypoints').filter((item) => item.deviceSN === original.code).forEach((item) => database.update('waypoints', item.id, { deviceSN: replacement.code }))
        })
        patch.status = 'completed'
      } else if (moduleKey === 'service-transfer') {
        try {
          const outcome = database.transaction(() => advanceConfiguredApproval(record, payload.decision === 'rejected' ? 'reject' : 'approve', payload.reason))
          Object.assign(patch, outcome.patch)
          if (outcome.final && outcome.approved) database.transaction(() => transferDeviceDealer(record))
        } catch (error) { return fail(422, error instanceof Error ? error.message : '转移失败', null) }
        if (patch.status === 'completed') {
          database.notify('售后责任已转入', `${record.code} · ${record.deviceSN}`, { ...record, owner: String(record.targetDealer || ''), ownerId: String(record.targetDealerId) })
        } else if (patch.status === 'rejected') database.notify('售后转移已拒绝', `${record.code} · ${String(payload.reason || '')}`, record, 'risk')
        else database.notify('售后转移审批已推进', `${record.code} · 下一节点：${String(patch.currentApproverName || '')}`, record)
      } else if (moduleKey === 'issuance') {
        patch.status = String(payload.nextStatus || (record.status === 'shipped' ? 'received' : 'completed'))
        if (patch.status === 'completed') patch.replacedAt = new Date().toISOString()
      } else if (moduleKey === 'warehouse') {
        const validDecisions = record.category === '调货' ? ['approved', 'rejected'] : ['outbound', 'rejected']
        if (!validDecisions.includes(String(payload.decision))) return fail(422, `请选择有效的${record.category === '调货' ? '审批' : '出库'}结果`, null)
        if (record.category === '调货') {
          try {
            const outcome = database.transaction(() => advanceConfiguredApproval(record, payload.decision === 'rejected' ? 'reject' : 'approve', payload.reason))
            Object.assign(patch, outcome.patch)
            if (outcome.final && outcome.approved) database.transaction(() => transferDevices(record, record.targetDealerId, '库存调货'))
          } catch (error) { return fail(422, error instanceof Error ? error.message : '调货审批失败', null) }
        } else {
          patch.status = payload.decision === 'rejected' ? 'rejected' : 'completed'
          if (patch.status === 'completed') {
            try { database.transaction(() => transferDevices(record, record.targetDealerId, '设备出库')) } catch (error) { return fail(422, error instanceof Error ? error.message : '设备归属更新失败', null) }
          }
        }
        database.notify(patch.status === 'completed' ? `${record.category}已完成` : `${record.category}申请已拒绝`, `${record.code} · ${String(payload.reason || '')}`, record, patch.status === 'completed' ? 'info' : 'risk')
      } else patch.status = record.status === 'pending' ? 'processing' : 'completed'
    }

    const updated = database.update(moduleKey, id, patch) || record
    if (actionKey === 'approve' && moduleKey === 'dealers') createAccount(updated, { ...updated, initialPassword: updated.initialPassword || 'Dealer123!' }, 'dealer')
    createRelation('workflow-events', updated, { sourceModule: moduleKey, title: actionConfig?.label || actionKey, content: String(payload.reason || payload.result || payload.replyContent || '操作已完成'), operator: auth.session!.displayName, status: 'completed' })
    const risk = ['remote-disable', 'remote-enable', 'unbind', 'reset-password', 'publish', 'approve', 'reject', 'escalate', 'process', 'change-region'].includes(actionKey)
    database.audit(actionConfig?.label || `执行${actionKey}`, `${record.code}${payload.reason ? ` · ${payload.reason}` : ''}`, auth.session!.displayName, risk, record)
    if (actionKey === 'permissions' || accountFor(moduleKey, record)?.id === auth.session?.accountId) auth.refreshSession()
    return ok(updated, `${actionConfig?.label || '操作'}已完成`)
  },
  async count(moduleKey: string, status?: string) {
    if (!hasPermission(useAuthStore().permissions, `${moduleKey}:view`)) return 0
    const rows = visibleRecords(moduleKey)
    if (moduleKey === 'devices' && status === 'bound') return rows.filter((item) => item.bindingStatus === 'bound').length
    if (moduleKey === 'dealers' && status === 'active') return rows.filter((item) => item.status === 'normal' && item.category !== '注册申请').length
    return status ? rows.filter((item) => item.status === status).length : rows.length
  },
}

export type DynamicOption = Awaited<ReturnType<typeof mockService.options>>['data'][number]
export type DynamicField = FieldConfig
