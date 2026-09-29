import type { DataDomain, DataScope, RoleKey } from '@/types'

export const rolePermissions: Record<RoleKey, string[]> = {
  platform: ['*:*:*'],
  tier1: [
    'dashboard:view', 'users:view', 'dealers:view', 'dealers:create', 'dealers:edit',
    'dealers:status', 'dealers:reset-password', 'projects:*', 'devices:view', 'devices:edit',
    'devices:unbind',
    'product-catalog:view', 'product-catalog:export',
    'repairs:view', 'repairs:assign', 'repairs:reply', 'repairs:complete',
    'messages:view', 'messages:reply', 'messages:forward', 'messages:escalate',
    'complaints:view', 'complaints:assign', 'complaints:reply', 'complaints:escalate', 'complaints:complete',
    'materials:view', 'materials:create', 'materials:edit', 'materials:approve', 'materials:reject', 'materials:confirm-receipt',
    'sn-replacement:view', 'sn-replacement:create',
    'sn-replacement:process', 'service-transfer:view', 'service-transfer:create',
    'service-transfer:process', 'service-transfer:confirm-transfer', 'warranty:view', 'warranty:create', 'warranty:edit', 'approval-flow:view', 'issuance:view', 'issuance:confirm-receipt', 'issuance:complete-replacement',
    'payments:view', 'users:export', 'dealers:export', 'projects:export', 'devices:export',
    'repairs:export', 'messages:export', 'complaints:export', 'materials:export',
    'sn-replacement:export', 'service-transfer:export', 'warranty:export', 'approval-flow:export',
    'issuance:export', 'payments:export',
  ],
  tier2: [
    'dashboard:view', 'projects:view', 'projects:create', 'projects:edit', 'projects:delete', 'devices:view',
    'product-catalog:view', 'product-catalog:export',
    'repairs:view', 'repairs:reply', 'repairs:complete', 'messages:view', 'messages:reply',
    'messages:escalate', 'complaints:view', 'complaints:reply', 'complaints:escalate', 'complaints:complete',
    'materials:view', 'materials:create', 'materials:edit', 'materials:confirm-receipt',
    'sn-replacement:view', 'sn-replacement:create', 'sn-replacement:process',
    'service-transfer:view', 'service-transfer:create', 'service-transfer:process', 'service-transfer:confirm-transfer',
    'warranty:view', 'warranty:create', 'warranty:edit', 'issuance:view', 'issuance:confirm-receipt', 'issuance:complete-replacement', 'payments:view',
    'projects:export', 'devices:export', 'repairs:export', 'messages:export',
    'complaints:export', 'materials:export',
    'sn-replacement:export', 'service-transfer:export', 'warranty:export', 'issuance:export', 'payments:export',
  ],
  custom: [
    'dashboard:view', 'users:view', 'devices:view', 'repairs:*', 'messages:*',
    'complaints:*', 'materials:view', 'materials:edit', 'materials:approve', 'materials:reject', 'materials:ship', 'materials:finance-confirm', 'materials:purchase-ship', 'materials:confirm-receipt',
    'material-catalog:view', 'couriers:view', 'issuance:view', 'issuance:create', 'issuance:confirm-receipt', 'issuance:complete-replacement', 'sn-replacement:view', 'sn-replacement:create', 'sn-replacement:process', 'sn-replacement:export', 'service-transfer:view', 'service-transfer:create',
    'approval-center:view', 'approval-center:export', 'warehouses:view', 'warehouse-locations:view', 'warehouse:view',
    'product-catalog:view', 'product-catalog:export',
    'service-transfer:process', 'service-transfer:approve-transfer-fee', 'service-transfer:reject-transfer-fee',
    'users:export', 'devices:export', 'repairs:export', 'messages:export', 'complaints:export',
    'materials:export', 'material-catalog:export', 'couriers:export', 'issuance:export', 'service-transfer:export', 'warehouse:export',
  ],
}

export const defaultRoleSeeds: Array<{
  roleKey: RoleKey
  name: string
  dataScope: DataScope
  permissions: string[]
}> = [
  { roleKey: 'platform', name: '平台管理员', dataScope: 'all', permissions: rolePermissions.platform },
  { roleKey: 'custom', name: '总部售后', dataScope: 'all', permissions: rolePermissions.custom },
  { roleKey: 'tier1', name: '一级经销商管理员', dataScope: 'descendants', permissions: rolePermissions.tier1 },
  { roleKey: 'tier2', name: '二级经销商管理员', dataScope: 'self', permissions: rolePermissions.tier2 },
]

export const defaultAccountSeeds: Array<{
  account: string
  password: string
  displayName: string
  roleKey: RoleKey
  ownerId: string
  domain: DataDomain
  firstLogin: boolean
  subjectType: 'admin' | 'dealer'
}> = [
  { account: 'admin@shark.cn', password: 'Admin123!', displayName: '林海', roleKey: 'platform', ownerId: 'platform', domain: 'cn', firstLogin: false, subjectType: 'admin' },
  { account: 'tier1@dealer.cn', password: 'Dealer123!', displayName: '张勇', roleKey: 'tier1', ownerId: 'dealer-t1-sz', domain: 'cn', firstLogin: false, subjectType: 'dealer' },
  { account: 'tier2@dealer.cn', password: 'Dealer123!', displayName: '李明', roleKey: 'tier2', ownerId: 'dealer-t2-xm', domain: 'cn', firstLogin: true, subjectType: 'dealer' },
]

export function hasPermission(permissions: string[], required?: string) {
  if (!required) return true
  if (permissions.includes('*:*:*') || permissions.includes(required)) return true
  const [module] = required.split(':')
  return permissions.includes(`${module}:*`)
}

const actionAliases: Record<string, string> = {
  edit: 'edit',
  delete: 'delete',
  toggle: 'status',
  'reset-password': 'reset-password',
  permissions: 'permissions',
  'remote-disable': 'remote',
  'remote-enable': 'remote',
}

export function actionPermission(moduleKey: string, actionKey: string) {
  if (actionKey === 'detail') return `${moduleKey}:view`
  return `${moduleKey}:${actionAliases[actionKey] || actionKey}`
}

export function hasActionPermission(permissions: string[], moduleKey: string, actionKey: string) {
  return hasPermission(permissions, actionPermission(moduleKey, actionKey))
}
