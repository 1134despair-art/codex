import { defineStore } from 'pinia'
import { createSeedDatabase } from '@/data/seed'
import { deviceCatalog, deviceIdentity } from '@/config/device-catalog'
import { defaultAccountSeeds, defaultRoleSeeds } from '@/config/permissions'
import { accountMatches } from '@/services/relation-matching'
import { normalizeMaterialInventory } from '@/services/material-inventory'
import { synchronizeProductCategoryHierarchy } from '@/services/product-categories'
import type { DataDomain, EntityRecord, StoredDatabase } from '@/types'

export const DATABASE_KEY = 'shark-sister-admin.db.v15'
export const PREVIOUS_DATABASE_KEY = 'shark-sister-admin.db.v14'
const V13_DATABASE_KEY = 'shark-sister-admin.db.v13'
const V12_DATABASE_KEY = 'shark-sister-admin.db.v12'
const V11_DATABASE_KEY = 'shark-sister-admin.db.v11'
const V10_DATABASE_KEY = 'shark-sister-admin.db.v10'
const V9_DATABASE_KEY = 'shark-sister-admin.db.v9'
const V8_DATABASE_KEY = 'shark-sister-admin.db.v8'
const V7_DATABASE_KEY = 'shark-sister-admin.db.v7'
const V6_DATABASE_KEY = 'shark-sister-admin.db.v6'
const V5_DATABASE_KEY = 'shark-sister-admin.db.v5'
const V4_DATABASE_KEY = 'shark-sister-admin.db.v4'
export const V3_DATABASE_KEY = 'shark-sister-admin.db.v3'
export const V2_DATABASE_KEY = 'shark-sister-admin.db.v2'
export const LEGACY_DATABASE_KEY = 'shark-sister-admin.db.v1'

