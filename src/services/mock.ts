import { moduleConfigs } from '@/config/modules'
import { deviceCatalog, deviceIdentity } from '@/config/device-catalog'
import { actionPermission, hasActionPermission, hasPermission } from '@/config/permissions'
import { dealerRegionOptions } from '@/config/region-catalog'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'
import { relatedNavigationCandidates } from '@/services/related-navigation'
import { deviceMatchesUser } from '@/services/relation-matching'
import type { ApiResult, EntityRecord, FieldConfig, PageQuery, RelatedNavigationItem, TableDataInfo, UserSession } from '@/types'

const sleep = (ms = 25) => new Promise((resolve) => window.setTimeout(resolve, ms))
const ok = <T>(data: T, msg = '操作成功'): ApiResult<T> => ({ code: 200, msg, data })
const fail = <T>(code: number, msg: string, data: T): ApiResult<T> => ({ code, msg, data })
const businessCodePrefixes: Record<string, string> = {
  projects: 'PRJ', warehouse: 'WH', materials: 'MAT', 'service-transfer': 'AST',
  warehouses: 'WHS', 'warehouse-locations': 'LOC',
  'approval-flow': 'APF', 'material-catalog': 'MTR', couriers: 'EXP', banners: 'BAN',
  'installation-transfers': 'IRT', 'faq-documents': 'FAQ', 'support-settings': 'SUP', 'after-sales-types': 'SAT',
  admins: 'ADM', roles: 'ROL', dealers: 'DLR', ota: 'OTA',
}
const approvalMenuLabels: Record<string, string> = {
  materials: '物料采购',
  warehouse: '仓库设备（调货审批）',
  'service-transfer': '售后转移（费用审批）',
}
const specialExportTitles: Record<string, string> = {
  'payment-settings': '支付配置',
  'launch-settings': 'APP 启动页配置',
}

function canonicalModuleKey(moduleKey: string) {
  return ['purchase-shipping', 'product-purchase'].includes(moduleKey) ? 'materials' : moduleKey
}

function configuredApprovalIds(flow: EntityRecord | undefined) {
  if (!flow) return []
  if (flow.levels === '平台直接审核') return [flow.platformApproverId].filter(Boolean).map(String)
  if (flow.levels === '一级 → 平台') return [flow.level1ApproverId, flow.platformApproverId].filter(Boolean).map(String)
  return [flow.level1ApproverId, flow.level2ApproverId, flow.platformApproverId].filter(Boolean).map(String)
}

function approvalRoleRank(roleKey: unknown) {
  if (roleKey === 'tier2') return 1
  if (roleKey === 'tier1') return 2
  return 3
}

function approversAfterInitiator(approvers: EntityRecord[], initiatorRole: unknown) {
  const initiatorRank = approvalRoleRank(initiatorRole)
  return approvers.filter((approver) => approvalRoleRank(approver.roleKey) > initiatorRank)
}

function includes(value: unknown, keyword: string) {
  return String(value ?? '').toLocaleLowerCase('zh-CN').includes(keyword.toLocaleLowerCase('zh-CN'))
}

