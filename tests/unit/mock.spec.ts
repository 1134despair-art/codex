import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mockService } from '@/services/mock'
import { relatedNavigationCandidates } from '@/services/related-navigation'
import { moduleConfigs } from '@/config/modules'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'

describe('RuoYi-compatible mock service', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAuthStore().login('admin@shark.cn', 'Admin123!')
  })

  it('searches, sorts and paginates local records', async () => {
    const result = await mockService.list('devices', { pageNum: 1, pageSize: 5, keyword: 'BX', tab: 'all', orderByColumn: 'code', isAsc: 'asc' })
    expect(result.code).toBe(200)
    expect(result.rows.length).toBeLessThanOrEqual(5)
    expect(result.total).toBeGreaterThan(0)
    expect(result.rows[0].code.localeCompare(result.rows.at(-1)?.code || '', 'zh-CN')).toBeLessThanOrEqual(0)
  })

  it('enforces configurable export permission and exports only the current filtered result', async () => {
    const auth = useAuthStore()
    const filtered = await mockService.exportRows('devices', {
      pageNum: 1, pageSize: 1, tab: 'all', filters: { country: '中国' },
    })
    expect(filtered.code).toBe(200)
    expect(filtered.data.length).toBeGreaterThan(0)
    expect(filtered.data.every((item) => item.country === '中国')).toBe(true)
    expect(filtered.data.every((item) => item.password === undefined && item.apiKey === undefined)).toBe(true)

    const database = useDatabaseStore()
    const role = database.records('roles').find((item) => item.roleKey === 'tier1')!
    database.update('roles', role.id, { permissions: ['devices:view'] })
    auth.logout()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    expect((await mockService.exportRows('devices', { pageNum: 1, pageSize: 10, tab: 'all' })).code).toBe(403)

    database.update('roles', role.id, { permissions: ['devices:view', 'devices:export'] })
    auth.refreshSession()
    expect((await mockService.exportRows('devices', { pageNum: 1, pageSize: 10, tab: 'all' })).code).toBe(200)
  })

  it('keeps approval configurations independent by business menu', async () => {
    const database = useDatabaseStore()
    const activeFlows = database.records('approval-flow').filter((item) => item.status === 'normal')
    expect(activeFlows.map((item) => item.menuKey).sort()).toEqual(['materials', 'service-transfer', 'warehouse'])
    const platformApproverId = (await mockService.options('platform-assignees')).data[0].value
    const duplicate = await mockService.create('approval-flow', {
      name: '重复调货流程', menuKey: 'warehouse', levels: '平台直接审核', platformApproverId, status: 'normal',
    })
    expect(duplicate.code).toBe(422)
    const disabled = await mockService.create('approval-flow', {
      name: '调货备用流程', menuKey: 'warehouse', levels: '平台直接审核', platformApproverId, status: 'disabled',
    })
    expect(disabled.code).toBe(200)
    expect(disabled.data).toMatchObject({ menuKey: 'warehouse', menuLabel: '仓库设备（调货审批）' })
  })

  it('filters stable relations with OR values inside a field and AND across fields', async () => {
    const devices = (await mockService.all('devices')).data.slice(0, 2)
    const result = await mockService.list('devices', {
      pageNum: 1,
      pageSize: 20,
      tab: 'all',
      relationFilters: { code: devices.map((item) => item.code), ownerId: String(devices[0].ownerId) },
    })
    expect(result.total).toBeGreaterThan(0)
    expect(result.rows.every((item) => devices.some((device) => device.code === item.code) && item.ownerId === devices[0].ownerId)).toBe(true)
  })

  it('returns only visible cross-menu navigation targets with real related counts', async () => {
    const database = useDatabaseStore()
    const user = database.records('users').find((item) => database.records('devices').some((device) => device.userId === item.id))!
    const navigation = await mockService.relatedNavigation('users', [user.id])
    const deviceLink = navigation.data[user.id].find((item) => item.targetModule === 'devices')!
    expect(deviceLink.level).toBe('primary')
    expect(deviceLink.count).toBeGreaterThan(0)
    const devices = await mockService.list('devices', { pageNum: 1, pageSize: 50, tab: 'all', relationFilters: deviceLink.relationFilters })
    expect(devices.rows).toHaveLength(deviceLink.count)
    expect(devices.rows.every((item) => item.userId === user.id)).toBe(true)

    const auth = useAuthStore()
    auth.logout()
    auth.login('tier2@dealer.cn', 'Dealer123!')
    const device = (await mockService.all('devices')).data[0]
    const tier2Navigation = await mockService.relatedNavigation('devices', [device.id])
    expect(tier2Navigation.data[device.id].some((item) => ['admins', 'roles', 'logs'].includes(item.targetModule))).toBe(false)
  })

  it('keeps devices as the primary user relation when legacy records only contain the account', async () => {
    const database = useDatabaseStore()
    const user = database.records('users').find((item) => database.records('devices').some((device) => device.account === item.account))!
    const linkedDevices = database.records('devices').filter((device) => device.account === user.account)
    expect(linkedDevices.length).toBeGreaterThan(0)
    for (const device of linkedDevices) {
      device.userId = ''
      device.bindingStatus = 'normal'
    }

    const detail = await mockService.related('users', user.id, 'user-devices')
    const displayed = await mockService.get('users', user.id)
    const navigation = await mockService.relatedNavigation('users', [user.id])
    const deviceLink = navigation.data[user.id].find((item) => item.targetModule === 'devices')!

    expect(displayed.data?.deviceCount).toBe(detail.data.length)
    expect(deviceLink.level).toBe('primary')
    expect(deviceLink.count).toBe(detail.data.length)
    expect(deviceLink.relationFilters).toEqual({ id: linkedDevices.map((device) => device.id) })
    expect(Object.keys(deviceLink.relationFilters)).not.toContain('account')
  })

  it('keeps every declared related-navigation target aligned with a real route and tab', () => {
    const database = useDatabaseStore().database.records
    for (const [moduleKey, config] of Object.entries(moduleConfigs)) {
      for (const record of database[moduleKey] || []) {
        for (const item of relatedNavigationCandidates(moduleKey, record, database)) {
          expect(moduleConfigs[item.targetModule], `${moduleKey} -> ${item.targetModule}`).toBeDefined()
          if (item.targetTab) expect(moduleConfigs[item.targetModule].tabs.some((tab) => tab.key === item.targetTab), `${item.targetModule}:${item.targetTab}`).toBe(true)
          expect(Object.keys(item.relationFilters).every((field) => !['account', 'phone', 'email', 'contact'].includes(field))).toBe(true)
        }
      }
      expect(config.route).toBe(moduleKey)
    }
  })

  it('supports Banner CRUD, uniqueness validation and audit logging', async () => {
    const beforeLogs = useDatabaseStore().records('logs').length
    const created = await mockService.create('banners', { code: 'BAN-AUTO-001', name: '售后服务入口', image: '/assets/backgrounds/banner-maintenance.png', target: '/service', sort: 9, status: 'normal' })
    expect(created.code).toBe(200)
    expect((await mockService.create('banners', { code: 'BAN-AUTO-001', name: '重复 Banner', image: 'x.png', target: '/', sort: 10, status: 'normal' })).code).toBe(409)
    const updated = await mockService.update('banners', created.data!.id, { name: '售后服务入口（已编辑）' })
    expect(updated.data?.name).toBe('售后服务入口（已编辑）')
    expect((await mockService.remove('banners', created.data!.id, '自动化测试')).data).toBe(true)
    expect(useDatabaseStore().records('logs').length).toBeGreaterThan(beforeLogs)
  })

  it('generates business codes and keeps created records in their operational tab', async () => {
    const accountId = (await mockService.options('platform-assignees')).data[0].value
    const flow = await mockService.create('approval-flow', {
      name: '自动化物料审批',
      menuKey: 'materials',
      levels: '平台直接审核',
      platformApproverId: accountId,
      status: 'disabled',
    })
    expect(flow.code, flow.msg).toBe(200)
    expect(flow.data?.code).toMatch(/^APF-\d{11}$/)
    expect(flow.data?.category).toBe('流程配置')
    expect(flow.data?.flowTypeLabel).toBe('物料采购')
    expect(flow.data?.menuLabel).toBe('物料采购')
    const visible = await mockService.list('approval-flow', { pageNum: 1, pageSize: 20, tab: 'flows' })
    expect(visible.rows.some((item) => item.id === flow.data?.id)).toBe(true)

    const warehouseDevice = `WH-AUTO-${Date.now()}`
    const inbound = await mockService.create('warehouse', {
      category: '在库', deviceSN: warehouseDevice, deviceModel: '制冰机 CI-02', region: '中国',
    })
    expect(inbound.code, inbound.msg).toBe(200)
    expect(inbound.data?.code).toMatch(/^IN-\d{11}$/)
    const deviceRows = useDatabaseStore().records('devices').filter((item) => item.code === warehouseDevice)
    expect(deviceRows).toHaveLength(1)
    expect(inbound.data?.quantity).toBe(1)
  })

  it('rejects dealer warehouse inbound and platform SN replacement outside the V3.2 role flow', async () => {
    const auth = useAuthStore()
    auth.logout()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    expect((await mockService.create('warehouse', { category: '在库', deviceSN: 'WH-NO-DEALER', deviceModel: '制冰机 CI-02', region: '中国' })).code).toBe(422)
    auth.logout()
    auth.login('admin@shark.cn', 'Admin123!')
    const original = (await mockService.all('devices')).data.find((item) => item.ownerId !== 'platform')!
    expect((await mockService.create('sn-replacement', { originalSN: original.code, newSN: 'SN-NO-PLATFORM' })).code).toBe(422)
  })

  it('creates projects, derives device relations and retains project history', async () => {
    const device = (await mockService.all('devices')).data.find((item) => item.activationDate) || (await mockService.all('devices')).data[0]
    const created = await mockService.create('projects', {
      name: '关联字段项目', deviceSN: device.code, shipOwner: '自动化船东', usageRegion: '广东', summary: '关联字段测试',
    })
    expect(created.code).toBe(200)
    expect(created.data?.deviceModel).toBe(device.deviceModel)
    expect(useDatabaseStore().records('project-history').some((item) => item.projectId === created.data?.id && item.changeType === '新增')).toBe(true)
    const updated = await mockService.update('projects', created.data!.id, { deviceSN: device.code, shipOwner: '变更后船东' })
    expect(updated.data?.deviceModel).toBe(device.deviceModel)
    expect(updated.data?.owner).toBe(device.owner)
    expect(updated.data?.warrantyUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(useDatabaseStore().records('project-history').some((item) => item.projectId === created.data?.id && item.changeType === '编辑' && String(item.snapshot).includes('自动化船东'))).toBe(true)
  })

  it('stores device child materials and queues remote-disable when the device is offline', async () => {
    const created = await mockService.create('devices', {
      code: 'BX-COMPONENT-AUTO-001', name: '制冰机 CI-02', region: '中国 · 广东',
      components: [{ serialNumber: 'AUTO-PUMP-001', specification: '海水泵 P-20' }, { serialNumber: 'AUTO-CTRL-001', specification: '控制器 C-02' }],
    })
    expect(created.code, created.msg).toBe(200)
    const details = await mockService.related('devices', created.data!.id, 'device-components')
    expect(details.data).toHaveLength(2)
    expect(details.data.map((item) => item.serialNumber).sort()).toEqual(['AUTO-CTRL-001', 'AUTO-PUMP-001'])

    const disabled = await mockService.action('devices', created.data!.id, 'remote-disable', { reason: '验证离线指令' })
    expect(disabled.data).toMatchObject({ status: 'offline', commandStatus: 'queued_offline', pendingRemoteStatus: 'disabled' })
    expect(useDatabaseStore().records('device-commands').find((item) => item.deviceId === created.data!.id)).toMatchObject({ result: 'queued_offline', status: 'pending' })
  })

  it('does not start warranty for an unactivated device', async () => {
    const device = (await mockService.all('devices')).data.find((item) => item.activation === 'inactive')!
    const created = await mockService.create('projects', { name: '待激活质保项目', deviceSN: device.code, shipOwner: '测试船东', usageRegion: '福建' })
    expect(created.code, created.msg).toBe(200)
    expect(created.data).toMatchObject({ warrantyUntil: '', warrantyResult: '设备未激活，无法校验' })
  })

  it('persists create and edit operations for platform-maintained configuration modules', async () => {
    const cases = [
      { moduleKey: 'material-catalog', tab: 'all', payload: { name: '自动化密封圈', category: '制冰机 CI-02', price: 88, stock: 12, status: 'normal' }, expected: { materialCode: /^MTR-/ } },
      { moduleKey: 'couriers', tab: 'companies', payload: { name: '自动化快递', courierCode: 'auto-express', apiKeyMasked: '********1234', status: 'normal' }, expected: { category: '快递公司' } },
      { moduleKey: 'banners', tab: 'all', payload: { name: '自动化 Banner', image: '/assets/backgrounds/banner-maintenance.png', target: '/service', sort: 8, status: 'normal' }, expected: { target: '/service' } },
    ] as const

    for (const current of cases) {
      const created = await mockService.create(current.moduleKey, current.payload)
      expect(created.code, `${current.moduleKey}: ${created.msg}`).toBe(200)
      for (const [field, expected] of Object.entries(current.expected)) {
        if (expected instanceof RegExp) expect(created.data?.[field]).toMatch(expected)
        else expect(created.data?.[field]).toBe(expected)
      }
      expect((await mockService.list(current.moduleKey, { pageNum: 1, pageSize: 50, tab: current.tab })).rows.some((item) => item.id === created.data?.id)).toBe(true)
      const editedName = `${created.data?.name}（已编辑）`
      expect((await mockService.update(current.moduleKey, created.data!.id, { name: editedName })).data?.name).toBe(editedName)
    }
  })

  it('removes data records that only supported out-of-scope tabs', async () => {
    const database = useDatabaseStore()
    expect(database.records('warranty').every((item) => item.category !== '变更记录')).toBe(true)
    expect(database.records('couriers').every((item) => item.category === '快递公司')).toBe(true)
    expect(database.records('ota').every((item) => item.category === '固件版本')).toBe(true)
    expect(database.records('payment-settings').every((item) => ['支付渠道', '商户配置'].includes(String(item.category)))).toBe(true)
    expect(database.records('dealers').every((item) => item.category !== '注册申请')).toBe(true)
  })

  it('applies role and data-domain scope', async () => {
    const auth = useAuthStore()
    auth.setDomain('global')
    const globalRows = (await mockService.all('devices')).data
    expect(globalRows.every((item) => item.domain === 'global')).toBe(true)
    auth.logout()
    auth.login('tier2@dealer.cn', 'Dealer123!')
    const dealerRows = (await mockService.all('devices')).data
    expect(dealerRows.every((item) => item.ownerId === 'dealer-t2-xm')).toBe(true)
  })

  it('lets tier-2 edit only projects in its own dealer scope', async () => {
    const auth = useAuthStore()
    const database = useDatabaseStore()
    auth.logout()
    auth.login('tier2@dealer.cn', 'Dealer123!')
    const own = database.records('projects').find((item) => item.ownerId === auth.session?.ownerId)!
    const outside = database.records('projects').find((item) => item.ownerId !== auth.session?.ownerId)!
    const updated = await mockService.update('projects', own.id, { shipOwner: '二级经销商船东' })
    expect(updated.code, updated.msg).toBe(200)
    expect(updated.data?.shipOwner).toBe('二级经销商船东')
    expect((await mockService.update('projects', outside.id, { shipOwner: '越权修改' })).code).toBe(403)
  })

  it('moves records through domain actions', async () => {
    const record = (await mockService.all('repairs')).data.find((item) => item.status === 'pending')!
    const assigneeId = (await mockService.options('dealers')).data[0].value
    expect((await mockService.action('repairs', record.id, 'assign', { assigneeId, reason: '分配给售后经销商' })).data?.status).toBe('processing')
    expect((await mockService.action('repairs', record.id, 'complete', '已完成维修')).data?.status).toBe('completed')
  })

  it('filters repairs by stable dealer ownership instead of the current handler', async () => {
    const database = useDatabaseStore()
    const record = database.records('repairs').find((item) => item.dealerId)!
    const result = await mockService.list('repairs', { pageNum: 1, pageSize: 50, tab: 'all', filters: { dealerId: String(record.dealerId) } })
    expect(result.total).toBeGreaterThan(0)
    expect(result.rows.every((item) => item.dealerId === record.dealerId && item.dealer)).toBe(true)
  })

  it('uses the dealer warranty years when no product-specific rule exists', async () => {
    const database = useDatabaseStore()
    const device = database.records('devices').find((item) => item.ownerId !== 'platform')!
    const dealer = database.records('dealers').find((item) => String(item.organizationId || item.ownerId) === device.ownerId)!
    database.update('dealers', dealer.id, { defaultWarrantyYears: 3 })
    database.update('devices', device.id, { activationDate: '2026-02-10' })
    for (const rule of database.records('warranty').filter((item) => String(item.dealerId || item.ownerId) === device.ownerId && (item.productType === device.name || item.category === device.name))) {
      database.update('warranty', rule.id, { status: 'disabled' })
    }
    const project = database.records('projects')[0]
    const updated = await mockService.update('projects', project.id, { deviceSN: device.code })
    expect(updated.data?.warrantyUntil).toBe('2029-02-10')
  })

  it('uses module-specific filters including exact SN and date range', async () => {
    const device = (await mockService.all('devices')).data[0]
    expect(moduleConfigs.devices.filters).toContainEqual(expect.objectContaining({ field: 'ownerId', label: '所属经销商', optionSource: 'dealers' }))
    expect(moduleConfigs.devices.columns).toContainEqual(expect.objectContaining({ field: 'owner', label: '所属经销商' }))
    const exact = await mockService.list('devices', { pageNum: 1, pageSize: 10, tab: 'all', filters: { code: device.code } })
    expect(exact.total).toBe(1)
    const partial = await mockService.list('devices', { pageNum: 1, pageSize: 10, tab: 'all', filters: { code: device.code.slice(0, -1) } })
    expect(partial.total).toBe(0)
    const dealerDevices = await mockService.list('devices', { pageNum: 1, pageSize: 20, tab: 'all', filters: { ownerId: device.ownerId } })
    expect(dealerDevices.total).toBeGreaterThan(0)
    expect(dealerDevices.rows.every((item) => item.ownerId === device.ownerId)).toBe(true)
    const users = await mockService.list('users', { pageNum: 1, pageSize: 10, tab: 'all', filters: { createdAt: ['2026-08-09', '2026-08-11'] } })
    expect(users.total).toBeGreaterThan(0)
  })

  it('returns real relation data for detail tabs', async () => {
    const user = (await mockService.all('users')).data.find((item) => Number(item.deviceCount) > 0)!
    expect(moduleConfigs.users.detailTabs.map((tab) => tab.key)).toEqual(['overview', 'devices'])
    expect((await mockService.related('users', user.id, 'waypoints')).data).toEqual([])
    const device = (await mockService.all('devices')).data[0]
    expect((await mockService.related('devices', device.id, 'ownership-history')).data.length).toBeGreaterThan(0)
    expect((await mockService.related('devices', device.id, 'firmware-history')).data.length).toBeGreaterThan(0)
  })

  it('force unbinds a device transactionally and rejects invalid state transitions', async () => {
    const device = (await mockService.all('devices')).data.find((item) => item.bindingStatus === 'bound')!
    const oldCode = device.code
    const oldAccount = device.account
    const user = (await mockService.all('users')).data.find((item) => item.account === oldAccount)
    const previousCount = Number(user?.deviceCount || 0)
    const result = await mockService.action('devices', device.id, 'unbind', { reason: '售后换机' })
    expect(result.code).toBe(200)
    expect(result.data?.code).toBe(`${oldCode}-1`)
    expect(result.data?.bindingStatus).toBe('unbound')
    if (user) expect((await mockService.get('users', user.id)).data?.deviceCount).toBe(Math.max(0, previousCount - 1))
    const completedRepair = (await mockService.all('repairs')).data.find((item) => item.status === 'completed')!
    expect((await mockService.action('repairs', completedRepair.id, 'assign', { assignee: '深圳海航' })).code).toBe(409)
  })

  it('shipping a material request creates logistics and issuance records', async () => {
    const material = (await mockService.all('materials')).data.find((item) => item.status === 'approved')!
    const issuanceBefore = (await mockService.all('issuance')).data.length
    const courierId = (await mockService.options('enabled-couriers')).data[0].value
    const shipped = await mockService.action('materials', material.id, 'ship', { courierId, trackingNo: 'SF10000001' })
    expect(shipped.data?.status).toBe('shipped')
    expect((await mockService.related('materials', material.id, 'logistics-records')).data[0].trackingNo).toBe('SF10000001')
    expect((await mockService.all('issuance')).data.length).toBe(issuanceBefore + 1)
  })

  it('stores the V3.2 Banner jump link as text', async () => {
    const created = await mockService.create('banners', { name: '经销商项目入口', image: '/assets/backgrounds/banner-maintenance.png', target: '/projects', sort: 3, status: 'normal' })
    expect(created.code).toBe(200)
    expect(created.data?.target).toBe('/projects')
    expect(created.data?.targetKey).toBeUndefined()
    expect(created.data?.audience).toBeUndefined()
  })

  it('keeps OTA management limited to firmware versions', async () => {
    const versions = await mockService.list('ota', { pageNum: 1, pageSize: 10, tab: 'versions' })
    expect(versions.rows.every((item) => item.category === '固件版本')).toBe(true)
    expect(useDatabaseStore().records('ota').every((item) => item.category === '固件版本')).toBe(true)
  })

  it('masks user contacts while preserving the raw account in the App login entity', async () => {
    const database = useDatabaseStore()
    const user = database.records('users').find((item) => String(item.account).includes('@')) || database.records('users')[0]
    const listed = (await mockService.list('users', { pageNum: 1, pageSize: 50, tab: 'all', filters: { name: user.name } })).rows.find((item) => item.id === user.id)!
    expect(String(listed.account)).toContain('*')
    expect(database.records('user-auth-accounts').find((item) => item.subjectId === user.id)?.account).toBe(user.account)
    expect((await mockService.create('users', { account: '13812345678', name: '超范围新增' })).code).toBe(403)
  })

  it('changes only the device sales region and writes an audit record', async () => {
    const device = (await mockService.all('devices')).data[0]
    const result = await mockService.action('devices', device.id, 'change-region', { country: '中国', region: '中国 · 浙江', reason: '渠道调整' })
    expect(result.data?.region).toBe('中国 · 浙江')
    expect(result.data?.firmware).toBe(device.firmware)
    expect(useDatabaseStore().records('logs').some((item) => item.subjectId === device.id && String(item.content).includes('渠道调整'))).toBe(true)
  })

  it('moves warehouse devices and records ownership history transactionally', async () => {
    const deviceOptions = (await mockService.options('warehouse-devices')).data.slice(0, 2)
    const dealerOption = (await mockService.options('dealers')).data[0]
    const duplicate = await mockService.create('warehouse', { category: '出库', selectedDevices: [deviceOptions[0].value, deviceOptions[0].value], targetDealerId: dealerOption.value, summary: '重复 SN' })
    expect(duplicate.code).toBe(422)
    expect(duplicate.msg).toContain('重复 SN')
    const outbound = await mockService.create('warehouse', { code: 'OUT-AUTO-01', category: '出库', selectedDevices: deviceOptions.map((item) => item.value), targetDealerId: dealerOption.value, summary: '表格批量出库' })
    expect(outbound.code).toBe(200)
    expect(outbound.data?.status).toBe('pending')
    expect(outbound.data?.quantity).toBe(2)
    expect(deviceOptions.every((option) => useDatabaseStore().records('devices').find((item) => item.code === option.value)?.inventoryStatus === 'in_stock')).toBe(true)
    const processed = await mockService.action('warehouse', outbound.data!.id, 'process', { decision: 'outbound', reason: '确认出库' })
    expect(processed.code, processed.msg).toBe(200)
    expect(processed.data?.status).toBe('completed')
    deviceOptions.forEach((option) => {
      const device = useDatabaseStore().records('devices').find((item) => item.code === option.value)
      expect(device?.ownerId).toBe(dealerOption.value)
      expect(useDatabaseStore().records('warehouse').some((item) => item.category === '在库' && item.deviceSN === option.value)).toBe(false)
      expect(useDatabaseStore().records('stock-movements').some((item) => item.deviceSN === option.value && item.category === '设备出库')).toBe(true)
      expect(useDatabaseStore().records('ownership-history').some((item) => item.deviceSN === option.value && item.operationType === '设备出库')).toBe(true)
    })
  })

  it('approves without reserving stock and deducts inventory only when shipping', async () => {
    const auth = useAuthStore()
    auth.logout()
    auth.login('tier2@dealer.cn', 'Dealer123!')
    const database = useDatabaseStore()
    const catalog = (await mockService.options('active-materials')).data[0]
    const device = (await mockService.all('devices')).data[0]
    const stockBefore = Number(database.records('material-catalog').find((item) => item.id === catalog.value)!.stock)
    const created = await mockService.create('materials', { code: 'MAT-REQ-AUTO', materialId: catalog.value, quantity: 2, deviceSN: device.code, category: '普通申请', summary: '库存链路测试' })
    expect(created.code, created.msg).toBe(200)
    expect(database.records('stock-reservations').some((item) => item.subjectId === created.data!.id)).toBe(false)

    auth.logout()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    expect((await mockService.action('materials', created.data!.id, 'approve', { reason: '一级审批' })).data?.status).toBe('pending')
    auth.logout()
    auth.login('admin@shark.cn', 'Admin123!')
    const approved = await mockService.action('materials', created.data!.id, 'approve', { reason: '平台审批' })
    expect(approved.data?.status).toBe('approved')
    expect(database.records('material-catalog').find((item) => item.id === catalog.value)?.stock).toBe(stockBefore)

    const courierId = (await mockService.options('enabled-couriers')).data[0].value
    const shipped = await mockService.action('materials', created.data!.id, 'ship', { courierId, trackingNo: 'SF-MAT-AUTO-01' })
    expect(shipped.data?.status).toBe('shipped')
    expect(database.records('material-catalog').find((item) => item.id === catalog.value)?.stock).toBe(stockBefore - 2)
    expect(database.records('issuance').some((item) => item.sourceRequestId === created.data!.id && item.trackingNo === 'SF-MAT-AUTO-01')).toBe(true)
  })

  it('executes a tier-2 material request through tier-1 and platform approval nodes', async () => {
    const auth = useAuthStore()
    auth.logout()
    auth.login('tier2@dealer.cn', 'Dealer123!')
    const catalog = (await mockService.options('active-materials')).data[0]
    const device = (await mockService.all('devices')).data[0]
    const created = await mockService.create('materials', { code: 'MAT-TIER2-AUTO', materialId: catalog.value, quantity: 1, deviceSN: device.code, category: '普通申请', summary: '二级审批链测试' })
    expect(created.code, created.msg).toBe(200)
    expect(created.data?.currentApproverName).toBe('张勇')
    expect((await mockService.action('materials', created.data!.id, 'approve', { reason: '申请人不能自审' })).code).toBe(403)

    auth.logout()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    const first = await mockService.action('materials', created.data!.id, 'approve', { reason: '一级审核通过' })
    expect(first.data?.status).toBe('pending')
    expect(first.data?.currentApproverName).toBe('林海')

    auth.logout()
    auth.login('admin@shark.cn', 'Admin123!')
    const final = await mockService.action('materials', created.data!.id, 'approve', { reason: '平台终审通过' })
    expect(final.data?.status).toBe('approved')
    const steps = useDatabaseStore().records('approval-steps').filter((item) => item.subjectId === created.data!.id)
    expect(steps.map((item) => item.status)).toEqual(['approved', 'approved'])
  })

  it('moves an approved device purchase through finance confirmation before warehouse fulfillment', async () => {
    const auth = useAuthStore()
    const database = useDatabaseStore()
    const issuanceBefore = database.records('issuance').length
    const materialStockBefore = database.records('material-catalog').map((item) => ({ id: item.id, stock: item.stock }))

    auth.logout()
    auth.login('tier2@dealer.cn', 'Dealer123!')
    const created = await mockService.create('materials', {
      category: '设备采购',
      deviceModel: '制冰机 CI-02',
      quantity: 2,
      estimatedUnitPrice: 68000,
      summary: '新增两台船用制冰设备',
    })
    expect(created.code, created.msg).toBe(200)
    expect(created.data).toMatchObject({
      code: expect.stringMatching(/^PUR-/),
      category: '设备采购',
      itemName: '制冰机 CI-02',
      amount: 136000,
      paymentStatus: '未登记',
      status: 'pending',
    })
    expect((await mockService.action('materials', created.data!.id, 'ship', { courierId: 'none', trackingNo: 'none' })).code).toBe(403)

    auth.logout()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    expect((await mockService.action('materials', created.data!.id, 'approve', { reason: '一级确认采购需求' })).data?.status).toBe('pending')

    auth.logout()
    auth.login('admin@shark.cn', 'Admin123!')
    const approved = await mockService.action('materials', created.data!.id, 'approve', { reason: '平台批准采购预算' })
    expect(approved.data?.status).toBe('approved')
    expect((await mockService.action('materials', created.data!.id, 'ship', { courierId: 'none', trackingNo: 'none' })).code).toBe(409)

    const recorded = await mockService.action('materials', created.data!.id, 'record-expense', {
      actualUnitPrice: 66500,
      paidAmount: 133000,
      paymentMethod: '对公转账',
      paymentReference: 'OFFLINE-20260820-001',
      paidAt: '2026-08-20',
      paymentNote: '线下采购付款凭证已归档',
    })
    expect(recorded.code, recorded.msg).toBe(200)
    expect(recorded.data).toMatchObject({ amount: 133000, paidAmount: 133000, paymentStatus: '已登记', status: 'approved', purchaseStage: 'warehouse_fulfillment', purchaseStageLabel: '待仓库发货' })
    expect((await mockService.related('materials', created.data!.id, 'expense-records')).data).toEqual([
      expect.objectContaining({ amount: 133000, paymentMethod: '对公转账', paymentReference: 'OFFLINE-20260820-001' }),
    ])
    expect(database.records('payments')).toContainEqual(expect.objectContaining({ subjectId: created.data!.id, subjectModule: 'materials', sourceType: 'platform', amount: 133000, paymentReference: 'OFFLINE-20260820-001' }))
    expect(database.records('issuance')).toHaveLength(issuanceBefore)
    expect(database.records('material-catalog').map((item) => ({ id: item.id, stock: item.stock }))).toEqual(materialStockBefore)
  })

  it('updates the device dealer relation after the configured service-transfer approvals', async () => {
    const auth = useAuthStore()
    auth.logout()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    const device = (await mockService.all('devices')).data.find((item) => item.ownerId === auth.session?.ownerId)!
    const project = await mockService.create('projects', { name: '售后转移联动项目', deviceSN: device.code, shipOwner: '联动船东', usageRegion: '广东' })
    expect(project.code, project.msg).toBe(200)
    const target = (await mockService.options('service-target-dealers', { deviceSN: device.code })).data[0]!
    const created = await mockService.create('service-transfer', { code: 'TRF-AUTO-01', deviceSN: device.code, targetDealerId: target.value, summary: '调整售后服务网点' })
    expect(created.code, created.msg).toBe(200)
    expect((await mockService.action('service-transfer', created.data!.id, 'process', { decision: 'confirmed', reason: '原方不能自确认' })).code).toBe(403)

    auth.logout()
    const targetAccount = useDatabaseStore().records('auth-accounts').find((item) => item.ownerId === target.value)!
    auth.login(String(targetAccount.account), String(targetAccount.password))
    expect((await mockService.all('service-transfer')).data.some((item) => item.id === created.data!.id)).toBe(true)
    const confirmed = await mockService.action('service-transfer', created.data!.id, 'process', { decision: 'confirmed', reason: '目标经销商确认' })
    expect(confirmed.data?.status).toBe('completed')
    const updatedDevice = useDatabaseStore().records('devices').find((item) => item.id === device.id)!
    expect(updatedDevice.ownerId).toBe(target.value)
    expect(useDatabaseStore().records('projects').find((item) => item.id === project.data!.id)?.ownerId).toBe(target.value)
    expect(useDatabaseStore().records('project-history').some((item) => item.projectId === project.data!.id && item.changeType === '售后转移')).toBe(true)
    expect(useDatabaseStore().records('ownership-history').some((item) => item.deviceId === device.id && item.toOwnerId === target.value && item.operationType === '售后转移')).toBe(true)
  })

  it('lets headquarters initiate a fee-bearing transfer and changes ownership only after fee approval', async () => {
    const auth = useAuthStore()
    const database = useDatabaseStore()
    const activeTransferSNs = new Set(database.records('service-transfer').filter((item) => item.status === 'pending').map((item) => item.deviceSN))
    const device = (await mockService.all('devices')).data.find((item) => item.ownerId !== 'platform' && !activeTransferSNs.has(item.code))!
    const originalOwnerId = device.ownerId
    const target = (await mockService.options('service-target-dealers', { deviceSN: device.code })).data.find((item) => item.value !== originalOwnerId)!

    const created = await mockService.create('service-transfer', {
      code: 'TRF-FEE-AUTO-01',
      deviceSN: device.code,
      targetDealerId: target.value,
      hasFee: true,
      estimatedFee: 3600,
      feeBearer: '原经销商',
      feeDescription: '异地交接与运输费用',
      summary: '总部调整售后服务归属',
    })
    expect(created.code, created.msg).toBe(200)
    expect(created.data).toMatchObject({ initiatorRole: 'platform', approvalStage: 'target_confirmation', feeStatus: '待总部审批', currentApproverId: expect.any(String) })
    expect(database.records('devices').find((item) => item.id === device.id)?.ownerId).toBe(originalOwnerId)
    expect(database.records('approval-steps').filter((item) => item.subjectId === created.data!.id)).toHaveLength(2)

    const targetAccount = database.records('auth-accounts').find((item) => item.ownerId === target.value && item.status === 'normal')!
    auth.logout()
    expect(auth.login(String(targetAccount.account), String(targetAccount.password)).accountId).toBe(targetAccount.id)
    const confirmed = await mockService.action('service-transfer', created.data!.id, 'confirm-transfer', { decision: 'confirmed', reason: '目标经销商确认接收' })
    expect(confirmed.code, confirmed.msg).toBe(200)
    expect(confirmed.data).toMatchObject({ status: 'pending', approvalStage: 'fee_approval', feeStatus: '待总部审批' })
    expect(database.records('devices').find((item) => item.id === device.id)?.ownerId).toBe(originalOwnerId)
    expect((await mockService.action('service-transfer', created.data!.id, 'approve-transfer-fee', { actualFee: 3500, paymentMethod: '对公转账', paymentReference: 'NO-PERMIT', paidAt: '2026-08-21', reason: '越权审批' })).code).toBe(403)

    auth.logout()
    expect(auth.login('admin@shark.cn', 'Admin123!').role).toBe('platform')
    const approved = await mockService.action('service-transfer', created.data!.id, 'approve-transfer-fee', {
      actualFee: 3500,
      paymentMethod: '对公转账',
      paymentReference: 'TRF-OFFLINE-20260821-001',
      paidAt: '2026-08-21',
      reason: '费用及线下付款凭证核对通过',
    })
    expect(approved.code, approved.msg).toBe(200)
    expect(approved.data).toMatchObject({ status: 'completed', approvalStage: 'completed', feeStatus: '已登记', actualFee: 3500 })
    expect(database.records('devices').find((item) => item.id === device.id)?.ownerId).toBe(target.value)
    expect(database.records('expense-records')).toContainEqual(expect.objectContaining({ subjectId: created.data!.id, amount: 3500, paymentReference: 'TRF-OFFLINE-20260821-001' }))
    expect(database.records('payments')).toContainEqual(expect.objectContaining({ subjectId: created.data!.id, subjectModule: 'service-transfer', sourceType: 'platform', amount: 3500, paymentReference: 'TRF-OFFLINE-20260821-001' }))
    expect(database.records('ownership-history')).toContainEqual(expect.objectContaining({ deviceId: device.id, toOwnerId: target.value, operationType: '售后转移' }))
  })

  it('keeps logistics tests isolated from stock and fulfillment records', async () => {
    const database = useDatabaseStore()
    const courier = (await mockService.all('couriers')).data.find((item) => item.category === '快递公司')!
    const before = { issuance: database.records('issuance').length, movements: database.records('stock-movements').length }
    const result = await mockService.action('couriers', courier.id, 'test', { trackingNo: 'TEST-TRACK-001' })
    expect(result.code).toBe(200)
    expect(database.records('issuance')).toHaveLength(before.issuance)
    expect(database.records('stock-movements')).toHaveLength(before.movements)
    expect(database.records('external-call-logs').some((item) => item.requestRef === 'TEST-TRACK-001' && item.result === 'simulated_success')).toBe(true)
    expect(database.records('couriers').find((item) => item.id === courier.id)?.trackingNo).not.toBe('TEST-TRACK-001')
  })

  it('enforces high-risk action permissions inside the service', async () => {
    const auth = useAuthStore()
    const platformDevice = (await mockService.all('devices')).data[0]
    expect((await mockService.action('devices', platformDevice.id, 'remote-disable', { reason: '演示指令' })).code).toBe(200)
    expect(useDatabaseStore().records('device-commands').some((item) => item.deviceId === platformDevice.id && item.result === 'simulated_success')).toBe(true)
    auth.logout()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    const dealerDevice = (await mockService.all('devices')).data[0]
    expect((await mockService.action('devices', dealerDevice.id, 'remote-disable', { reason: '越权尝试' })).code).toBe(403)
  })

  it('rejects anonymous registration and all unauthenticated create services', async () => {
    const auth = useAuthStore()
    auth.logout()
    expect((await mockService.create('dealer-applications', { name: '注册申请测试', account: 'apply-auto@example.com', phone: '13800138000', status: 'pending' })).code).toBe(403)
    expect((await mockService.create('projects', { code: 'NO-AUTH', name: '越权项目' })).code).toBe(403)
  })

  it('makes administrator CRUD affect real login accounts', async () => {
    const roleId = (await mockService.options('roles')).data.find((item) => item.label.startsWith('总部售后'))!.value
    const created = await mockService.create('admins', { account: 'ops-auto@shark.cn', initialPassword: 'Ops12345!', name: '自动化客服', roleId, ownerId: 'platform', status: 'normal' })
    expect(created.code).toBe(200)
    const auth = useAuthStore()
    auth.logout()
    expect(auth.login('ops-auto@shark.cn', 'Ops12345!').displayName).toBe('自动化客服')
    auth.logout()
    auth.login('admin@shark.cn', 'Admin123!')
    await mockService.action('admins', created.data!.id, 'toggle', { reason: '停用测试账号' })
    auth.logout()
    expect(() => auth.login('ops-auto@shark.cn', 'Ops12345!')).toThrow('账号已禁用')
  })

  it('keeps a disabled administrator disabled after resetting its password', async () => {
    const roleId = (await mockService.options('roles')).data.find((item) => item.label.startsWith('总部售后'))!.value
    const created = await mockService.create('admins', { account: 'locked@shark.cn', initialPassword: 'Ops12345!', name: '禁用重置校验', roleId, ownerId: 'platform', status: 'normal' })
    expect((await mockService.action('admins', created.data!.id, 'toggle', { reason: '停用账号' })).data?.status).toBe('disabled')
    expect((await mockService.action('admins', created.data!.id, 'reset-password', { reason: '重置密码' })).code).toBe(200)
    const login = useDatabaseStore().records('auth-accounts').find((item) => item.account === 'locked@shark.cn')!
    expect(login.status).toBe('disabled')
    const auth = useAuthStore()
    auth.logout()
    expect(() => auth.login('locked@shark.cn', 'Reset123!')).toThrow('账号已禁用')
  })

  it('synchronizes administrator edits and rejects duplicate or overlong login accounts', async () => {
    const roleId = (await mockService.options('roles')).data.find((item) => item.label.startsWith('总部售后'))!.value
    const first = await mockService.create('admins', { account: 'edit-a@shark.cn', initialPassword: 'Ops12345!', name: '账号甲', roleId, ownerId: 'platform', status: 'normal' })
    const second = await mockService.create('admins', { account: 'edit-b@shark.cn', initialPassword: 'Ops12345!', name: '账号乙', roleId, ownerId: 'platform', status: 'normal' })
    expect((await mockService.update('admins', second.data!.id, { account: 'edit-a@shark.cn' })).code).toBe(409)
    expect((await mockService.update('admins', second.data!.id, { account: 'account-name-that-is-too-long@shark.cn' })).code).toBe(422)
    const updated = await mockService.update('admins', first.data!.id, { account: 'edit-c@shark.cn', status: 'disabled' })
    expect(updated.code).toBe(200)
    expect(useDatabaseStore().records('auth-accounts').find((item) => item.subjectId === first.data!.id)).toMatchObject({ account: 'edit-c@shark.cn', status: 'disabled' })
  })

  it('isolates Banner and payment configuration by the selected data domain', async () => {
    const auth = useAuthStore()
    const cnBanners = (await mockService.all('banners')).data
    const cnPayments = (await mockService.all('payment-settings')).data
    expect(cnBanners.length).toBeGreaterThan(0)
    expect(cnBanners.every((item) => item.domain === 'cn')).toBe(true)
    expect(cnPayments.every((item) => item.domain === 'cn')).toBe(true)
    auth.setDomain('global')
    expect((await mockService.all('banners')).data.every((item) => item.domain === 'global')).toBe(true)
    expect((await mockService.all('payment-settings')).data.every((item) => item.domain === 'global')).toBe(true)
  })

  it('validates action fields at the service boundary and accepts any non-empty sales country', async () => {
    const device = (await mockService.all('devices')).data[0]
    expect((await mockService.action('devices', device.id, 'remote-disable', {})).code).toBe(422)
    expect((await mockService.action('devices', device.id, 'change-region', { country: '', region: '', reason: '' })).code).toBe(422)
    const created = await mockService.create('devices', { code: 'DE-AUTO-DEVICE-01', name: '制冰机 CI-02', region: '德国 · 汉堡' })
    expect(created.code, created.msg).toBe(200)
    expect(created.data?.country).toBe('德国')
    const project = (await mockService.all('projects')).data[0]
    expect((await mockService.remove('projects', project.id, '')).code).toBe(422)
  })

  it('imports devices transactionally and leaves no partial records on validation failure', async () => {
    const database = useDatabaseStore()
    const before = database.records('devices').length
    const failed = await mockService.importDevices([
      { sn: 'BATCH-AUTO-001', model: '制冰机 CI-02', region: '德国' },
      { sn: 'BATCH-AUTO-001', model: '海水淡化器 SW-04', region: '法国' },
    ])
    expect(failed.code).toBe(409)
    expect(database.records('devices')).toHaveLength(before)
    const imported = await mockService.importDevices([
      { sn: 'BATCH-AUTO-001', model: '制冰机 CI-02', region: '德国' },
      { sn: 'BATCH-AUTO-002', model: '海水淡化器 SW-04', region: '法国' },
    ], 'warehouse')
    expect(imported.code, imported.msg).toBe(200)
    expect(database.records('devices').filter((item) => ['BATCH-AUTO-001', 'BATCH-AUTO-002'].includes(item.code))).toHaveLength(2)
    expect(database.records('warehouse').filter((item) => ['BATCH-AUTO-001', 'BATCH-AUTO-002'].includes(String(item.deviceSN)))).toHaveLength(2)
  })

  it('creates a notification when resetting an App user password', async () => {
    const user = (await mockService.all('users')).data[0]
    const before = useDatabaseStore().records('notifications').length
    const account = useDatabaseStore().records('user-auth-accounts').find((item) => item.subjectId === user.id)!
    useDatabaseStore().update('user-auth-accounts', account.id, { password: 'Changed123!', firstLogin: false })
    const result = await mockService.action('users', user.id, 'reset-password', { reason: '用户申请找回' })
    expect(result.code).toBe(200)
    expect(result.data?.mustChangePassword).toBe(true)
    expect(useDatabaseStore().records('user-auth-accounts').find((item) => item.id === account.id)?.password).toBe('Reset123!')
    expect(useDatabaseStore().records('user-auth-accounts').find((item) => item.id === account.id)?.firstLogin).toBe(true)
    expect(useDatabaseStore().records('notifications')).toHaveLength(before + 1)
  })

  it('synchronizes user enable and disable state to the App account entity', async () => {
    const user = (await mockService.all('users')).data.find((item) => item.status === 'normal')!
    const account = useDatabaseStore().records('user-auth-accounts').find((item) => item.subjectId === user.id)!
    expect((await mockService.action('users', user.id, 'toggle', { reason: '风险账号' })).data?.status).toBe('disabled')
    expect(useDatabaseStore().records('user-auth-accounts').find((item) => item.id === account.id)?.status).toBe('disabled')
    expect((await mockService.action('users', user.id, 'toggle', { reason: '复核通过' })).data?.status).toBe('normal')
    expect(useDatabaseStore().records('user-auth-accounts').find((item) => item.id === account.id)?.status).toBe('normal')
  })

  it('rejects arbitrary values that are not present in dynamic options', async () => {
    const warehouseDevice = (await mockService.options('warehouse-devices')).data[0].value
    const invalidOutbound = await mockService.create('warehouse', { code: 'OUT-INVALID', category: '出库', selectedDevices: [warehouseDevice], targetDealerId: 'manual-free-text' })
    expect(invalidOutbound.code).toBe(422)
    const material = (await mockService.all('materials')).data.find((item) => item.status === 'approved')!
    expect((await mockService.action('materials', material.id, 'ship', { courierId: 'manual-free-text', trackingNo: 'X1' })).code).toBe(422)
  })
})