const now = () => new Date().toISOString()
const approvalMenuLabels: Record<string, string> = {
  materials: '采购与物料申请审批',
  warehouse: '仓库设备（调货审批）',
  'service-transfer': '售后转移（费用审批）',
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

function entity(moduleKey: string, index: number, payload: Partial<EntityRecord>): EntityRecord {
  const timestamp = now()
  return {
    id: String(payload.id || `${moduleKey}-${String(index + 1).padStart(4, '0')}`),
    code: String(payload.code || `${moduleKey.slice(0, 3).toUpperCase()}-${String(index + 1).padStart(4, '0')}`),
    name: String(payload.name || '未命名记录'),
    status: String(payload.status || 'normal'),
    ownerId: String(payload.ownerId || 'platform'),
    owner: String(payload.owner || '平台中心'),
    domain: (payload.domain || 'cn') as DataDomain,
    createdAt: String(payload.createdAt || timestamp),
    updatedAt: String(payload.updatedAt || timestamp),
    ...payload,
  }
}

function normalizeRoles(records: Record<string, EntityRecord[]>, preservePermissions = false, mergeExportPermissions = false) {
  records.roles ||= []
  const sourceRoles = [...records.roles]
  const groups = new Map<string, EntityRecord[]>()
  for (const role of sourceRoles) {
    const key = String(role.name || role.roleKey || role.id)
    groups.set(key, [...(groups.get(key) || []), role])
  }
  const roleIdRemap = new Map<string, string>()
  records.roles = [...groups.values()].map((group) => {
    const role = group.find((item) => item.roleKey && item.roleKey !== 'custom')
      || group.find((item) => item.roleKey)
      || group[0]
    for (const duplicate of group) roleIdRemap.set(duplicate.id, role.id)
    if (!Array.isArray(role.permissions)) {
      const permissionSource = group.find((item) => Array.isArray(item.permissions))
      if (permissionSource) role.permissions = permissionSource.permissions
    }
    return role
  })
  for (const seed of defaultRoleSeeds) {
    let role = records.roles.find((item) => item.name === seed.name)
      || (seed.roleKey !== 'custom' ? records.roles.find((item) => item.roleKey === seed.roleKey) : undefined)
    if (!role) {
      role = entity('roles', records.roles.length, {
        name: seed.name,
        category: '系统预置',
        dataScope: seed.dataScope,
        roleKey: seed.roleKey,
        permissions: [...seed.permissions],
        permissionCount: seed.permissions.length,
        summary: `${seed.name}默认权限`,
      })
      records.roles.push(role)
    }
    role.roleKey = seed.roleKey
    role.dataScope = seed.dataScope
    role.status = 'normal'
    const mustUseSeed = seed.roleKey === 'platform' || !preservePermissions && seed.roleKey !== 'custom'
    const currentPermissions = Array.isArray(role.permissions) ? role.permissions.map(String) : []
    role.permissions = mustUseSeed
      ? [...seed.permissions]
      : seed.roleKey === 'custom' && role.name === seed.name
        ? [...new Set([...currentPermissions, ...seed.permissions])]
        : currentPermissions.length
          ? mergeExportPermissions
            ? [...new Set([...currentPermissions, ...seed.permissions.filter((permission) => permission.endsWith(':export'))])]
            : currentPermissions
          : [...seed.permissions]
    role.permissionCount = (role.permissions as unknown[]).length
  }
  return roleIdRemap
}

function normalizeDealers(records: Record<string, EntityRecord[]>) {
  records.dealers ||= []
  const canonical: Record<string, { organizationId: string; domain: 'cn' | 'global'; parentDealerId?: string }> = {
    '深圳海航设备有限公司': { organizationId: 'dealer-t1-sz', domain: 'cn' },
    '厦门蓝湾船舶服务': { organizationId: 'dealer-t2-xm', domain: 'cn', parentDealerId: 'dealer-t1-sz' },
    'Pacific Marine Systems': { organizationId: 'dealer-t1-us', domain: 'global' },
    'Harbour Tech Southampton': { organizationId: 'dealer-t2-uk', domain: 'global', parentDealerId: 'dealer-t1-us' },
    '宁波远洋机电': { organizationId: 'dealer-t2-nb', domain: 'cn', parentDealerId: 'dealer-t1-sz' },
    '青岛远海船舶设备': { organizationId: 'dealer-t1-qd', domain: 'cn' },
  }
  for (const dealer of records.dealers) {
    if (dealer.account === 'service@qingdao-marine.cn') dealer.account = 'service@qingdao.cn'
    if (dealer.account === 'service@harbourtech.co.uk') dealer.account = 'service@harbour.uk'
    const fixed = canonical[String(dealer.name)]
    if (!fixed) continue
    dealer.organizationId = fixed.organizationId
    dealer.ownerId = fixed.organizationId
    dealer.owner = dealer.name
    dealer.domain = fixed.domain
    dealer.parentDealerId = fixed.parentDealerId || ''
    if (dealer.name === '青岛远海船舶设备' && dealer.category === '注册申请') {
      dealer.category = '一级'
      dealer.status = 'normal'
    }
  }
  const tierOne = records.dealers.filter((item) => String(item.tier || item.category) === '一级' && item.status !== 'pending')
  for (const dealer of records.dealers) {
    dealer.tier = dealer.tier || (dealer.category === '二级' ? '二级' : '一级')
    dealer.organizationId = dealer.organizationId || dealer.ownerId || dealer.id
    dealer.defaultWarrantyYears = Number(dealer.defaultWarrantyYears || (dealer.domain === 'cn' ? 2 : 1))
    if (dealer.tier === '二级') {
      const parent = tierOne.find((item) => item.name === dealer.parentDealer) || tierOne.find((item) => item.domain === dealer.domain)
      dealer.parentDealerId = dealer.parentDealerId || parent?.organizationId || parent?.ownerId || ''
      dealer.parentDealer = parent?.name || dealer.parentDealer || '-'
    } else {
      dealer.parentDealerId = ''
      dealer.parentDealer = '-'
    }
  }
}

const accountAliases: Record<string, string> = {
  'wangh@shark-sister.cn': 'wangh@shark.cn',
  'mark@pacificmarine.us': 'mark@pacific.us',
  'test-ops@shark-sister.cn': 'testops@shark.cn',
  'service@harbourtech.co.uk': 'service@harbour.uk',
  'service@qingdao-marine.cn': 'service@qingdao.cn',
}

function normalizeAccountAliases(records: Record<string, EntityRecord[]>) {
  for (const moduleKey of ['admins', 'dealers', 'auth-accounts']) {
    for (const record of records[moduleKey] || []) {
      const next = accountAliases[String(record.account || '')]
      if (!next) continue
      record.account = next
      if (moduleKey === 'auth-accounts') record.code = next
    }
  }
}

function normalizeBusinessRecords(records: Record<string, EntityRecord[]>) {
  records.tasks = []
  records.logs = (records.logs || []).filter((item) => item.category !== 'API调用')
  for (const moduleKey of ['repairs', 'complaints']) {
    for (const record of records[moduleKey] || []) if (record.status === 'overdue') record.status = 'processing'
  }
  records.notifications ||= [
    entity('notifications', 0, { name: '报修单即将超过 SLA', summary: 'BX202608100021 · 剩余 18 分钟', category: 'risk', status: 'unread' }),
    entity('notifications', 1, { name: '库存调货等待审批', summary: '24 台设备将变更归属', category: 'warning', status: 'unread' }),
    entity('notifications', 2, { name: 'OTA 灰度任务完成', summary: '成功率 98.0%，2 台等待重试', category: 'info', status: 'read' }),
  ]
  records['warehouse-outbounds'] ||= []
  records['warehouse-transfers'] ||= []
  records['approval-instances'] ||= []
  records['approval-steps'] ||= []
  records['stock-movements'] ||= []
  records['device-commands'] ||= []
  records['external-call-logs'] ||= []
  records['user-auth-accounts'] ||= []

  const canonicalUserAccounts: Record<string, string> = {
    '海风与帆': '13812345678',
    'Captain Allen': 'allen@oceanmail.com',
    '远航号': '15912341033',
    'Marina M': 'marina@example.co.uk',
    '蓝鲸 07': '13712349004',
  }
  for (const user of records.users || []) {
    const original = String(user.account || '')
    const canonical = canonicalUserAccounts[user.name]
    if (!canonical || !original.includes('*')) continue
    user.account = canonical
    for (const device of records.devices || []) if (device.account === original) device.account = canonical
  }

  for (const material of records.materials || []) material.applyTime ||= material.createdAt
  for (const banner of records.banners || []) {
    banner.target = banner.target || banner.legacyTarget || ''
    delete banner.targetKey
    delete banner.targetLabel
    delete banner.audience
    delete banner.audienceLabel
  }

  records.devices ||= []
  for (const repair of records.repairs || []) {
    const device = records.devices.find((item) => item.code === repair.deviceSN)
    const dealerId = String(repair.dealerId || device?.ownerId || repair.ownerId || '')
    const dealer = (records.dealers || []).find((item) => String(item.organizationId || item.ownerId) === dealerId)
    repair.dealerId = dealerId
    repair.dealer = String(repair.dealer || dealer?.name || device?.owner || repair.owner || '待确认')
    repair.responsibilityDealerId ||= repair.dealerId
    repair.responsibilityDealer ||= repair.dealer
  }
  let stockDevices = records.devices.filter((item) => item.inventoryStatus === 'in_stock' || item.ownerId === 'platform')
  if (!stockDevices.length) {
    const deviceModels = ['制冰机 CI-02', '海水淡化器 SW-04', '顶流机 TF-01', '电池组 BP-03']
    stockDevices = deviceModels.map((name, index) => entity('devices', records.devices.length + index, {
      code: `WH20260810${String(index + 1).padStart(3, '0')}`,
      name,
      country: '中国',
      region: '中国 · 深圳中心仓',
      activation: 'inactive',
      bindingStatus: 'unbound',
      account: '-',
      firmware: 'v1.0.0',
      inventoryStatus: 'in_stock',
      warehouseLocation: `A-${String(index + 1).padStart(2, '0')}-01`,
      ownerId: 'platform',
      owner: '平台中心仓',
      status: 'offline',
    }))
    records.devices.push(...stockDevices)
  }

  records.warehouse ||= []
  const nonStock = records.warehouse.filter((item) => item.category !== '在库')
  const stockRows = stockDevices.map((device, index) => entity('warehouse', index, {
    id: `warehouse-stock-${device.id}`,
    code: `IN-${String(index + 1).padStart(6, '0')}`,
    name: device.name,
    category: '在库',
    deviceId: device.id,
    deviceSN: device.code,
    deviceModel: device.name,
    country: device.country,
    warehouseLocation: device.warehouseLocation || `A-${String(index + 1).padStart(2, '0')}-01`,
    inboundAt: device.createdAt,
    quantity: 1,
    ownerId: 'platform',
    owner: '平台中心仓',
    domain: device.domain,
  }))
  records.warehouse = [...stockRows, ...nonStock]
}

function normalizeUserAccounts(records: Record<string, EntityRecord[]>) {
  records.users ||= []
  records['user-auth-accounts'] ||= []
  for (const user of records.users) {
    let account = records['user-auth-accounts'].find((item) => item.subjectId === user.id || item.account === user.account)
    if (!account) {
      account = entity('user-auth-accounts', records['user-auth-accounts'].length, {
        code: `APP-${user.code}`,
        name: user.name,
        account: user.account,
        password: 'Reset123!',
        mustChangePassword: false,
        subjectType: 'user',
        subjectId: user.id,
        status: user.status,
        owner: user.owner,
        ownerId: user.ownerId,
        domain: user.domain,
      })
      records['user-auth-accounts'].push(account)
    }
    account.name = user.name
    account.account = user.account
    account.status = user.status
    account.owner = user.owner
    account.ownerId = user.ownerId
    account.domain = user.domain
  }
}

function normalizeApprovalFlows(records: Record<string, EntityRecord[]>) {
  records['approval-flow'] ||= []
  const activeAccounts = (records['auth-accounts'] || []).filter((item) => item.status === 'normal')
  const platform = activeAccounts.find((item) => item.roleKey === 'platform')
  const tier1 = activeAccounts.find((item) => item.roleKey === 'tier1')
  const tier2 = activeAccounts.find((item) => item.roleKey === 'tier2')
  const inferMenuKey = (flow: EntityRecord) => {
    const explicit = String(flow.menuKey || flow.flowType || '')
    if (approvalMenuLabels[explicit]) return explicit
    const text = `${flow.name || ''}${flow.flowTypeLabel || ''}`
    if (text.includes('调货') || text.includes('仓库')) return 'warehouse'
    if (text.includes('售后') || text.includes('转移')) return 'service-transfer'
    return 'materials'
  }
  for (const flow of records['approval-flow']) {
    const menuKey = inferMenuKey(flow)
    flow.category = '流程配置'
    flow.menuKey = menuKey
    flow.menuLabel = approvalMenuLabels[menuKey]
    flow.flowType = menuKey
    flow.flowTypeLabel = approvalMenuLabels[menuKey]
  }
  const defaults: Record<string, { levels: string; members: EntityRecord[] }> = {
    materials: { levels: '一级 → 平台', members: [tier1, platform].filter(Boolean) as EntityRecord[] },
    warehouse: { levels: '平台直接审核', members: [platform].filter(Boolean) as EntityRecord[] },
    'service-transfer': { levels: '平台直接审核', members: [platform].filter(Boolean) as EntityRecord[] },
  }
  for (const menuKey of Object.keys(approvalMenuLabels)) {
    let flow = records['approval-flow'].find((item) => item.menuKey === menuKey)
    if (!flow) {
      flow = appendEntity(records, 'approval-flow', {
        name: `${approvalMenuLabels[menuKey]}审批流程`, category: '流程配置', menuKey, status: 'normal', ownerId: 'platform', owner: '平台中心', domain: 'cn',
      })
    }
    const defaultConfig = defaults[menuKey]
    flow.levels ||= defaultConfig.levels
    const configuredIds = configuredApprovalIds(flow)
    const legacyIds = Array.isArray(flow.members) ? flow.members.map(String).filter((id) => activeAccounts.some((item) => item.id === id)) : []
    const ids = configuredIds.length ? configuredIds : legacyIds.length ? legacyIds : defaultConfig.members.map((item) => item.id)
    const members = [...new Set(ids)].map((id) => activeAccounts.find((item) => item.id === id)).filter(Boolean) as EntityRecord[]
    flow.category = '流程配置'
    flow.menuKey = menuKey
    flow.menuLabel = approvalMenuLabels[menuKey]
    flow.flowType = menuKey
    flow.flowTypeLabel = approvalMenuLabels[menuKey]
    if (flow.levels === '二级 → 一级 → 平台') {
      flow.level1ApproverId = members.find((item) => item.roleKey === 'tier2')?.id || tier2?.id || ''
      flow.level2ApproverId = members.find((item) => item.roleKey === 'tier1')?.id || tier1?.id || ''
    } else if (flow.levels === '一级 → 平台') {
      flow.level1ApproverId = members.find((item) => item.roleKey === 'tier1')?.id || tier1?.id || ''
      flow.level2ApproverId = ''
    } else {
      flow.level1ApproverId = ''
      flow.level2ApproverId = ''
    }
    flow.platformApproverId = members.find((item) => item.roleKey === 'platform')?.id || platform?.id || ''
    const orderedIds = configuredApprovalIds(flow)
    flow.members = orderedIds
    flow.memberNames = orderedIds.map((id) => activeAccounts.find((item) => item.id === id)).filter(Boolean).map((item) => item!.displayName || item!.name).join('、') || '-'
  }
  for (const menuKey of Object.keys(approvalMenuLabels)) {
    const enabled = records['approval-flow'].filter((item) => item.menuKey === menuKey && item.status === 'normal')
    enabled.slice(1).forEach((flow) => { flow.status = 'disabled' })
  }
}

function appendEntity(records: Record<string, EntityRecord[]>, moduleKey: string, payload: Partial<EntityRecord>) {
  records[moduleKey] ||= []
  const row = entity(moduleKey, records[moduleKey].length, payload)
  records[moduleKey].push(row)
  return row
}

function normalizeDeviceRecords(records: Record<string, EntityRecord[]>) {
  records.devices ||= []
  const usedCodes = new Set<string>()
  for (const [index, device] of records.devices.entries()) {
    const originalCode = String(device.code || `DEVICE-${index + 1}`)
    if (usedCodes.has(originalCode)) {
      let duplicateIndex = 2
      let nextCode = `${originalCode}-D${duplicateIndex}`
      while (usedCodes.has(nextCode) || records.devices.some((item) => item !== device && item.code === nextCode)) nextCode = `${originalCode}-D${duplicateIndex += 1}`
      for (const [moduleKey, rows] of Object.entries(records)) {
        if (moduleKey === 'devices') continue
        for (const row of rows) {
          const sameDevice = row.deviceId === device.id
          const sameScopedSn = row.deviceSN === originalCode && String(row.ownerId || '') === String(device.ownerId || '')
          if (sameDevice || sameScopedSn) row.deviceSN = nextCode
          if (row.originalSN === originalCode && String(row.ownerId || '') === String(device.ownerId || '')) row.originalSN = nextCode
          if (Array.isArray(row.selectedDevices) && String(row.ownerId || '') === String(device.ownerId || '')) row.selectedDevices = row.selectedDevices.map((sn) => sn === originalCode ? nextCode : sn)
        }
      }
      device.code = nextCode
      const uniqueSuffix = nextCode.replace(/\W/g, '').slice(-10)
      device.communicationId = `COMM-${uniqueSuffix}`
      device.chipId = `CHIP-${uniqueSuffix}`
      device.mainboardSerial = `MB-${uniqueSuffix}`
      device.coreComponentSerials = `CORE-${uniqueSuffix}`
    }
    usedCodes.add(String(device.code))
    const identity = deviceIdentity(device.name)
    device.deviceName ||= identity.deviceName
    device.deviceModel ||= identity.deviceModel
    device.deviceType ||= identity.deviceType
    device.specification ||= identity.specification
    const suffix = String(device.code || index + 1).replace(/\W/g, '').slice(-10)
    device.communicationId ||= `COMM-${suffix}`
    device.chipId ||= `CHIP-${suffix}`
    device.mainboardSerial ||= `MB-${suffix}`
    device.coreComponentSerials ||= `CORE-${suffix}`
  }

  records['sn-replacement'] ||= []
  records['sn-replacement'].forEach((request, index) => {
    const original = records.devices.find((item) => item.code === request.originalSN)
    const fallback = deviceCatalog[index % deviceCatalog.length]
    const originalIdentity = original
      ? deviceIdentity(original.name)
      : deviceIdentity(request.replacementDeviceDescriptor || `${request.originalDeviceName || fallback.deviceName} ${request.originalDeviceModel || fallback.deviceModel}`)
    request.originalDeviceName ||= original?.deviceName || originalIdentity.deviceName
    request.originalDeviceModel ||= original?.deviceModel || originalIdentity.deviceModel
    request.originalDeviceType ||= original?.deviceType || originalIdentity.deviceType

    const replacementIdentity = deviceIdentity(request.replacementDeviceDescriptor || `${request.replacementDeviceName || originalIdentity.deviceName} ${request.replacementDeviceModel || originalIdentity.deviceModel}`)
    request.replacementDeviceDescriptor = replacementIdentity.descriptor
    request.replacementDeviceName ||= replacementIdentity.deviceName
    request.replacementDeviceModel = replacementIdentity.deviceModel
    request.replacementDeviceType = replacementIdentity.deviceType
  })
}

function normalizeMeetingAdjustments(records: Record<string, EntityRecord[]>) {
  records['product-catalog'] ||= []
  deviceCatalog.forEach((item, index) => {
    const exists = records['product-catalog'].some((record) => record.deviceModel === item.deviceModel || record.descriptor === item.descriptor)
    if (exists) return
    records['product-catalog'].push(entity('product-catalog', index, {
      id: `product-catalog-${index + 1}`,
      code: `PROD-${String(index + 1).padStart(3, '0')}`,
      name: item.deviceName,
      deviceType: item.deviceType,
      deviceModel: item.deviceModel,
      specification: item.specification,
      descriptor: item.descriptor,
      referencePrice: [68000, 92000, 118000, 36000, 12800][index] || 0,
      status: 'normal', owner: '平台中心', ownerId: 'platform', domain: 'cn',
    }))
  })
  records['price-history'] ||= []
  records['app-versions'] ||= [entity('app-versions', 0, {
    id: 'app-version-1', code: 'APP-V3.2.0', name: '3.2.0', platform: 'iOS / Android',
    releaseScope: '全部用户', releaseAt: '2026-08-21', summary: '后台配置、售后与设备管理能力更新',
    status: 'published', owner: '平台中心', ownerId: 'platform', domain: 'cn',
  })]
  records['warranty-history'] ||= []
  records['ota-results'] ||= []
  records['ota-rollbacks'] ||= []
  records['replacement-records'] ||= []
  records['purchase-items'] ||= []
  records['billing-items'] ||= []

  const superAdmin = records.admins?.find((item) => item.account === 'admin@shark.cn') || records.admins?.find((item) => item.category === '平台')
  records.admins?.forEach((item) => { item.isSuperAdmin = item.id === superAdmin?.id; item.accountLevel = item.isSuperAdmin ? '超级管理员' : '普通管理员' })
  records['auth-accounts']?.forEach((item) => { item.isSuperAdmin = item.account === superAdmin?.account })

  for (const rule of records.warranty || []) {
    rule.market ||= rule.domain === 'global' ? '海外' : '国内'
    rule.warrantyStartPoint ||= '设备激活日'
    rule.effectiveFrom ||= String(rule.createdAt).slice(0, 10)
    rule.effectiveTo ||= ''
  }
  for (const faq of records['faq-documents'] || []) {
    faq.productType ||= faq.name.includes('顶流机') ? '顶流机 TF-01' : '全部产品'
    faq.deviceModel ||= faq.productType
    faq.documentVersion ||= '1.0'
  }
  const launch = records['launch-settings']?.[0]
  if (launch) {
    launch.splashEnabled = launch.enabled !== false
    launch.onboardingEnabled ??= true
    launch.onboardingRevision ||= 'onboarding-v1'
    launch.onboardingTitle ||= '连接设备，掌握每一次航行'
    launch.onboardingSummary ||= '首次安装后展示一次，可在版本升级时重新启用。'
  }
}

function normalizeV14Adjustments(records: Record<string, EntityRecord[]>) {
  records['support-settings'] ||= []
  if (!records['support-settings'].length) {
    records['support-settings'].push(entity('support-settings', 0, {
      code: 'SUP-CN-001', name: '国内用户客服', audience: 'all', audienceLabel: '全部用户',
      servicePhone: '400-820-2026', serviceEmail: 'service@shark.cn', serviceHours: '周一至周日 08:30-20:30',
      emergencyPhone: '0755-8600-2026', summary: '设备故障、安装咨询和售后进度查询。', status: 'normal',
      owner: '平台中心', ownerId: 'platform', domain: 'cn',
    }))
    records['support-settings'].push(entity('support-settings', 1, {
      code: 'SUP-GLOBAL-001', name: '海外用户客服', audience: 'all', audienceLabel: '全部用户',
      servicePhone: '+1 800 555 2026', serviceEmail: 'support@shark-global.com', serviceHours: 'Mon-Sun 08:00-20:00 UTC+8',
      summary: 'Global equipment and after-sales support.', status: 'normal', owner: 'Global Operations', ownerId: 'platform', domain: 'global',
    }))
  }

  records['after-sales-types'] ||= []
  const serviceTypeSeeds = [
    { code: 'SAT-REPAIR', name: '故障报修', requiredFields: ['deviceSN', 'contact', 'faultCategory', 'description', 'attachments'], responseSlaHours: 24 },
    { code: 'SAT-COMPLAINT', name: '提交投诉', requiredFields: ['contact', 'description'], responseSlaHours: 24 },
    { code: 'SAT-MESSAGE', name: '客服留言', requiredFields: ['contact', 'description'], responseSlaHours: 48 },
    { code: 'SAT-TRANSFER', name: '跨区转移', requiredFields: ['deviceSN', 'installationRegion', 'description'], responseSlaHours: 72 },
  ]
  const fieldLabels: Record<string, string> = { deviceSN: '设备 SN', contact: '联系方式', description: '问题描述', attachments: '图片/视频附件', faultCategory: '故障分类', installationRegion: '安装地区' }
  for (const [index, item] of serviceTypeSeeds.entries()) {
    if (records['after-sales-types'].some((record) => record.code === item.code)) continue
    records['after-sales-types'].push(entity('after-sales-types', index, {
      ...item, audience: 'all', audienceLabel: '全部用户',
      requiredFieldsLabel: item.requiredFields.map((field) => fieldLabels[field]).join('、'),
      summary: `${item.name}提交字段与响应时限配置`, status: 'normal', owner: '平台中心', ownerId: 'platform', domain: 'cn',
    }))
  }

  const launch = records['launch-settings']?.[0]
  if (launch) {
    const relativeAssetPath = (value: unknown) => {
      const source = String(value || '')
      return source.startsWith('/assets/') ? `.${source}` : source
    }
    const existingPages = Array.isArray(launch.onboardingPages) ? launch.onboardingPages : []
    launch.onboardingPages = existingPages.length ? existingPages : [
      { id: 'onboarding-device', title: String(launch.onboardingTitle || '连接设备'), summary: String(launch.onboardingSummary || '快速完成设备绑定并查看运行状态。'), image: './assets/backgrounds/launch-screen.png', durationMs: 2200 },
      { id: 'onboarding-service', title: '管理设备全生命周期', summary: '安装、质保、报修和费用记录始终可追溯。', image: './assets/backgrounds/launch-screen.png', durationMs: 2200 },
      { id: 'onboarding-waypoint', title: '决定航点保存位置', summary: '首次绑定时选择本地或服务器，后续可在设置中修改。', image: './assets/backgrounds/launch-screen.png', durationMs: 2400 },
    ]
    launch.backgroundImage = relativeAssetPath(launch.backgroundImage)
    launch.logoImage = relativeAssetPath(launch.logoImage)
    for (const page of launch.onboardingPages as EntityRecord[]) page.image = relativeAssetPath(page.image)
  }

  for (const faq of records['faq-documents'] || []) {
    const embedded = String(faq.pdfData || '').startsWith('data:application/pdf')
    if (String(faq.pdfFile || '').startsWith('/documents/')) faq.pdfFile = `.${faq.pdfFile}`
    const bundled = /^\.?\/documents\//.test(String(faq.pdfFile || '')) && String(faq.pdfFile || '').toLowerCase().endsWith('.pdf')
    faq.fileStatus = embedded || bundled ? 'valid' : 'invalid'
    faq.fileError = faq.fileStatus === 'valid' ? '' : 'PDF 文件内容不可用，请重新上传后再发布'
    if (faq.fileStatus === 'invalid' && faq.status === 'published') faq.status = 'disabled'
  }
  if (!(records['faq-documents'] || []).some((item) => item.fileStatus === 'invalid')) {
    appendEntity(records, 'faq-documents', {
      code: 'FAQ-INVALID-DEMO', name: '旧版安装说明（文件待补）', titleEn: 'Legacy Installation Guide',
      productType: '制冰机 CI-02', documentVersion: '0.9', fileName: 'legacy-installation.pdf', pdfFile: 'legacy-installation.pdf',
      fileStatus: 'invalid', fileError: 'PDF 文件内容不可用，请重新上传后再发布', sort: 99,
      summary: '用于演示文件失效后的运营处理状态。', status: 'disabled', owner: '平台中心', ownerId: 'platform', domain: 'cn',
    })
  }

  const users = records.users || []
  for (const dealer of records.dealers || []) {
    const user = users.find((item) => item.id === dealer.linkedUserId || item.account === dealer.account)
    if (!user) continue
    dealer.linkedUserId = user.id
    dealer.linkedUserName = user.name
    const links = [{ subjectType: 'user', subjectId: user.id }, { subjectType: 'dealer', subjectId: dealer.id }]
    const capabilities = ['user', 'dealer']
    user.linkedDealerId = dealer.id
    user.identityCapabilities = capabilities
    for (const account of records['auth-accounts'] || []) if (account.subjectId === dealer.id || account.account === dealer.account) Object.assign(account, { linkedUserId: user.id, subjectLinks: links, capabilities })
    for (const account of records['user-auth-accounts'] || []) if (account.subjectId === user.id || account.account === user.account) Object.assign(account, { linkedDealerId: dealer.id, subjectLinks: links, capabilities })
  }

  const devices = records.devices || []
  records['installation-transfers'] ||= []
  for (const project of records.projects || []) {
    const device = devices.find((item) => item.code === project.deviceSN)
    project.factoryRegion ||= device?.region || project.usageRegion || ''
    project.installationRegion ||= project.usageRegion || project.factoryRegion
    project.usageRegion = project.installationRegion
    const source = String(project.factoryRegion).replace(/\s+/g, '').replace(/[·/]/g, '')
    const target = String(project.installationRegion).replace(/\s+/g, '').replace(/[·/]/g, '')
    if (!source || !target || source === target) {
      project.crossRegionStatus ||= 'not_required'
      continue
    }
    project.crossRegionStatus = 'pending'
    if (!['expired', 'warning'].includes(String(project.status))) project.status = 'pending'
    if (!records['installation-transfers'].some((item) => item.projectId === project.id && item.status === 'pending')) {
      appendEntity(records, 'installation-transfers', {
        code: `IRT-${String(project.code).replace('PRJ-', '')}`, name: `${project.name}跨区安装审核`, category: '安装跨区审核',
        projectId: project.id, projectCode: project.code, deviceSN: project.deviceSN, factoryRegion: project.factoryRegion,
        installationRegion: project.installationRegion, dealer: project.owner, summary: `${project.factoryRegion} → ${project.installationRegion}，等待平台审核`,
        status: 'pending', owner: project.owner, ownerId: project.ownerId, domain: project.domain,
      })
    }
  }

  records.waypoints = (records.waypoints || []).filter((item) => item.serverSaved === true || item.storageMode === 'server')
  for (const waypoint of records.waypoints) Object.assign(waypoint, { serverSaved: true, storageMode: 'server', adminVisible: false, syncStatus: waypoint.syncStatus || 'synced' })

  for (const replacement of records['replacement-records'] || []) {
    if (replacement.repairId) continue
    const repair = (records.repairs || []).find((item) => item.deviceSN === replacement.deviceSN)
    if (repair) Object.assign(replacement, { repairId: repair.id, repairCode: repair.code })
  }
}

function normalizeProcurementRecords(records: Record<string, EntityRecord[]>) {
  records['expense-records'] ||= []
  records['purchase-items'] ||= []
  records.materials ||= []
  const catalogs = records['material-catalog'] || []
  const products = records['product-catalog'] || deviceCatalog.map((item, index) => entity('product-catalog', index, {
    id: `product-catalog-${index + 1}`,
    name: item.deviceName,
    deviceType: item.deviceType,
    deviceModel: item.deviceModel,
    specification: item.specification,
    descriptor: item.descriptor,
    referencePrice: [68000, 92000, 118000, 36000, 12800][index] || 0,
    status: 'normal', owner: '平台中心', ownerId: 'platform', domain: 'cn',
  }))

  for (const request of records.materials) {
    if (request.category === '设备采购') {
      const deviceModel = String(request.deviceModel || request.itemName || request.name).split(' × ')[0]
      const quantity = Math.max(1, Number(request.quantity || 1))
      const estimatedUnitPrice = Number(request.estimatedUnitPrice || (Number(request.amount || 0) / quantity) || 0)
      const product = products.find((item) => item.id === request.productId || item.descriptor === deviceModel || item.deviceModel === deviceModel || item.name === deviceModel)
      const purchaseItems = Array.isArray(request.purchaseItems) && request.purchaseItems.length
        ? request.purchaseItems as Array<Record<string, unknown>>
        : [{ itemKey: product ? `product:${product.id}` : `descriptor:${deviceModel}`, itemType: '设备', itemId: product?.id || '', itemName: product?.descriptor || deviceModel, quantity, unitPrice: estimatedUnitPrice, subtotal: Math.round(quantity * estimatedUnitPrice * 100) / 100 }]
      request.requestType = 'device_purchase'
      request.purchaseItems = purchaseItems
      request.deviceModel = purchaseItems.length === 1 ? String(purchaseItems[0].itemName || deviceModel) : `多项采购（${purchaseItems.length} 项）`
      request.itemName = purchaseItems.map((item) => String(item.itemName || '')).filter(Boolean).join('、')
      request.quantity = purchaseItems.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1)), 0)
      request.estimatedUnitPrice = purchaseItems.length === 1 ? Number(purchaseItems[0].unitPrice || estimatedUnitPrice) : 0
      request.amount = Math.round(purchaseItems.reduce((sum, item) => sum + Number(item.subtotal || Number(item.quantity || 1) * Number(item.unitPrice || 0)), 0) * 100) / 100
      request.currency = 'CNY'
      request.paymentStatus ||= records['expense-records'].some((item) => item.subjectId === request.id) ? '已登记' : '未登记'
      request.deviceSN = '-'
      request.warrantyResult = '不适用'
      if (!records['purchase-items'].some((item) => item.subjectId === request.id)) {
        purchaseItems.forEach((item, index) => appendEntity(records, 'purchase-items', {
          id: `purchase-item-${request.id}-${index + 1}`,
          name: String(item.itemName || '采购项目'), subjectId: request.id, subjectCode: request.code,
          itemType: item.itemType || '设备', itemId: item.itemId || '', itemName: item.itemName,
          quantity: Math.max(1, Number(item.quantity || 1)), unitPrice: Number(item.unitPrice || 0),
          subtotal: Number(item.subtotal || Number(item.quantity || 1) * Number(item.unitPrice || 0)),
          status: request.status, owner: request.owner, ownerId: request.ownerId, domain: request.domain,
        }))
      }
      delete request.materialId
      delete request.materialName
      continue
    }

    const materialName = String(request.materialName || request.itemName || request.name).split(' × ')[0]
    const catalog = catalogs.find((item) => item.id === request.materialId || item.name === materialName)
    if (!catalog) continue
    request.materialId = catalog.id
    request.materialName = catalog.name
    request.itemName = catalog.name
    request.unitPrice = Number(catalog.price || 0)
    request.amount = Math.round(Number(request.quantity || 0) * Number(catalog.price || 0) * 100) / 100
    request.currency = 'CNY'
  }

  if (!records.materials.some((item) => item.category === '设备采购')) {
    appendEntity(records, 'materials', {
      id: 'materials-device-purchase-demo',
      code: 'PUR-20260820001',
      name: '制冰机 CI-02 × 2',
      category: '设备采购',
      requestType: 'device_purchase',
      deviceModel: '制冰机 CI-02',
      itemName: '制冰机 CI-02',
      quantity: 2,
      estimatedUnitPrice: 68000,
      amount: 136000,
      currency: 'CNY',
      paymentStatus: '未登记',
      deviceSN: '-',
      warrantyResult: '不适用',
      dealer: '厦门蓝湾船舶服务',
      applyTime: '2026-08-20T02:00:00.000Z',
      summary: '厦门服务中心新增两台船用制冰设备',
      status: 'pending',
      owner: '厦门蓝湾船舶服务',
      ownerId: 'dealer-t2-xm',
      domain: 'cn',
    })
  }
}

