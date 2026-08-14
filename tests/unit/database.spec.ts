import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DATABASE_KEY, PREVIOUS_DATABASE_KEY, migrateDatabase, useDatabaseStore } from '@/stores/database'
import { PREFERENCES_KEY, usePreferencesStore } from '@/stores/preferences'

describe('database store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('persists create, update and delete operations', () => {
    const store = useDatabaseStore()
    const original = store.records('projects').length
    const created = store.create('projects', { code: 'PRJ-TEST-01', name: '自动化测试项目' })
    expect(store.records('projects')).toHaveLength(original + 1)
    expect(JSON.parse(localStorage.getItem(DATABASE_KEY) || '{}').records.projects[0].code).toBe('PRJ-TEST-01')

    store.update('projects', created.id, { name: '已编辑测试项目', status: 'processing' })
    expect(store.records('projects').find((item) => item.id === created.id)?.name).toBe('已编辑测试项目')
    expect(store.remove('projects', created.id)).toBe(true)
    expect(store.records('projects')).toHaveLength(original)
  })

  it('restores the complete seed database', () => {
    const store = useDatabaseStore()
    store.remove('devices', store.records('devices')[0].id)
    store.reset()
    expect(store.records('devices').length).toBeGreaterThanOrEqual(9)
    expect(store.records('warehouse').filter((item) => item.category === '在库').length).toBeGreaterThanOrEqual(4)
    expect(store.database.version).toBe(8)
    expect(store.records('logs').length).toBeGreaterThan(0)
  })

  it('automatically migrates the current v7 browser database and preserves user records', () => {
    localStorage.setItem(PREVIOUS_DATABASE_KEY, JSON.stringify({ version: 7, records: { projects: [{ id: 'legacy-project', code: 'OLD-001', name: '保留项目', ownerId: 'platform', status: 'normal', domain: 'cn', createdAt: '2026-01-01', updatedAt: '2026-01-01' }] } }))
    setActivePinia(createPinia())
    const store = useDatabaseStore()
    expect(store.database.version).toBe(8)
    expect(JSON.parse(localStorage.getItem(DATABASE_KEY) || '{}').version).toBe(8)
    expect(store.records('projects')[0].code).toBe('OLD-001')
    expect(store.records('auth-accounts').some((item) => item.account === 'admin@shark.cn')).toBe(true)
    expect(store.records('notifications').length).toBeGreaterThan(0)
  })

  it('repairs the V7 platform and dealer role baselines without deleting business data', () => {
    const current = useDatabaseStore().database
    const tier1 = current.records.roles.find((item) => item.roleKey === 'tier1')!
    const tier2 = current.records.roles.find((item) => item.roleKey === 'tier2')!
    tier1.permissions = ['dashboard:view', 'warranty:view']
    tier2.permissions = ['dashboard:view', 'warranty:view']
    current.records.projects.unshift({ ...current.records.projects[0], id: 'kept-project', code: 'KEEP-V8', name: '迁移保留项目' })

    const migrated = migrateDatabase({ version: 7, records: current.records })
    expect(migrated.version).toBe(8)
    expect(migrated.records.projects.some((item) => item.id === 'kept-project')).toBe(true)
    expect(migrated.records.roles.find((item) => item.roleKey === 'tier1')?.permissions).toEqual(expect.arrayContaining(['warranty:view', 'warranty:create', 'warranty:edit']))
    expect(migrated.records.roles.find((item) => item.roleKey === 'tier2')?.permissions).toEqual(expect.arrayContaining(['warranty:view', 'warranty:create', 'warranty:edit']))
    expect(migrated.records.roles.find((item) => item.roleKey === 'platform')?.permissions).toEqual(['*:*:*'])
  })

  it('repairs accounts that reference a duplicate or unavailable system role', () => {
    const timestamp = '2026-08-10T00:00:00.000Z'
    const migrated = migrateDatabase({
      records: {
        roles: [
          { id: 'role-stale', code: 'ROL-OLD', name: '平台管理员', status: 'disabled', roleKey: '', ownerId: 'platform', domain: 'cn', createdAt: timestamp, updatedAt: timestamp },
          { id: 'role-current', code: 'ROL-NEW', name: '平台管理员', status: 'normal', roleKey: 'platform', dataScope: 'all', permissions: ['*:*:*'], ownerId: 'platform', domain: 'cn', createdAt: timestamp, updatedAt: timestamp },
        ],
        'auth-accounts': [
          { id: 'account-admin', code: 'admin@shark.cn', name: '林海', account: 'admin@shark.cn', password: 'Admin123!', displayName: '林海', roleId: 'role-stale', roleKey: 'platform', roleLabel: '平台管理员', status: 'normal', ownerId: 'platform', domain: 'cn', createdAt: timestamp, updatedAt: timestamp },
        ],
      },
    })
    const account = migrated.records['auth-accounts'].find((item) => item.account === 'admin@shark.cn')!
    const role = migrated.records.roles.find((item) => item.id === account.roleId)!
    expect(account.roleId).toBe('role-current')
    expect(role.roleKey).toBe('platform')
    expect(role.status).toBe('normal')
    expect(role.permissions).toContain('*:*:*')
  })

  it('migrates the legacy Qingdao dealer login into the V3.2 account length boundary', () => {
    const legacy = migrateDatabase()
    const dealer = legacy.records.dealers.find((item) => item.organizationId === 'dealer-t1-qd')!
    const account = legacy.records['auth-accounts'].find((item) => item.ownerId === 'dealer-t1-qd')!
    dealer.account = 'service@qingdao-marine.cn'
    account.account = 'service@qingdao-marine.cn'
    account.code = 'service@qingdao-marine.cn'

    const migrated = migrateDatabase(legacy)
    const migratedDealer = migrated.records.dealers.find((item) => item.organizationId === 'dealer-t1-qd')!
    const migratedAccount = migrated.records['auth-accounts'].find((item) => item.ownerId === 'dealer-t1-qd')!
    expect(migratedDealer.account).toBe('service@qingdao.cn')
    expect(migratedAccount.account).toBe('service@qingdao.cn')
    expect(String(migratedAccount.account).length).toBeLessThanOrEqual(20)
  })

  it('creates login entities for every administrator and dealer within the V3.2 account boundary', () => {
    const store = useDatabaseStore()
    for (const admin of store.records('admins')) {
      expect(store.records('auth-accounts').some((item) => item.subjectId === admin.id || item.account === admin.account), String(admin.account)).toBe(true)
      expect(String(admin.account).length).toBeLessThanOrEqual(20)
    }
    for (const dealer of store.records('dealers')) {
      expect(store.records('auth-accounts').some((item) => item.account === dealer.account), String(dealer.account)).toBe(true)
      expect(String(dealer.account).length).toBeLessThanOrEqual(20)
    }
    const support = store.records('auth-accounts').find((item) => item.account === 'wangh@shark.cn')!
    expect(support.roleKey).toBe('custom')
  })

  it('commits local transactions once and rolls back every related write on failure', () => {
    const store = useDatabaseStore()
    const before = JSON.stringify(store.database.records)
    expect(() => store.transaction(() => {
      store.create('projects', { code: 'PRJ-ROLLBACK', name: '不应保留的项目' })
      store.create('logs', { code: 'LOG-ROLLBACK', name: '不应保留的日志' })
      throw new Error('rollback')
    })).toThrow('rollback')
    expect(JSON.stringify(store.database.records)).toBe(before)
    expect(JSON.stringify(JSON.parse(localStorage.getItem(DATABASE_KEY) || '{}').records)).toBe(before)
  })

  it('keeps workflow and strict V3.2 relation collections idempotent after migration', () => {
    const store = useDatabaseStore()
    const pending = store.records('materials').find((item) => item.status === 'pending')!
    expect(store.records('approval-instances').some((item) => item.subjectId === pending.id)).toBe(true)
    expect(store.records('approval-steps').some((item) => item.subjectId === pending.id)).toBe(true)
    expect(store.records('service-responsibilities')).toEqual([])
    const migratedAgain = migrateDatabase(store.database)
    expect(migratedAgain.records['approval-instances'].filter((item) => item.subjectId === pending.id)).toHaveLength(1)
    expect(migratedAgain.records['service-responsibilities']).toEqual([])
  })

  it('preserves saved built-in dealer role permissions after a V8 reload', () => {
    const store = useDatabaseStore()
    const role = store.records('roles').find((item) => item.roleKey === 'tier2')!
    store.update('roles', role.id, { permissions: ['dashboard:view', 'devices:view'] })
    const migrated = migrateDatabase(store.database)
    expect(migrated.records.roles.find((item) => item.id === role.id)?.permissions).toEqual(['dashboard:view', 'devices:view'])
    expect(migrated.records.roles.find((item) => item.roleKey === 'platform')?.permissions).toEqual(['*:*:*'])
  })

  it('persists interface preferences with the versioned key', () => {
    const preferences = usePreferencesStore()
    preferences.setCollapsed(true)
    preferences.setPageSize(20)
    preferences.setExpandedGroups(['工作台', '设备与库存'])
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}')).toEqual({ collapsed: true, pageSize: 20, expandedGroups: ['工作台', '设备与库存'], navigationCustomized: true })
  })
})
