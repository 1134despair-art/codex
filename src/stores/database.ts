import { defineStore } from 'pinia'
import { createSeedDatabase } from '@/data/seed'
import { defaultAccountSeeds, defaultRoleSeeds } from '@/config/permissions'
import type { DataDomain, EntityRecord, StoredDatabase } from '@/types'

export const DATABASE_KEY = 'shark-sister-admin.db.v8'
export const PREVIOUS_DATABASE_KEY = 'shark-sister-admin.db.v7'
const V6_DATABASE_KEY = 'shark-sister-admin.db.v6'
const V5_DATABASE_KEY = 'shark-sister-admin.db.v5'
const V4_DATABASE_KEY = 'shark-sister-admin.db.v4'
export const V3_DATABASE_KEY = 'shark-sister-admin.db.v3'
export const V2_DATABASE_KEY = 'shark-sister-admin.db.v2'
export const LEGACY_DATABASE_KEY = 'shark-sister-admin.db.v1'

const now = () => new Date().toISOString()

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

function normalizeRoles(records: Record<string, EntityRecord[]>, preservePermissions = false) {
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
    role.permissions = mustUseSeed ? [...seed.permissions] : Array.isArray(role.permissions) ? role.permissions : [...seed.permissions]
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
  for (const flow of records['approval-flow'] || []) {
    flow.category = '流程配置'
    flow.flowType = 'materials'
    flow.flowTypeLabel = '物料申请'
  }
  for (const banner of records.banners || []) {
    banner.target = banner.target || banner.legacyTarget || ''
    delete banner.targetKey
    delete banner.targetLabel
    delete banner.audience
    delete banner.audienceLabel
  }

  records.devices ||= []
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
  records['approval-flow'] = records['approval-flow'].filter((item) => !item.flowType || item.flowType === 'materials' || String(item.name).includes('物料'))
  const labels: Record<string, string> = { materials: '物料申请' }
  const defaults: Record<string, EntityRecord[]> = {
    materials: [tier1, platform].filter(Boolean) as EntityRecord[],
  }
  for (const flowType of Object.keys(labels)) {
    let flow = records['approval-flow'].find((item) => item.flowType === flowType)
    if (!flow) {
      const legacy = records['approval-flow'].find((item) => String(item.name).includes(flowType === 'materials' ? '物料' : flowType === 'warehouse' ? '调货' : '售后'))
      flow = legacy || appendEntity(records, 'approval-flow', {
        name: `${labels[flowType]}审批流程`, category: '流程配置', flowType, status: 'normal', ownerId: 'platform', owner: '平台中心', domain: 'cn',
      })
    }
    const configuredIds = [flow.level1ApproverId, flow.level2ApproverId, flow.platformApproverId].filter(Boolean).map(String)
    const legacyIds = Array.isArray(flow.members) ? flow.members.map(String).filter((id) => activeAccounts.some((item) => item.id === id)) : []
    const fallback = defaults[flowType]
    const ids = configuredIds.length ? configuredIds : legacyIds.length ? legacyIds : fallback.map((item) => item.id)
    const members = [...new Set(ids)].map((id) => activeAccounts.find((item) => item.id === id)).filter(Boolean) as EntityRecord[]
    flow.category = '流程配置'
    flow.flowType = flowType
    flow.flowTypeLabel = labels[flowType]
    flow.levels = members.some((item) => item.roleKey === 'tier2')
      ? '二级 → 一级 → 平台'
      : members.some((item) => item.roleKey === 'tier1') ? '一级 → 平台' : '平台直接审核'
    flow.level1ApproverId = members[0]?.id || tier2?.id || ''
    flow.level2ApproverId = members.length > 2 ? members[1].id : ''
    flow.platformApproverId = members.find((item) => item.roleKey === 'platform')?.id || members.at(-1)?.id || ''
    flow.members = members.map((item) => item.id)
    flow.memberNames = members.map((item) => item.displayName || item.name).join('、') || '-'
  }
}

function appendEntity(records: Record<string, EntityRecord[]>, moduleKey: string, payload: Partial<EntityRecord>) {
  const row = entity(moduleKey, records[moduleKey].length, payload)
  records[moduleKey].push(row)
  return row
}