function normalizeV15Adjustments(records: Record<string, EntityRecord[]>) {
  const headquartersRole = records.roles?.find((item) => item.roleKey === 'custom' && item.name === '总部售后')
  if (headquartersRole) {
    const requiredPermissions = ['approval-center:view', 'approval-center:export', 'warehouses:view', 'warehouse-locations:view', 'warehouse:view', 'warehouse:export', 'materials:finance-confirm', 'materials:purchase-ship']
    const permissions = Array.isArray(headquartersRole.permissions) ? headquartersRole.permissions.map(String) : []
    const mergedPermissions = [...new Set([...permissions, ...requiredPermissions])]
    headquartersRole.permissions = mergedPermissions
    headquartersRole.permissionCount = mergedPermissions.length
  }
  records.warehouses ||= []
  records['warehouse-locations'] ||= []
  records['purchase-fulfillments'] ||= []

  const warehouseSeeds: Array<{ code: string; name: string; category: string; region: string; domain: DataDomain }> = [
    { code: 'WHS-CN-001', name: '平台中心仓', category: '中心仓', region: '中国 · 深圳', domain: 'cn' },
    { code: 'WHS-CN-002', name: '华南备件仓', category: '区域仓', region: '中国 · 广州', domain: 'cn' },
    { code: 'WHS-GL-001', name: '海外服务仓', category: '海外仓', region: '新加坡', domain: 'global' },
  ]
  for (const [index, warehouse] of warehouseSeeds.entries()) {
    if (records.warehouses.some((item) => item.code === warehouse.code || item.name === warehouse.name)) continue
    appendEntity(records, 'warehouses', {
      ...warehouse,
      manager: index === 0 ? '平台仓储组' : index === 1 ? '华南售后组' : 'Global Service',
      status: 'normal', owner: '平台中心', ownerId: 'platform',
    })
  }
  for (const warehouse of records.warehouses) {
    warehouse.owner = '平台中心'
    warehouse.ownerId = 'platform'
  }

  const locationSeeds = [
    { code: 'A-01-01', name: 'A-01-01', warehouseName: '平台中心仓' },
    { code: 'A-03-18', name: 'A-03-18', warehouseName: '平台中心仓' },
    { code: 'B-01-01', name: 'B-01-01', warehouseName: '华南备件仓' },
    { code: 'G-01-01', name: 'G-01-01', warehouseName: '海外服务仓' },
  ]
  for (const location of locationSeeds) {
    const warehouse = records.warehouses.find((item) => item.name === location.warehouseName)
    if (!warehouse || records['warehouse-locations'].some((item) => item.warehouseId === warehouse.id && item.code === location.code)) continue
    appendEntity(records, 'warehouse-locations', {
      ...location,
      warehouseId: warehouse.id,
      capacity: 200,
      status: 'normal', owner: warehouse.owner, ownerId: warehouse.ownerId, domain: warehouse.domain,
    })
  }

  const products = records['product-catalog'] || []
  for (const product of products) {
    const identity = deviceIdentity(product.descriptor || product.deviceModel || product.name)
    product.deviceType ||= identity.deviceType
    product.deviceModel ||= identity.deviceModel
    product.specification ||= identity.specification
    product.descriptor ||= identity.descriptor
  }

  const defaultWarehouse = records.warehouses.find((item) => item.name === '平台中心仓') || records.warehouses[0]
  const defaultLocation = records['warehouse-locations'].find((item) => item.warehouseId === defaultWarehouse?.id)
  for (const device of records.devices || []) {
    const identity = deviceIdentity(device.descriptor || device.name || device.deviceModel)
    device.deviceName ||= identity.deviceName
    device.deviceType ||= identity.deviceType
    device.deviceModel ||= identity.deviceModel
    device.specification ||= identity.specification
    device.productId ||= products.find((item) => item.deviceModel === device.deviceModel)?.id || ''
    if (device.ownerId === 'platform' || device.category === '在库设备') {
      const warehouse = records.warehouses.find((item) => item.id === device.warehouseId || item.name === device.warehouseName) || defaultWarehouse
      const location = records['warehouse-locations'].find((item) => item.id === device.warehouseLocationId || (item.warehouseId === warehouse?.id && (item.name === device.warehouseLocation || item.code === device.warehouseLocation))) || defaultLocation
      if (warehouse) {
        device.warehouseId = warehouse.id
        device.warehouseName = warehouse.name
      }
      if (location) {
        device.warehouseLocationId = location.id
        device.warehouseLocation = location.name
      }
    }
  }

  for (const stock of records.warehouse || []) {
    if (!['在库', '在库设备'].includes(String(stock.category))) continue
    const device = (records.devices || []).find((item) => item.code === stock.deviceSN)
    const identity = deviceIdentity(stock.deviceModel || device?.name)
    const warehouse = records.warehouses.find((item) => item.id === stock.warehouseId || item.name === stock.warehouseName) || defaultWarehouse
    const location = records['warehouse-locations'].find((item) => item.id === stock.warehouseLocationId || (item.warehouseId === warehouse?.id && (item.name === stock.warehouseLocation || item.code === stock.warehouseLocation))) || defaultLocation
    Object.assign(stock, {
      deviceName: device?.deviceName || identity.deviceName,
      deviceType: device?.deviceType || identity.deviceType,
      deviceModel: device?.deviceModel || identity.deviceModel,
      specification: device?.specification || identity.specification,
      productId: device?.productId || products.find((item) => item.deviceModel === identity.deviceModel)?.id || '',
      warehouseId: warehouse?.id || '',
      warehouseName: warehouse?.name || stock.warehouseName || '',
      warehouseLocationId: location?.id || '',
      warehouseLocation: location?.name || stock.warehouseLocation || '',
    })
  }

  for (const request of records.materials || []) {
    if (request.category !== '设备采购') continue
    request.initiatedBy ||= request.applicant || request.dealer || request.owner
    request.initiatedAt ||= request.applyTime || request.createdAt
    request.contractStatus ||= '待确认'
    request.deliveryStatus ||= request.status === 'completed' ? '已签收' : request.status === 'shipped' ? '已发货' : '待处理'
    if (request.status === 'completed') {
      request.purchaseStage = 'completed'
      request.purchaseStageLabel = '已完成'
      request.deliveryStatus = '已签收'
    } else if (request.status === 'shipped') {
      request.purchaseStage = 'shipped'
      request.purchaseStageLabel = '已发货'
    } else if (request.status === 'approved' && request.paymentStatus === '已登记') {
      request.purchaseStage = 'warehouse_fulfillment'
      request.purchaseStageLabel = '待仓库发货'
    } else if (request.status === 'approved') {
      request.purchaseStage = 'finance_confirmation'
      request.purchaseStageLabel = '待财务确认'
    } else if (request.status === 'rejected') {
      request.purchaseStage = 'rejected'
      request.purchaseStageLabel = '已拒绝'
    } else {
      request.purchaseStage = 'business_confirmation'
      request.purchaseStageLabel = '待业务确认'
    }
  }
}

