import type { DataDomain, DataScope, RoleKey } from '@/types'

export const rolePermissions: Record<RoleKey, string[]> = {
  platform: ['*:*:*'],
  tier1: [
    'dashboard:view', 'users:view', 'dealers:view', 'dealers:create', 'dealers:edit',
    'dealers:status', 'dealers:reset-password', 'projects:*', 'devices:view', 'devices:edit',
    'devices:unbind', 'warehouse:view', 'warehouse:create',
    'repairs:view', 'repairs:assign', 'repairs:reply', 'repairs:complete',
    'messages:view', 'messages:reply', 'messages:forward', 'messages:escalate',
    'complaints:view', 'complaints:assign', 'complaints:reply', 'complaints:complete',
    'materials:view', 'materials:create', 'materials:approve', 'materials:reject',
    'material-catalog:view', 'couriers:view', 'sn-replacement:view', 'sn-replacement:create',
    'sn-replacement:process', 'service-transfer:view', 'service-transfer:create',
    'service-transfer:process', 'warranty:view', 'warranty:create', 'warranty:edit', 'approval-flow:view', 'issuance:view',
    'payments:view',
  ],
  tier2: [
    'dashboard:view', 'projects:view', 'projects:edit', 'projects:delete', 'devices:view', 'warehouse:view', 'warehouse:create',
    'repairs:view', 'repairs:reply', 'repairs:complete', 'messages:view', 'messages:reply',
    'messages:escalate', 'complaints:view', 'complaints:reply', 'complaints:complete',
    'materials:view', 'materials:create', 'material-catalog:view', 'couriers:view',
    'sn-replacement:view', 'sn-replacement:create', 'sn-replacement:process',
    'service-transfer:view', 'service-transfer:create', 'service-transfer:process',
    'warranty:view', 'warranty:create', 'warranty:edit', 'issuance:view', 'payments:view',
  ],
  custom: [
    'dashboard:view', 'users:view', 'devices:view', 'repairs:*', 'messages:*',
    'complaints:*', 'materials:view', 'materials:approve', 'materials:reject', 'materials:ship',
    'material-catalog:view', 'couriers:view', 'issuance:view',
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
