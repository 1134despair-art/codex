import { moduleConfigs } from '@/config/modules'
import { recordsRelatedToUser } from '@/services/relation-matching'
import type { EntityRecord, RelatedNavigationItem } from '@/types'

export type RelatedNavigationCandidate = Omit<RelatedNavigationItem, 'count'>

function values(record: EntityRecord, field: string) {
  const value = record[field]
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  return String(value || '').split(/[、,]/).map((item) => item.trim()).filter((item) => item && item !== '-')
}

function candidate(targetModule: string, label: string, icon: string, relationFilters: Record<string, string | string[]>, level: 'primary' | 'secondary' = 'secondary', targetTab?: string): RelatedNavigationCandidate {
  return { key: `${targetModule}:${targetTab || 'default'}:${label}`, targetModule, targetTab, label, icon, relationFilters, level }
}

function userRelation(targetModule: string, user: EntityRecord, records: Record<string, EntityRecord[]>): Record<string, string | string[]> | undefined {
  const related = recordsRelatedToUser(targetModule, user, records)
  if (!related.length) return undefined
  if (related.every((record) => record.userId === user.id)) return { userId: user.id }
  return { id: related.map((record) => record.id) }
}

export function relatedNavigationCandidates(moduleKey: string, record: EntityRecord, records: Record<string, EntityRecord[]>): RelatedNavigationCandidate[] {
  const items: RelatedNavigationCandidate[] = []
  const ownerId = String(record.organizationId || record.ownerId || '')
  const deviceSN = String(record.deviceSN || record.code || '')
  const add = (item: RelatedNavigationCandidate, valid = true) => { if (valid) items.push(item) }

  if (moduleKey === 'users') {
    const targets = [
      ['devices', '查看设备', 'cpu', 'primary'],
      ['repairs', '查看报修', 'wrench', 'secondary'],
      ['messages', '查看留言', 'messages-square', 'secondary'],
      ['complaints', '查看投诉', 'message-square-warning', 'secondary'],
      ['payments', '查看支付订单', 'receipt-text', 'secondary'],
    ] as const
    for (const [target, label, icon, level] of targets) {
      const relationFilters = userRelation(target, record, records)
      add(candidate(target, label, icon, relationFilters || {}, level), Boolean(relationFilters))
    }
  }

  if (moduleKey === 'dealers') {
    add(candidate('devices', '管理设备', 'cpu', { ownerId }, 'primary'), Boolean(ownerId))
    add(candidate('projects', '查看项目', 'ship-wheel', { ownerId }), Boolean(ownerId))
    add(candidate('admins', '查看管理员账号', 'user-cog', { ownerId }), Boolean(ownerId))
    for (const [target, label, icon] of [['repairs', '查看报修', 'wrench'], ['messages', '查看留言', 'messages-square'], ['complaints', '查看投诉', 'message-square-warning'], ['materials', '查看物料申请', 'package-check']] as const) {
      add(candidate(target, label, icon, { ownerId }), Boolean(ownerId))
    }
  }

  if (moduleKey === 'projects') {
    add(candidate('devices', '查看绑定设备', 'cpu', { code: String(record.deviceSN || '') }, 'primary'), Boolean(record.deviceSN))
    add(candidate('dealers', '查看所属经销商', 'store', { organizationId: String(record.ownerId || '') }), Boolean(record.ownerId))
    add(candidate('warranty', '查看适用质保', 'shield-check', { dealerId: String(record.ownerId || ''), productType: String(record.deviceModel || record.category || '') }), Boolean(record.ownerId && (record.deviceModel || record.category)))
    for (const [target, label, icon] of [['repairs', '查看报修记录', 'wrench'], ['complaints', '查看投诉记录', 'message-square-warning'], ['materials', '查看物料申请', 'package-check']] as const) {
      add(candidate(target, label, icon, { deviceSN: String(record.deviceSN || '') }), Boolean(record.deviceSN))
    }
  }

  if (moduleKey === 'devices') {
    const hasUser = Boolean(record.userId)
    add(candidate('users', '查看绑定用户', 'user-round', { id: String(record.userId || '') }, 'primary'), hasUser)
    add(candidate('projects', hasUser ? '查看关联项目' : '查看关联项目', 'ship-wheel', { deviceSN: record.code }, hasUser ? 'secondary' : 'primary'))
    add(candidate('dealers', '查看所属经销商', 'store', { organizationId: String(record.ownerId || '') }), Boolean(record.ownerId && record.ownerId !== 'platform'))
    add(candidate('warehouse', '查看仓库归属', 'warehouse', { deviceSN: record.code }, 'secondary', 'ownership'))
    add(candidate('cross-region-activations', '查看跨区域激活异常', 'triangle-alert', { deviceSN: record.code }, 'secondary'))
    add(candidate('ota', '查看适用固件', 'package-up', { deviceType: String(record.name || '') }), Boolean(record.name))
    for (const [target, label, icon] of [['repairs', '查看报修', 'wrench'], ['complaints', '查看投诉', 'message-square-warning'], ['materials', '查看物料申请', 'package-check']] as const) add(candidate(target, label, icon, { deviceSN: record.code }))
  }

  if (moduleKey === 'cross-region-activations') {
    add(candidate('devices', '查看异常设备', 'cpu', { code: String(record.deviceSN || '') }, 'primary'), Boolean(record.deviceSN))
  }

  if (moduleKey === 'warehouse') {
    const deviceSns = values(record, 'selectedDevices').length ? values(record, 'selectedDevices') : values(record, 'deviceSN')
    add(candidate('devices', '查看涉及设备', 'cpu', { code: deviceSns }, 'primary'), record.category !== '在库' && deviceSns.length > 0)
    add(candidate('dealers', '查看来源经销商', 'store', { organizationId: String(record.sourceDealerId || '') }), Boolean(record.sourceDealerId && record.sourceDealerId !== 'platform'))
    add(candidate('dealers', '查看目标经销商', 'store', { organizationId: String(record.targetDealerId || '') }), Boolean(record.targetDealerId))
    add(candidate('warehouse', '查看归属历史', 'warehouse', { deviceSN: deviceSns }, 'secondary', 'ownership'), deviceSns.length > 0 && record.category !== '归属')
  }

  if (moduleKey === 'ota') add(candidate('devices', '查看适用设备', 'cpu', { name: String(record.deviceType || '') }, 'primary'), Boolean(record.deviceType))

  if (moduleKey === 'repairs') {
    add(candidate('devices', '查看关联设备', 'cpu', { code: deviceSN }, 'primary'), Boolean(record.deviceSN && record.deviceSN !== '-'))
    add(candidate('users', '查看报修用户', 'user-round', { id: String(record.userId || '') }), Boolean(record.userId))
    add(candidate('dealers', '查看处理经销商', 'store', { organizationId: String(record.ownerId || '') }), Boolean(record.ownerId && record.ownerId !== 'platform'))
  }

  if (moduleKey === 'messages') {
    add(candidate('users', '查看留言用户', 'user-round', { id: String(record.userId || '') }, 'primary'), Boolean(record.userId))
    add(candidate('dealers', '查看转发经销商', 'store', { organizationId: String(record.ownerId || '') }), Boolean(record.ownerId && record.ownerId !== 'platform'))
  }

  if (moduleKey === 'complaints') {
    const hasDevice = Boolean(record.deviceSN && record.deviceSN !== '-')
    add(candidate('devices', '查看关联设备', 'cpu', { code: deviceSN }, 'primary'), hasDevice)
    add(candidate('users', '查看投诉用户', 'user-round', { id: String(record.userId || '') }, hasDevice ? 'secondary' : 'primary'), Boolean(record.userId))
    add(candidate('dealers', '查看处理经销商', 'store', { organizationId: String(record.ownerId || '') }), Boolean(record.ownerId && record.ownerId !== 'platform'))
  }

  if (moduleKey === 'materials') {
    const device = records.devices?.find((item) => item.code === record.deviceSN)
    add(candidate('devices', '查看关联设备', 'cpu', { code: deviceSN }, 'primary'), Boolean(record.deviceSN))
    add(candidate('material-catalog', '查看物料', 'boxes', { id: String(record.materialId || '') }), Boolean(record.materialId))
    add(candidate('dealers', '查看申请经销商', 'store', { organizationId: String(record.ownerId || '') }), Boolean(record.ownerId && record.ownerId !== 'platform'))
    add(candidate('warranty', '查看质保规则', 'shield-check', { dealerId: String(record.ownerId || ''), productType: String(device?.name || '') }), Boolean(record.ownerId && device?.name))
    add(candidate('issuance', '查看发放记录', 'package-open', { sourceRequestId: record.id }))
  }

  if (moduleKey === 'material-catalog') {
    add(candidate('materials', '查看相关申请', 'package-check', { materialId: record.id }, 'primary'))
    add(candidate('issuance', '查看发放记录', 'package-open', { materialId: record.id }))
  }

  if (moduleKey === 'couriers') add(candidate('issuance', '查看发放记录', 'package-open', { courierId: record.id }, 'primary'))

  if (moduleKey === 'sn-replacement') {
    const currentSN = String(record.status === 'completed' ? record.newSN : record.originalSN || '')
    add(candidate('devices', '查看当前设备', 'cpu', { code: currentSN }, 'primary'), Boolean(currentSN))
    add(candidate('projects', '查看关联项目', 'ship-wheel', { deviceSN: currentSN }), Boolean(currentSN))
    add(candidate('warehouse', '查看归属历史', 'warehouse', { deviceSN: [String(record.originalSN || ''), String(record.newSN || '')].filter(Boolean) }, 'secondary', 'ownership'))
  }

  if (moduleKey === 'service-transfer') {
    add(candidate('devices', '查看关联设备', 'cpu', { code: deviceSN }, 'primary'), Boolean(record.deviceSN))
    add(candidate('dealers', '查看原经销商', 'store', { organizationId: String(record.sourceDealerId || '') }), Boolean(record.sourceDealerId))
    add(candidate('dealers', '查看目标经销商', 'store', { organizationId: String(record.targetDealerId || '') }), Boolean(record.targetDealerId))
  }

  if (moduleKey === 'warranty') {
    add(candidate('devices', '查看适用设备', 'cpu', { ownerId: String(record.dealerId || record.ownerId || ''), name: String(record.productType || record.category || '') }, 'primary'))
    add(candidate('dealers', '查看设置经销商', 'store', { organizationId: String(record.dealerId || record.ownerId || '') }))
  }

  if (moduleKey === 'approval-flow') {
    const flowTarget = record.flowType === 'warehouse' ? ['warehouse', 'transfer'] : record.flowType === 'service-transfer' ? ['service-transfer', 'target'] : ['materials', 'approval']
    add(candidate(flowTarget[0], '查看待审批业务', 'list-checks', { status: 'pending' }, 'primary', flowTarget[1]))
  }

  if (moduleKey === 'approval-center') {
    const sourceModule = String(record.sourceModule || record.menuKey || '')
    add(candidate(sourceModule, '查看并处理原业务单', 'arrow-up-right', { id: String(record.subjectId || '') }, 'primary'), Boolean(moduleConfigs[sourceModule] && record.subjectId))
  }

  if (moduleKey === 'issuance') {
    add(candidate('materials', '查看来源申请', 'package-check', { id: String(record.sourceRequestId || '') }, 'primary'), Boolean(record.sourceRequestId))
    add(candidate('material-catalog', '查看物料', 'boxes', { id: String(record.materialId || '') }), Boolean(record.materialId))
    add(candidate('devices', '查看关联设备', 'cpu', { code: String(record.deviceSN || '') }), Boolean(record.deviceSN))
    add(candidate('couriers', '查看快递公司', 'truck', { id: String(record.courierId || '') }), Boolean(record.courierId))
  }

  if (moduleKey === 'payments') add(candidate('users', '查看支付用户', 'user-round', { id: String(record.userId || '') }, 'primary'), Boolean(record.userId))

  if (moduleKey === 'admins') {
    const loginAccount = records['auth-accounts']?.find((item) => item.subjectId === record.id || item.account === record.account)
    add(candidate('roles', '查看所属角色', 'shield-user', { id: String(record.roleId || '') }, 'primary'), Boolean(record.roleId))
    add(candidate('dealers', '查看所属经销商', 'store', { organizationId: String(record.ownerId || '') }), Boolean(record.ownerId && record.ownerId !== 'platform'))
    add(candidate('logs', '查看账号日志', 'scroll-text', { operatorAccountId: String(loginAccount?.id || '') }), Boolean(loginAccount))
  }

  if (moduleKey === 'roles') add(candidate('admins', '查看使用账号', 'user-cog', { roleId: record.id }, 'primary'))

  if (moduleKey === 'logs') {
    const subjectModule = String(record.subjectModule || '')
    add(candidate(subjectModule, '查看原业务对象', 'arrow-up-right', { id: String(record.subjectId || '') }, 'primary'), Boolean(moduleConfigs[subjectModule] && record.subjectId))
    const operatorAccount = records['auth-accounts']?.find((item) => item.id === record.operatorAccountId)
    const admin = records.admins?.find((item) => item.id === operatorAccount?.subjectId)
    add(candidate('admins', '查看操作账号', 'user-cog', { id: String(admin?.id || '') }), Boolean(admin))
  }

  return [...new Map(items.map((item) => [item.key, item])).values()]
}