function normalizeDocumentIssueAdjustments(records: Record<string, EntityRecord[]>) {
  const devices = records.devices || []
  const projects = records.projects || []
  for (const transfer of records['installation-transfers'] || []) {
    const project = projects.find((item) => item.id === transfer.projectId || item.code === transfer.projectCode)
    const device = devices.find((item) => item.code === transfer.deviceSN || item.code === project?.deviceSN)
    if (transfer.status === 'pending') {
      const submittedAt = String(transfer.submittedAt || now())
      const reviewDeadline = String(transfer.reviewDeadline || new Date(new Date(submittedAt).getTime() + 48 * 60 * 60 * 1000).toISOString())
      Object.assign(transfer, {
        submittedAt,
        reviewDeadline,
        temporaryOperationUntil: reviewDeadline,
        temporaryUseStatus: 'active',
        temporaryUseStatusLabel: '48 小时临时可用',
        activationBeforeReview: transfer.activationBeforeReview || device?.activation || 'inactive',
      })
      if (project) Object.assign(project, { activationReviewStatus: 'pending', temporaryOperationUntil: reviewDeadline, temporaryUseStatusLabel: '48 小时临时可用' })
      if (device) Object.assign(device, { activationReviewStatus: 'pending', temporaryOperationUntil: reviewDeadline, temporaryUseStatusLabel: '48 小时临时可用' })
    } else {
      transfer.temporaryUseStatus ||= 'ended'
      transfer.temporaryUseStatusLabel ||= transfer.status === 'approved' ? '审核通过，正式启用' : transfer.status === 'rejected' ? '审核拒绝，临时权限终止' : '已结束'
    }
  }
}

function normalizeDeviceBusinessLinks(records: Record<string, EntityRecord[]>) {
  const devices = records.devices || []
  if (!devices.length) return
  const exactDevice = (sn: unknown) => devices.find((device) => device.code === String(sn || ''))
  const fallbackDevice = (record: EntityRecord, index: number) => {
    const sameOwner = devices.filter((device) => device.domain === record.domain && device.ownerId === record.ownerId)
    const sameDomain = devices.filter((device) => device.domain === record.domain)
    const candidates = sameOwner.length ? sameOwner : sameDomain.length ? sameDomain : devices
    return candidates[index % candidates.length]
  }
  const link = (record: EntityRecord, device: EntityRecord) => {
    record.deviceId = device.id
    record.deviceSN = device.code
  }

  for (const moduleKey of ['projects', 'repairs', 'materials', 'service-transfer', 'installation-transfers', 'issuance']) {
    for (const [index, record] of (records[moduleKey] || []).entries()) {
      if (moduleKey === 'materials' && record.category === '设备采购') continue
      let device = exactDevice(record.deviceSN)
      if (moduleKey === 'installation-transfers') {
        const project = (records.projects || []).find((item) => item.id === record.projectId || item.code === record.projectCode)
        device ||= exactDevice(project?.deviceSN)
      }
      device ||= fallbackDevice(record, index)
      if (device) link(record, device)
    }
  }
  for (const [index, complaint] of (records.complaints || []).entries()) {
    if (String(complaint.deviceSN || '') === '-') continue
    const device = exactDevice(complaint.deviceSN) || fallbackDevice(complaint, index)
    if (device) link(complaint, device)
  }
  for (const [index, order] of (records.warehouse || []).entries()) {
    if (order.category === '在库') continue
    const selected = Array.isArray(order.selectedDevices) ? order.selectedDevices.map(String) : []
    const validSelected = selected.filter((sn) => Boolean(exactDevice(sn)))
    if (validSelected.length) {
      order.deviceSN = validSelected.join('、')
      continue
    }
    const device = fallbackDevice(order, index)
    if (!device) continue
    order.selectedDevices = [device.code]
    link(order, device)
  }
}

function normalizePlatformBilling(records: Record<string, EntityRecord[]>) {
  records.payments ||= []
  records['expense-records'] ||= []
  records['billing-items'] ||= []
  for (const payment of records.payments) {
    payment.sourceType ||= 'app'
    payment.sourceLabel ||= payment.sourceType === 'platform' ? '平台费用登记' : 'APP 支付'
    payment.businessType ||= payment.sourceType === 'platform' ? payment.category : 'APP 服务订单'
    payment.channel ||= payment.category
  }

  for (const expense of records['expense-records']) {
    if (records.payments.some((item) => item.expenseRecordId === expense.id)) continue
    const sourceModule = expense.category === '售后转移' ? 'service-transfer' : 'materials'
    const subject = (records[sourceModule] || []).find((item) => item.id === expense.subjectId)
    appendEntity(records, 'payments', {
      code: `BILL-${String(expense.code || expense.id).replace(/[^A-Za-z0-9]/g, '').slice(-14)}`,
      name: expense.name,
      category: '平台费用账单',
      sourceType: 'platform',
      sourceLabel: '平台费用登记',
      businessType: expense.category,
      channel: expense.paymentMethod || '线下登记',
      amount: Number(expense.amount || 0),
      currency: expense.currency || 'CNY',
      account: subject?.dealer || subject?.owner || expense.owner || '平台业务',
      paidAt: expense.paidAt || expense.createdAt,
      paymentReference: expense.paymentReference || '',
      expenseRecordId: expense.id,
      subjectId: expense.subjectId,
      subjectCode: expense.subjectCode || subject?.code || '',
      subjectModule: sourceModule,
      recordedBy: expense.operator || '平台账单中心',
      status: 'paid',
      owner: subject?.owner || expense.owner,
      ownerId: subject?.ownerId || expense.ownerId,
      domain: subject?.domain || expense.domain,
    })
  }

  for (const payment of records.payments) {
    if (records['billing-items'].some((item) => item.paymentId === payment.id)) continue
    const purchaseItems = payment.subjectModule === 'materials'
      ? (records['purchase-items'] || []).filter((item) => item.subjectId === payment.subjectId)
      : []
    const sourceItems = purchaseItems.length ? purchaseItems : [{
      name: payment.name,
      itemName: payment.name,
      itemType: payment.businessType === '设备采购' ? '设备' : payment.businessType === '售后转移' ? '服务' : '费用',
      quantity: 1,
      unitPrice: Number(payment.amount || 0),
      subtotal: Number(payment.amount || 0),
    }]
    const sourceTotal = sourceItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
    sourceItems.forEach((item, index) => appendEntity(records, 'billing-items', {
      id: `billing-item-${payment.id}-${index + 1}`,
      name: String(item.itemName || item.name || '费用项目'), paymentId: payment.id,
      subjectId: payment.subjectId, subjectCode: payment.subjectCode,
      feeType: item.itemType === '物料' ? '物料费' : item.itemType === '设备' ? '设备采购费' : payment.businessType === '售后转移' ? '服务费' : '订单费用',
      itemName: item.itemName || item.name, quantity: Number(item.quantity || 1),
      unitPrice: Number(item.unitPrice || 0), subtotal: Number(item.subtotal || 0),
      adjustment: index === sourceItems.length - 1 ? Math.round((Number(payment.amount || 0) - sourceTotal) * 100) / 100 : 0,
      status: payment.status, owner: payment.owner, ownerId: payment.ownerId, domain: payment.domain,
    }))
  }
}