function generateBusinessCode(moduleKey: string, payload: Partial<EntityRecord>) {
  if (moduleKey === 'devices') return String(payload.code || '')
  const database = useDatabaseStore()
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const warehousePrefix = payload.category === '出库' ? 'OUT' : payload.category === '调货' ? 'TRF' : 'IN'
  const prefix = moduleKey === 'warehouse' ? warehousePrefix : moduleKey === 'materials' && payload.category === '设备采购' ? 'PUR' : businessCodePrefixes[moduleKey] || moduleKey.slice(0, 3).toUpperCase()
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
  moduleKey = canonicalModuleKey(moduleKey)
  const auth = useAuthStore()
  const session = auth.session
  if (!session) return { allowed: false, reason: '登录状态已失效', code: 401 }
  if (moduleKey === 'warehouse' && ['confirm-outbound', 'reject-outbound'].includes(actionKey)) {
    if (!hasActionPermission(auth.permissions, moduleKey, 'process')) return { allowed: false, reason: '缺少权限：warehouse:process', code: 403 }
    if (!isVisibleRecord(moduleKey, record)) return { allowed: false, reason: '记录不存在或超出当前数据范围', code: 403 }
    if (record.category !== '出库') return { allowed: false, reason: '该固定操作仅适用于设备出库单', code: 409 }
    if (!['pending', 'processing'].includes(String(record.status))) return { allowed: false, reason: '当前出库单已经处理', code: 409 }
    return { allowed: true, reason: '', code: 200 }
  }
  if (moduleKey === 'approval-center' && ['approve-original', 'reject-original'].includes(actionKey)) {
    if (record.status !== 'pending') return { allowed: false, reason: '当前审批不属于本账号或已经处理', code: 409 }
    const sourceModule = String(record.sourceModule || record.menuKey || '')
    if (!['materials', 'warehouse'].includes(sourceModule)) return { allowed: false, reason: '该审批需在原业务单填写完整业务字段', code: 409 }
    const source = useDatabaseStore().records(sourceModule).find((item) => item.id === record.subjectId)
    if (!source) return { allowed: false, reason: '原业务单不存在', code: 404 }
    return actionDecision(sourceModule, source, sourceModule === 'materials' ? actionKey === 'approve-original' ? 'approve' : 'reject' : 'process')
  }
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
    if (record.category === '设备采购' && !['sales_confirmation', 'rd_confirmation'].includes(String(record.purchaseStage))) return { allowed: false, reason: '当前采购单不在销售或研发确认节点', code: 409 }
    const allowed = record.currentApproverId === session.accountId
    return { allowed, reason: allowed ? '' : `当前审批人为${record.currentApproverName || '其他账号'}`, code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'materials' && actionKey === 'ship' && record.category === '设备采购') return { allowed: false, reason: '设备采购不走物料发货流程', code: 409 }
  if (moduleKey === 'materials' && ['finance-confirm', 'record-expense'].includes(actionKey)) {
    if (record.category !== '设备采购') return { allowed: false, reason: '只有设备采购申请可以执行财务确认', code: 409 }
    if (!['finance_confirmation', 'warehouse_fulfillment'].includes(String(record.purchaseStage))) return { allowed: false, reason: '当前采购单未进入财务核实或仓库处理节点', code: 409 }
    const allowed = ['platform', 'custom'].includes(session.role)
    return { allowed, reason: allowed ? '' : '财务确认只能由平台或总部人员操作', code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'materials' && actionKey === 'start-production') {
    if (record.category !== '设备采购' || record.purchaseStage !== 'production') return { allowed: false, reason: '当前采购单未进入导入生产节点', code: 409 }
    const allowed = ['platform', 'custom'].includes(session.role)
    return { allowed, reason: allowed ? '' : '导入生产只能由平台或总部人员操作', code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'materials' && actionKey === 'purchase-ship') {
    if (record.category !== '设备采购') return { allowed: false, reason: '只有设备采购申请可以执行仓库发货', code: 409 }
    if (record.purchaseStage !== 'warehouse_fulfillment') return { allowed: false, reason: '当前采购单未进入仓库发货节点', code: 409 }
    const allowed = ['platform', 'custom'].includes(session.role)
    return { allowed, reason: allowed ? '' : '仓库发货只能由平台或总部人员操作', code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'materials' && actionKey === 'confirm-purchase-receipt') {
    if (record.category !== '设备采购' || record.purchaseStage !== 'shipped') return { allowed: false, reason: '当前采购单未进入待收货节点', code: 409 }
    const allowed = ['platform', 'custom'].includes(session.role) || record.ownerId === session.ownerId
    return { allowed, reason: allowed ? '' : '只有采购方或总部人员可以确认收货', code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'payments' && ['record-payment', 'finance-verify'].includes(actionKey)) {
    const allowed = ['platform', 'custom'].includes(session.role)
    return { allowed, reason: allowed ? '' : '付款核实只能由平台或财务人员操作', code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'cross-region-activations' && actionKey === 'resolve') {
    const allowed = ['platform', 'custom'].includes(session.role)
    return { allowed, reason: allowed ? '' : '跨区域异常只能由平台或总部人员处理', code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'issuance' && actionKey === 'confirm-receipt') {
    const allowed = ['platform', 'custom'].includes(session.role) || record.ownerId === session.ownerId
    return { allowed, reason: allowed ? '' : '只有发放对象或总部人员可以确认收货', code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'repairs' && actionKey === 'record-bill') {
    if (record.billingPaymentId) return { allowed: false, reason: '该报修单已经登记维修账单', code: 409 }
    const allowed = ['platform', 'custom'].includes(session.role)
    return { allowed, reason: allowed ? '' : '维修账单只能由平台或总部人员登记', code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'warehouse' && actionKey === 'process' && record.category === '调货') {
    const allowed = record.currentApproverId === session.accountId
    return { allowed, reason: allowed ? '' : `当前审批人为${record.currentApproverName || '其他账号'}`, code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'service-transfer' && ['process', 'confirm-transfer', 'approve-transfer-fee', 'reject-transfer-fee'].includes(actionKey)) {
    if (actionKey === 'confirm-transfer' && record.approvalStage !== 'target_confirmation') return { allowed: false, reason: '当前不在目标经销商确认阶段', code: 409 }
    if (['approve-transfer-fee', 'reject-transfer-fee'].includes(actionKey)) {
      if (!record.hasFee || record.approvalStage !== 'fee_approval') return { allowed: false, reason: '当前没有待总部审批的费用', code: 409 }
      if (!['platform', 'custom'].includes(session.role)) return { allowed: false, reason: '费用审批仅限总部账号', code: 403 }
    }
    const allowed = record.currentApproverId === session.accountId
    return { allowed, reason: allowed ? '' : `当前处理人为${record.currentApproverName || '其他账号'}`, code: allowed ? 200 : 403 }
  }
  if (moduleKey === 'installation-transfers' && actionKey === 'process') {
    const allowed = session.role === 'platform'
    return { allowed, reason: allowed ? '' : '安装跨区审核仅限平台管理员', code: allowed ? 200 : 403 }
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
  const allowedModules = new Set(['dealers', 'projects', 'devices', 'product-catalog', 'warehouses', 'warehouse-locations', 'app-versions', 'warehouse', 'ota', 'materials', 'product-purchase', 'material-catalog', 'couriers', 'sn-replacement', 'service-transfer', 'warranty', 'banners', 'faq-documents', 'support-settings', 'after-sales-types', 'admins', 'payment-settings'])
  if (!allowedModules.has(moduleKey)) return { allowed: false, reason: 'V3.2 未定义该模块的新增操作' }
  const required = `${moduleKey}:create`
  return hasPermission(auth.permissions, required) ? { allowed: true, reason: '' } : { allowed: false, reason: `缺少权限：${required}` }
}

const editableModules = new Set([
  'dealers', 'projects', 'product-catalog', 'warehouses', 'warehouse-locations', 'app-versions', 'material-catalog', 'couriers', 'warranty',
  'approval-flow', 'banners', 'faq-documents', 'support-settings', 'after-sales-types', 'admins', 'payment-settings',
])

function configuredFields(moduleKey: string, payload: Partial<EntityRecord>) {
  const config = moduleConfigs[moduleKey]
  if (!config) return []
  if (moduleKey === 'warehouse') {
    const tab = payload.category === '出库' ? 'outbound' : payload.category === '调货' ? 'transfer' : 'stock'
    return config.tabFields?.[tab] || config.fields
  }
  if (moduleKey === 'materials' && payload.category === '设备采购') return config.tabFields?.purchase || config.fields
  return config.fields
}

function validateConfiguredFields(moduleKey: string, payload: Partial<EntityRecord>, creating: boolean) {
  for (const field of configuredFields(moduleKey, payload)) {
    if (field.visibleWhen) {
      const current = payload[field.visibleWhen.field]
      const visible = field.visibleWhen.values ? field.visibleWhen.values.includes(current as never) : current === field.visibleWhen.value
      if (!visible) continue
    }
    if (!field.required && !(creating && field.requiredOnCreate)) continue
    const value = payload[field.field]
    const sensitiveValue = field.sensitive ? payload[`${field.field}Masked`] : undefined
    const missing = Array.isArray(value)
      ? value.length === 0
      : value === undefined || value === null || String(value).trim() === ''
    const sensitiveMissing = sensitiveValue === undefined || sensitiveValue === null || String(sensitiveValue).trim() === ''
    if (missing && (!field.sensitive || sensitiveMissing)) return `请填写${field.label}`
    if (field.type === 'lineItems' && Array.isArray(value) && value.some((item) => !item || typeof item !== 'object' || !String((item as Record<string, unknown>).itemKey || '').trim() || Number((item as Record<string, unknown>).quantity || 0) < 1 || Number((item as Record<string, unknown>).unitPrice || 0) <= 0)) return `${field.label}中的设备/物料、数量和单价必须完整有效`
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

function approvalCenterRecords() {
  const database = useDatabaseStore()
  const session = useAuthStore().session
  if (!session) return []
  return database.records('approval-instances').map((instance) => {
    const sourceModule = String(instance.sourceModule || instance.menuKey || '')
    const subject = database.records(sourceModule).find((item) => item.id === instance.subjectId)
    const steps = database.records('approval-steps').filter((item) => item.instanceId === instance.id).sort((left, right) => Number(left.sequence) - Number(right.sequence))
    const current = steps.find((item) => item.status === 'pending')
    const actualStatus = String(instance.status || subject?.status || 'pending')
    const status = actualStatus === 'pending' && current?.approverAccountId !== session.accountId ? 'waiting' : actualStatus
    return {
      ...instance,
      id: instance.id,
      code: instance.code,
      subjectId: instance.subjectId,
      subjectCode: instance.subjectCode || subject?.code || '-',
      name: subject?.name || instance.name,
      category: subject?.category || instance.menuLabel,
      initiatedBy: subject?.initiatedBy || subject?.dealer || subject?.owner || '-',
      initiatedAt: subject?.initiatedAt || subject?.applyTime || subject?.createdAt,
      amount: subject?.amount || subject?.estimatedFee || 0,
      contractStatus: subject?.contractStatus || '-',
      deliveryStatus: subject?.deliveryStatus || '-',
      currentApproverName: current?.approverName || '-',
      currentApproverAccountId: current?.approverAccountId || '',
      currentStepLabel: current ? `第 ${current.sequence}/${steps.length} 级 · ${current.name}` : actualStatus === 'approved' ? '审批完成' : actualStatus === 'rejected' ? '已拒绝' : '等待后续业务',
      status,
      actualStatus,
      updatedAt: current?.updatedAt || instance.updatedAt,
      owner: subject?.owner || instance.owner,
      ownerId: subject?.ownerId || instance.ownerId,
      domain: subject?.domain || instance.domain,
    } as EntityRecord
  })
}

function visibleRecords(moduleKey: string) {
  const database = useDatabaseStore()
  const session = useAuthStore().session
  if (!session) return []
  const sourceModuleKey = canonicalModuleKey(moduleKey)
  let records = sourceModuleKey === 'approval-center' ? approvalCenterRecords() : [...database.records(sourceModuleKey)]
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

function deviceRecordsFor(record: EntityRecord) {
  const devices = useDatabaseStore().records('devices')
  const selectedSNs = Array.isArray(record.selectedDevices)
    ? record.selectedDevices.map(String)
    : String(record.deviceSN || '').split(/[、,，]/).map((item) => item.trim()).filter((item) => item && item !== '-')
  const matches = devices.filter((device) =>
    device.id === record.deviceId
    || device.id === record.id
    || selectedSNs.includes(String(device.code))
    || (!selectedSNs.length && device.code === record.code),
  )
  return [...new Map(matches.map((device) => [device.id, device])).values()]
}

function withDeviceIdentity(record: EntityRecord): EntityRecord {
  const devices = deviceRecordsFor(record)
  if (!devices.length) return { ...record }
  const unique = (field: string) => [...new Set(devices.map((device) => String(device[field] || '-')))].join('、')
  return {
    ...record,
    deviceId: devices.length === 1 ? devices[0].id : record.deviceId,
    deviceName: unique('deviceName'),
    deviceType: unique('deviceType'),
    deviceModel: unique('deviceModel'),
    specification: unique('specification'),
  }
}

function forDisplay(moduleKey: string, record: EntityRecord) {
  const masked = withDeviceIdentity(record)
  const database = useDatabaseStore()
  if (moduleKey === 'users') masked.deviceCount = visibleRecords('devices').filter((item) => deviceMatchesUser(item, record)).length
  if (moduleKey === 'dealers') masked.deviceCount = visibleRecords('devices').filter((item) => item.ownerId === String(record.organizationId || record.ownerId)).length
  if (moduleKey === 'ownership-history') {
    const device = database.records('devices').find((item) => item.id === record.deviceId || item.code === record.deviceSN)
    masked.currentOwner = device?.owner || '-'
  }
  const headquarters = ['platform', 'custom'].includes(String(useAuthStore().session?.role || ''))
  if (!headquarters && ['devices', 'warehouse', 'ownership-history', 'stock-movements'].includes(moduleKey)) {
    for (const field of ['warehouseId', 'warehouseName', 'warehouseLocationId', 'warehouseLocation', 'manufacturedAt', 'productionAt', 'inboundAt', 'outboundAt', 'storageDays']) delete masked[field]
    if (moduleKey === 'ownership-history') {
      if (String(masked.fromOwner || '').includes('中心仓')) masked.fromOwner = '平台仓储'
      if (String(masked.toOwner || '').includes('中心仓')) masked.toOwner = '平台仓储'
    }
  }
  if (['devices', 'repairs', 'messages', 'complaints'].includes(moduleKey)) {
    if (masked.account) masked.account = maskContact(masked.account)
    if (masked.contact) masked.contact = maskContact(masked.contact)
  }
  if (!['users', 'dealers', 'payments'].includes(moduleKey)) return masked
  for (const field of ['account', 'phone', 'email', 'contact']) if (masked[field]) masked[field] = maskContact(masked[field])
  return masked
}

function forExport(moduleKey: string, record: EntityRecord) {
  const exported = forDisplay(moduleKey, record)
  for (const field of ['password', 'initialPassword', 'apiKey', 'apiKeyMasked', 'pdfData', 'image', 'qrCodeData', 'paymentProof', 'shipmentPhoto', 'receiptPhoto', 'permissions']) delete exported[field]
  return exported
}

function activeFilters(moduleKey: string, tabKey?: string) {
  const config = moduleConfigs[moduleKey]
  return config?.tabFilters?.[String(tabKey || '')] || config?.filters || []
}

function filterRows(moduleKey: string, source: EntityRecord[], query: PageQuery) {
  const config = moduleConfigs[moduleKey]
  let rows = source
  if (moduleKey === 'materials') rows = rows.filter((item) => item.category !== '设备采购')
  if (['product-purchase', 'purchase-shipping'].includes(moduleKey)) rows = rows.filter((item) => item.category === '设备采购')
  if (query.tab && config) {
    const tab = config.tabs.find((item) => item.key === query.tab)
    if (tab?.field && tab.value) rows = rows.filter((item) => String(item[tab.field!]) === tab.value)
    if (tab?.field && tab.values?.length) rows = rows.filter((item) => tab.values!.includes(String(item[tab.field!])))
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
  for (const [field, rawValue] of Object.entries(query.relationFilters || {})) {
    const values = (Array.isArray(rawValue) ? rawValue : [rawValue]).map(String).filter(Boolean)
    if (!values.length) continue
    rows = rows.filter((item) => values.includes(String(item[field] ?? '')))
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

function recordPlatformBill(subject: EntityRecord, expense: EntityRecord, sourceModule: 'materials' | 'service-transfer') {
  const database = useDatabaseStore()
  const payload: Partial<EntityRecord> = {
    code: `BILL-${Date.now().toString().slice(-11)}`,
    name: expense.name,
    category: '平台费用账单',
    sourceType: 'platform',
    sourceLabel: '平台费用登记',
    businessType: expense.category,
    channel: '二维码支付',
    paymentInstruction: '扫描订单对应的供应商收款二维码，付款后上传截图；金额与订单由财务人工核实。',
    amount: Number(expense.amount || 0),
    orderAmount: Number(expense.amount || 0),
    paidAmount: Number(expense.amount || 0),
    remainingAmount: 0,
    paymentCount: 1,
    currency: expense.currency || 'CNY',
    account: subject.dealer || subject.owner || '平台业务',
    paidAt: expense.paidAt || expense.createdAt,
    paymentReference: expense.paymentReference || '',
    expenseRecordId: expense.id,
    subjectId: subject.id,
    subjectCode: subject.code,
    subjectModule: sourceModule,
    recordedBy: expense.operator || useAuthStore().session?.displayName || '平台账单中心',
    paymentProof: expense.paymentProof || '',
    orderRole: 'parent',
    status: 'verified',
    owner: subject.owner,
    ownerId: subject.ownerId,
    domain: subject.domain,
  }
  const existing = database.records('payments').find((item) => item.expenseRecordId === expense.id)
  const payment = existing ? database.update('payments', existing.id, payload)! : database.create('payments', payload)
  const parentOrderCode = String(payment.code)
  database.update('payments', payment.id, { parentOrderCode, lastChildOrderCode: `${parentOrderCode}-P01` })
  if (!database.records('payment-transactions').some((item) => item.paymentId === payment.id)) {
    database.create('payment-transactions', {
      code: `${parentOrderCode}-P01`, childOrderCode: `${parentOrderCode}-P01`, name: `${payment.name}第 1 笔付款`,
      paymentId: payment.id, parentPaymentId: payment.id, parentOrderCode, installmentNo: 1, installmentLabel: '第 1 笔付款',
      subjectId: subject.id, subjectCode: subject.code, orderAmount: Number(expense.amount || 0), previousPaidAmount: 0,
      amount: Number(expense.amount || 0), currentPaymentAmount: Number(expense.amount || 0),
      paidAmountAfter: Number(expense.amount || 0), remainingAmountAfter: 0,
      channel: '二维码支付', paymentReference: expense.paymentReference || '', paymentProof: expense.paymentProof || '',
      paidAt: expense.paidAt || expense.createdAt, operator: expense.operator || useAuthStore().session?.displayName || '平台账单中心',
      verifiedAt: expense.paidAt || expense.createdAt, verifiedBy: expense.operator || useAuthStore().session?.displayName || '平台账单中心',
      status: 'verified', owner: subject.owner, ownerId: subject.ownerId, domain: subject.domain,
    })
  }
  database.records('billing-items').filter((item) => item.paymentId === payment.id).forEach((item) => database.remove('billing-items', item.id))
  const purchaseItems = sourceModule === 'materials'
    ? database.records('purchase-items').filter((item) => item.subjectId === subject.id)
    : []
  const sourceItems = purchaseItems.length ? purchaseItems : [{
    name: expense.name,
    itemName: expense.name,
    itemType: sourceModule === 'service-transfer' ? '服务' : '费用',
    quantity: 1,
    unitPrice: Number(expense.amount || 0),
    subtotal: Number(expense.amount || 0),
  }]
  const sourceTotal = sourceItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
  sourceItems.forEach((item, index) => database.create('billing-items', {
    name: String(item.itemName || item.name || '费用项目'), paymentId: payment.id,
    subjectId: subject.id, subjectCode: subject.code,
    feeType: item.itemType === '物料' ? '物料费' : item.itemType === '设备' ? '设备采购费' : sourceModule === 'service-transfer' ? '服务费' : '订单费用',
    itemName: item.itemName || item.name, quantity: Number(item.quantity || 1),
    unitPrice: Number(item.unitPrice || 0), subtotal: Number(item.subtotal || 0),
    adjustment: index === sourceItems.length - 1 ? Math.round((Number(payment.amount || 0) - sourceTotal) * 100) / 100 : 0,
    status: payment.status, owner: payment.owner, ownerId: payment.ownerId, domain: payment.domain,
  }))
  return payment
}

function subjectLogs(record: EntityRecord) {
  return visibleRecords('logs').filter((item) => item.subjectId === record.id || item.subjectCode === record.code || includes(item.content, record.code) || (record.account && includes(item.content, String(record.account))))
}

function serviceRecords(record: EntityRecord) {
  return ['repairs', 'complaints', 'materials'].flatMap((key) => visibleRecords(key)).filter((item) => item.deviceSN === record.deviceSN || item.deviceSN === record.code)
}

function relatedRecords(record: EntityRecord, source = ''): EntityRecord[] {
  if (source === 'user-devices') return visibleRecords('devices').filter((item) => deviceMatchesUser(item, record))
  if (source === 'waypoints') {
    return visibleRecords('waypoints')
      .filter((item) => item.userId === record.id && item.serverSaved === true && item.storageMode === 'server' && item.adminVisible !== false)
      .sort((a, b) => String(b.recordedAt || b.createdAt).localeCompare(String(a.recordedAt || a.createdAt)))
  }
  if (source === 'subject-logs' || source === 'logs') return subjectLogs(record)
  if (source === 'ownership-history') return visibleRecords('ownership-history').filter((item) => item.deviceId === record.id || item.deviceSN === record.code)
  if (source === 'device-components') return visibleRecords('device-components').filter((item) => item.deviceId === record.id || item.deviceSN === record.code)
  if (source === 'firmware-history') return visibleRecords('firmware-history').filter((item) => item.deviceId === record.id || item.deviceSN === record.code)
  if (source === 'price-history') return visibleRecords('price-history').filter((item) => item.productId === record.id)
  if (source === 'warranty-history') return visibleRecords('warranty-history').filter((item) => item.ruleId === record.id)
  if (source === 'ota-results') return visibleRecords('ota-results').filter((item) => item.firmwareId === record.id)
  if (source === 'ota-rollbacks') return visibleRecords('ota-rollbacks').filter((item) => item.firmwareId === record.id)
  if (source === 'replacement-records') return visibleRecords('replacement-records').filter((item) => item.issuanceId === record.id)
  if (source === 'purchase-items') return visibleRecords('purchase-items').filter((item) => item.subjectId === record.id)
  if (source === 'purchase-fulfillments') return visibleRecords('purchase-fulfillments').filter((item) => item.subjectId === record.id)
  if (source === 'warehouse-locations') return visibleRecords('warehouse-locations').filter((item) => item.warehouseId === record.id)
  if (source === 'approval-center-steps') return visibleRecords('approval-steps').filter((item) => item.instanceId === record.id).sort((left, right) => Number(left.sequence) - Number(right.sequence))
  if (source === 'billing-items') return visibleRecords('billing-items').filter((item) => item.paymentId === record.id || item.subjectId === record.id)
  if (source === 'payment-transactions') return visibleRecords('payment-transactions').filter((item) => item.paymentId === record.id || item.parentPaymentId === record.id).sort((left, right) => Number(right.installmentNo || 0) - Number(left.installmentNo || 0) || String(right.paidAt || '').localeCompare(String(left.paidAt || '')))
  if (source === 'device-service' || source === 'project-service') return serviceRecords(record)
  if (source === 'dealer-devices') return visibleRecords('devices').filter((item) => item.ownerId === record.organizationId || item.ownerId === record.ownerId)
  if (source === 'dealer-service') return ['repairs', 'messages', 'complaints', 'materials', 'sn-replacement', 'service-transfer', 'issuance'].flatMap((key) => visibleRecords(key)).filter((item) => item.ownerId === record.organizationId || item.ownerId === record.ownerId || item.dealerId === record.organizationId || item.dealerId === record.ownerId || item.sourceDealerId === record.organizationId || item.sourceDealerId === record.ownerId || item.targetDealerId === record.organizationId || item.targetDealerId === record.ownerId)
  if (source === 'dealer-accounts') return visibleRecords('admins').filter((item) => item.ownerId === record.organizationId || item.ownerId === record.ownerId)
  if (source === 'project-devices') return visibleRecords('devices').filter((item) => item.code === record.deviceSN)
  if (source === 'project-history') return visibleRecords('project-history').filter((item) => item.projectId === record.id || item.projectCode === record.code).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  if (source === 'project-warranty') {
    const device = useDatabaseStore().records('devices').find((item) => item.code === record.deviceSN)
    return [{ ...record, id: `${record.id}-warranty`, code: String(record.deviceSN || record.code), productType: device?.name || record.deviceModel, dealer: record.owner, warrantyUntil: record.warrantyUntil }]
  }
  if (source === 'warehouse-devices') {
    const selected = Array.isArray(record.selectedDevices) ? record.selectedDevices.map(String) : String(record.deviceSN || '').split(/[、,]/).filter(Boolean)
    return visibleRecords('devices').filter((item) => selected.includes(item.code))
  }
  if (source === 'ota-devices') return visibleRecords('devices').filter((item) => otaMatchesDevice(record, item))
  if (source === 'workflow-events') return visibleRecords('workflow-events').filter((item) => item.subjectId === record.id)
  if (source === 'approval-steps') return visibleRecords('approval-steps').filter((item) => item.subjectId === record.id).sort((left, right) => Number(left.sequence) - Number(right.sequence))
  if (source === 'replies') return visibleRecords('replies').filter((item) => item.subjectId === record.id)
  if (source === 'logistics-records') return visibleRecords('logistics-records').filter((item) => item.subjectId === record.id)
  if (source === 'expense-records') return visibleRecords('expense-records').filter((item) => item.subjectId === record.id)
  if (source === 'role-permissions' && Array.isArray(record.permissions)) return record.permissions.map((permission, index) => ({ ...record, id: `${record.id}-permission-${index}`, code: String(permission), name: String(permission), category: String(permission).endsWith('view') ? '菜单访问' : '业务操作' }))
  return []
}

function option(label: unknown, value: unknown) {
  return { label: String(label), value: String(value) }
}

function uniqueOptions(items: Array<{ label: string; value: string }>) {
  return [...new Map(items.map((item) => [item.value, item])).values()]
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))] : []
}

function otaMatchesDevice(firmware: EntityRecord, device: EntityRecord) {
  const productNames = stringArray(firmware.applicableProductNames)
  const deviceTypes = stringArray(firmware.applicableDeviceTypes)
  const deviceModels = stringArray(firmware.applicableDeviceModels)
  const identity = deviceIdentity(device.name)
  const productName = String(device.deviceName || identity.deviceName)
  const deviceType = String(device.deviceType || identity.deviceType)
  const deviceModel = String(device.deviceModel || identity.deviceModel)
  return (!productNames.length || productNames.includes(productName))
    && (!deviceTypes.length || deviceTypes.includes(deviceType))
    && (!deviceModels.length || deviceModels.includes(deviceModel))
}

function resolveDealer(value: unknown) {
  return useDatabaseStore().records('dealers').find((item) => item.id === value || item.organizationId === value || item.ownerId === value || item.name === value)
}

function activeWarrantyRule(device: EntityRecord) {
  const database = useDatabaseStore()
  const today = new Date().toISOString().slice(0, 10)
  const market = device.domain === 'global' ? '海外' : '国内'
  return database.records('warranty')
    .filter((item) => (item.productType === device.name || item.category === device.name)
      && String(item.dealerId || item.ownerId) === String(device.ownerId)
      && item.status === 'normal'
      && (!item.market || item.market === market)
      && (!item.effectiveFrom || String(item.effectiveFrom) <= today)
      && (!item.effectiveTo || String(item.effectiveTo) >= today))
    .sort((left, right) => String(right.effectiveFrom || '').localeCompare(String(left.effectiveFrom || '')))[0]
}

function warrantyMonthsForDevice(device: EntityRecord, kind: 'labor' | 'material' = 'material') {
  const rule = activeWarrantyRule(device)
  const configuredMonths = Number(kind === 'labor' ? rule?.laborMonths : rule?.materialMonths)
  if (configuredMonths > 0) return configuredMonths
  const dealer = resolveDealer(device.ownerId)
  return Math.max(1, Number(dealer?.defaultWarrantyYears || (device.domain === 'cn' ? 2 : 1))) * 12
}

function warrantyStartForDevice(device: EntityRecord, project?: Partial<EntityRecord>) {
  const rule = activeWarrantyRule(device)
  const startPoint = String(rule?.warrantyStartPoint || '设备激活日')
  if (startPoint === '安装验收日') return String(project?.installationAcceptedAt || device.installationAcceptedAt || '')
  if (startPoint.includes('出库')) return String(device.outboundAt || '')
  if (device.activation !== 'activated' && !device.activationDate) return ''
  return String(device.activationDate || '')
}

function warrantyEvaluation(device: EntityRecord | undefined, project?: Partial<EntityRecord>) {
  if (!device) return { result: '未找到设备', startDate: '', endDate: '' }
  const startDate = warrantyStartForDevice(device, project)
  if (!startDate) return { result: device.activation === 'inactive' ? '设备未激活，无法校验' : '缺少质保起算日期', startDate: '', endDate: '' }
  const endDate = addMonthsIso(startDate, warrantyMonthsForDevice(device))
  if (!endDate) return { result: '质保日期配置无效', startDate, endDate: '' }
  const expired = new Date(`${endDate}T23:59:59.999Z`) < new Date()
  return { result: expired ? '已过期，需自费' : '质保有效', startDate, endDate }
}

function addMonthsIso(value: unknown, months: number) {
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 10)
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
    capabilities: [subjectType],
    subjectLinks: [{ subjectType, subjectId: record.id }],
    status: record.status === 'disabled' ? 'disabled' : 'normal',
  })
}

function normalizeRegion(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, '').replace(/[·/]/g, '')
}

function syncProjectInstallationReview(project: EntityRecord) {
  const database = useDatabaseStore()
  const factoryRegion = String(project.factoryRegion || '')
  const installationRegion = String(project.installationRegion || project.usageRegion || '')
  const existing = database.records('installation-transfers').find((item) => item.projectId === project.id && item.status === 'pending')
  const device = database.records('devices').find((item) => item.code === project.deviceSN)
  if (!factoryRegion || !installationRegion || normalizeRegion(factoryRegion) === normalizeRegion(installationRegion)) {
    if (existing) database.update('installation-transfers', existing.id, { status: 'withdrawn', reviewNote: '项目地区调整后不再属于跨区安装' })
    if (device?.activationReviewStatus === 'pending') database.update('devices', device.id, { activationReviewStatus: 'not_required', temporaryOperationUntil: '', temporaryUseStatusLabel: '无需审核' })
    return database.update('projects', project.id, { usageRegion: installationRegion, crossRegionStatus: 'not_required', status: project.status === 'pending' ? 'normal' : project.status }) || project
  }
  const submittedAt = String(existing?.submittedAt || new Date().toISOString())
  const reviewDeadline = String(existing?.reviewDeadline || new Date(new Date(submittedAt).getTime() + 48 * 60 * 60 * 1000).toISOString())
  const payload = {
    name: `${project.name}跨区安装审核`, category: '安装跨区审核', projectId: project.id, projectCode: project.code,
    deviceSN: project.deviceSN, factoryRegion, installationRegion, dealer: project.owner,
    submittedAt, reviewDeadline, temporaryOperationUntil: reviewDeadline, temporaryUseStatus: 'active', temporaryUseStatusLabel: '48 小时临时可用',
    activationBeforeReview: existing?.activationBeforeReview || device?.activation || 'inactive',
    summary: `${factoryRegion} → ${installationRegion}，已自动提交人工审核；设备可临时运行至 ${reviewDeadline.replace('T', ' ').slice(0, 16)}`, status: 'pending', owner: project.owner,
    ownerId: project.ownerId, domain: project.domain,
  }
  if (existing) database.update('installation-transfers', existing.id, payload)
  else database.create('installation-transfers', { code: generateBusinessCode('installation-transfers', payload), ...payload })
  if (device) database.update('devices', device.id, { activationReviewStatus: 'pending', temporaryOperationUntil: reviewDeadline, temporaryUseStatusLabel: '48 小时临时可用' })
  return database.update('projects', project.id, { usageRegion: installationRegion, crossRegionStatus: 'pending', activationReviewStatus: 'pending', temporaryOperationUntil: reviewDeadline, temporaryUseStatusLabel: '48 小时临时可用', status: 'pending' }) || project
}

function deriveFields(moduleKey: string, payload: Partial<EntityRecord>) {
  const database = useDatabaseStore()
  const next = { ...payload }
  const linkedSN = String(next.deviceSN || '').trim()
  const linkedDevice = linkedSN && linkedSN !== '-' && !linkedSN.includes('、')
    ? database.records('devices').find((item) => item.code === linkedSN)
    : undefined
  if (moduleKey !== 'devices' && linkedDevice) {
    next.deviceId = linkedDevice.id
    next.deviceName = linkedDevice.deviceName
    next.deviceType = linkedDevice.deviceType
    next.deviceModel = linkedDevice.deviceModel
    next.specification = linkedDevice.specification
  }
  if (moduleKey === 'devices' && next.region) {
    const region = String(next.region).trim()
    next.region = region
    next.country = region.split(/[·/-]/)[0]?.trim() || region
  }
  if (moduleKey === 'devices' && next.name) {
    const identity = deviceIdentity(next.name)
    next.deviceName = String(next.deviceName || identity.deviceName)
    next.deviceModel = identity.deviceModel
    next.deviceType = identity.deviceType
    next.specification = identity.specification
    next.productId = database.records('product-catalog').find((item) => item.deviceModel === identity.deviceModel)?.id || next.productId || ''
  }
  if (moduleKey === 'devices' && next.code) {
    const suffix = String(next.code).replace(/\W/g, '').slice(-10)
    next.communicationId ||= `COMM-${suffix}`
    next.chipId ||= `CHIP-${suffix}`
    next.mainboardSerial ||= `MB-${suffix}`
    const components = Array.isArray(next.components) ? next.components as Array<Record<string, unknown>> : []
    const normalizedComponents = components.map((component) => ({ serialNumber: String(component.serialNumber || '').trim(), specification: String(component.specification || '').trim() })).filter((component) => component.serialNumber || component.specification)
    next.components = normalizedComponents
    next.coreComponentSerials ||= normalizedComponents.length ? normalizedComponents.map((component) => component.serialNumber).join('、') : `CORE-${suffix}`
  }
  if (moduleKey === 'projects' && next.deviceSN) {
    const device = database.records('devices').find((item) => item.code === next.deviceSN)
    if (device) {
      next.deviceName = device.deviceName
      next.deviceType = device.deviceType
      next.deviceModel = device.deviceModel
      next.specification = device.specification
      next.owner = device.owner
      next.ownerId = device.ownerId
      next.domain = device.domain
      next.factoryRegion = String(device.region || next.factoryRegion || '')
      next.installationRegion ||= next.usageRegion || device.region
      next.usageRegion = next.installationRegion
      const warranty = warrantyEvaluation(device, next)
      next.warrantyUntil = warranty.endDate
      next.warrantyStartDate = warranty.startDate
      next.warrantyResult = warranty.result
    }
  }
  if (moduleKey === 'repairs' && next.deviceSN) {
    const device = database.records('devices').find((item) => item.code === next.deviceSN)
    if (device) {
      next.dealerId = device.ownerId
      next.dealer = device.owner
      next.responsibilityDealerId ||= device.ownerId
      next.responsibilityDealer ||= device.owner
      next.ownerId ||= device.ownerId
      next.owner ||= device.owner
      next.domain ||= device.domain
    }
  }
  if (moduleKey === 'sn-replacement') {
    const original = database.records('devices').find((item) => item.code === next.originalSN)
    if (original) {
      const identity = deviceIdentity(original.name)
      next.originalDeviceName = String(original.deviceName || identity.deviceName)
      next.originalDeviceModel = String(original.deviceModel || identity.deviceModel)
      next.originalDeviceType = String(original.deviceType || identity.deviceType)
      next.replacementDeviceDescriptor ||= identity.descriptor
      next.replacementDeviceName ||= String(original.deviceName || identity.deviceName)
    }
    if (next.replacementDeviceDescriptor) {
      const replacement = deviceIdentity(next.replacementDeviceDescriptor)
      next.replacementDeviceModel = replacement.deviceModel
      next.replacementDeviceType = replacement.deviceType
    }
  }
  if (moduleKey === 'dealers' && next.parentDealerId) {
    const parent = resolveDealer(next.parentDealerId)
    next.parentDealer = parent?.name || ''
  }
  if (moduleKey === 'dealers') {
    delete next.linkedUserId
    delete next.linkedUserName
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
  if (moduleKey === 'service-transfer') {
    next.hasFee = Boolean(next.hasFee)
    next.estimatedFee = next.hasFee ? Number(next.estimatedFee || 0) : 0
    next.feeStatus = next.hasFee ? String(next.feeStatus || '待总部审批') : '无费用'
    if (!next.hasFee) {
      next.feeBearer = '-'
      next.feeDescription = ''
    }
  }
  if (moduleKey === 'materials') {
    const material = database.records('material-catalog').find((item) => item.id === next.materialId)
    if (next.category === '设备采购') {
      const rawItems = Array.isArray(next.purchaseItems) && next.purchaseItems.length
        ? next.purchaseItems as Array<Record<string, unknown>>
        : [{ itemKey: `descriptor:${String(next.deviceModel || deviceCatalog[0].descriptor)}`, quantity: Number(next.quantity || 1), unitPrice: Number(next.estimatedUnitPrice || 0) }]
      const items = rawItems.map((line) => {
        const itemKey = String(line.itemKey || '')
        const [kind, id] = itemKey.split(':')
        const product = kind === 'product' ? database.records('product-catalog').find((item) => item.id === id) : undefined
        const catalog = kind === 'material' ? database.records('material-catalog').find((item) => item.id === id) : undefined
        const descriptor = kind === 'descriptor' ? id : String(product?.descriptor || catalog?.name || '')
        const quantity = Math.max(1, Number(line.quantity || 1))
        const unitPrice = Number(line.unitPrice || product?.referencePrice || catalog?.price || 0)
        return { itemKey, itemType: catalog ? '物料' : '设备', itemId: product?.id || catalog?.id || '', itemName: descriptor, quantity, unitPrice, subtotal: Math.round(quantity * unitPrice * 100) / 100 }
      })
      next.requestType = 'device_purchase'
      next.purchaseItems = items
      next.deviceModel = items.length === 1 ? items[0].itemName : `多项采购（${items.length} 项）`
      next.itemName = items.map((item) => item.itemName).join('、')
      next.quantity = items.reduce((sum, item) => sum + item.quantity, 0)
      next.estimatedUnitPrice = items.length === 1 ? items[0].unitPrice : 0
      next.amount = Math.round(items.reduce((sum, item) => sum + item.subtotal, 0) * 100) / 100
      next.currency = 'CNY'
      next.paymentStatus ||= '未登记'
      next.deviceSN = '-'
      next.warrantyResult = '不适用'
      next.purchaseStage ||= 'sales_confirmation'
      next.purchaseStageLabel ||= '待销售确认'
      next.contractStatus ||= '待确认'
      next.deliveryStatus ||= '待处理'
      delete next.materialId
      delete next.materialName
    } else if (material) {
      next.materialName = material.name
      next.itemName = material.name
      next.unitPrice = Number(material.price || 0)
      next.amount = Math.round(Number(next.quantity || 0) * Number(material.price || 0) * 100) / 100
      next.currency = 'CNY'
      const warranty = warrantyEvaluation(linkedDevice)
      next.warrantyResult = warranty.result
      next.warrantyStartDate = warranty.startDate
      next.warrantyUntil = warranty.endDate
    }
    const session = useAuthStore().session
    const dealer = database.records('dealers').find((item) => String(item.organizationId || item.ownerId) === session?.ownerId)
    next.dealer ||= dealer?.name || session?.displayName || ''
  }
  if (moduleKey === 'warehouse' && Array.isArray(next.selectedDevices) && next.selectedDevices.length) {
    const selectedDevices = next.selectedDevices as unknown[]
    const selected = database.records('devices').filter((item) => selectedDevices.includes(item.code))
    const device = selected[0]
    next.sourceDealer = device?.owner || '平台中心仓'
    next.sourceDealerId = device?.ownerId || 'platform'
    const unique = (field: string) => [...new Set(selected.map((item) => String(item[field] || '-')))].join('、')
    next.deviceType = unique('deviceType')
    next.deviceModel = unique('deviceModel')
    next.specification = unique('specification')
  }
  if (moduleKey === 'warehouse' && next.category === '在库') {
    const warehouse = database.records('warehouses').find((item) => (item.id === next.warehouseId || item.name === next.warehouseName) && item.status === 'normal')
      || database.records('warehouses').find((item) => item.name === '平台中心仓' && item.status === 'normal')
    const location = database.records('warehouse-locations').find((item) => (item.id === next.warehouseLocationId || item.name === next.warehouseLocation || item.code === next.warehouseLocation) && item.warehouseId === warehouse?.id && item.status === 'normal')
      || database.records('warehouse-locations').find((item) => item.warehouseId === warehouse?.id && item.status === 'normal')
    if (next.deviceModel) {
      const identity = deviceIdentity(next.deviceModel)
      next.deviceName ||= identity.deviceName
      next.deviceType = identity.deviceType
      next.deviceModel = identity.deviceModel
      next.specification = identity.specification
      next.productId = database.records('product-catalog').find((item) => item.deviceModel === identity.deviceModel)?.id || ''
    }
    next.warehouseId = warehouse?.id || ''
    next.warehouseName = warehouse?.name || ''
    next.warehouseLocationId = location?.id || ''
    next.warehouseLocation = location?.name || ''
  }
  if (moduleKey === 'warehouse-locations' && next.warehouseId) {
    const warehouse = database.records('warehouses').find((item) => item.id === next.warehouseId)
    next.warehouseName = warehouse?.name || ''
    next.owner = warehouse?.owner || next.owner
    next.ownerId = warehouse?.ownerId || next.ownerId
    next.domain = warehouse?.domain || next.domain
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
  if (moduleKey === 'faq-documents') {
    next.productType ||= deviceCatalog.find((item) => String(next.name || '').includes(item.deviceName))?.descriptor || deviceCatalog[0].descriptor
    next.documentVersion ||= '1.0'
    const embedded = String(next.pdfData || '').startsWith('data:application/pdf')
    const bundled = /^\.?\/documents\//.test(String(next.pdfFile || '')) && String(next.pdfFile || '').toLowerCase().endsWith('.pdf')
    next.fileStatus = embedded || bundled ? 'valid' : 'invalid'
    next.fileError = next.fileStatus === 'valid' ? '' : 'PDF 文件内容不可用，请重新上传后再发布'
  }
  if (moduleKey === 'support-settings' || moduleKey === 'after-sales-types') {
    const audienceLabels: Record<string, string> = { all: '全部用户', user: '普通用户', dealer: '经销商' }
    next.audienceLabel = audienceLabels[String(next.audience || 'all')] || '全部用户'
  }
  if (moduleKey === 'after-sales-types') {
    const labels: Record<string, string> = { deviceSN: '设备 SN', contact: '联系方式', description: '问题描述', attachments: '图片/视频附件', faultCategory: '故障分类', installationRegion: '安装地区' }
    next.requiredFieldsLabel = (Array.isArray(next.requiredFields) ? next.requiredFields : []).map((field) => labels[String(field)] || String(field)).join('、')
  }
  if (moduleKey === 'approval-flow') {
    const menuKey = String(next.menuKey || next.flowType || 'materials')
    next.menuKey = menuKey
    next.menuLabel = approvalMenuLabels[menuKey] || menuKey
    next.flowType = menuKey
    next.flowTypeLabel = next.menuLabel
    const approverFields = ['level1ApproverId', 'level2ApproverId', 'platformApproverId']
    if (approverFields.some((field) => Object.hasOwn(next, field))) {
      if (next.levels === '平台直接审核') {
        next.level1ApproverId = ''
        next.level2ApproverId = ''
      } else if (next.levels === '一级 → 平台') next.level2ApproverId = ''
      const ids = configuredApprovalIds(next as EntityRecord)
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
    next.market ||= dealer?.domain === 'global' ? '海外' : '国内'
    next.warrantyStartPoint ||= '设备激活日'
    next.effectiveFrom ||= new Date().toISOString().slice(0, 10)
  }
  if (moduleKey === 'couriers') next.category ||= '快递公司'
  if (moduleKey === 'ota') {
    next.category ||= '固件版本'
    const products = database.records('product-catalog').filter((item) => item.status === 'normal')
    const legacy = products.find((item) => item.descriptor === next.deviceType || item.deviceModel === next.compatibleModel)
    const requestedNames = stringArray(next.applicableProductNames).length ? stringArray(next.applicableProductNames) : legacy ? [String(legacy.name)] : []
    const requestedTypes = stringArray(next.applicableDeviceTypes).length ? stringArray(next.applicableDeviceTypes) : legacy ? [String(legacy.deviceType)] : []
    const requestedModels = stringArray(next.applicableDeviceModels).length ? stringArray(next.applicableDeviceModels) : legacy ? [String(legacy.deviceModel)] : []
    next.applicableProductNames = requestedNames.filter((name) => products.some((item) => item.name === name))
    next.applicableDeviceTypes = requestedTypes.filter((type) => products.some((item) => item.deviceType === type && stringArray(next.applicableProductNames).includes(String(item.name))))
    next.applicableDeviceModels = requestedModels.filter((model) => products.some((item) => item.deviceModel === model
      && stringArray(next.applicableProductNames).includes(String(item.name))
      && stringArray(next.applicableDeviceTypes).includes(String(item.deviceType))))
    next.applicableProductSummary = stringArray(next.applicableProductNames).join('、')
    next.applicableTypeSummary = stringArray(next.applicableDeviceTypes).join('、')
    next.applicableModelSummary = stringArray(next.applicableDeviceModels).join('、')
    delete next.deviceType
    delete next.compatibleModel
    delete next.releaseScope
  }
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
  if (moduleKey === 'dealers') {
    const domain = String(payload.domain || useAuthStore().session?.domain || 'cn')
    if (!dealerRegionOptions.some((item) => item.domain === domain && item.value === payload.region)) return '请选择区域字典中的有效负责地区'
  }
  if (moduleKey === 'ota') {
    const names = stringArray(payload.applicableProductNames)
    const types = stringArray(payload.applicableDeviceTypes)
    const models = stringArray(payload.applicableDeviceModels)
    const matching = database.records('product-catalog').filter((item) => item.status === 'normal'
      && names.includes(String(item.name)) && types.includes(String(item.deviceType)) && models.includes(String(item.deviceModel)))
    if (!matching.length) return '适用产品、设备类型和设备型号必须来自同一条产品与型号主数据'
  }
  if (moduleKey === 'materials' && payload.category !== '设备采购' && !database.records('devices').some((item) => item.code === payload.deviceSN)) return '请选择有效设备后再校验质保'
  if (moduleKey === 'devices' && !String(payload.country || payload.region || '').trim()) return '请填写销售地区'
  if (moduleKey === 'devices') {
    for (const field of ['communicationId', 'chipId', 'mainboardSerial', 'coreComponentSerials']) {
      const value = String(payload[field] || '').trim()
      if (value && database.records('devices').some((item) => item.id !== payload.id && String(item[field] || '') === value)) return `${field} 已绑定其他设备，请检查唯一身份映射`
    }
    const components = Array.isArray(payload.components) ? payload.components as Array<Record<string, unknown>> : []
    const serials = components.map((item) => String(item.serialNumber || '').trim()).filter(Boolean)
    if (components.some((item) => !String(item.serialNumber || '').trim() || !String(item.specification || '').trim())) return '子物料序列号与规格必须成对填写'
    if (new Set(serials).size !== serials.length) return '子物料序列号不能重复'
    const duplicated = database.records('device-components').find((item) => item.deviceId !== payload.id && serials.includes(String(item.serialNumber || '')))
    if (duplicated) return `子物料序列号 ${duplicated.serialNumber} 已绑定其他设备`
  }
  if (moduleKey === 'product-catalog') {
    if (database.records('product-catalog').some((item) => item.id !== payload.id && item.deviceModel === payload.deviceModel)) return '设备型号已存在，请直接编辑原产品'
    if (!String(payload.specification || '').trim()) return '请填写产品规格'
  }
  if (moduleKey === 'warehouses') {
    if (database.records('warehouses').some((item) => item.id !== payload.id && (item.code === payload.code || item.name === payload.name))) return '仓库编号或名称已存在'
  }
  if (moduleKey === 'warehouse-locations') {
    const warehouse = database.records('warehouses').find((item) => item.id === payload.warehouseId && item.status === 'normal')
    if (!warehouse) return '请选择有效且已启用的仓库'
    if (database.records('warehouse-locations').some((item) => item.id !== payload.id && item.warehouseId === payload.warehouseId && item.code === payload.code)) return '同一仓库内库位编码不能重复'
  }
  if (moduleKey === 'app-versions') {
    if (!/^\d+\.\d+\.\d+$/.test(String(payload.name || ''))) return '版本号格式应为 1.0.0'
    if (database.records('app-versions').some((item) => item.id !== payload.id && item.name === payload.name && item.platform === payload.platform)) return '相同客户端平台的版本号已存在'
  }
  if (moduleKey === 'ota' && !/^v?\d+\.\d+\.\d+$/.test(String(payload.name || ''))) return '版本号格式应为 1.0.0'
  if (moduleKey === 'projects' && !String(payload.deviceSN || '').trim()) return '项目必须绑定设备 SN'
  if (moduleKey === 'projects' && !String(payload.factoryRegion || '').trim()) return '所选设备缺少出厂地区，暂不能创建安装项目'
  if (moduleKey === 'projects' && !String(payload.installationRegion || '').trim()) return '请填写实际安装地区'
  if (moduleKey === 'faq-documents' && payload.status === 'published' && payload.fileStatus !== 'valid') return 'PDF 文件已失效，请重新上传后再发布'
  if (moduleKey === 'materials' && Number(payload.quantity || 0) < 1) return '申请数量必须大于 0'
  if (moduleKey === 'materials') {
    if (payload.category === '设备采购') {
      if (!String(payload.deviceModel || '').trim()) return '请选择采购设备'
      if ((!Array.isArray(payload.purchaseItems) || payload.purchaseItems.length <= 1) && Number(payload.estimatedUnitPrice || 0) <= 0) return '预算单价必须大于 0'
      if (Number(payload.amount || 0) <= 0) return '预算总费用必须大于 0'
      return ''
    }
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
    if (new Set(selected).size !== selected.length) return '设备清单中存在重复 SN'
    const allowed = payload.category === '出库'
      ? visibleRecords('devices').filter((item) => item.inventoryStatus === 'in_stock' && item.ownerId === 'platform')
      : visibleRecords('devices').filter((item) => item.ownerId !== 'platform' && item.inventoryStatus !== 'in_stock')
    if (!selected.length || selected.some((sn) => !allowed.some((item) => item.code === sn))) return '所选设备不存在、已出库或超出当前数据范围'
    const target = resolveDealer(payload.targetDealerId)
    if (!target || target.status !== 'normal') return '接收经销商不存在或已禁用'
    if (payload.category === '调货' && allowed.some((item) => selected.includes(item.code) && item.ownerId === (target.organizationId || target.ownerId))) return '目标经销商不能与设备当前归属相同'
  }
  if (moduleKey === 'warehouse' && payload.category === '在库') {
    const warehouse = database.records('warehouses').find((item) => item.id === payload.warehouseId && item.status === 'normal')
    const location = database.records('warehouse-locations').find((item) => item.id === payload.warehouseLocationId && item.status === 'normal')
    if (!warehouse) return '请选择有效且已启用的仓库'
    if (!location || location.warehouseId !== warehouse.id) return '请选择属于当前仓库的有效库位'
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
    if (!String(payload.replacementDeviceName || '').trim()) return '请填写新设备名称'
    if (!deviceCatalog.some((item) => item.descriptor === payload.replacementDeviceDescriptor)) return '请选择有效的新设备型号'
  }
  if (moduleKey === 'service-transfer') {
    const device = visibleRecords('devices').find((item) => item.code === payload.deviceSN)
    const target = resolveDealer(payload.targetDealerId)
    if (!device) return '设备不存在或不属于当前数据范围'
    const session = useAuthStore().session
    const sourceDealerId = String(device.ownerId)
    const headquarters = ['platform', 'custom'].includes(String(session?.role))
    if (!headquarters && sourceDealerId !== session?.ownerId) return '经销商只能发起自身设备的售后转移'
    if (!target || target.status !== 'normal') return '目标经销商不可用'
    if (target.organizationId === device.ownerId || target.ownerId === device.ownerId) return '目标经销商不能与原经销商相同'
    const source = resolveDealer(device.ownerId)
    const targetId = String(target.organizationId || target.ownerId)
    const eligible = source?.tier === '二级' && targetId === source.parentDealerId || Boolean(source && target.tier === source.tier)
    if (!headquarters && !eligible) return '目标经销商必须是当前经销商的上级或同级经销商'
    if (payload.hasFee) {
      if (Number(payload.estimatedFee || 0) <= 0) return '涉及费用时预计费用必须大于 0'
      if (!['原经销商', '目标经销商', '总部'].includes(String(payload.feeBearer))) return '请选择费用承担方'
      if (!String(payload.feeDescription || '').trim()) return '请填写费用说明'
    }
  }
  if (moduleKey === 'approval-flow') {
    const accounts = database.records('auth-accounts').filter((item) => item.status === 'normal')
    const menuKey = String(payload.menuKey || payload.flowType || '')
    if (!approvalMenuLabels[menuKey]) return '请选择有效的适用菜单'
    const ids = configuredApprovalIds(payload as EntityRecord)
    if (!ids.length || ids.some((id) => !accounts.some((item) => item.id === id))) return '审批人员不存在、已禁用或超出可选范围'
    const platform = accounts.find((item) => item.id === payload.platformApproverId)
    if (!platform || platform.roleKey !== 'platform') return '平台审核人员必须选择有效的平台管理员账号'
    if (payload.levels === '二级 → 一级 → 平台') {
      if (accounts.find((item) => item.id === payload.level1ApproverId)?.roleKey !== 'tier2') return '第一级审核人员必须选择有效的二级经销商账号'
      if (accounts.find((item) => item.id === payload.level2ApproverId)?.roleKey !== 'tier1') return '第二级审核人员必须选择有效的一级经销商账号'
    }
    if (payload.levels === '一级 → 平台' && accounts.find((item) => item.id === payload.level1ApproverId)?.roleKey !== 'tier1') return '第一级审核人员必须选择有效的一级经销商账号'
    const requiredCount = payload.levels === '二级 → 一级 → 平台' ? 3 : payload.levels === '一级 → 平台' ? 2 : 1
    if (new Set(ids).size !== requiredCount) return `当前审核层级需要配置 ${requiredCount} 个不同的审核账号`
    if (payload.status === 'normal' && database.records('approval-flow').some((item) => item.id !== payload.id && item.status === 'normal' && String(item.menuKey || item.flowType) === menuKey)) return `${approvalMenuLabels[menuKey]}已存在启用的审批流程，请先停用原流程`
  }
  if (moduleKey === 'warranty') {
    const session = useAuthStore().session
    const dealer = resolveDealer(payload.dealerId)
    if (!dealer) return '请选择有效经销商'
    if (session?.role === 'platform') return '平台管理员仅查看全部质保规则，规则必须由经销商自行设置'
    if (String(dealer.organizationId || dealer.ownerId) !== session?.ownerId) return '经销商只能维护自身质保规则'
    if (database.records('warranty').some((item) => item.id !== payload.id && String(item.dealerId || item.ownerId) === session.ownerId && item.productType === payload.productType)) return '当前设备类型已配置质保规则，请直接编辑原规则'
    if (payload.effectiveFrom && payload.effectiveTo && String(payload.effectiveFrom) > String(payload.effectiveTo)) return '失效日期不能早于生效日期'
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
      ...(operationType === '设备出库' ? {
        warehouseId: '', warehouseName: '', warehouseLocationId: '', warehouseLocation: '', outboundAt: new Date().toISOString(),
      } : {}),
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
      warehouseId: device.warehouseId || '',
      warehouseName: device.warehouseName || '',
      warehouseLocationId: device.warehouseLocationId || '',
      warehouseLocation: device.warehouseLocation || '',
      inboundAt: device.inboundAt || '',
      outboundAt: operationType === '设备出库' ? new Date().toISOString() : '',
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

function configuredApprovers(menuKey: string) {
  const database = useDatabaseStore()
  const accounts = database.records('auth-accounts').filter((item) => item.status === 'normal')
  const configured = database.records('approval-flow').find((item) => item.status === 'normal' && String(item.menuKey || item.flowType) === menuKey)
  const configuredIds = configuredApprovalIds(configured)
  const approvers = [...new Map(configuredIds.map((id) => accounts.find((item) => item.id === id)).filter(Boolean).map((item) => [item!.id, item!])).values()]
  if (!configured || !approvers.length || approvers.length !== configuredIds.length) throw new Error(`没有可用的${approvalMenuLabels[menuKey] || '业务'}审批流程，请先在审批流程菜单完成配置`)
  return { flow: configured, approvers }
}

function approversForBusinessHierarchy(approvers: EntityRecord[], record: EntityRecord, initiatorRole: unknown) {
  if (initiatorRole !== 'tier2') return approversAfterInitiator(approvers, initiatorRole)
  const database = useDatabaseStore()
  const sourceDealer = resolveDealer(record.ownerId)
  const parentDealer = resolveDealer(sourceDealer?.parentDealerId)
  const parentOwnerId = String(parentDealer?.organizationId || parentDealer?.ownerId || '')
  const parentAccount = database.records('auth-accounts').find((item) => item.status === 'normal' && item.roleKey === 'tier1' && item.ownerId === parentOwnerId)
  if (!parentAccount) throw new Error('当前二级经销商未配置可用的上级一级经销商审批账号')
  return approversAfterInitiator(approvers, initiatorRole).map((approver) => approver.roleKey === 'tier1' ? parentAccount : approver)
}

function createApproval(record: EntityRecord, menuKey: string, sourceModule: string) {
  const database = useDatabaseStore()
  const configured = configuredApprovers(menuKey)
  const initiatorRole = record.initiatorRole || useAuthStore().session?.role
  let approvers = menuKey === 'service-transfer' ? [] : approversForBusinessHierarchy(configured.approvers, record, initiatorRole)
  if (menuKey === 'service-transfer') {
    const targetAccount = database.records('auth-accounts').find((item) => item.status === 'normal' && item.ownerId === record.targetDealerId)
    if (!targetAccount) throw new Error('目标经销商没有可用的确认账号')
    approvers = [targetAccount]
    if (record.hasFee) approvers.push(...configured.approvers.filter((item) => item.roleKey === 'platform'))
  }
  approvers = [...new Map(approvers.map((item) => [item.id, item])).values()]
  if (menuKey === 'materials' && record.category === '设备采购' && approvers.length === 1) approvers.push(approvers[0])
  if (!approvers.length) throw new Error('当前业务没有可用的后续审批账号')
  const instance = database.create('approval-instances', {
    code: `APR-${record.code}`,
    name: `${record.code} ${String(record.name || '')}审批`,
    subjectId: record.id,
    subjectCode: record.code,
    sourceModule,
    menuKey,
    menuLabel: approvalMenuLabels[menuKey] || menuKey,
    flowId: configured.flow.id,
    currentStep: 1,
    totalSteps: approvers.length,
    status: 'pending',
    owner: record.owner,
    ownerId: record.ownerId,
    domain: record.domain,
  })
  approvers.forEach((approver, index) => database.create('approval-steps', {
    code: `${instance.code}-${index + 1}`,
    name: menuKey === 'materials' && record.category === '设备采购' ? (index === 0 ? '销售确认' : '研发确认') : `第 ${index + 1} 级审批`,
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
  const reservation = database.records('stock-reservations').find((item) => item.subjectId === record.id && item.status === 'reserved')
  database.update('material-catalog', catalog.id, {
    stock: before - quantity,
    reservedStock: Math.max(0, Number(catalog.reservedStock || 0) - Number(reservation?.quantity || quantity)),
    status: before - quantity <= Number(catalog.warningThreshold || 10) ? 'low' : 'normal',
  })
  if (reservation) database.update('stock-reservations', reservation.id, { status: 'consumed', consumedAt: new Date().toISOString() })
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
    const reservation = database.records('stock-reservations').find((item) => item.subjectId === record.id && item.status === 'reserved')
    if (reservation) {
      const catalog = activeMaterialCatalog(record)
      if (catalog) database.update('material-catalog', catalog.id, { reservedStock: Math.max(0, Number(catalog.reservedStock || 0) - Number(reservation.quantity || 0)) })
      database.update('stock-reservations', reservation.id, { status: 'released', releasedAt: timestamp })
    }
    return { status: 'rejected', currentApproverId: '', currentApproverName: '', rejectionReason: reason }
  }
  database.update('approval-steps', current.id, { status: 'approved', reason, decidedAt: timestamp })
  const next = steps.find((item) => item.status === 'waiting')
  if (next) {
    database.update('approval-steps', next.id, { status: 'pending' })
    database.update('approval-instances', instance.id, { currentStep: next.sequence })
    if (record.category === '设备采购') {
      return {
        status: 'pending', purchaseStage: 'rd_confirmation', purchaseStageLabel: '待研发确认',
        salesConfirmedAt: timestamp, salesConfirmedBy: auth.session?.displayName || '',
        currentApproverId: next.approverAccountId, currentApproverName: next.approverName, approvalReason: reason,
      }
    }
    return { status: 'pending', currentApproverId: next.approverAccountId, currentApproverName: next.approverName, approvalReason: reason }
  }
  database.update('approval-instances', instance.id, { status: 'approved', completedAt: timestamp })
  if (record.category === '设备采购') {
    return {
      status: 'approved',
      purchaseStage: 'production',
      purchaseStageLabel: '待导入生产',
      currentApproverId: '',
      currentApproverName: '',
      rdConfirmedAt: timestamp,
      rdConfirmedBy: auth.session?.displayName || '',
      approvalReason: reason,
    }
  }
  if (record.category !== '设备采购') {
    const catalog = activeMaterialCatalog(record)
    const quantity = Number(record.quantity || 0)
    if (!catalog || Number(catalog.stock || 0) - Number(catalog.reservedStock || 0) < quantity) throw new Error('物料可用库存不足，无法完成审批预占')
    database.update('material-catalog', catalog.id, { reservedStock: Number(catalog.reservedStock || 0) + quantity })
    database.create('stock-reservations', { name: `${record.code}库存预占`, subjectId: record.id, subjectCode: record.code, materialId: catalog.id, quantity, status: 'reserved', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
    if (Number(catalog.stock || 0) - Number(catalog.reservedStock || 0) - quantity <= Number(catalog.warningThreshold || 10)) database.notify('物料库存达到预警阈值', `${catalog.name}可用库存不足，请及时补货`, catalog, 'risk')
  }
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
  const updatedDevice = { ...device, owner: target.name, ownerId: targetId }
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
  for (const project of database.records('projects').filter((item) => item.deviceSN === device.code)) {
    database.create('project-history', {
      code: `${project.code}-H${Date.now().toString().slice(-6)}`,
      name: `${project.name}转移前记录`,
      projectId: project.id,
      projectCode: project.code,
      changeType: '售后转移',
      snapshot: JSON.stringify({ shipOwner: project.shipOwner, owner: project.owner, ownerId: project.ownerId, deviceSN: project.deviceSN, warrantyUntil: project.warrantyUntil }),
      operator: useAuthStore().session?.displayName || '',
      status: 'completed', owner: target.name, ownerId: targetId, domain: project.domain,
    })
    const warranty = warrantyEvaluation(updatedDevice, project)
    database.update('projects', project.id, { owner: target.name, ownerId: targetId, warrantyUntil: warranty.endDate, warrantyStartDate: warranty.startDate, warrantyResult: warranty.result })
  }
}

export const mockService = {
  canAction(moduleKey: string, record: EntityRecord, actionKey: string) {
    return actionDecision(canonicalModuleKey(moduleKey), record, actionKey)
  },
  async list(moduleKey: string, query: PageQuery): Promise<TableDataInfo<EntityRecord>> {
    await sleep()
    if (!hasPermission(useAuthStore().permissions, `${moduleKey}:view`)) return { code: 403, msg: '无权查看该模块', rows: [], total: 0 }
    const tab = moduleConfigs[moduleKey]?.tabs.find((item) => item.key === query.tab)
    const sourceKey = tab?.source || moduleKey
    const rows = filterRows(moduleKey, visibleRecords(sourceKey).map(withDeviceIdentity), query)
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
  async exportRows(moduleKey: string, query: PageQuery) {
    await sleep(10)
    const auth = useAuthStore()
    if (!hasPermission(auth.permissions, `${moduleKey}:export`)) return fail(403, '无权导出该模块数据', [] as EntityRecord[])
    const config = moduleConfigs[moduleKey]
    if (!config && !specialExportTitles[moduleKey] || config?.exportable === false) return fail(405, '该模块不支持导出', [] as EntityRecord[])
    const tab = config?.tabs.find((item) => item.key === query.tab) || config?.tabs[0]
    const sourceKey = tab?.source || moduleKey
    const rows = filterRows(moduleKey, visibleRecords(sourceKey).map(withDeviceIdentity), query)
    if (query.orderByColumn) {
      const field = query.orderByColumn
      const direction = query.isAsc === 'desc' ? -1 : 1
      rows.sort((left, right) => String(left[field] ?? '').localeCompare(String(right[field] ?? ''), 'zh-CN') * direction)
    } else rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    const exported = rows.map((item) => forExport(sourceKey, item))
    const session = auth.session
    const title = config?.title || specialExportTitles[moduleKey]
    if (session) useDatabaseStore().audit(`导出${title}`, `${tab?.label || String(query.tab || '全部')} · ${exported.length} 条`, session.displayName, false)
    return ok(exported, '导出数据准备完成')
  },
  async importDevices(rows: Array<{ sn: string; model: string; deviceType?: string; specification?: string; region: string; warehouseName?: string; warehouseLocation?: string; components?: Array<{ serialNumber: string; specification: string }> }>, target: 'devices' | 'warehouse' = 'devices') {
    await sleep()
    const moduleKey = target === 'warehouse' ? 'warehouse' : 'devices'
    const permission = createDecision(moduleKey)
    if (!permission.allowed) return fail(403, permission.reason, [] as EntityRecord[])
    const database = useDatabaseStore()
    const session = useAuthStore().session
    if (!session) return fail(401, '登录状态已失效', [] as EntityRecord[])
    if (target === 'warehouse' && session.role !== 'platform') return fail(403, '设备入库只能由平台管理员操作', [] as EntityRecord[])
    if (!rows.length) return fail(422, '没有可导入的数据', [] as EntityRecord[])

    const allowedModels = new Set([
      ...deviceCatalog.map((item) => item.descriptor),
      ...database.records('product-catalog').filter((item) => item.status === 'normal').map((item) => String(item.descriptor || `${item.name} ${item.deviceModel}`)),
    ])
    const seen = new Set(database.records('devices').map((item) => String(item.code)))
    const seenComponents = new Set(database.records('device-components').map((item) => String(item.serialNumber || '')))
    const normalized = rows.map((item) => {
      const identity = deviceIdentity(item.model)
      return { sn: item.sn.trim(), model: item.model.trim(), deviceType: item.deviceType?.trim() || identity.deviceType, specification: item.specification?.trim() || identity.specification, region: item.region.trim(), warehouseName: item.warehouseName?.trim() || '', warehouseLocation: item.warehouseLocation?.trim() || '', components: (item.components || []).map((component) => ({ serialNumber: component.serialNumber.trim(), specification: component.specification.trim() })) }
    })
    for (const item of normalized) {
      if (!item.sn) return fail(422, 'SN 不能为空', [] as EntityRecord[])
      if (seen.has(item.sn)) return fail(409, `SN ${item.sn} 已存在或文件内重复`, [] as EntityRecord[])
      if (!allowedModels.has(item.model)) return fail(422, `设备型号 ${item.model} 无效`, [] as EntityRecord[])
      const identity = deviceIdentity(item.model)
      if (item.deviceType !== identity.deviceType) return fail(422, `设备 ${item.sn} 的类型与型号不匹配`, [] as EntityRecord[])
      if (item.specification !== identity.specification) return fail(422, `设备 ${item.sn} 的规格与型号不匹配`, [] as EntityRecord[])
      if (!item.region) return fail(422, `设备 ${item.sn} 的销售地区不能为空`, [] as EntityRecord[])
      if (target === 'warehouse') {
        const warehouse = database.records('warehouses').find((row) => row.name === (item.warehouseName || '平台中心仓') && row.status === 'normal')
        if (!warehouse) return fail(422, `设备 ${item.sn} 的仓库不存在或已停用`, [] as EntityRecord[])
        const location = database.records('warehouse-locations').find((row) => row.warehouseId === warehouse.id && (row.name === (item.warehouseLocation || 'A-01-01') || row.code === (item.warehouseLocation || 'A-01-01')) && row.status === 'normal')
        if (!location) return fail(422, `设备 ${item.sn} 的库位不存在、已停用或不属于该仓库`, [] as EntityRecord[])
      }
      for (const component of item.components) {
        if (!component.serialNumber || !component.specification) return fail(422, `设备 ${item.sn} 的子物料序列号与规格必须成对填写`, [] as EntityRecord[])
        if (seenComponents.has(component.serialNumber)) return fail(409, `子物料序列号 ${component.serialNumber} 已存在或文件内重复`, [] as EntityRecord[])
        seenComponents.add(component.serialNumber)
      }
      seen.add(item.sn)
    }

    const created = database.transaction(() => normalized.map((item) => {
      const country = item.region.split(/[·/-]/)[0]?.trim() || item.region
      const identity = deviceIdentity(item.model)
      const warehouseMaster = target === 'warehouse' ? database.records('warehouses').find((row) => row.name === (item.warehouseName || '平台中心仓')) : undefined
      const locationMaster = target === 'warehouse' ? database.records('warehouse-locations').find((row) => row.warehouseId === warehouseMaster?.id && (row.name === (item.warehouseLocation || 'A-01-01') || row.code === (item.warehouseLocation || 'A-01-01'))) : undefined
      const device = database.create('devices', {
        code: item.sn, name: item.model, productId: database.records('product-catalog').find((row) => row.deviceModel === identity.deviceModel)?.id || '', deviceName: identity.deviceName, deviceModel: identity.deviceModel, deviceType: identity.deviceType, specification: identity.specification, country, region: item.region, components: item.components, coreComponentSerials: item.components.map((component) => component.serialNumber).join('、'), firmware: 'v1.0.0', activation: 'inactive', activationDate: '',
        bindingStatus: 'unbound', account: '-', inventoryStatus: target === 'warehouse' ? 'in_stock' : '', warehouseId: warehouseMaster?.id || '', warehouseName: warehouseMaster?.name || '', warehouseLocationId: locationMaster?.id || '', warehouseLocation: locationMaster?.name || '', inboundAt: target === 'warehouse' ? new Date().toISOString() : '',
        status: 'offline', owner: target === 'warehouse' ? warehouseMaster?.name || '平台中心仓' : session.displayName,
        ownerId: target === 'warehouse' ? 'platform' : session.ownerId, domain: session.domain,
      })
      item.components.forEach((component) => database.create('device-components', { name: component.specification, serialNumber: component.serialNumber, specification: component.specification, deviceId: device.id, deviceSN: device.code, status: 'normal', owner: device.owner, ownerId: device.ownerId, domain: device.domain }))
      if (target === 'devices') return device
      const inboundCode = generateBusinessCode('warehouse', { category: '在库' })
      const warehouse = database.create('warehouse', {
        code: inboundCode, name: item.model, category: '在库', deviceId: device.id, deviceSN: item.sn, productId: device.productId, deviceName: identity.deviceName, deviceType: identity.deviceType, deviceModel: identity.deviceModel, specification: identity.specification,
        country, region: item.region, quantity: 1, warehouseId: warehouseMaster?.id || '', warehouseName: warehouseMaster?.name || '', warehouseLocationId: locationMaster?.id || '', warehouseLocation: locationMaster?.name || '', inboundAt: new Date().toISOString(), status: 'normal',
        owner: warehouseMaster?.name || '平台中心仓', ownerId: 'platform', domain: session.domain,
      })
      database.create('stock-movements', {
        code: `STK-${inboundCode}`, name: item.model, category: '设备入库', deviceId: device.id, deviceSN: item.sn, quantity: 1,
        subjectId: warehouse.id, subjectCode: warehouse.code, warehouseId: warehouseMaster?.id || '', warehouseName: warehouseMaster?.name || '', warehouseLocationId: locationMaster?.id || '', warehouseLocation: locationMaster?.name || '', status: 'completed', owner: warehouseMaster?.name || '平台中心仓', ownerId: 'platform', domain: session.domain,
      })
      return warehouse
    }))
    database.audit(target === 'warehouse' ? '批量设备入库' : '批量录入设备', `${created.length} 台 · ${created.map((item) => item.code).join('、')}`, session.displayName, false, created[0])
    return ok(created, target === 'warehouse' ? `成功入库 ${created.length} 台设备` : `成功录入 ${created.length} 台设备`)
  },
  async importMaterials(rows: Array<{ materialCode: string; name: string; category: string; price: number; stock: number }>) {
    await sleep()
    const permission = createDecision('material-catalog')
    if (!permission.allowed) return fail(403, permission.reason, [] as EntityRecord[])
    const database = useDatabaseStore()
    const session = useAuthStore().session
    if (!session) return fail(401, '登录状态已失效', [] as EntityRecord[])
    if (!rows.length) return fail(422, '没有可导入的数据', [] as EntityRecord[])
    const existing = new Set(database.records('material-catalog').flatMap((item) => [String(item.code), String(item.materialCode)]))
    for (const row of rows) {
      if (!row.materialCode.trim() || existing.has(row.materialCode.trim())) return fail(409, `物料编号 ${row.materialCode || '-'} 已存在或文件内重复`, [] as EntityRecord[])
      if (!row.name.trim() || !(Number(row.price) > 0) || !Number.isInteger(Number(row.stock)) || Number(row.stock) < 0) return fail(422, `物料 ${row.materialCode} 的名称、价格或库存无效`, [] as EntityRecord[])
      existing.add(row.materialCode.trim())
    }
    const created = database.transaction(() => rows.map((row) => database.create('material-catalog', { code: row.materialCode.trim(), materialCode: row.materialCode.trim(), name: row.name.trim(), category: row.category, price: Number(row.price), stock: Number(row.stock), reservedStock: 0, status: 'normal', owner: session.displayName, ownerId: session.ownerId, domain: session.domain })))
    database.audit('批量导入物料', `${created.length} 条`, session.displayName, false, created[0])
    return ok(created, `成功导入 ${created.length} 条物料`)
  },
  async get(moduleKey: string, id: string) {
    await sleep()
    if (!hasPermission(useAuthStore().permissions, `${moduleKey}:view`)) return fail(403, '无权查看该模块', null)
    const record = visibleRecords(moduleKey).find((item) => item.id === id)
    if (!record) return fail(404, '记录不存在或无权访问', null)
    const derived = forDisplay(moduleKey, record)
    if (moduleKey === 'users') return ok(derived, '查询成功')
    return ok(['platform', 'custom'].includes(String(useAuthStore().session?.role)) ? { ...record, deviceCount: derived.deviceCount ?? record.deviceCount } : derived, '查询成功')
  },
  async related(moduleKey: string, id: string, source?: string) {
    await sleep()
    if (!hasPermission(useAuthStore().permissions, `${moduleKey}:view`)) return fail(403, '无权查看关联数据', [] as EntityRecord[])
    const record = visibleRecords(moduleKey).find((item) => item.id === id)
    if (!record) return fail(404, '记录不存在或无权访问', [] as EntityRecord[])
    return ok(relatedRecords(record, source).map((item) => forDisplay(source || moduleKey, item)), '查询成功')
  },
  async relatedNavigation(moduleKey: string, recordIds: string[]): Promise<ApiResult<Record<string, RelatedNavigationItem[]>>> {
    await sleep(5)
    if (!hasPermission(useAuthStore().permissions, `${moduleKey}:view`)) return fail(403, '无权查看关联入口', {})
    const database = useDatabaseStore()
    const sourceRecords = visibleRecords(moduleKey).filter((item) => recordIds.includes(item.id))
    const accessibleRecords = Object.fromEntries(Object.keys(database.database.records).map((key) => [key, visibleRecords(key)]))
    const result: Record<string, RelatedNavigationItem[]> = {}
    for (const record of sourceRecords) {
      const items: RelatedNavigationItem[] = []
      for (const item of relatedNavigationCandidates(moduleKey, record, accessibleRecords)) {
        const targetConfig = moduleConfigs[item.targetModule]
        if (!targetConfig || !hasPermission(useAuthStore().permissions, targetConfig.permission)) continue
        const targetTab = targetConfig.tabs.find((tab) => tab.key === item.targetTab) || targetConfig.tabs[0]
        const sourceKey = targetTab?.source || item.targetModule
        const matched = filterRows(item.targetModule, visibleRecords(sourceKey), {
          pageNum: 1,
          pageSize: Number.MAX_SAFE_INTEGER,
          tab: targetTab?.key,
          relationFilters: item.relationFilters,
        })
        if (!matched.length) continue
        items.push({ ...item, count: matched.length })
      }
      result[record.id] = items.sort((left, right) => left.level === right.level ? left.label.localeCompare(right.label, 'zh-CN') : left.level === 'primary' ? -1 : 1)
    }
    return ok(result, '关联入口加载成功')
  },
  async options(optionSource: string, context: Record<string, unknown> = {}) {
    await sleep(5)
    let options: Array<{ label: string; value: string }> = []
    if (optionSource === 'warehouses') options = visibleRecords('warehouses').filter((item) => item.status === 'normal').map((item) => option(`${item.name} · ${item.region}`, item.id))
    if (optionSource === 'warehouse-locations') options = visibleRecords('warehouse-locations').filter((item) => item.status === 'normal' && (!context.warehouseId || item.warehouseId === context.warehouseId)).map((item) => option(`${item.name} · ${item.warehouseName}`, item.id))
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
          const headquarters = ['platform', 'custom'].includes(String(session?.role))
          return item.domain === session?.domain && item.status === 'normal' && item.category !== '注册申请' && id !== sourceId && activeOwners.has(id) && (headquarters || isParent || isPeer)
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
    if (optionSource === 'app-users') options = visibleRecords('users').filter((item) => item.status === 'normal').map((item) => option(`${item.name} · ${item.account}`, item.id))
    if (optionSource === 'dealer-regions') options = dealerRegionOptions
      .filter((item) => item.domain === useAuthStore().session?.domain)
      .map((item) => option(item.label, item.value))
    if (optionSource === 'device-types') options = useDatabaseStore().records('product-catalog')
      .filter((item) => item.status === 'normal')
      .map((item) => option(String(item.deviceType), String(item.deviceType)))
    if (optionSource === 'device-models') options = useDatabaseStore().records('product-catalog')
      .filter((item) => item.status === 'normal' && (!context.deviceType || item.deviceType === context.deviceType))
      .map((item) => option(`${item.name} · ${item.deviceModel} · ${item.specification || '规格待配置'}`, String(item.deviceModel)))
    if (optionSource === 'warehouse-devices') options = visibleRecords('devices').filter((item) => item.inventoryStatus === 'in_stock' && item.ownerId === 'platform' && (!context.warehouseId || item.warehouseId === context.warehouseId)).map((item) => option(`${item.code} · ${item.deviceType} · ${item.deviceModel} · ${item.specification || '-'} · ${item.warehouseLocation || '未分配库位'}`, item.code))
    if (optionSource === 'dealer-devices') options = visibleRecords('devices').filter((item) => item.ownerId !== 'platform' && item.inventoryStatus !== 'in_stock').map((item) => option(`${item.code} · ${item.deviceType} · ${item.deviceModel} · ${item.owner}`, item.code))
    if (optionSource === 'accessible-devices') options = visibleRecords('devices')
      .filter((item) => (!context.deviceType || item.deviceType === context.deviceType) && (!context.deviceModel || item.deviceModel === context.deviceModel))
      .map((item) => option(`${item.code} · ${item.deviceType} · ${item.deviceModel} · ${item.specification || '-'} · ${item.owner}`, item.code))
    if (optionSource === 'enabled-couriers') options = visibleRecords('couriers').filter((item) => item.category === '快递公司' && item.status === 'normal').map((item) => option(item.name, item.id))
    if (optionSource === 'active-materials') options = visibleRecords('material-catalog')
      .filter((item) => item.status !== 'disabled' && Number(item.stock || 0) > 0)
      .map((item) => option(`${item.name} · 库存 ${Number(item.stock || 0)}`, item.id))
    if (optionSource === 'product-descriptors') options = useDatabaseStore().records('product-catalog')
      .filter((item) => item.status === 'normal')
      .map((item) => option(`${item.descriptor || `${item.name} ${item.deviceModel}`} · ${item.specification || '规格待配置'}`, String(item.descriptor || `${item.name} ${item.deviceModel}`)))
    if (optionSource === 'ota-product-names') options = useDatabaseStore().records('product-catalog')
      .filter((item) => item.status === 'normal')
      .map((item) => option(item.name, item.name))
    if (optionSource === 'ota-device-types') {
      const names = stringArray(context.applicableProductNames)
      options = useDatabaseStore().records('product-catalog')
        .filter((item) => item.status === 'normal' && (!names.length || names.includes(String(item.name))))
        .map((item) => option(item.deviceType, item.deviceType))
    }
    if (optionSource === 'ota-device-models') {
      const names = stringArray(context.applicableProductNames)
      const types = stringArray(context.applicableDeviceTypes)
      options = useDatabaseStore().records('product-catalog')
        .filter((item) => item.status === 'normal'
          && (!names.length || names.includes(String(item.name)))
          && (!types.length || types.includes(String(item.deviceType))))
        .map((item) => option(`${item.deviceModel} · ${item.name} · ${item.specification || '规格待配置'}`, item.deviceModel))
    }
    if (optionSource === 'purchasable-items') options = [
      ...useDatabaseStore().records('product-catalog').filter((item) => item.status === 'normal').map((item) => option(`设备 · ${item.descriptor || `${item.name} ${item.deviceModel}`}`, `product:${item.id}`)),
      ...useDatabaseStore().records('material-catalog').filter((item) => item.status !== 'disabled').map((item) => option(`物料 · ${item.name}`, `material:${item.id}`)),
    ]
    if (optionSource === 'assignees') options = visibleRecords('auth-accounts').filter((item) => item.status === 'normal').map((item) => option(`${item.displayName || item.name} · ${item.roleLabel || ''}`, item.id))
    if (optionSource === 'tier1-approvers') options = useDatabaseStore().records('auth-accounts').filter((item) => item.status === 'normal' && item.roleKey === 'tier1').map((item) => option(`${item.displayName || item.name} · ${item.roleLabel || ''}`, item.id))
    if (optionSource === 'tier2-approvers') options = useDatabaseStore().records('auth-accounts').filter((item) => item.status === 'normal' && item.roleKey === 'tier2').map((item) => option(`${item.displayName || item.name} · ${item.roleLabel || ''}`, item.id))
    if (optionSource === 'platform-assignees') options = useDatabaseStore().records('auth-accounts').filter((item) => item.status === 'normal' && item.roleKey === 'platform').map((item) => option(`${item.displayName || item.name} · ${item.roleLabel || ''}`, item.id))
    if (optionSource === 'warranty-dealers') {
      const session = useAuthStore().session
      options = session?.role === 'platform'
        ? visibleRecords('dealers').filter((item) => item.status === 'normal').map((item) => option(item.name, item.organizationId || item.ownerId))
        : visibleRecords('dealers').filter((item) => String(item.organizationId || item.ownerId) === session?.ownerId).map((item) => option(item.name, item.organizationId || item.ownerId))
    }
    if (optionSource === 'roles') options = visibleRecords('roles').filter((item) => item.status === 'normal').map((item) => option(`${item.name} · ${item.dataScope}`, item.id))
    if (optionSource === 'repair-orders') {
      const issuance = visibleRecords('issuance').find((item) => item.id === context.recordId)
      options = visibleRecords('repairs')
        .filter((item) => !issuance?.deviceSN || item.deviceSN === issuance.deviceSN)
        .map((item) => option(`${item.code} · ${item.name} · ${item.status === 'completed' ? '已完成' : '处理中'}`, item.id))
    }
    return ok(uniqueOptions(options), '选项加载成功')
  },
  async resolveFields(moduleKey: string, form: Partial<EntityRecord>) {
    await sleep(5)
    if (moduleKey === 'product-purchase') form = { ...form, category: '设备采购' }
    return ok(deriveFields(canonicalModuleKey(moduleKey), form), '关联字段已更新')
  },
  async create(moduleKey: string, input: Partial<EntityRecord>) {
    await sleep()
    const permission = createDecision(moduleKey)
    if (!permission.allowed) return fail(403, permission.reason, null)
    const requestedModuleKey = moduleKey
    moduleKey = canonicalModuleKey(moduleKey)
    if (requestedModuleKey === 'product-purchase') input = { ...input, category: '设备采购' }
    const database = useDatabaseStore()
    const auth = useAuthStore()
    const session = auth.session as UserSession
    const payload = deriveFields(moduleKey, input)
    payload.code ||= generateBusinessCode(moduleKey, payload)
    if (moduleKey === 'material-catalog') payload.materialCode ||= payload.code
    if (moduleKey === 'materials') payload.name ||= `${payload.category === '设备采购' ? payload.deviceModel || '设备采购' : payload.materialName || '物料'} × ${payload.quantity || 1}`
    if (moduleKey === 'service-transfer') payload.name ||= `${payload.sourceDealer || '原经销商'} → ${payload.targetDealer || '目标经销商'}`
    if (moduleKey === 'sn-replacement') payload.name ||= `${payload.originalSN} → ${payload.newSN}`
    if (moduleKey === 'warranty') {
      payload.name ||= `${payload.dealer || '经销商'} · ${payload.productType || '设备'}质保`
      payload.category ||= String(payload.productType || '')
    }
    if (moduleKey === 'product-catalog') {
      payload.descriptor = `${payload.name || ''} ${payload.deviceModel || ''}`.trim()
      payload.category = String(payload.deviceType || '')
    }
    if (moduleKey === 'warehouses') payload.category ||= '区域仓'
    if (moduleKey === 'warehouse-locations') payload.category = '库位'
    if (moduleKey === 'app-versions') {
      payload.code ||= `APP-V${payload.name}`
      payload.category = '客户端版本'
    }
    if (moduleKey === 'dealers') payload.defaultWarrantyYears = Number(payload.defaultWarrantyYears || (auth.session?.domain === 'cn' ? 2 : 1))
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
          const identity = deviceIdentity(payload.deviceModel)
          const device = database.create('devices', { code: sn, name: identity.descriptor, productId: payload.productId, deviceName: String(payload.deviceName || identity.deviceName), deviceModel: identity.deviceModel, deviceType: identity.deviceType, specification: identity.specification, country: String(payload.region || '').split(/[·]/)[0].trim(), region: String(payload.region || ''), activation: 'inactive', activationDate: '', bindingStatus: 'unbound', account: '-', firmware: 'v1.0.0', inventoryStatus: 'in_stock', warehouseId: payload.warehouseId, warehouseName: payload.warehouseName, warehouseLocationId: payload.warehouseLocationId, warehouseLocation: payload.warehouseLocation, inboundAt: new Date().toISOString(), status: 'offline', owner: String(payload.warehouseName || '平台中心仓'), ownerId: 'platform', domain: session.domain })
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
      if (payload.category === '设备采购') {
        payload.paymentStatus = '未登记'
        payload.warrantyResult = '不适用'
        payload.purchaseStage = 'sales_confirmation'
        payload.purchaseStageLabel = '待销售确认'
        payload.contractStatus = '待确认'
        payload.deliveryStatus = '待处理'
        payload.initiatedBy = session.displayName
        payload.initiatedAt = new Date().toISOString()
      } else {
        const device = database.records('devices').find((item) => item.code === payload.deviceSN)
        const warranty = warrantyEvaluation(device)
        payload.warrantyResult = warranty.result
        payload.warrantyStartDate = warranty.startDate
        payload.warrantyUntil = warranty.endDate
      }
      payload.status = 'pending'
      payload.applyTime = new Date().toISOString()
      payload.dealer ||= session.displayName
    }
    if (moduleKey === 'devices') Object.assign(payload, { country: String(payload.region || '').split(/[·]/)[0].trim(), firmware: 'v1.0.0', activation: 'inactive', activationDate: '', bindingStatus: 'unbound', account: '-', userId: '', status: 'offline' })
    if (moduleKey === 'warranty' && auth.session?.role === 'platform') return fail(403, '平台管理员仅查看全部质保规则，经销商只能维护自身规则', null)
    if (moduleKey === 'couriers' && payload.apiKey) {
      payload.apiKeyMasked = `********${String(payload.apiKey).slice(-4)}`
      delete payload.apiKey
    }
    if (moduleKey === 'dealers') Object.assign(payload, { category: payload.tier, defaultWarrantyYears: Number(payload.defaultWarrantyYears || (auth.session?.domain === 'cn' ? 2 : 1)), mustChangePassword: true, deviceCount: 0, organizationId: `dealer-${Date.now().toString(36)}` })
    if (moduleKey === 'sn-replacement') {
      const original = visibleRecords('devices').find((item) => item.code === payload.originalSN)!
      Object.assign(payload, { status: 'pending', owner: original.owner, ownerId: original.ownerId, domain: original.domain })
    }
    if (moduleKey === 'service-transfer') Object.assign(payload, { status: 'pending', approvalStage: 'target_confirmation', feeStatus: payload.hasFee ? '待总部审批' : '无费用', initiatedBy: session.displayName, initiatorAccountId: session.accountId, initiatorRole: session.role, initiatedAt: new Date().toISOString(), owner: payload.sourceDealer, ownerId: payload.sourceDealerId })
    if (moduleKey === 'warehouse' && ['出库', '调货'].includes(String(payload.category))) {
      const selectedDevices = Array.isArray(payload.selectedDevices) ? payload.selectedDevices : []
      Object.assign(payload, {
        name: payload.name || `${payload.targetDealer || '接收经销商'}${payload.category}单`,
        status: 'pending',
        quantity: selectedDevices.length,
        deviceSN: selectedDevices.join('、'),
      })
    }
    if (moduleKey === 'roles') Object.assign(payload, { roleKey: 'custom', permissions: [], permissionCount: 0 })
    if (moduleKey === 'admins') {
      const role = database.records('roles').find((item) => item.id === payload.roleId)!
      Object.assign(payload, { role: role.name, dataScope: role.dataScope, category: payload.ownerId === 'platform' ? '平台' : '经销商', isSuperAdmin: false, accountLevel: '普通管理员' })
    }
    const record = database.create(moduleKey, { ...payload, ownerId: payload.ownerId || session.ownerId, owner: payload.owner || session.displayName, domain: payload.domain || session.domain })
    if (moduleKey === 'devices' && Array.isArray(record.components)) {
      for (const component of record.components as Array<Record<string, unknown>>) database.create('device-components', { name: String(component.specification), serialNumber: component.serialNumber, specification: component.specification, deviceId: record.id, deviceSN: record.code, status: 'normal', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
    }
    if (moduleKey === 'projects') {
      database.create('project-history', { code: `${record.code}-H001`, name: `${record.name}初始记录`, projectId: record.id, projectCode: record.code, changeType: '新增', snapshot: JSON.stringify({ shipOwner: record.shipOwner, owner: record.owner, ownerId: record.ownerId, deviceSN: record.deviceSN, warrantyUntil: record.warrantyUntil }), operator: session.displayName, status: 'completed', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
      syncProjectInstallationReview(record)
    }
    if (moduleKey === 'materials' && record.category === '设备采购' && Array.isArray(record.purchaseItems)) {
      for (const item of record.purchaseItems as Array<Record<string, unknown>>) database.create('purchase-items', { name: String(item.itemName || '采购项目'), subjectId: record.id, subjectCode: record.code, itemType: item.itemType, itemId: item.itemId, itemName: item.itemName, quantity: item.quantity, unitPrice: item.unitPrice, subtotal: item.subtotal, status: 'pending', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
    }
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
    if (moduleKey === 'admins' && record.isSuperAdmin && (input.status === 'disabled' || input.roleId && input.roleId !== record.roleId || input.ownerId && input.ownerId !== 'platform')) return fail(409, '唯一超级管理员不能停用、降级或变更归属组织', null)
    if (moduleKey === 'warranty' && (auth.session?.role === 'platform' || String(record.dealerId || record.ownerId) !== auth.session?.ownerId)) {
      return fail(403, '经销商只能编辑自身质保规则', null)
    }
    const editableInput = moduleKey === 'approval-flow'
      ? Object.fromEntries(['levels', 'level1ApproverId', 'level2ApproverId', 'platformApproverId'].filter((field) => Object.hasOwn(input, field)).map((field) => [field, input[field]]))
      : input
    const payload = deriveFields(moduleKey, ['faq-documents', 'projects'].includes(moduleKey) ? { ...record, ...editableInput, id } : { ...editableInput, id })
    if (moduleKey === 'approval-flow') Object.assign(payload, { name: record.name, menuKey: record.menuKey, menuLabel: record.menuLabel, flowType: record.flowType, flowTypeLabel: record.flowTypeLabel, businessFlow: record.businessFlow, status: 'normal' })
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
    const updated = database.transaction(() => {
      if (moduleKey === 'projects') {
        database.create('project-history', { code: `${record.code}-H${Date.now().toString().slice(-6)}`, name: `${record.name}编辑前记录`, projectId: record.id, projectCode: record.code, changeType: '编辑', snapshot: JSON.stringify({ shipOwner: record.shipOwner, owner: record.owner, ownerId: record.ownerId, deviceSN: record.deviceSN, warrantyUntil: record.warrantyUntil, usageRegion: record.usageRegion, summary: record.summary }), operator: auth.session!.displayName, status: 'completed', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
      }
      if (moduleKey === 'product-catalog' && Number(record.referencePrice || 0) !== Number(payload.referencePrice || 0) || moduleKey === 'material-catalog' && Number(record.price || 0) !== Number(payload.price || 0)) {
        database.create('price-history', { name: `${record.name}价格变更`, productId: record.id, productCode: record.code, oldPrice: Number(record.referencePrice || record.price || 0), newPrice: Number(payload.referencePrice || payload.price || 0), operator: auth.session!.displayName, status: 'completed', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
      }
      if (moduleKey === 'warranty') {
        database.create('warranty-history', { name: `${record.name}规则变更`, ruleId: record.id, snapshot: `${payload.market || record.market} · ${payload.warrantyStartPoint || record.warrantyStartPoint} · 人工 ${payload.laborMonths || record.laborMonths} 月 · 物料 ${payload.materialMonths || record.materialMonths} 月`, operator: auth.session!.displayName, status: 'completed', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
      }
      const saved = database.update(moduleKey, id, payload)!
      if (moduleKey === 'projects') return syncProjectInstallationReview(saved)
      return saved
    })
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
    if (!['projects', 'material-catalog', 'banners', 'faq-documents'].includes(moduleKey)) return fail(405, '该业务属于审计数据，不允许删除', false)
    if (!reason.trim()) return fail(422, '请填写删除原因', false)
    const removed = database.remove(moduleKey, id)
    database.audit(`删除${moduleConfigs[moduleKey]?.title || moduleKey}`, `${record.code} · ${reason}`, auth.session!.displayName, true, record)
    return ok(removed, '删除成功')
  },
  async action(moduleKey: string, id: string, actionKey: string, input: Record<string, unknown> | string = {}): Promise<ApiResult<EntityRecord | null>> {
    await sleep()
    moduleKey = canonicalModuleKey(moduleKey)
    const database = useDatabaseStore()
    const auth = useAuthStore()
    const payload = typeof input === 'string' ? { reason: input, result: input, replyContent: input } : input
    const record = visibleRecords(moduleKey).find((item) => item.id === id)
    if (!record) return fail(403, '记录不存在或无权操作', null)
    const authorization = actionDecision(moduleKey, record, actionKey)
    if (!authorization.allowed) {
      database.audit(`操作失败：${actionKey}`, `${record.code} · ${authorization.reason}`, auth.session?.displayName || '未知账号', true, record, 'failed')
      return fail(authorization.code, authorization.reason, null)
    }
    if (moduleKey === 'approval-center' && ['approve-original', 'reject-original'].includes(actionKey)) {
      const sourceModule = String(record.sourceModule || record.menuKey || '')
      const sourceId = String(record.subjectId || '')
      if (sourceModule === 'materials') return mockService.action(sourceModule, sourceId, actionKey === 'approve-original' ? 'approve' : 'reject', payload)
      if (sourceModule === 'warehouse') return mockService.action(sourceModule, sourceId, 'process', { ...payload, decision: actionKey === 'approve-original' ? 'approved' : 'rejected' })
      return fail(409, '该审批需进入原业务单处理', null)
    }
    const actionConfig = moduleConfigs[moduleKey]?.actions?.find((item) => item.key === actionKey)
    if (actionConfig?.allowedStatuses?.length && !actionConfig.allowedStatuses.includes(record.status)) return fail(409, `当前状态“${record.status}”不能执行${actionConfig.label}`, null)
    const actionValidation = validateActionFields(actionConfig?.fields, payload)
    if (actionValidation) return fail(422, actionValidation, null)
    const patch: Partial<EntityRecord> = {}

    if (actionKey === 'toggle') {
      if (moduleKey === 'admins' && record.isSuperAdmin) {
        database.audit('操作失败：停用超级管理员', `${record.code} · 唯一超级管理员不能停用`, auth.session?.displayName || '未知账号', true, record, 'failed')
        return fail(409, '唯一超级管理员不能停用', null)
      }
      if (moduleKey === 'faq-documents' && record.status === 'disabled' && record.fileStatus !== 'valid') return fail(409, 'PDF 文件已失效，请重新上传后再发布', null)
      patch.status = record.status === 'disabled' ? moduleKey === 'faq-documents' ? 'published' : 'normal' : 'disabled'
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
    if (actionKey === 'publish') {
      const nextPublished = record.status !== 'published'
      Object.assign(patch, { status: nextPublished ? 'published' : moduleKey === 'app-versions' ? 'disabled' : 'withdrawn', releaseAt: nextPublished ? new Date().toISOString() : record.releaseAt })
      if (moduleKey === 'ota' && nextPublished) {
        const compatible = database.records('devices').filter((item) => otaMatchesDevice(record, item))
        for (const device of compatible) database.create('ota-results', { name: `${device.code}升级结果`, firmwareId: record.id, deviceSN: device.code, deviceName: device.deviceName, deviceType: device.deviceType, deviceModel: device.deviceModel, targetVersion: record.name, result: 'simulated_success', resultLabel: '静态模拟成功', completedAt: new Date().toISOString(), status: 'completed', owner: device.owner, ownerId: device.ownerId, domain: device.domain })
      }
    }
    if (actionKey === 'rollback' && moduleKey === 'ota') {
      database.create('ota-rollbacks', { name: `${record.name}回滚登记`, firmwareId: record.id, targetVersion: payload.targetVersion, reason: payload.reason, operator: auth.session!.displayName, status: 'completed', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
      patch.status = 'withdrawn'
    }
    if (['remote-disable', 'remote-enable'].includes(actionKey)) {
      const offlineQueued = actionKey === 'remote-disable' && record.status === 'offline'
      if (offlineQueued) Object.assign(patch, { commandStatus: 'queued_offline', pendingRemoteStatus: 'disabled' })
      else patch.status = actionKey === 'remote-disable' ? 'disabled' : 'online'
      database.create('device-commands', {
        code: `CMD-${Date.now().toString().slice(-8)}`,
        name: actionKey === 'remote-disable' ? '远程禁用' : '远程启用',
        deviceId: record.id,
        deviceSN: record.code,
        requestedStatus: actionKey === 'remote-disable' ? 'disabled' : 'online',
        reason: payload.reason,
        result: offlineQueued ? 'queued_offline' : 'simulated_success',
        resultLabel: offlineQueued ? '设备离线，待联网后下发' : '纯前端模拟成功',
        status: offlineQueued ? 'pending' : 'completed',
        owner: record.owner,
        ownerId: record.ownerId,
        domain: record.domain,
      })
      if (offlineQueued) database.notify('远程禁用指令等待下发', `${record.code} 当前无网络，设备联网后再下发禁用指令`, record, 'risk')
    }
    if (actionKey === 'reply') {
      createRelation('replies', record, { sourceModule: moduleKey, content: payload.replyContent, operator: auth.session!.displayName, channel: '站内信', status: 'completed' })
      patch.lastReply = payload.replyContent
      if (moduleKey === 'messages') patch.status = 'completed'
      database.notify('业务回复已发送', `${record.code} · ${String(payload.replyContent).slice(0, 60)}`, record)
    }
    if (actionKey === 'record-bill' && moduleKey === 'repairs') {
      const laborHours = Number(payload.laborHours || 0)
      const laborUnitPrice = Number(payload.laborUnitPrice || 0)
      const materialAmount = Number(payload.materialAmount || 0)
      const adjustment = Number(payload.adjustment || 0)
      const orderStatus = 'pending'
      const paymentChannel = '二维码支付'
      const paidAt = ''
      const laborSubtotal = Math.round(laborHours * laborUnitPrice * 100) / 100
      const total = Math.round((laborSubtotal + materialAmount + adjustment) * 100) / 100
      if (laborHours < 0.5 || laborUnitPrice < 0 || materialAmount < 0 || total <= 0) return fail(422, '人工工时、费用明细或账单总额无效', null)
      const payment = database.transaction(() => {
        const expense = createRelation('expense-records', record, {
          name: `${record.code}维修账单`, category: '维修账单', laborHours, laborUnitPrice, laborSubtotal,
          materialAmount, adjustment, amount: total, currency: 'CNY', paymentMethod: paymentChannel,
          paymentReference: '', paidAt, paymentNote: payload.billingNote,
          operator: auth.session!.displayName, status: orderStatus,
        })
        const createdPayment = database.create('payments', {
          code: `BILL-${Date.now().toString().slice(-11)}`, name: `${record.code}维修账单`, category: '平台维修账单',
          sourceType: 'platform', sourceLabel: '平台费用登记', businessType: '维修账单', channel: paymentChannel,
          amount: total, orderAmount: total, paidAmount: 0, remainingAmount: total, paymentCount: 0, currency: 'CNY', account: record.account || record.owner, paidAt,
          paymentReference: '', paymentInstruction: '扫描订单对应的供应商收款二维码，付款后上传截图；金额与订单由财务人工核实。', expenseRecordId: expense.id, subjectId: record.id,
          subjectCode: record.code, subjectModule: 'repairs', recordedBy: auth.session!.displayName,
          orderRole: 'parent', status: orderStatus, owner: record.owner, ownerId: record.ownerId, domain: record.domain,
        })
        database.update('payments', createdPayment.id, { parentOrderCode: createdPayment.code })
        const items = [
          { feeType: '人工费', itemName: '维修人工服务', quantity: laborHours, unitPrice: laborUnitPrice, subtotal: laborSubtotal },
          ...(materialAmount > 0 ? [{ feeType: '物料费', itemName: '维修物料', quantity: 1, unitPrice: materialAmount, subtotal: materialAmount }] : []),
        ]
        items.forEach((item, index) => database.create('billing-items', {
          name: item.itemName, paymentId: createdPayment.id, subjectId: record.id, subjectCode: record.code,
          ...item, adjustment: index === items.length - 1 ? adjustment : 0, status: orderStatus,
          owner: record.owner, ownerId: record.ownerId, domain: record.domain,
        }))
        return createdPayment
      })
      Object.assign(patch, { billingPaymentId: payment.id, billingStatus: orderStatus, billingAmount: total })
      database.notify('维修账单已登记', `${record.code} · ¥${total.toLocaleString()} · ${paymentChannel}`, record)
    }
    if (actionKey === 'complete-replacement' && moduleKey === 'issuance') {
      if (String(payload.oldPartSerial) === String(payload.newPartSerial)) return fail(422, '旧件编号与新件编号不能相同', null)
      const repair = database.records('repairs').find((item) => item.id === payload.repairId)
      if (!repair || repair.deviceSN !== record.deviceSN) return fail(422, '请选择与当前设备一致的维修工单', null)
      database.create('replacement-records', { name: `${record.materialName || record.name}更换记录`, issuanceId: record.id, sourceRequestId: record.sourceRequestId, repairId: repair.id, repairCode: repair.code, deviceSN: record.deviceSN, oldPartSerial: payload.oldPartSerial, newPartSerial: payload.newPartSerial, reason: payload.reason, operator: auth.session!.displayName, status: 'completed', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
      database.update('repairs', repair.id, { hasReplacement: true, replacementNote: `${payload.oldPartSerial} → ${payload.newPartSerial}` })
      Object.assign(patch, { status: 'completed', replacedAt: new Date().toISOString(), oldPartSerial: payload.oldPartSerial, newPartSerial: payload.newPartSerial })
      const sourceRequest = database.records('materials').find((item) => item.id === record.sourceRequestId || item.code === record.sourceRequestCode)
      if (sourceRequest) database.update('materials', sourceRequest.id, { status: 'completed', completedAt: new Date().toISOString(), fulfillmentStatus: '已完成' })
    }
    if (actionKey === 'confirm-receipt' && moduleKey === 'issuance') {
      Object.assign(patch, { status: 'received', receivedAt: new Date().toISOString(), receivedBy: auth.session!.displayName, receiptNote: payload.reason })
      const sourceRequest = database.records('materials').find((item) => item.id === record.sourceRequestId || item.code === record.sourceRequestCode)
      if (sourceRequest) database.update('materials', sourceRequest.id, { fulfillmentStatus: '已收货，待更换' })
      database.notify('售后物料已确认收货', `${record.code} · ${record.materialName || record.name}`, record)
    }
    if (actionKey === 'unbind') {
      const targetSN = `${record.code}-1`
      if (database.records('devices').some((item) => item.id !== record.id && item.code === targetSN)) return fail(409, `目标 SN ${targetSN} 已存在，请先处理编号冲突`, null)
      const oldAccount = String(record.account || '-')
      Object.assign(patch, { code: targetSN, account: '-', userId: '', bindingStatus: 'unbound', boundAt: '' })
      createRelation('ownership-history', record, { deviceId: record.id, deviceSN: targetSN, fromOwner: oldAccount, toOwner: '未绑定', operationType: '强制解绑', operator: auth.session!.displayName, status: 'completed' })
      database.notify('设备已强制解绑', `${record.code} 已归档为 ${targetSN}`, record, 'risk')
    }
    if (actionKey === 'ship') {
      const courier = database.records('couriers').find((item) => item.id === payload.courierId && item.category === '快递公司' && item.status === 'normal')
      if (!courier) return fail(422, '请选择已启用的快递公司', null)
      if (!String(payload.trackingNo || '').trim()) return fail(422, '请填写物流单号', null)
      if (database.records('logistics-records').some((item) => item.trackingNo === payload.trackingNo)) return fail(409, '物流单号已被使用', null)
      Object.assign(patch, { status: 'shipped', courier: courier.name, courierId: courier.id, trackingNo: payload.trackingNo, shipmentPhoto: payload.shipmentPhoto, shippedAt: new Date().toISOString() })
      try {
        database.transaction(() => {
          deductMaterialStock(record)
          createRelation('logistics-records', record, { courier: courier.name, courierId: courier.id, trackingNo: payload.trackingNo, shipmentPhoto: payload.shipmentPhoto, content: '已揽收，等待转运', status: 'shipped' })
          database.create('issuance', { code: `ISS-${Date.now().toString().slice(-8)}`, name: String(record.materialName || record.name), materialName: record.materialName, materialId: record.materialId, quantity: record.quantity, sourceRequestId: record.id, sourceRequestCode: record.code, deviceSN: record.deviceSN, courier: courier.name, courierId: courier.id, trackingNo: payload.trackingNo, shipmentPhoto: payload.shipmentPhoto, recipient: record.dealer || record.owner, issuedAt: new Date().toISOString(), replacedAt: '', status: 'shipped', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
        })
      } catch (error) {
        return fail(422, error instanceof Error ? error.message : '库存扣减失败', null)
      }
      database.notify('物料已发货', `${record.code} · ${courier.name} · ${payload.trackingNo}`, record)
    }
    if (actionKey === 'start-production' && moduleKey === 'materials') {
      Object.assign(patch, {
        purchaseStage: 'finance_confirmation', purchaseStageLabel: '待财务核实',
        productionBatchNo: payload.productionBatchNo, productionAt: payload.productionAt,
        productionImportedAt: new Date().toISOString(), productionImportedBy: auth.session!.displayName,
        productionNote: payload.reason, status: 'approved', paymentStatus: '待核实',
      })
      database.notify('设备采购已导入生产', `${record.code} · 批次 ${String(payload.productionBatchNo)}`, record)
    }
    if (['finance-confirm', 'record-expense'].includes(actionKey)) {
      const actualUnitPrice = Number(payload.actualUnitPrice || 0)
      const installmentAmount = Math.round(Number(payload.paidAmount || 0) * 100) / 100
      const purchaseItems = database.records('purchase-items').filter((item) => item.subjectId === record.id)
      const orderAmount = Math.round(Number(record.orderAmount || (actualUnitPrice > 0 && purchaseItems.length <= 1
        ? actualUnitPrice * Number(record.quantity || purchaseItems[0]?.quantity || 0)
        : record.amount || 0)) * 100) / 100
      const previousPaidAmount = Math.round(Number(record.paidAmount || 0) * 100) / 100
      const remainingBeforePayment = Math.max(0, Math.round((orderAmount - previousPaidAmount) * 100) / 100)
      if (installmentAmount <= 0 || orderAmount <= 0) return fail(422, '采购费用必须大于 0', null)
      if (installmentAmount - remainingBeforePayment > 0.01) return fail(422, `本次付款不能超过待付金额 ¥${remainingBeforePayment.toLocaleString()}`, null)
      if (!String(payload.paymentProof || '').startsWith('data:image/') || !String(payload.paymentReference || '').trim() || !String(payload.paidAt || '').trim()) return fail(422, '请完整填写付款截图、支付凭证号和日期', null)
      if (database.records('expense-records').some((item) => item.paymentReference === payload.paymentReference)) return fail(409, '付款凭证/流水号已登记', null)
      const paidAmount = Math.round((previousPaidAmount + installmentAmount) * 100) / 100
      const remainingAmount = Math.max(0, Math.round((orderAmount - paidAmount) * 100) / 100)
      const fullyPaid = remainingAmount <= 0.01
      const releasedToWarehouse = record.purchaseStage === 'warehouse_fulfillment' || payload.warehouseDecision === 'release'
      const paymentCount = Number(record.paymentCount || 0) + 1
      Object.assign(patch, {
        actualUnitPrice: purchaseItems.length > 1 ? 0 : actualUnitPrice || Number(purchaseItems[0]?.unitPrice || record.estimatedUnitPrice || 0),
        amount: orderAmount,
        orderAmount,
        paidAmount,
        remainingAmount,
        paymentCount,
        currency: 'CNY',
        paymentStatus: fullyPaid ? '已核实付清' : '已核实部分付款',
        paymentMethod: '二维码支付',
        paymentProof: payload.paymentProof,
        paymentReference: payload.paymentReference,
        paidAt: payload.paidAt,
        paymentNote: payload.paymentNote,
        contractStatus: payload.contractStatus || '无需合同',
        contractNo: payload.contractNo || '',
        financeConfirmedAt: new Date().toISOString(),
        financeConfirmedBy: auth.session!.displayName,
        warehouseDecision: payload.warehouseDecision,
        warehouseDecisionLabel: releasedToWarehouse ? '允许进入仓库处理' : '暂不放行',
        purchaseStage: releasedToWarehouse ? 'warehouse_fulfillment' : 'finance_confirmation',
        purchaseStageLabel: releasedToWarehouse ? '待仓库发货' : `待财务核实（已核实 ¥${paidAmount.toLocaleString()}）`,
        deliveryStatus: releasedToWarehouse ? '待发货' : '财务暂未放行',
        status: 'approved',
      })
      const expense = createRelation('expense-records', record, {
        name: `${record.deviceModel || record.name}第 ${paymentCount} 笔采购付款`,
        category: '设备采购',
        amount: installmentAmount,
        orderAmount,
        accumulatedPaidAmount: paidAmount,
        remainingAmount,
        paymentSequence: paymentCount,
        actualUnitPrice,
        quantity: record.quantity,
        currency: 'CNY',
        paymentMethod: '二维码支付',
        paymentProof: payload.paymentProof,
        paymentReference: payload.paymentReference,
        paidAt: payload.paidAt,
        paymentNote: payload.paymentNote,
        warehouseDecision: payload.warehouseDecision,
        warehouseDecisionLabel: releasedToWarehouse ? '允许进入仓库处理' : '暂不放行',
        contractStatus: payload.contractStatus || '无需合同',
        contractNo: payload.contractNo || '',
        operator: auth.session!.displayName,
        status: 'completed',
      })
      recordPlatformBill(record, expense, 'materials')
      database.notify(releasedToWarehouse ? '设备采购付款已核实并放行' : '设备采购付款已核实', `${record.code} · 本次 ¥${installmentAmount.toLocaleString()} · 累计 ¥${paidAmount.toLocaleString()}`, record)
    }
    if (actionKey === 'purchase-ship') {
      const selected = Array.isArray(payload.selectedDevices) ? payload.selectedDevices.map(String) : []
      const courier = database.records('couriers').find((item) => item.id === payload.courierId && item.category === '快递公司' && item.status === 'normal')
      if (!courier) return fail(422, '请选择已启用的快递公司', null)
      if (database.records('logistics-records').some((item) => item.trackingNo === payload.trackingNo)) return fail(409, '物流单号已被使用', null)
      const items = database.records('purchase-items').filter((item) => item.subjectId === record.id)
      const deviceItems = items.filter((item) => item.itemType === '设备')
      const requiredDeviceCount = deviceItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
      if (selected.length !== requiredDeviceCount) return fail(422, `本采购单需选择 ${requiredDeviceCount} 台设备，当前已选 ${selected.length} 台`, null)
      const devices = selected.map((sn) => database.records('devices').find((item) => item.code === sn))
      if (devices.some((item) => !item || item.inventoryStatus !== 'in_stock' || item.ownerId !== 'platform')) return fail(422, '所选设备包含非在库、已出库或不存在的 SN', null)
      const remaining = [...devices] as EntityRecord[]
      for (const item of deviceItems) {
        const descriptor = String(item.itemName || '')
        for (let index = 0; index < Number(item.quantity || 0); index += 1) {
          const matchedIndex = remaining.findIndex((device) => device.name === descriptor || device.deviceModel === descriptor || descriptor.includes(String(device.deviceModel || '')))
          if (matchedIndex < 0) return fail(422, `所选设备与采购明细“${descriptor} × ${item.quantity}”不匹配`, null)
          remaining.splice(matchedIndex, 1)
        }
      }
      const warehouse = database.records('warehouses').find((item) => item.id === payload.warehouseId && item.status === 'normal')
      if (!warehouse) return fail(422, '请选择有效且已启用的发货仓库', null)
      if (devices.some((device) => device?.warehouseId && device.warehouseId !== warehouse.id)) return fail(422, '所选设备不属于指定发货仓库', null)
      try {
        database.transaction(() => {
          const subject = { ...record, selectedDevices: selected } as EntityRecord
          transferDevices(subject, record.ownerId, '设备出库')
          for (const item of items.filter((entry) => entry.itemType === '物料')) {
            const catalog = database.records('material-catalog').find((entry) => entry.id === item.itemId)
            const quantity = Number(item.quantity || 0)
            if (!catalog || Number(catalog.stock || 0) < quantity) throw new Error(`物料 ${item.itemName} 库存不足`)
            const before = Number(catalog.stock || 0)
            database.update('material-catalog', catalog.id, { stock: before - quantity, status: before - quantity <= Number(catalog.warningThreshold || 10) ? 'low' : 'normal' })
            database.create('stock-movements', { name: catalog.name, category: '采购随单发货', materialId: catalog.id, quantity: -quantity, beforeStock: before, afterStock: before - quantity, subjectId: record.id, subjectCode: record.code, status: 'completed', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
          }
          database.create('purchase-fulfillments', {
            code: `FUL-${Date.now().toString().slice(-10)}`, name: `${record.code}仓库发货`, subjectId: record.id, subjectCode: record.code,
            warehouseId: warehouse.id, warehouseName: warehouse.name, selectedDevices: selected, deviceSN: selected.join('、'),
            deliveryMethod: '物流配送', deliveryReference: payload.trackingNo, courier: courier.name, courierId: courier.id,
            trackingNo: payload.trackingNo, shipmentPhoto: payload.shipmentPhoto, shippedAt: payload.shippedAt,
            operator: auth.session!.displayName, status: 'shipped', owner: record.owner, ownerId: record.ownerId, domain: record.domain,
          })
          createRelation('logistics-records', record, { courier: courier.name, courierId: courier.id, trackingNo: payload.trackingNo, shipmentPhoto: payload.shipmentPhoto, content: '已发货，等待物流更新', status: 'shipped' })
        })
      } catch (error) {
        return fail(422, error instanceof Error ? error.message : '采购发货失败', null)
      }
      Object.assign(patch, {
        selectedDevices: selected,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        deliveryMethod: '物流配送',
        deliveryReference: payload.trackingNo,
        courier: courier.name,
        courierId: courier.id,
        trackingNo: payload.trackingNo,
        shipmentPhoto: payload.shipmentPhoto,
        shippedAt: payload.shippedAt,
        purchaseStage: 'shipped',
        purchaseStageLabel: '已发货',
        deliveryStatus: '已发货',
        status: 'shipped',
      })
      database.notify('设备采购已发货', `${record.code} · ${selected.length} 台 · ${warehouse.name}`, record)
    }
    if (actionKey === 'confirm-purchase-receipt' && moduleKey === 'materials') {
      Object.assign(patch, {
        purchaseStage: 'received', purchaseStageLabel: '已收货', deliveryStatus: '已收货',
        receivedAt: new Date().toISOString(), receivedBy: auth.session!.displayName,
        receiptPhoto: payload.receiptPhoto || '', receiptNote: payload.reason, status: 'completed',
      })
      const fulfillment = database.records('purchase-fulfillments').find((item) => item.subjectId === record.id && item.status === 'shipped')
      if (fulfillment) database.update('purchase-fulfillments', fulfillment.id, { status: 'received', receivedAt: patch.receivedAt, receivedBy: patch.receivedBy, receiptPhoto: patch.receiptPhoto, receiptNote: patch.receiptNote })
      database.notify('设备采购已确认收货', `${record.code} · ${String(payload.reason || '')}`, record)
    }
    if (actionKey === 'test') {
      database.create('external-call-logs', { code: `EXT-${Date.now().toString().slice(-8)}`, name: '快递100轨迹测试', category: '物流接口', provider: '快递100', requestRef: payload.trackingNo, responseTime: 286, result: 'simulated_success', resultLabel: '静态模拟成功', status: 'completed', owner: record.owner, ownerId: record.ownerId, domain: record.domain })
    }
    if (actionKey === 'finance-verify' && moduleKey === 'payments') {
      const installmentAmount = Math.round(Number(payload.paidAmount || 0) * 100) / 100
      const orderAmount = Math.round(Number(record.orderAmount || record.amount || 0) * 100) / 100
      const previousPaidAmount = Math.round(Number(record.paidAmount || 0) * 100) / 100
      const remainingBeforePayment = Math.max(0, Math.round((orderAmount - previousPaidAmount) * 100) / 100)
      if (installmentAmount <= 0) return fail(422, '本次核实金额必须大于 0', null)
      if (installmentAmount - remainingBeforePayment > 0.01) return fail(422, `本次核实金额不能超过待付金额 ¥${remainingBeforePayment.toLocaleString()}`, null)
      if (!String(payload.paymentProof || '').startsWith('data:image/')) return fail(422, '请上传有效的付款截图', null)
      if (database.records('payment-transactions').some((item) => item.paymentReference === payload.paymentReference)) return fail(409, '支付凭证号已核实', null)
      const paidAmount = Math.round((previousPaidAmount + installmentAmount) * 100) / 100
      const remainingAmount = Math.max(0, Math.round((orderAmount - paidAmount) * 100) / 100)
      const status = remainingAmount <= 0.01 ? 'verified' : 'pending'
      const installmentNo = Number(record.paymentCount || 0) + 1
      const parentOrderCode = String(record.parentOrderCode || record.code)
      const childOrderCode = `${parentOrderCode}-P${String(installmentNo).padStart(2, '0')}`
      const previousVerifiedChildOrderCodes = database.records('payment-transactions')
        .filter((item) => item.paymentId === record.id && item.status === 'verified')
        .sort((left, right) => Number(left.installmentNo || 0) - Number(right.installmentNo || 0))
        .map((item) => String(item.childOrderCode || item.code))
        .join('、')
      const verifiedAt = new Date().toISOString()
      database.create('payment-transactions', {
        code: childOrderCode, childOrderCode, name: `${parentOrderCode}第 ${installmentNo} 笔付款`,
        paymentId: record.id, parentPaymentId: record.id, parentOrderCode, installmentNo, installmentLabel: `第 ${installmentNo} 笔付款`,
        previousVerifiedChildOrderCodes, subjectId: record.subjectId, subjectCode: record.subjectCode,
        orderAmount, previousPaidAmount, amount: installmentAmount, currentPaymentAmount: installmentAmount,
        paidAmountAfter: paidAmount, remainingAmountAfter: remainingAmount,
        channel: '二维码支付', paymentReference: payload.paymentReference,
        paymentProof: payload.paymentProof, paidAt: payload.paidAt, verificationNote: payload.verificationNote,
        verifiedAt, verifiedBy: auth.session!.displayName, operator: auth.session!.displayName,
        status: 'verified', owner: record.owner, ownerId: record.ownerId, domain: record.domain,
      })
      Object.assign(patch, {
        orderRole: 'parent', parentOrderCode, lastChildOrderCode: childOrderCode,
        childOrderCodes: [previousVerifiedChildOrderCodes, childOrderCode].filter(Boolean).join('、'),
        orderAmount, paidAmount, remainingAmount, paymentCount: installmentNo,
        channel: '二维码支付', paymentReference: payload.paymentReference, paymentProof: payload.paymentProof,
        paidAt: payload.paidAt, verificationNote: payload.verificationNote,
        verifiedAt, verifiedBy: auth.session!.displayName, status,
      })
      database.notify(status === 'verified' ? '支付订单已全部核实' : '部分付款已核实，订单待继续支付', `${record.code} · 本次 ¥${installmentAmount.toLocaleString()} · 待付 ¥${remainingAmount.toLocaleString()}`, record)
    }
    if (actionKey === 'record-payment' && moduleKey === 'payments') {
      const installmentAmount = Math.round(Number(payload.paidAmount || 0) * 100) / 100
      const orderAmount = Math.round(Number(record.orderAmount || record.amount || 0) * 100) / 100
      const previousPaidAmount = Math.round(Number(record.paidAmount || 0) * 100) / 100
      const remainingBeforePayment = Math.max(0, Math.round((orderAmount - previousPaidAmount) * 100) / 100)
      if (installmentAmount <= 0) return fail(422, '本次付款金额必须大于 0', null)
      if (installmentAmount - remainingBeforePayment > 0.01) return fail(422, `本次付款不能超过待付金额 ¥${remainingBeforePayment.toLocaleString()}`, null)
      if (database.records('payment-transactions').some((item) => item.paymentReference === payload.paymentReference)) return fail(409, '付款凭证/流水号已登记', null)
      const paidAmount = Math.round((previousPaidAmount + installmentAmount) * 100) / 100
      const remainingAmount = Math.max(0, Math.round((orderAmount - paidAmount) * 100) / 100)
      const status = remainingAmount <= 0.01 ? 'verified' : 'pending'
      const installmentNo = Number(record.paymentCount || 0) + 1
      const parentOrderCode = String(record.parentOrderCode || record.code)
      const childOrderCode = `${parentOrderCode}-P${String(installmentNo).padStart(2, '0')}`
      const previousVerifiedChildOrderCodes = database.records('payment-transactions')
        .filter((item) => item.paymentId === record.id && item.status === 'verified')
        .sort((left, right) => Number(left.installmentNo || 0) - Number(right.installmentNo || 0))
        .map((item) => String(item.childOrderCode || item.code))
        .join('、')
      database.create('payment-transactions', {
        code: childOrderCode, childOrderCode, name: `${parentOrderCode}第 ${installmentNo} 笔付款`,
        paymentId: record.id, parentPaymentId: record.id, parentOrderCode, installmentNo, installmentLabel: `第 ${installmentNo} 笔付款`,
        previousVerifiedChildOrderCodes, subjectId: record.subjectId, subjectCode: record.subjectCode, orderAmount, previousPaidAmount,
        amount: installmentAmount, currentPaymentAmount: installmentAmount, paidAmountAfter: paidAmount, remainingAmountAfter: remainingAmount,
        channel: payload.paymentMethod, paymentReference: payload.paymentReference,
        paidAt: payload.paidAt, paymentNote: payload.paymentNote, verifiedAt: new Date().toISOString(),
        verifiedBy: auth.session!.displayName, operator: auth.session!.displayName,
        status: 'verified', owner: record.owner, ownerId: record.ownerId, domain: record.domain,
      })
      Object.assign(patch, {
        orderRole: 'parent', parentOrderCode, lastChildOrderCode: childOrderCode,
        childOrderCodes: [previousVerifiedChildOrderCodes, childOrderCode].filter(Boolean).join('、'),
        orderAmount, paidAmount, remainingAmount, paymentCount: installmentNo,
        channel: payload.paymentMethod, paymentReference: payload.paymentReference, paidAt: payload.paidAt,
        paymentNote: payload.paymentNote, status,
      })
      database.notify(status === 'verified' ? '支付订单已付清' : '支付订单收到部分付款', `${record.code} · 本次 ¥${installmentAmount.toLocaleString()} · 待付 ¥${remainingAmount.toLocaleString()}`, record)
    }
    if (actionKey === 'resolve' && moduleKey === 'cross-region-activations') {
      Object.assign(patch, {
        status: 'resolved', resolution: payload.resolution, resolutionNote: payload.reason,
        resolvedAt: new Date().toISOString(), resolvedBy: auth.session!.displayName,
      })
      database.notify('跨区域激活异常已处理', `${record.code} · ${String(payload.reason || '')}`, record)
    }
    if (actionKey === 'permissions') {
      const permissions = Array.isArray(payload.permissions) ? payload.permissions.map(String).filter((item) => item.includes(':')) : []
      Object.assign(patch, { permissionUpdatedAt: new Date().toISOString(), permissions, permissionCount: permissions.length })
    }
    if (['process', 'confirm-outbound', 'reject-outbound'].includes(actionKey) || moduleKey === 'service-transfer' && ['confirm-transfer', 'approve-transfer-fee', 'reject-transfer-fee'].includes(actionKey)) {
      if (moduleKey === 'sn-replacement') {
        const original = visibleRecords('devices').find((item) => item.code === record.originalSN)
        if (!original) return fail(403, '原 SN 不存在或不属于当前经销商数据范围', null)
        const archivedSN = `${original.code}-1`
        if (database.records('devices').some((item) => item.id !== original.id && [archivedSN, record.newSN].includes(item.code))) return fail(409, '归档 SN 或新 SN 已存在', null)
        const oldAccount = String(original.account || '-')
        const replacementIdentity = deviceIdentity(record.replacementDeviceDescriptor || `${record.replacementDeviceName || ''} ${record.replacementDeviceModel || ''}`)
        database.transaction(() => {
          database.update('devices', original.id, { code: archivedSN, account: '-', userId: '', bindingStatus: 'unbound' })
          const replacement = database.create('devices', { code: String(record.newSN), name: replacementIdentity.descriptor, deviceName: String(record.replacementDeviceName), deviceModel: replacementIdentity.deviceModel, deviceType: replacementIdentity.deviceType, region: original.region, country: original.country, firmware: original.firmware, activation: original.activation, activationDate: original.activationDate, account: oldAccount, userId: original.userId, bindingStatus: 'bound', boundAt: new Date().toISOString(), inventoryStatus: original.inventoryStatus, warehouseLocation: original.warehouseLocation, status: 'online', owner: original.owner, ownerId: original.ownerId, domain: original.domain })
          createRelation('ownership-history', replacement, { deviceId: replacement.id, deviceSN: replacement.code, deviceName: replacement.deviceName, deviceModel: replacement.deviceModel, deviceType: replacement.deviceType, fromOwner: '换机备件', toOwner: replacement.owner, operationType: '换 SN', operator: auth.session!.displayName, status: 'completed' })
          database.records('projects').filter((item) => item.deviceSN === original.code).forEach((item) => database.update('projects', item.id, { deviceSN: replacement.code, deviceModel: replacement.name }))
          database.records('waypoints').filter((item) => item.deviceSN === original.code).forEach((item) => database.update('waypoints', item.id, { deviceSN: replacement.code }))
        })
        Object.assign(patch, { status: 'completed', completedAt: new Date().toISOString() })
      } else if (moduleKey === 'service-transfer') {
        const feeStage = record.hasFee && record.approvalStage === 'fee_approval'
        const rejected = actionKey === 'reject-transfer-fee' || payload.decision === 'rejected'
        if (feeStage && !rejected) {
          if (Number(payload.actualFee || 0) <= 0) return fail(422, '实际费用必须大于 0', null)
          if (!String(payload.paymentMethod || '').trim() || !String(payload.paymentReference || '').trim() || !String(payload.paidAt || '').trim()) return fail(422, '请完整填写付款方式、凭证和日期', null)
        }
        try {
          const outcome = database.transaction(() => {
            const result = advanceConfiguredApproval(record, rejected ? 'reject' : 'approve', payload.reason)
            if (result.final && result.approved) {
              if (record.hasFee) {
                const expense = createRelation('expense-records', record, { name: `${record.deviceSN} 售后转移费用`, category: '售后转移', amount: Number(payload.actualFee), estimatedFee: record.estimatedFee, feeBearer: record.feeBearer, paymentMethod: payload.paymentMethod, paymentReference: payload.paymentReference, paidAt: payload.paidAt, operator: auth.session!.displayName, status: 'completed' })
                recordPlatformBill(record, expense, 'service-transfer')
              }
              transferDeviceDealer(record)
            }
            return result
          })
          Object.assign(patch, outcome.patch)
          if (outcome.final && outcome.approved) Object.assign(patch, { approvalStage: 'completed', feeStatus: record.hasFee ? '已登记' : '无费用', actualFee: record.hasFee ? Number(payload.actualFee) : 0, paymentMethod: payload.paymentMethod || '', paymentReference: payload.paymentReference || '', paidAt: payload.paidAt || '', completedAt: new Date().toISOString() })
          else if (outcome.final) Object.assign(patch, { approvalStage: 'rejected', feeStatus: record.hasFee ? '已拒绝' : '无费用' })
          else Object.assign(patch, { approvalStage: 'fee_approval', feeStatus: '待总部审批' })
        } catch (error) { return fail(422, error instanceof Error ? error.message : '转移失败', null) }
        if (patch.status === 'completed') {
          database.notify('售后责任已转入', `${record.code} · ${record.deviceSN}`, { ...record, owner: String(record.targetDealer || ''), ownerId: String(record.targetDealerId) })
        } else if (patch.status === 'rejected') database.notify('售后转移已拒绝', `${record.code} · ${String(payload.reason || '')}`, record, 'risk')
        else database.notify('售后转移审批已推进', `${record.code} · 下一节点：${String(patch.currentApproverName || '')}`, record)
      } else if (moduleKey === 'installation-transfers') {
        if (!['approved', 'rejected'].includes(String(payload.decision))) return fail(422, '请选择有效的审核结果', null)
        const approved = payload.decision === 'approved'
        Object.assign(patch, { status: payload.decision, reviewedAt: new Date().toISOString(), reviewer: auth.session!.displayName, reviewNote: payload.reason, temporaryUseStatus: 'ended', temporaryUseStatusLabel: approved ? '审核通过，正式启用' : '审核拒绝，临时权限终止' })
        const project = database.records('projects').find((item) => item.code === record.projectCode || item.id === record.projectId)
        if (project) database.update('projects', project.id, { status: approved ? 'normal' : 'rejected', crossRegionStatus: payload.decision, activationReviewStatus: payload.decision, temporaryUseStatusLabel: patch.temporaryUseStatusLabel, reviewNote: payload.reason })
        const device = database.records('devices').find((item) => item.code === record.deviceSN)
        if (device) database.update('devices', device.id, {
          activationReviewStatus: payload.decision,
          temporaryUseStatusLabel: patch.temporaryUseStatusLabel,
          ...(approved && String(record.activationBeforeReview || device.activation) === 'inactive' ? { activation: 'activated', activationDate: new Date().toISOString() } : {}),
        })
        database.notify(approved ? '安装跨区审核已通过' : '安装跨区审核已拒绝', `${record.projectCode} · ${record.deviceSN}`, record, approved ? 'info' : 'risk')
      } else if (moduleKey === 'issuance') {
        patch.status = String(payload.nextStatus || (record.status === 'shipped' ? 'received' : 'completed'))
        if (patch.status === 'completed') patch.replacedAt = new Date().toISOString()
      } else if (moduleKey === 'warehouse') {
        if (actionKey === 'confirm-outbound') payload.decision = 'outbound'
        if (actionKey === 'reject-outbound') payload.decision = 'rejected'
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
    createRelation('workflow-events', updated, { sourceModule: moduleKey, title: actionConfig?.label || actionKey, content: String(payload.reason || payload.result || payload.replyContent || payload.paymentReference || '操作已完成'), operator: auth.session!.displayName, status: 'completed' })
    const risk = ['remote-disable', 'remote-enable', 'unbind', 'reset-password', 'publish', 'approve', 'reject', 'start-production', 'finance-confirm', 'record-expense', 'purchase-ship', 'confirm-purchase-receipt', 'finance-verify', 'record-bill', 'confirm-transfer', 'approve-transfer-fee', 'reject-transfer-fee', 'escalate', 'process', 'confirm-outbound', 'reject-outbound', 'change-region'].includes(actionKey)
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
