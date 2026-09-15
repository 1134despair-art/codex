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
    expect(store.database.version).toBe(15)
    expect(store.records('logs').length).toBeGreaterThan(0)
    expect(store.records('users').some((item) => item.category === 'APPID')).toBe(true)
    expect(store.records('device-components').length).toBeGreaterThan(0)
    expect(store.records('project-history').length).toBeGreaterThanOrEqual(store.records('projects').length)
  })

  it('migrates legacy data to v15 without duplicating child materials or project snapshots', () => {
    const current = migrateDatabase()
    const first = migrateDatabase({ version: 12, records: current.records })
    const second = migrateDatabase(first)
    expect(first.version).toBe(15)
    expect(second.records['device-components']).toHaveLength(first.records['device-components'].length)
    expect(second.records['project-history']).toHaveLength(first.records['project-history'].length)
    expect(new Set(second.records['device-components'].map((item) => item.serialNumber)).size).toBe(second.records['device-components'].length)
  })

  it('migrates v13 privacy and client configuration data into the v15 model', () => {
    const legacy = migrateDatabase()
    const user = legacy.records.users[0]
    legacy.records.waypoints = [
      { id: 'local-waypoint', code: 'WPT-LOCAL', name: '仅本机航点', userId: user.id, serverSaved: false, storageMode: 'local', ownerId: 'platform', domain: 'cn', status: 'normal', createdAt: '2026-08-01', updatedAt: '2026-08-01' },
      { id: 'server-waypoint', code: 'WPT-SERVER', name: '服务器航点', userId: user.id, serverSaved: true, storageMode: 'server', ownerId: 'platform', domain: 'cn', status: 'normal', createdAt: '2026-08-01', updatedAt: '2026-08-01' },
    ]
    legacy.records['support-settings'] = []
    legacy.records['after-sales-types'] = []

    const migrated = migrateDatabase({ version: 13, records: legacy.records })
    expect(migrated.version).toBe(15)
    expect(migrated.records.waypoints.map((item) => item.id)).toEqual(['server-waypoint'])
    expect(migrated.records.waypoints[0]).toMatchObject({ serverSaved: true, storageMode: 'server', adminVisible: false })
    expect(migrated.records['support-settings'].length).toBeGreaterThan(0)
    expect(migrated.records['after-sales-types'].length).toBeGreaterThan(0)
    expect((migrated.records['launch-settings'][0].onboardingPages as unknown[]).length).toBeGreaterThanOrEqual(3)
  })

  it('repairs duplicate device SN values and keeps scoped project relations aligned', () => {
    const legacy = migrateDatabase()
    const original = legacy.records.devices[0]
    const duplicate = { ...original, id: 'duplicate-device-v12', owner: '厦门蓝湾船舶服务', ownerId: 'dealer-t2-xm' }
    legacy.records.devices.push(duplicate)
    legacy.records.projects.push({ ...legacy.records.projects[0], id: 'duplicate-project-v12', code: 'PRJ-DUP-V12', deviceSN: original.code, owner: duplicate.owner, ownerId: duplicate.ownerId })

    const migrated = migrateDatabase({ version: 12, records: legacy.records })
    const migratedDuplicate = migrated.records.devices.find((item) => item.id === duplicate.id)!
    expect(migratedDuplicate.code).toMatch(new RegExp(`^${original.code}-D\\d+$`))
    expect(new Set(migrated.records.devices.map((item) => item.code)).size).toBe(migrated.records.devices.length)
    expect(migrated.records.projects.find((item) => item.id === 'duplicate-project-v12')?.deviceSN).toBe(migratedDuplicate.code)
  })

  it('automatically migrates the current v8 browser database and preserves user records', () => {
    localStorage.setItem(PREVIOUS_DATABASE_KEY, JSON.stringify({ version: 8, records: { projects: [{ id: 'legacy-project', code: 'OLD-001', name: '保留项目', ownerId: 'platform', status: 'normal', domain: 'cn', createdAt: '2026-01-01', updatedAt: '2026-01-01' }] } }))
    setActivePinia(createPinia())
    const store = useDatabaseStore()
    expect(store.database.version).toBe(15)
    expect(JSON.parse(localStorage.getItem(DATABASE_KEY) || '{}').version).toBe(15)
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
    expect(migrated.version).toBe(15)
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

  it('backfills repair dealer ownership and mirrors historical expenses into platform bills', () => {
    const store = useDatabaseStore()
    expect(store.records('repairs').every((item) => item.dealerId && item.dealer)).toBe(true)
    expect(store.records('payments').every((item) => item.sourceType && item.sourceLabel)).toBe(true)
    for (const expense of store.records('expense-records')) {
      expect(store.records('payments')).toContainEqual(expect.objectContaining({
        expenseRecordId: expense.id,
        subjectId: expense.subjectId,
        sourceType: 'platform',
        status: 'paid',
      }))
    }
  })

  it('migrates approval configuration to one independent flow per business menu', () => {
    const store = useDatabaseStore()
    const flows = store.records('approval-flow').filter((item) => item.status === 'normal')
    expect(flows.map((item) => item.menuKey).sort()).toEqual(['materials', 'service-transfer', 'warehouse'])
    expect(new Set(flows.map((item) => item.menuKey)).size).toBe(3)
    for (const flow of flows) {
      expect(flow.menuLabel).toBeTruthy()
      expect(Array.isArray(flow.members)).toBe(true)
    }
    const pendingInstance = store.records('approval-instances').find((item) => item.status === 'pending')!
    expect(pendingInstance.menuKey).toBeTruthy()
    expect(pendingInstance.flowId).toBeTruthy()
  })

  it('preserves saved built-in dealer role permissions after a V9 reload', () => {
    const store = useDatabaseStore()
    const role = store.records('roles').find((item) => item.roleKey === 'tier2')!
    store.update('roles', role.id, { permissions: ['dashboard:view', 'devices:view'] })
    const migrated = migrateDatabase(store.database)
    expect(migrated.records.roles.find((item) => item.id === role.id)?.permissions).toEqual(['dashboard:view', 'devices:view'])
    expect(migrated.records.roles.find((item) => item.roleKey === 'platform')?.permissions).toEqual(['*:*:*'])
  })

  it('backfills stable user, issuance and audit relations during the V8 to V9 migration', () => {
    const store = useDatabaseStore()
    const boundDevices = store.records('devices').filter((item) => item.bindingStatus === 'bound' && item.account !== '-')
    expect(boundDevices.some((item) => item.userId)).toBe(true)
    expect(boundDevices.filter((item) => item.userId).every((item) => store.records('users').some((user) => user.id === item.userId))).toBe(true)
    expect(store.records('issuance').some((item) => item.sourceRequestId && item.deviceSN)).toBe(true)

    const project = store.records('projects')[0]
    store.audit('编辑项目', project.code, '林海', false, project)
    const log = store.records('logs')[0]
    expect(log.subjectId).toBe(project.id)
    expect(log.subjectModule).toBe('projects')
  })

  it('repairs legacy account-linked devices even when their binding status is missing', () => {
    const source = migrateDatabase()
    const user = source.records.users.find((item) => source.records.devices.some((device) => device.account === item.account))!
    const device = source.records.devices.find((item) => item.account === user.account)!
    device.userId = ''
    device.bindingStatus = 'normal'

    const migrated = migrateDatabase(source)
    const repaired = migrated.records.devices.find((item) => item.id === device.id)!
    expect(repaired.userId).toBe(user.id)
    expect(repaired.bindingStatus).toBe('bound')
  })

  it('persists interface preferences with the versioned key', () => {
    const preferences = usePreferencesStore()
    preferences.setCollapsed(true)
    preferences.setPageSize(20)
    preferences.setExpandedGroups(['工作台', '设备与库存'])
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}')).toEqual({ collapsed: true, pageSize: 20, expandedGroups: ['工作台', '设备与库存'], navigationCustomized: true })
  })
})