function normalizeWorkflowRelations(records: Record<string, EntityRecord[]>) {
  const accounts = records['auth-accounts'] || []
  const dealers = records.dealers || []
  const platformAccount = accounts.find((item) => item.roleKey === 'platform' && item.status === 'normal')
  const catalogs = records['material-catalog'] || []

  const ensureApproval = (record: EntityRecord, menuKey: string, sourceModule: string) => {
    if (record.status !== 'pending' || record.approvalInstanceId) return
    const configured = records['approval-flow'].find((item) => item.status === 'normal' && String(item.menuKey || item.flowType) === menuKey)
    const configuredIds = configuredApprovalIds(configured)
    const configuredApprovers = configuredIds.map((id) => accounts.find((item) => item.id === id && item.status === 'normal')).filter(Boolean) as EntityRecord[]
    const initiatorRole = record.initiatorRole || accounts.find((item) => item.status === 'normal' && item.ownerId === record.ownerId && ['tier1', 'tier2'].includes(String(item.roleKey)))?.roleKey || (record.ownerId === 'platform' ? 'platform' : 'tier2')
    let approvers = approversAfterInitiator(configuredApprovers, initiatorRole)
    if (initiatorRole === 'tier2') {
      const sourceDealer = dealers.find((item) => String(item.organizationId || item.ownerId) === String(record.ownerId))
      const parentDealer = dealers.find((item) => item.id === sourceDealer?.parentDealerId || item.organizationId === sourceDealer?.parentDealerId || item.ownerId === sourceDealer?.parentDealerId)
      const parentOwnerId = String(parentDealer?.organizationId || parentDealer?.ownerId || '')
      const parentAccount = accounts.find((item) => item.status === 'normal' && item.roleKey === 'tier1' && item.ownerId === parentOwnerId)
      if (parentAccount) approvers = approvers.map((item) => item.roleKey === 'tier1' ? parentAccount : item)
    }
    if (!approvers.length && platformAccount) approvers.push(platformAccount)
    if (menuKey === 'service-transfer') {
      approvers.length = 0
      const targetAccount = accounts.find((item) => item.status === 'normal' && item.ownerId === record.targetDealerId)
      if (targetAccount) approvers.unshift(targetAccount)
      if (record.hasFee) approvers.push(...configuredApprovers.filter((item) => item.roleKey === 'platform'))
    }
    const uniqueApprovers = [...new Map(approvers.map((item) => [item.id, item])).values()]
    if (!uniqueApprovers.length) return
    const instance = appendEntity(records, 'approval-instances', {
      id: `approval-instance-${record.id}`,
      code: `APR-${record.code}`,
      name: `${record.code} ${record.name}审批`,
      subjectId: record.id,
      subjectCode: record.code,
      sourceModule,
      menuKey,
      menuLabel: approvalMenuLabels[menuKey] || menuKey,
      flowId: configured?.id || '',
      currentStep: 1,
      totalSteps: uniqueApprovers.length,
      status: 'pending',
      owner: record.owner,
      ownerId: record.ownerId,
      domain: record.domain,
    })
    uniqueApprovers.forEach((approver, index) => appendEntity(records, 'approval-steps', {
      id: `approval-step-${record.id}-${index + 1}`,
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
    record.approvalInstanceId = instance.id
    record.currentApproverId = uniqueApprovers[0].id
    record.currentApproverName = uniqueApprovers[0].displayName || uniqueApprovers[0].name
  }

  for (const material of records.materials || []) {
    if (material.category !== '设备采购') {
      const materialName = String(material.materialName || material.name).split(' × ')[0]
      const catalog = catalogs.find((item) => item.id === material.materialId || item.name === materialName)
      if (catalog) {
        material.materialId = catalog.id
        material.materialName = catalog.name
      }
    }

    ensureApproval(material, 'materials', 'materials')
  }

  for (const device of records.devices || []) {
    if (device.serviceOwnerId && device.serviceOwnerId !== device.ownerId) {
      device.ownerId = String(device.serviceOwnerId)
      device.owner = String(device.serviceOwner || device.owner || '')
    }
    delete device.serviceOwnerId
    delete device.serviceOwner
  }
  records['service-responsibilities'] = []

  if (!(records['service-transfer'] || []).some((item) => item.hasFee)) {
    const device = (records.devices || []).find((item) => item.ownerId !== 'platform' && item.inventoryStatus !== 'in_stock')
    const source = device && dealers.find((item) => String(item.organizationId || item.ownerId) === String(device.ownerId))
    const target = source && dealers.find((item) => {
      const targetId = String(item.organizationId || item.ownerId)
      return item.status === 'normal'
        && item.domain === source.domain
        && targetId !== String(source.organizationId || source.ownerId)
        && accounts.some((account) => account.status === 'normal' && account.ownerId === targetId)
    })
    if (device && source && target && platformAccount) {
      appendEntity(records, 'service-transfer', {
        id: 'service-transfer-fee-demo',
        code: 'AST-20260821001',
        name: `${source.name} → ${target.name}`,
        category: '售后转移',
        deviceSN: device.code,
        sourceDealer: source.name,
        sourceDealerId: String(source.organizationId || source.ownerId),
        targetDealer: target.name,
        targetDealerId: String(target.organizationId || target.ownerId),
        hasFee: true,
        estimatedFee: 3200,
        feeBearer: '原经销商',
        feeDescription: '异地设备交接、运输与上门服务费用',
        feeStatus: '待总部审批',
        approvalStage: 'target_confirmation',
        initiatedBy: platformAccount.displayName || platformAccount.name,
        initiatorAccountId: platformAccount.id,
        initiatorRole: 'platform',
        initiatedAt: '2026-08-21T02:30:00.000Z',
        summary: '总部发起跨区域售后服务关系调整',
        status: 'pending',
        owner: source.name,
        ownerId: String(source.organizationId || source.ownerId),
        domain: source.domain,
      })
    }
  }

  for (const transfer of records['service-transfer'] || []) {
    const device = records.devices.find((item) => item.code === transfer.deviceSN)
    transfer.sourceDealerId ||= device?.ownerId || transfer.ownerId
    transfer.sourceDealer ||= device?.owner || transfer.owner
    if (!transfer.targetDealerId) {
      const targetName = String(transfer.targetDealer || String(transfer.name).split(' → ')[1] || '').trim()
      const target = dealers.find((item) => item.name.includes(targetName) || targetName.includes(item.name))
      if (target) transfer.targetDealerId = target.organizationId || target.ownerId
    }
    transfer.hasFee = Boolean(transfer.hasFee)
    transfer.estimatedFee = transfer.hasFee ? Number(transfer.estimatedFee || 0) : 0
    transfer.feeStatus ||= transfer.hasFee ? '待总部审批' : '无费用'
    transfer.approvalStage ||= transfer.status === 'pending' ? 'target_confirmation' : String(transfer.status)
    transfer.initiatedBy ||= transfer.owner || '历史数据'
    transfer.initiatedAt ||= transfer.createdAt
    ensureApproval(transfer, 'service-transfer', 'service-transfer')
  }

  for (const transfer of records.warehouse || []) {
    if (transfer.category === '调货') ensureApproval(transfer, 'warehouse', 'warehouse')
  }
}

function normalizeStableRelations(records: Record<string, EntityRecord[]>) {
  const users = records.users || []
  const devices = records.devices || []
  const findUser = (account: unknown) => users.find((user) => accountMatches(account, user.account))

  for (const device of devices) {
    const user = users.find((item) => item.id === device.userId) || findUser(device.account)
    device.userId = user?.id || ''
    if (user) {
      device.bindingStatus = 'bound'
      device.account = user.account
    } else if (!device.account || device.account === '-') {
      device.bindingStatus = 'unbound'
    }
  }

  for (const moduleKey of ['repairs', 'messages', 'complaints', 'payments']) {
    for (const record of records[moduleKey] || []) {
      const device = record.deviceSN && record.deviceSN !== '-' ? devices.find((item) => item.code === record.deviceSN) : undefined
      const user = users.find((item) => item.id === record.userId) || users.find((item) => item.id === device?.userId) || findUser(record.account)
      record.userId = user?.id || ''
    }
  }

  for (const material of records.materials || []) {
    const device = devices.find((item) => item.code === material.deviceSN)
    material.userId = String(material.userId || device?.userId || '')
  }

  for (const issuance of records.issuance || []) {
    const request = (records.materials || []).find((item) => item.id === issuance.sourceRequestId || item.code === issuance.sourceRequestCode)
      || (records.materials || []).find((item) => item.materialName === issuance.materialName)
    issuance.sourceRequestId = String(issuance.sourceRequestId || request?.id || '')
    issuance.sourceRequestCode = String(issuance.sourceRequestCode || request?.code || '')
    issuance.materialId = String(issuance.materialId || request?.materialId || '')
    issuance.deviceSN = String(issuance.deviceSN || request?.deviceSN || '')
  }

  const businessModules = Object.keys(records).filter((moduleKey) => !['logs', 'notifications'].includes(moduleKey))
  for (const log of records.logs || []) {
    const operatorAccount = (records['auth-accounts'] || []).find((item) => item.id === log.operatorAccountId || item.account === log.account || item.displayName === log.operator || item.name === log.operator)
    log.operatorAccountId = String(log.operatorAccountId || operatorAccount?.id || '')
    if (!log.subjectModule && log.subjectId) {
      log.subjectModule = businessModules.find((moduleKey) => records[moduleKey].some((item) => item.id === log.subjectId)) || ''
    }
    if (!log.subjectModule && log.subjectCode) {
      log.subjectModule = businessModules.find((moduleKey) => records[moduleKey].some((item) => item.code === log.subjectCode)) || ''
    }
    if (!log.subjectModule) {
      const content = String(log.content || log.summary || '')
      const match = businessModules.flatMap((moduleKey) => records[moduleKey].map((item) => ({ moduleKey, item })))
        .find(({ item }) => item.code && content.includes(item.code))
      if (match) {
        log.subjectId = match.item.id
        log.subjectCode = match.item.code
        log.subjectModule = match.moduleKey
      }
    }
  }
}

function normalizeProjectAndComponentRelations(records: Record<string, EntityRecord[]>) {
  records['device-components'] ||= []
  records['project-history'] ||= []
  const components = records['device-components']
  for (const [index, device] of (records.devices || []).entries()) {
    const inline = Array.isArray(device.components) ? device.components as Array<Record<string, unknown>> : []
    const legacySerials = String(device.coreComponentSerials || '').split(/[、,;；]/).map((item) => item.trim()).filter(Boolean)
    const normalized = inline.length
      ? inline.map((item) => ({ serialNumber: String(item.serialNumber || '').trim(), specification: String(item.specification || '').trim() })).filter((item) => item.serialNumber && item.specification)
      : index < 3 ? legacySerials.map((serialNumber) => ({ serialNumber, specification: `${String(device.deviceType || device.name)}核心组件` })) : []
    for (const component of normalized) {
      if (components.some((item) => item.serialNumber === component.serialNumber)) continue
      appendEntity(records, 'device-components', {
        id: `device-component-${device.id}-${components.length + 1}`,
        code: component.serialNumber,
        name: component.specification,
        serialNumber: component.serialNumber,
        specification: component.specification,
        deviceId: device.id,
        deviceSN: device.code,
        status: 'normal', owner: device.owner, ownerId: device.ownerId, domain: device.domain,
      })
    }
    device.components = components.filter((item) => item.deviceId === device.id || item.deviceSN === device.code).map((item) => ({ serialNumber: item.serialNumber, specification: item.specification }))
    if (Array.isArray(device.components) && device.components.length) device.coreComponentSerials = (device.components as Array<Record<string, unknown>>).map((item) => item.serialNumber).join('、')
  }

  for (const project of records.projects || []) {
    if (records['project-history'].some((item) => item.projectId === project.id)) continue
    appendEntity(records, 'project-history', {
      id: `project-history-${project.id}-initial`,
      code: `${project.code}-H001`,
      name: `${project.name}初始记录`,
      projectId: project.id,
      projectCode: project.code,
      changeType: '初始记录',
      snapshot: JSON.stringify({ shipOwner: project.shipOwner, owner: project.owner, ownerId: project.ownerId, deviceSN: project.deviceSN, warrantyUntil: project.warrantyUntil }),
      operator: '数据迁移', status: 'completed', owner: project.owner, ownerId: project.ownerId, domain: project.domain,
    })
  }
}

function normalizeAccounts(records: Record<string, EntityRecord[]>, roleIdRemap: Map<string, string>, repairLegacyRoles = false) {
  records['auth-accounts'] ||= []
  records.admins ||= []
  const roles = records.roles

  for (const admin of records.admins) {
    const mappedRoleId = roleIdRemap.get(String(admin.roleId || '')) || admin.roleId
    const ownerDealer = records.dealers.find((item) => String(item.organizationId || item.ownerId) === String(admin.ownerId))
    const fallbackRoleKey = String(admin.summary || '').includes('总部售后')
      ? 'custom'
      : admin.category === '经销商' ? (ownerDealer?.tier === '二级' ? 'tier2' : 'tier1') : 'platform'
    const role = (repairLegacyRoles && (String(admin.summary || '').includes('总部售后') || admin.category === '经销商')
      ? roles.find((item) => item.roleKey === fallbackRoleKey)
      : roles.find((item) => item.id === mappedRoleId || item.name === admin.role))
      || roles.find((item) => item.roleKey === fallbackRoleKey)
      || roles[0]
    admin.roleId = role?.id || ''
    admin.role = role?.name || admin.role || '平台管理员'
    admin.dataScope = role?.dataScope || admin.dataScope || 'all'
  }

  for (const seed of defaultAccountSeeds) {
    if (records['auth-accounts'].some((item) => item.account === seed.account)) continue
    const role = roles.find((item) => item.roleKey === seed.roleKey) || roles[0]
    const subject = seed.subjectType === 'admin'
      ? records.admins.find((item) => item.account === seed.account)
      : records.dealers.find((item) => item.organizationId === seed.ownerId || item.ownerId === seed.ownerId)
    records['auth-accounts'].push(entity('auth-accounts', records['auth-accounts'].length, {
      code: seed.account,
      name: seed.displayName,
      account: seed.account,
      password: seed.password,
      displayName: seed.displayName,
      roleId: role?.id || '',
      roleKey: seed.roleKey,
      roleLabel: role?.name || seed.roleKey,
      dataScope: role?.dataScope || (seed.roleKey === 'platform' ? 'all' : seed.roleKey === 'tier1' ? 'descendants' : 'self'),
      ownerId: seed.ownerId,
      domain: seed.domain,
      firstLogin: seed.firstLogin,
      failedAttempts: 0,
      lockedUntil: 0,
      subjectType: seed.subjectType,
      subjectId: subject?.id || '',
      status: 'normal',
    }))
  }

  for (const admin of records.admins) {
    if (!admin.account || records['auth-accounts'].some((item) => item.account === admin.account)) continue
    const role = roles.find((item) => item.id === admin.roleId) || roles.find((item) => item.roleKey === 'custom') || roles[0]
    records['auth-accounts'].push(entity('auth-accounts', records['auth-accounts'].length, {
      code: String(admin.account), name: admin.name, account: admin.account, password: 'Admin123!', displayName: admin.name,
      roleId: role.id, roleKey: role.roleKey, roleLabel: role.name, dataScope: role.dataScope,
      ownerId: admin.ownerId, domain: admin.domain, firstLogin: false, failedAttempts: 0,
      lockedUntil: admin.status === 'locked' ? Date.now() + 30 * 60 * 1000 : 0,
      subjectType: 'admin', subjectId: admin.id, status: admin.status,
    }))
  }

  for (const dealer of records.dealers) {
    const ownerId = String(dealer.organizationId || dealer.ownerId)
    if (!dealer.account || records['auth-accounts'].some((item) => item.account === dealer.account)) continue
    const roleKey = dealer.tier === '二级' ? 'tier2' : 'tier1'
    const role = roles.find((item) => item.roleKey === roleKey) || roles[0]
    records['auth-accounts'].push(entity('auth-accounts', records['auth-accounts'].length, {
      code: String(dealer.account),
      name: dealer.name,
      account: dealer.account,
      password: 'Dealer123!',
      displayName: dealer.name,
      roleId: role.id,
      roleKey,
      roleLabel: role.name,
      dataScope: role.dataScope,
      ownerId,
      domain: dealer.domain,
      firstLogin: false,
      failedAttempts: 0,
      lockedUntil: 0,
      subjectType: 'dealer',
      subjectId: dealer.id,
      status: dealer.status === 'disabled' ? 'disabled' : 'normal',
    }))
  }

  for (const account of records['auth-accounts']) {
    if (account.account === 'service@qingdao-marine.cn') {
      account.account = 'service@qingdao.cn'
      account.code = 'service@qingdao.cn'
    }
    const seed = defaultAccountSeeds.find((item) => item.account === account.account)
    const seedRoleName = seed ? defaultRoleSeeds.find((item) => item.roleKey === seed.roleKey)?.name : ''
    const mappedRoleId = roleIdRemap.get(String(account.roleId || '')) || account.roleId
    const role = seed
      ? roles.find((item) => item.roleKey === seed.roleKey && (!seedRoleName || item.name === seedRoleName))
      : roles.find((item) => item.id === mappedRoleId)
        || roles.find((item) => item.name === account.roleLabel)
        || roles.find((item) => item.roleKey === account.roleKey)
    if (!role) continue
    account.roleId = role.id
    account.roleKey = role.roleKey || account.roleKey || 'custom'
    account.roleLabel = role.name
    account.dataScope = role.dataScope || account.dataScope || 'self'
  }

  for (const admin of records.admins) {
    if (admin.status !== 'disabled' && admin.status !== 'locked') continue
    for (const account of records['auth-accounts'].filter((item) => item.subjectId === admin.id || item.account === admin.account)) {
      account.status = admin.status
      if (admin.status === 'locked' && Number(account.lockedUntil || 0) <= Date.now()) account.lockedUntil = Date.now() + 30 * 60 * 1000
    }
  }
  for (const dealer of records.dealers) {
    if (dealer.status !== 'disabled') continue
    const ownerId = String(dealer.organizationId || dealer.ownerId)
    for (const account of records['auth-accounts'].filter((item) => item.ownerId === ownerId)) account.status = 'disabled'
  }
}

function normalizeMeeting20260928(records: Record<string, EntityRecord[]>) {
  records['sales-regions'] ||= []
  records['product-categories'] ||= []
  records['purchase-change-history'] ||= []

  const regionSeeds = [
    { code: 'REG-CN-GD-SZ', market: '国内', country: '中国', province: '广东', city: '深圳', domain: 'cn' as DataDomain },
    { code: 'REG-CN-GD-FS', market: '国内', country: '中国', province: '广东', city: '佛山', domain: 'cn' as DataDomain },
    { code: 'REG-CN-FJ-XM', market: '国内', country: '中国', province: '福建', city: '厦门', domain: 'cn' as DataDomain },
    { code: 'REG-CN-SD-QD', market: '国内', country: '中国', province: '山东', city: '青岛', domain: 'cn' as DataDomain },
    { code: 'REG-US-CA-LA', market: '海外', country: '美国', province: 'California', city: 'Los Angeles', domain: 'global' as DataDomain },
    { code: 'REG-US-FL-MI', market: '海外', country: '美国', province: 'Florida', city: 'Miami', domain: 'global' as DataDomain },
  ]
  for (const region of regionSeeds) {
    if (records['sales-regions'].some((item) => item.code === region.code)) continue
    appendEntity(records, 'sales-regions', { ...region, name: `${region.country} · ${region.province} · ${region.city}`, dealerCount: 0, status: 'normal', owner: '平台中心', ownerId: 'platform' })
  }

  for (const dealer of records.dealers || []) {
    if (!Array.isArray(dealer.salesRegionIds) || !dealer.salesRegionIds.length) {
      const source = String(dealer.region || '')
      const matches = records['sales-regions'].filter((region) => region.domain === dealer.domain && [region.country, region.province, region.city].some((value) => source.includes(String(value))))
      const fallback = records['sales-regions'].find((region) => region.domain === dealer.domain)
      dealer.salesRegionIds = (matches.length ? matches : fallback ? [fallback] : []).map((item) => item.id)
    }
    const selected = records['sales-regions'].filter((region) => (dealer.salesRegionIds as unknown[]).includes(region.id))
    if (selected.length) dealer.region = selected.map((region) => region.name).join('；')
  }
  for (const region of records['sales-regions']) region.dealerCount = (records.dealers || []).filter((dealer) => Array.isArray(dealer.salesRegionIds) && dealer.salesRegionIds.includes(region.id)).length

  const products = records['product-catalog'] || []
  for (const product of products) {
    const categoryName = String(product.productCategory || product.name || product.deviceType || '其他设备')
    let category = records['product-categories'].find((item) => item.name === categoryName)
    if (!category) category = appendEntity(records, 'product-categories', { code: `PCG-${String(records['product-categories'].length + 1).padStart(3, '0')}`, name: categoryName, category: '产品分类', productCount: 0, status: 'normal', owner: '平台中心', ownerId: 'platform', domain: product.domain })
    product.productCategoryId = category.id
    product.productCategory = category.name
    const reference = Number(product.referencePrice || 0)
    product.terminalPrice = Number(product.terminalPrice || reference)
    product.tier1Price = Number(product.tier1Price || Math.round(reference * 0.82))
    product.tier2Price = Number(product.tier2Price || Math.round(reference * 0.9))
    product.referencePrice = product.tier1Price
  }
  synchronizeProductCategoryHierarchy(records)

  for (const material of records['material-catalog'] || []) if (material.status === 'low') material.status = 'normal'
  for (const request of records.materials || []) {
    if (['普通申请', '提前申请'].includes(String(request.category))) request.category = '售后物料申请'
  }

  const forbiddenDealerPrefixes = ['warehouse:', 'warehouses:', 'warehouse-locations:', 'couriers:', 'material-catalog:']
  for (const role of records.roles || []) {
    if (!['tier1', 'tier2'].includes(String(role.roleKey))) continue
    const permissions = Array.isArray(role.permissions) ? role.permissions.map(String) : []
    const hasLegacyDealerModules = permissions.some((permission) => forbiddenDealerPrefixes.some((prefix) => permission.startsWith(prefix)))
    const hasProcurementPermissions = permissions.some((permission) => permission.startsWith('materials:'))
    if (!hasLegacyDealerModules && !hasProcurementPermissions) continue
    const normalizedPermissions = permissions.filter((permission) => !forbiddenDealerPrefixes.some((prefix) => permission.startsWith(prefix)))
    if (hasProcurementPermissions && !normalizedPermissions.includes('materials:edit')) normalizedPermissions.push('materials:edit')
    role.permissions = normalizedPermissions
    role.permissionCount = normalizedPermissions.length
  }
}

function ensureWorkflowDemoCoverage(records: Record<string, EntityRecord[]>) {
  const ensure = (moduleKey: string, id: string, payload: Partial<EntityRecord>) => {
    const existing = (records[moduleKey] || []).find((item) => item.id === id)
    if (existing) return existing
    return appendEntity(records, moduleKey, { id, ...payload })
  }
  const devices = records.devices || []
  const dealers = records.dealers || []
  const products = records['product-catalog'] || []
  const warehouses = records.warehouses || []
  const tier1 = dealers.find((item) => item.organizationId === 'dealer-t1-sz') || dealers.find((item) => item.tier === '一级' && item.domain === 'cn')
  const tier2 = dealers.find((item) => item.organizationId === 'dealer-t2-xm') || dealers.find((item) => item.tier === '二级' && item.domain === 'cn')
  const dealer = tier2 || tier1 || dealers[0]
  const dealerId = String(dealer?.organizationId || dealer?.ownerId || 'dealer-t2-xm')
  const dealerName = String(dealer?.name || '厦门蓝湾船舶服务')
  const product = products[0]
  const productName = String(product?.descriptor || product?.deviceModel || product?.name || '顶流机 TF-01')
  const unitPrice = Number(product?.referencePrice || 68000)
  const demoTimes = ['2026-09-28T01:20:00.000Z', '2026-09-28T01:30:00.000Z', '2026-09-28T01:40:00.000Z', '2026-09-28T01:50:00.000Z']

  const purchaseSamples = [
    { id: 'materials-purchase-finance-demo', code: 'PUR-20260928001', stage: 'finance_confirmation', stageLabel: '待财务确认', paymentStatus: '未登记', contractStatus: '待确认', deliveryStatus: '待处理', status: 'approved' },
    { id: 'materials-purchase-warehouse-demo', code: 'PUR-20260928002', stage: 'warehouse_fulfillment', stageLabel: '待仓库发货', paymentStatus: '已登记', contractStatus: '已签订', deliveryStatus: '待发货', status: 'approved' },
    { id: 'materials-purchase-shipped-demo', code: 'PUR-20260928003', stage: 'shipped', stageLabel: '已发货', paymentStatus: '已登记', contractStatus: '已签订', deliveryStatus: '已发货', status: 'shipped' },
    { id: 'materials-purchase-completed-demo', code: 'PUR-20260928004', stage: 'completed', stageLabel: '已完成', paymentStatus: '已登记', contractStatus: '已签订', deliveryStatus: '已签收', status: 'completed' },
  ]
  for (const [index, sample] of purchaseSamples.entries()) {
    ensure('materials', sample.id, {
      code: sample.code,
      name: `${productName} × 1`,
      category: '设备采购',
      requestType: 'device_purchase',
      productId: product?.id || '',
      deviceModel: productName,
      itemName: productName,
      quantity: 1,
      estimatedUnitPrice: unitPrice,
      amount: unitPrice,
      currency: 'CNY',
      paymentStatus: sample.paymentStatus,
      contractStatus: sample.contractStatus,
      deliveryStatus: sample.deliveryStatus,
      purchaseStage: sample.stage,
      purchaseStageLabel: sample.stageLabel,
      initiatedBy: dealerName,
      initiatedAt: demoTimes[index],
      dealer: dealerName,
      deviceSN: '-',
      warrantyResult: '不适用',
      summary: `${sample.stageLabel}流程演示数据`,
      status: sample.status,
      owner: dealerName,
      ownerId: dealerId,
      domain: 'cn',
    })
  }

  for (const purchaseId of ['materials-purchase-warehouse-demo', 'materials-purchase-shipped-demo', 'materials-purchase-completed-demo']) {
    const financedPurchase = records.materials.find((item) => item.id === purchaseId)
    if (!financedPurchase) continue
    Object.assign(financedPurchase, { financeConfirmedAt: financedPurchase.financeConfirmedAt || demoTimes[1], financeConfirmedBy: financedPurchase.financeConfirmedBy || '平台财务' })
    ensure('expense-records', `expense-${purchaseId}`, {
      name: `${financedPurchase.code}采购费用`, category: '设备采购', subjectId: financedPurchase.id, subjectCode: financedPurchase.code,
      amount: financedPurchase.amount, quantity: financedPurchase.quantity, currency: 'CNY', paymentMethod: '对公转账',
      paymentReference: `DEMO-FIN-${financedPurchase.code}`, paidAt: '2026-09-28', contractStatus: '已签订', contractNo: `DEMO-CONTRACT-${financedPurchase.code}`,
      operator: '平台财务', status: 'completed', owner: financedPurchase.owner, ownerId: financedPurchase.ownerId, domain: financedPurchase.domain,
    })
  }
  for (const [index, purchaseId] of ['materials-purchase-shipped-demo', 'materials-purchase-completed-demo'].entries()) {
    const shippedPurchase = records.materials.find((item) => item.id === purchaseId)
    if (!shippedPurchase) continue
    const shippedDevice = devices.filter((item) => item.domain === 'cn')[index] || devices[index] || devices[0]
    const warehouse = warehouses.find((item) => item.domain === 'cn') || warehouses[0]
    const completed = shippedPurchase.status === 'completed'
    Object.assign(shippedPurchase, {
      selectedDevices: shippedDevice ? [shippedDevice.code] : [],
      warehouseId: warehouse?.id || '',
      warehouseName: warehouse?.name || '',
      deliveryMethod: '物流配送',
      deliveryReference: `DEMO-DELIVERY-20260928-0${index + 1}`,
      shippedAt: '2026-09-28',
      ...(completed ? { receivedAt: demoTimes[2], receivedBy: dealerName, receiptNote: '设备数量与外观核对无误', completedAt: demoTimes[2] } : {}),
    })
    ensure('purchase-fulfillments', `fulfillment-${purchaseId}`, {
      name: `${shippedPurchase.code}仓库发货`, subjectId: shippedPurchase.id, subjectCode: shippedPurchase.code,
      warehouseId: warehouse?.id || '', warehouseName: warehouse?.name || '', selectedDevices: shippedDevice ? [shippedDevice.code] : [],
      deviceSN: shippedDevice?.code || '', deliveryMethod: '物流配送', deliveryReference: `DEMO-DELIVERY-20260928-0${index + 1}`, shippedAt: '2026-09-28',
      operator: '平台仓库组', status: completed ? 'completed' : 'shipped',
      ...(completed ? { receivedAt: demoTimes[2], receivedBy: dealerName, receiptNote: '设备数量与外观核对无误' } : {}),
      owner: shippedPurchase.owner, ownerId: shippedPurchase.ownerId, domain: shippedPurchase.domain,
    })
  }

  const pendingInstallation = (records['installation-transfers'] || []).find((item) => item.status === 'pending')
  const installationSamples = [
    { id: 'installation-transfer-approved-demo', code: 'IRT-20260928002', status: 'approved', suffix: '已通过', note: '安装地区与服务能力核验通过' },
    { id: 'installation-transfer-rejected-demo', code: 'IRT-20260928003', status: 'rejected', suffix: '已拒绝', note: '目标地区暂无授权安装服务能力' },
  ]
  for (const [index, sample] of installationSamples.entries()) {
    const device = devices[(index + 1) % Math.max(devices.length, 1)]
    const project = ensure('projects', `project-${sample.id}`, {
      code: `PRJ-2026092800${index + 2}`, name: `跨区安装${sample.suffix}样例`, category: device?.name || productName,
      deviceSN: device?.code || '', deviceModel: device?.name || productName, shipOwner: index ? '陈远帆' : '林海舟', warrantyUntil: '2028-09-28', factoryRegion: '中国 · 广东', installationRegion: index ? '中国 · 山东' : '中国 · 福建',
      usageRegion: index ? '中国 · 山东' : '中国 · 福建', crossRegionStatus: sample.status, activationReviewStatus: sample.status,
      status: sample.status === 'approved' ? 'normal' : 'rejected', owner: dealerName, ownerId: dealerId, domain: 'cn',
    })
    ensure('installation-transfers', sample.id, {
      code: sample.code, name: project.name, category: '安装跨区审核', projectId: project.id, projectCode: project.code,
      deviceSN: device?.code || '', factoryRegion: '中国 · 广东', installationRegion: index ? '中国 · 山东' : '中国 · 福建', dealer: dealerName,
      reviewedAt: demoTimes[index + 1], reviewer: '平台管理员', reviewNote: sample.note, temporaryUseStatus: 'ended',
      temporaryUseStatusLabel: sample.status === 'approved' ? '审核通过，正式启用' : '审核拒绝，临时权限终止',
      summary: sample.note, status: sample.status, owner: dealerName, ownerId: dealerId, domain: 'cn',
    })
  }
  if (pendingInstallation && !records.projects.some((item) => item.id === pendingInstallation.projectId)) {
    const device = devices.find((item) => item.code === pendingInstallation.deviceSN) || devices[0]
    const project = ensure('projects', 'project-installation-transfer-pending-demo', {
      code: String(pendingInstallation.projectCode || 'PRJ-20260928001'), name: '跨区安装待审核样例', category: device?.name || productName,
      deviceSN: device?.code || '', deviceModel: device?.name || productName, shipOwner: '张海宁', warrantyUntil: '2028-09-28', factoryRegion: pendingInstallation.factoryRegion || '中国 · 广东',
      installationRegion: pendingInstallation.installationRegion || '中国 · 福建', usageRegion: pendingInstallation.installationRegion || '中国 · 福建',
      crossRegionStatus: 'pending', activationReviewStatus: 'pending', status: 'pending', owner: pendingInstallation.owner, ownerId: pendingInstallation.ownerId, domain: pendingInstallation.domain,
    })
    Object.assign(pendingInstallation, { projectId: project.id, projectCode: project.code, deviceSN: project.deviceSN })
  }

  const cnDevices = devices.filter((item) => item.domain === 'cn')
  const transferSource = tier1 || dealer
  const transferTarget = tier2 && tier2.id !== transferSource?.id ? tier2 : dealers.find((item) => item.domain === 'cn' && item.id !== transferSource?.id)
  const sourceId = String(transferSource?.organizationId || transferSource?.ownerId || 'dealer-t1-sz')
  const targetId = String(transferTarget?.organizationId || transferTarget?.ownerId || 'dealer-t2-xm')
  const sourceName = String(transferSource?.name || '深圳海航设备有限公司')
  const targetName = String(transferTarget?.name || '厦门蓝湾船舶服务')
  const targetStage = (records['service-transfer'] || []).find((item) => item.id === 'service-transfer-0001')
  if (targetStage) Object.assign(targetStage, { status: 'pending', approvalStage: 'target_confirmation', hasFee: false, estimatedFee: 0, feeStatus: '无费用', sourceDealer: sourceName, sourceDealerId: sourceId, targetDealer: targetName, targetDealerId: targetId, owner: sourceName, ownerId: sourceId, domain: 'cn' })
  const feeStage = (records['service-transfer'] || []).find((item) => item.id === 'service-transfer-0002')
  if (feeStage) Object.assign(feeStage, { status: 'pending', approvalStage: 'fee_approval', hasFee: true, estimatedFee: 3200, feeBearer: '原经销商', feeStatus: '待总部审批', sourceDealer: sourceName, sourceDealerId: sourceId, targetDealer: targetName, targetDealerId: targetId, owner: sourceName, ownerId: sourceId, domain: 'cn' })
  const completedStage = (records['service-transfer'] || []).find((item) => item.id === 'service-transfer-0003')
  if (completedStage) Object.assign(completedStage, { status: 'completed', approvalStage: 'completed', hasFee: false, estimatedFee: 0, feeStatus: '无费用', sourceDealer: sourceName, sourceDealerId: sourceId, targetDealer: targetName, targetDealerId: targetId, owner: sourceName, ownerId: sourceId, domain: 'cn' })
  const rejectedStage = (records['service-transfer'] || []).find((item) => item.status === 'rejected')
    || (records['service-transfer'] || []).find((item) => item.id === 'service-transfer-fee-demo')
    || ensure('service-transfer', 'service-transfer-rejected-demo', { code: 'AST-20260928004', name: `${sourceName} → ${targetName}`, category: '售后转移' })
  Object.assign(rejectedStage, { status: 'rejected', approvalStage: 'rejected', hasFee: true, estimatedFee: 1800, feeBearer: '总部', feeStatus: '已拒绝', sourceDealer: sourceName, sourceDealerId: sourceId, targetDealer: targetName, targetDealerId: targetId, rejectionReason: '费用依据不完整', owner: sourceName, ownerId: sourceId, domain: 'cn' })

  const transferDevice = cnDevices[0] || devices[0]
  const warehouseSamples = [
    { id: 'warehouse-transfer-approved-demo', code: 'WTR-20260928002', status: 'completed', decision: '调货审批通过并完成归属变更' },
    { id: 'warehouse-transfer-rejected-demo', code: 'WTR-20260928003', status: 'rejected', decision: '目标仓储容量不足，调货申请已拒绝' },
  ]
  for (const sample of warehouseSamples) {
    ensure('warehouse', sample.id, {
      code: sample.code, name: `${targetName}库存调货`, category: '调货', deviceSN: transferDevice?.code || '', selectedDevices: transferDevice ? [transferDevice.code] : [],
      sourceDealer: sourceName, sourceDealerId: sourceId, targetDealer: targetName, targetDealerId: targetId,
      summary: sample.decision, approvalReason: sample.decision, status: sample.status, owner: sourceName, ownerId: sourceId, domain: 'cn',
    })
  }

  const repairDevice = cnDevices.find((item) => item.ownerId === dealerId) || cnDevices[0] || devices[0]
  const completedRepair = ensure('repairs', 'repairs-billed-demo', {
    code: 'REP-20260928004', name: '顶流机转向传感器更换', category: '转向', account: repairDevice?.account || '13812345678',
    deviceSN: repairDevice?.code || '', faultCategory: '转向', contact: '13812345678', description: '转向抖动，现场更换传感器后恢复正常',
    dealerId, dealer: dealerName, assignee: dealerName, result: '转向传感器已更换并通过运行测试', completedAt: demoTimes[2],
    status: 'completed', owner: dealerName, ownerId: dealerId, domain: 'cn',
  })
  if (!completedRepair.billingPaymentId) {
    const payment = ensure('payments', 'payment-repair-completed-demo', {
      code: 'BILL-20260928001', name: `${completedRepair.code}维修账单`, category: '平台维修账单', sourceType: 'platform', sourceLabel: '平台费用登记',
      businessType: '维修账单', channel: '线下登记', amount: 680, currency: 'CNY', account: completedRepair.account || completedRepair.owner,
      paidAt: '2026-09-28', paymentReference: 'DEMO-REPAIR-20260928', subjectId: completedRepair.id, subjectCode: completedRepair.code,
      subjectModule: 'repairs', recordedBy: '平台售后', status: 'paid', owner: completedRepair.owner, ownerId: completedRepair.ownerId, domain: completedRepair.domain,
    })
    completedRepair.billingPaymentId = payment.id
    completedRepair.billingStatus = payment.status
    completedRepair.billingAmount = payment.amount
    const expense = ensure('expense-records', 'expense-repair-completed-demo', {
      name: `${completedRepair.code}维修账单`, category: '维修账单', subjectId: completedRepair.id, subjectCode: completedRepair.code,
      laborHours: 2, laborUnitPrice: 220, laborSubtotal: 440, materialAmount: 240, adjustment: 0, amount: 680, currency: 'CNY',
      paymentMethod: '线下登记', paymentReference: 'DEMO-REPAIR-20260928', paidAt: '2026-09-28', operator: '平台售后',
      status: 'paid', owner: completedRepair.owner, ownerId: completedRepair.ownerId, domain: completedRepair.domain,
    })
    payment.expenseRecordId = expense.id
    ensure('billing-items', 'billing-item-repair-labor-demo', {
      name: '维修人工服务', paymentId: payment.id, subjectId: completedRepair.id, subjectCode: completedRepair.code, feeType: '人工费',
      itemName: '维修人工服务', quantity: 2, unitPrice: 220, subtotal: 440, adjustment: 0, status: 'paid', owner: completedRepair.owner, ownerId: completedRepair.ownerId, domain: completedRepair.domain,
    })
    ensure('billing-items', 'billing-item-repair-material-demo', {
      name: '维修物料', paymentId: payment.id, subjectId: completedRepair.id, subjectCode: completedRepair.code, feeType: '物料费',
      itemName: '转向传感器', quantity: 1, unitPrice: 240, subtotal: 240, adjustment: 0, status: 'paid', owner: completedRepair.owner, ownerId: completedRepair.ownerId, domain: completedRepair.domain,
    })
  }

  const completedIssuance = (records.issuance || []).find((item) => item.status === 'completed')
  if (completedIssuance && !(records['replacement-records'] || []).some((item) => item.issuanceId === completedIssuance.id)) {
    const repair = completedRepair || records.repairs?.[0]
    ensure('replacement-records', 'replacement-issuance-completed-demo', {
      name: `${completedIssuance.materialName || completedIssuance.name}更换记录`, issuanceId: completedIssuance.id,
      sourceRequestId: completedIssuance.sourceRequestId || '', repairId: repair?.id || '', repairCode: repair?.code || '', deviceSN: completedIssuance.deviceSN || repair?.deviceSN || '',
      oldPartSerial: 'OLD-DEMO-20260928', newPartSerial: 'NEW-DEMO-20260928', reason: '故障件更换完成', operator: '平台售后',
      status: 'completed', owner: completedIssuance.owner, ownerId: completedIssuance.ownerId, domain: completedIssuance.domain,
    })
  }
}

function synchronizeWorkflowDemoApprovals(records: Record<string, EntityRecord[]>) {
  const accounts = records['auth-accounts'] || []
  const platform = accounts.find((item) => item.roleKey === 'platform' && item.status === 'normal')
  if (!platform) return
  const ensureHistoricalApproval = (record: EntityRecord | undefined, menuKey: string, sourceModule: string, status: 'approved' | 'rejected') => {
    if (!record) return
    let instance = (records['approval-instances'] || []).find((item) => item.id === record.approvalInstanceId || item.subjectId === record.id)
    if (!instance) {
      instance = appendEntity(records, 'approval-instances', {
        id: `approval-instance-${record.id}`, code: `APR-${record.code}`, name: `${record.code} ${record.name}审批`, subjectId: record.id,
        subjectCode: record.code, sourceModule, menuKey, menuLabel: approvalMenuLabels[menuKey] || menuKey, currentStep: 1, totalSteps: 1,
        status, completedAt: record.updatedAt, owner: record.owner, ownerId: record.ownerId, domain: record.domain,
      })
    }
    Object.assign(instance, { status, completedAt: instance.completedAt || record.updatedAt, currentStep: instance.totalSteps || 1 })
    record.approvalInstanceId = instance.id
    record.currentApproverId = ''
    record.currentApproverName = ''
    const steps = (records['approval-steps'] || []).filter((item) => item.instanceId === instance!.id)
    if (!steps.length) {
      appendEntity(records, 'approval-steps', {
        id: `approval-step-${record.id}-history`, code: `${instance.code}-1`, name: '业务审批', subjectId: record.id, subjectCode: record.code,
        instanceId: instance.id, sequence: 1, approverAccountId: platform.id, approverName: platform.displayName || platform.name,
        comment: status === 'approved' ? '演示流程审批通过' : '演示流程审批拒绝', handledAt: record.updatedAt, status,
        owner: record.owner, ownerId: record.ownerId, domain: record.domain,
      })
    } else {
      steps.forEach((step) => Object.assign(step, { status: status === 'approved' ? 'approved' : step.sequence === 1 ? 'rejected' : 'skipped', handledAt: step.handledAt || record.updatedAt }))
    }
  }

  for (const id of ['materials-purchase-finance-demo', 'materials-purchase-warehouse-demo', 'materials-purchase-shipped-demo', 'materials-purchase-completed-demo']) {
    ensureHistoricalApproval(records.materials?.find((item) => item.id === id), 'materials', 'materials', 'approved')
  }
  ensureHistoricalApproval(records.materials?.find((item) => item.status === 'rejected'), 'materials', 'materials', 'rejected')
  ensureHistoricalApproval(records.warehouse?.find((item) => item.id === 'warehouse-transfer-approved-demo'), 'warehouse', 'warehouse', 'approved')
  ensureHistoricalApproval(records.warehouse?.find((item) => item.id === 'warehouse-transfer-rejected-demo'), 'warehouse', 'warehouse', 'rejected')
  ensureHistoricalApproval(records['service-transfer']?.find((item) => item.status === 'completed'), 'service-transfer', 'service-transfer', 'approved')
  ensureHistoricalApproval(records['service-transfer']?.find((item) => item.status === 'rejected'), 'service-transfer', 'service-transfer', 'rejected')

  const feeTransfer = records['service-transfer']?.find((item) => item.approvalStage === 'fee_approval')
  const instance = feeTransfer && records['approval-instances']?.find((item) => item.id === feeTransfer.approvalInstanceId)
  const steps = instance ? (records['approval-steps'] || []).filter((item) => item.instanceId === instance.id).sort((left, right) => Number(left.sequence) - Number(right.sequence)) : []
  if (feeTransfer && instance && steps.length >= 2) {
    const current = steps[steps.length - 1]
    steps.forEach((step, index) => Object.assign(step, index === steps.length - 1 ? { status: 'pending' } : { status: 'approved', handledAt: step.handledAt || feeTransfer.updatedAt }))
    Object.assign(instance, { status: 'pending', currentStep: current.sequence })
    Object.assign(feeTransfer, { status: 'pending', currentApproverId: current.approverAccountId, currentApproverName: current.approverName })
  }
}

export function migrateDatabase(source?: { version?: number; records?: Record<string, EntityRecord[]> } | null): StoredDatabase {
  const seed = createSeedDatabase()
  if (source?.records) {
    for (const [moduleKey, rows] of Object.entries(source.records)) {
      if (Array.isArray(rows)) seed.records[moduleKey] = rows
    }
  }
  if (!(seed.records.users || []).some((item) => item.category === 'APPID')) {
    appendEntity(seed.records, 'users', { code: 'USE-APPID-001', name: 'APPID 演示用户', account: 'APPID-DEMO-001', category: 'APPID', lastActive: '刚刚', status: 'normal', owner: '平台中心', ownerId: 'platform', domain: 'cn' })
  }
  const sourceVersion = Number(source?.version || 0)
  const roleIdRemap = normalizeRoles(seed.records, sourceVersion >= 8, sourceVersion > 0 && sourceVersion < 10)
  if (sourceVersion > 0 && sourceVersion < 13) {
    const tier2Role = seed.records.roles.find((item) => item.roleKey === 'tier2')
    const permissions = Array.isArray(tier2Role?.permissions) ? tier2Role.permissions.map(String) : []
    if (tier2Role && !permissions.includes('projects:create')) {
      tier2Role.permissions = [...permissions, 'projects:create']
      tier2Role.permissionCount = permissions.length + 1
    }
  }
  normalizeDealers(seed.records)
  normalizeAccountAliases(seed.records)
  normalizeBusinessRecords(seed.records)
  normalizeDeviceRecords(seed.records)
  normalizeAccounts(seed.records, roleIdRemap, Number(source?.version || 0) < 7)
  normalizeUserAccounts(seed.records)
  normalizeApprovalFlows(seed.records)
  seed.records.ota = (seed.records.ota || []).filter((item) => item.category === '固件版本')
  seed.records.couriers = (seed.records.couriers || []).filter((item) => item.category === '快递公司')
  seed.records.warranty = (seed.records.warranty || []).filter((item) => item.category !== '变更记录')
  for (const rule of seed.records.warranty) {
    rule.dealerId = String(rule.dealerId || rule.ownerId)
    rule.dealer = String(rule.dealer || rule.owner)
    rule.productType = String(rule.productType || rule.category)
  }
  seed.records.dealers = (seed.records.dealers || []).filter((item) => item.category !== '注册申请')
  seed.records['dealer-applications'] = []
  seed.records['payment-settings'] = (seed.records['payment-settings'] || []).filter((item) => ['支付渠道', '商户配置'].includes(String(item.category)))
  seed.records['launch-settings'] ||= []
  if (!seed.records['launch-settings'].length) {
    appendEntity(seed.records, 'launch-settings', {
      id: 'launch-settings-default',
      code: 'APP-LAUNCH-V3.2',
      name: 'APP 启动页',
      category: '客户端配置',
      status: 'normal',
      enabled: true,
      revision: 'v3.2-default',
      title: '鲨鱼妹妹',
      titleEn: 'Shark Sister',
      subtitle: '连接海上设备，掌握每一次运行状态',
      subtitleEn: 'Connected control for every journey',
      backgroundImage: './assets/backgrounds/launch-screen.png',
      logoImage: './assets/backgrounds/launch-logo.png',
      durationMs: 1800,
      allowSkip: true,
      owner: '平台中心',
      ownerId: 'platform',
      domain: 'cn',
    })
  }
  const requiredPaymentChannels = ['微信支付', '支付宝', 'PayPal', 'Apple Pay', 'Google Pay']
  for (const [index, channel] of requiredPaymentChannels.entries()) {
    if (seed.records['payment-settings'].some((item) => item.category === '支付渠道' && item.name === channel)) continue
    appendEntity(seed.records, 'payment-settings', {
      name: channel,
      category: '支付渠道',
      channel,
      status: 'normal',
      summary: index < 2 ? '国内用户支付方式' : '海外用户支付方式',
      owner: '平台中心',
      ownerId: 'platform',
      domain: index < 2 ? 'cn' : 'global',
    })
  }
  if ((source?.version || 0) < 5) {
    for (const moduleKey of ['materials', 'warehouse', 'service-transfer']) {
      for (const record of seed.records[moduleKey] || []) {
        if (record.status !== 'pending') continue
        delete record.approvalInstanceId
        delete record.currentApproverId
        delete record.currentApproverName
      }
    }
    seed.records['approval-instances'] = []
    seed.records['approval-steps'] = []
  }
  if (sourceVersion > 0 && sourceVersion < 13) {
    const pendingSubjects = new Set<string>()
    for (const moduleKey of ['materials', 'warehouse', 'service-transfer']) {
      for (const record of seed.records[moduleKey] || []) {
        if (record.status !== 'pending') continue
        if (moduleKey === 'warehouse' && record.category !== '调货') continue
        pendingSubjects.add(record.id)
        delete record.approvalInstanceId
        delete record.currentApproverId
        delete record.currentApproverName
      }
    }
    const removedInstances = new Set((seed.records['approval-instances'] || []).filter((item) => pendingSubjects.has(String(item.subjectId))).map((item) => item.id))
    seed.records['approval-instances'] = (seed.records['approval-instances'] || []).filter((item) => !removedInstances.has(item.id))
    seed.records['approval-steps'] = (seed.records['approval-steps'] || []).filter((item) => !removedInstances.has(String(item.instanceId)))
  }
  seed.records['stock-reservations'] ||= []
  for (const catalog of seed.records['material-catalog'] || []) catalog.reservedStock = Number(catalog.reservedStock || 0)
  normalizeProcurementRecords(seed.records)
  normalizePlatformBilling(seed.records)
  normalizeStableRelations(seed.records)
  normalizeProjectAndComponentRelations(seed.records)
  normalizeMeetingAdjustments(seed.records)
  normalizeV14Adjustments(seed.records)
  normalizeV15Adjustments(seed.records)
  normalizeDocumentIssueAdjustments(seed.records)
  normalizeDeviceBusinessLinks(seed.records)
  normalizeMeeting20260928(seed.records)
  normalizeMaterialInventory(seed.records)
  ensureWorkflowDemoCoverage(seed.records)
  normalizeProcurementRecords(seed.records)
  normalizePlatformBilling(seed.records)
  normalizeWorkflowRelations(seed.records)
  normalizeStableRelations(seed.records)
  normalizeProjectAndComponentRelations(seed.records)
  normalizeDocumentIssueAdjustments(seed.records)
  normalizeDeviceBusinessLinks(seed.records)
  normalizeMaterialInventory(seed.records)
  synchronizeWorkflowDemoApprovals(seed.records)
  seed.version = 15
  seed.updatedAt = now()
  return seed
}

function parseStored(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') as { version?: number; records?: Record<string, EntityRecord[]> } | null
  } catch {
    return null
  }
}

function readDatabase(): StoredDatabase {
  const current = parseStored(DATABASE_KEY)
  if (current?.version === 15 && current.records) {
    const migrated = migrateDatabase(current)
    localStorage.setItem(DATABASE_KEY, JSON.stringify(migrated))
    return migrated
  }
  const source = [PREVIOUS_DATABASE_KEY, V13_DATABASE_KEY, V12_DATABASE_KEY, V11_DATABASE_KEY, V10_DATABASE_KEY, V9_DATABASE_KEY, V8_DATABASE_KEY, V7_DATABASE_KEY, V6_DATABASE_KEY, V5_DATABASE_KEY, V4_DATABASE_KEY, V3_DATABASE_KEY, V2_DATABASE_KEY, LEGACY_DATABASE_KEY]
    .map(parseStored)
    .find((candidate) => candidate?.records)
  const migrated = migrateDatabase(source)
  localStorage.setItem(DATABASE_KEY, JSON.stringify(migrated))
  return migrated
}

export const useDatabaseStore = defineStore('database', {
  state: () => ({ database: readDatabase(), revision: 0, transactionDepth: 0 }),
  actions: {
    persist() {
      if (this.transactionDepth > 0) return
      this.database.updatedAt = now()
      localStorage.setItem(DATABASE_KEY, JSON.stringify(this.database))
      this.revision += 1
    },
    reset() {
      this.database = migrateDatabase()
      this.persist()
    },
    records(moduleKey: string) {
      if (!this.database.records[moduleKey]) this.database.records[moduleKey] = []
      return this.database.records[moduleKey]
    },
    create(moduleKey: string, payload: Partial<EntityRecord>) {
      const createdAt = now()
      const record = entity(moduleKey, this.records(moduleKey).length, {
        id: `${moduleKey}-${Date.now().toString(36)}-${String(this.records(moduleKey).length + 1).padStart(3, '0')}`,
        code: String(payload.code || `${moduleKey.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-8)}`),
        name: String(payload.name || '未命名记录'),
        summary: '',
        category: '标准',
        region: '中国',
        owner: '',
        ownerId: 'platform',
        status: 'normal',
        domain: 'cn',
        createdAt,
        updatedAt: createdAt,
        ...payload,
      })
      this.records(moduleKey).unshift(record)
      this.persist()
      return record
    },
    update(moduleKey: string, id: string, payload: Partial<EntityRecord>) {
      const index = this.records(moduleKey).findIndex((item) => item.id === id)
      if (index < 0) return undefined
      this.records(moduleKey)[index] = { ...this.records(moduleKey)[index], ...payload, updatedAt: now() }
      this.persist()
      return this.records(moduleKey)[index]
    },
    remove(moduleKey: string, id: string) {
      const index = this.records(moduleKey).findIndex((item) => item.id === id)
      if (index < 0) return false
      this.records(moduleKey).splice(index, 1)
      this.persist()
      return true
    },
    transaction<T>(work: () => T) {
      const snapshot = JSON.parse(JSON.stringify(this.database)) as StoredDatabase
      this.transactionDepth += 1
      try {
        const result = work()
        this.transactionDepth -= 1
        if (this.transactionDepth === 0) this.persist()
        return result
      } catch (error) {
        this.database = snapshot
        this.transactionDepth -= 1
        if (this.transactionDepth === 0) this.persist()
        throw error
      }
    },
    notify(name: string, summary: string, subject?: Partial<EntityRecord>, category = 'info') {
      return this.create('notifications', {
        name,
        summary,
        category,
        status: 'unread',
        owner: String(subject?.owner || ''),
        ownerId: String(subject?.ownerId || 'platform'),
        domain: subject?.domain || 'cn',
        subjectId: subject?.id,
        subjectCode: subject?.code,
      })
    },
    audit(action: string, target: string, operator: string, risk = false, subject?: Partial<EntityRecord>, result: 'success' | 'failed' = 'success') {
      const subjectModule = subject?.id
        ? Object.entries(this.database.records).find(([moduleKey, rows]) => moduleKey !== 'logs' && rows.some((item) => item.id === subject.id))?.[0]
        : undefined
      const operatorAccount = this.records('auth-accounts').find((item) => item.account === operator || item.displayName === operator || item.name === operator)
      this.create('logs', {
        name: action,
        category: action.includes('登录') ? '登录' : '业务操作',
        status: risk ? 'warning' : 'normal',
        summary: `${target} · ${operator} · 127.0.0.1`,
        account: operator,
        operator,
        operatorAccountId: operatorAccount?.id || '',
        operationType: action.includes('登录') ? '登录' : risk ? '高风险操作' : action.replace(/[^新增编辑删除审批登录]/g, '') || '编辑',
        result,
        resultLabel: result === 'success' ? '成功' : '失败',
        content: target,
        ip: '127.0.0.1',
        deviceInfo: 'Windows · Chromium',
        owner: operator,
        ownerId: String(subject?.ownerId || 'platform'),
        domain: subject?.domain || 'cn',
        subjectId: subject?.id,
        subjectCode: subject?.code,
        subjectModule,
      })
    },
  },
})