function normalizeWorkflowRelations(records: Record<string, EntityRecord[]>) {
  const accounts = records['auth-accounts'] || []
  const dealers = records.dealers || []
  const platformAccount = accounts.find((item) => item.roleKey === 'platform' && item.status === 'normal')
  const catalogs = records['material-catalog'] || []

  const ensureApproval = (record: EntityRecord, flowType: string, sourceModule: string) => {
    if (record.status !== 'pending' || record.approvalInstanceId) return
    const configured = records['approval-flow'].find((item) => item.status === 'normal' && item.flowType === flowType)
    const configuredIds = [configured?.level1ApproverId, configured?.level2ApproverId, configured?.platformApproverId].filter(Boolean).map(String)
    const approvers = flowType === 'warehouse'
      ? [platformAccount].filter(Boolean) as EntityRecord[]
      : configuredIds.map((id) => accounts.find((item) => item.id === id && item.status === 'normal')).filter(Boolean) as EntityRecord[]
    if (!approvers.length && platformAccount && flowType !== 'service-transfer') approvers.push(platformAccount)
    if (flowType === 'service-transfer') {
      const targetAccount = accounts.find((item) => item.status === 'normal' && item.ownerId === record.targetDealerId)
      if (targetAccount) approvers.unshift(targetAccount)
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
    const materialName = String(material.materialName || material.name).split(' × ')[0]
    const catalog = catalogs.find((item) => item.id === material.materialId || item.name === materialName)
    if (catalog) {
      material.materialId = catalog.id
      material.materialName = catalog.name
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

  for (const transfer of records['service-transfer'] || []) {
    const device = records.devices.find((item) => item.code === transfer.deviceSN)
    transfer.sourceDealerId ||= device?.ownerId || transfer.ownerId
    transfer.sourceDealer ||= device?.owner || transfer.owner
    if (!transfer.targetDealerId) {
      const targetName = String(transfer.targetDealer || String(transfer.name).split(' → ')[1] || '').trim()
      const target = dealers.find((item) => item.name.includes(targetName) || targetName.includes(item.name))
      if (target) transfer.targetDealerId = target.organizationId || target.ownerId
    }
    ensureApproval(transfer, 'service-transfer', 'service-transfer')
  }

  for (const transfer of records.warehouse || []) {
    if (transfer.category === '调货') ensureApproval(transfer, 'warehouse', 'warehouse')
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

export function migrateDatabase(source?: { version?: number; records?: Record<string, EntityRecord[]> } | null): StoredDatabase {
  const seed = createSeedDatabase()
  if (source?.records) {
    for (const [moduleKey, rows] of Object.entries(source.records)) {
      if (Array.isArray(rows)) seed.records[moduleKey] = rows
    }
  }
  const roleIdRemap = normalizeRoles(seed.records, Number(source?.version) >= 8)
  normalizeDealers(seed.records)
  normalizeAccountAliases(seed.records)
  normalizeBusinessRecords(seed.records)
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
  seed.records['stock-reservations'] = []
  for (const catalog of seed.records['material-catalog'] || []) delete catalog.reservedStock
  normalizeWorkflowRelations(seed.records)
  seed.version = 8
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
  if (current?.version === 8 && current.records) return migrateDatabase(current)
  const source = [PREVIOUS_DATABASE_KEY, V6_DATABASE_KEY, V5_DATABASE_KEY, V4_DATABASE_KEY, V3_DATABASE_KEY, V2_DATABASE_KEY, LEGACY_DATABASE_KEY]
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
    audit(action: string, target: string, operator: string, risk = false, subject?: Partial<EntityRecord>) {
      this.create('logs', {
        name: action,
        category: action.includes('登录') ? '登录' : '业务操作',
        status: risk ? 'warning' : 'normal',
        summary: `${target} · ${operator} · 127.0.0.1`,
        account: operator,
        operator,
        operationType: action.includes('登录') ? '登录' : risk ? '高风险操作' : action.replace(/[^新增编辑删除审批登录]/g, '') || '编辑',
        content: target,
        ip: '127.0.0.1',
        deviceInfo: 'Windows · Chromium',
        owner: operator,
        ownerId: String(subject?.ownerId || 'platform'),
        domain: subject?.domain || 'cn',
        subjectId: subject?.id,
        subjectCode: subject?.code,
      })
    },
  },
})
