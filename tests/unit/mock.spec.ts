import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mockService } from '@/services/mock'
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
      flowType: 'materials',
      levels: '平台直接审核',
      platformApproverId: accountId,
      status: 'normal',
    })
    expect(flow.code, flow.msg).toBe(200)
    expect(flow.data?.code).toMatch(/^APF-\d{11}$/)
    expect(flow.data?.category).toBe('流程配置')
    expect(flow.data?.flowTypeLabel).toBe('物料申请')
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

  it('updates project relations but rejects the undefined project-create extension', async () => {
    const device = (await mockService.all('devices')).data.find((item) => item.activationDate) || (await mockService.all('devices')).data[0]
    expect((await mockService.create('projects', {
      name: '关联字段项目', deviceSN: device.code, shipOwner: '自动化船东', usageRegion: '广东', summary: '关联字段测试',
    })).code).toBe(403)
    const project = (await mockService.all('projects')).data[0]
    const updated = await mockService.update('projects', project.id, { deviceSN: device.code })
    expect(updated.data?.deviceModel).toBe(device.name)
    expect(updated.data?.owner).toBe(device.owner)
    expect(updated.data?.warrantyUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/)
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
    expect((await mockService.update('projects', own.id, { shipOwner: '二级经销商船东' })).data?.shipOwner).toBe('二级经销商船东')
    expect((await mockService.update('projects', outside.id, { shipOwner: '越权修改' })).code).toBe(403)
  })

  it('moves records through domain actions', async () => {
    const record = (await mockService.all('repairs')).data.find((item) => item.status === 'pending')!
    const assigneeId = (await mockService.options('dealers')).data[0].value
    expect((await mockService.action('repairs', record.id, 'assign', { assigneeId, reason: '分配给售后经销商' })).data?.status).toBe('processing')
    expect((await mockService.action('repairs', record.id, 'complete', '已完成维修')).data?.status).toBe('completed')
  })

  it('uses module-specific filters including exact SN and date range', async () => {
    const device = (await mockService.all('devices')).data[0]
    const exact = await mockService.list('devices', { pageNum: 1, pageSize: 10, tab: 'all', filters: { code: device.code } })
    expect(exact.total).toBe(1)
    const partial = await mockService.list('devices', { pageNum: 1, pageSize: 10, tab: 'all', filters: { code: device.code.slice(0, -1) } })
    expect(partial.total).toBe(0)
    const users = await mockService.list('users', { pageNum: 1, pageSize: 10, tab: 'all', filters: { createdAt: ['2026-08-09', '2026-08-11'] } })
    expect(users.total).toBeGreaterThan(0)
  })

  it('returns real relation data for detail tabs', async () => {
    const user = (await mockService.all('users')).data.find((item) => Number(item.deviceCount) > 0)!
    expect((await mockService.related('users', user.id, 'waypoints')).data.length).toBeGreaterThan(0)
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
    const deviceOption = (await mockService.options('warehouse-devices')).data[0]
    const dealerOption = (await mockService.options('dealers')).data[0]
    const outbound = await mockService.create('warehouse', { code: 'OUT-AUTO-01', category: '出库', selectedDevices: [deviceOption.value], targetDealerId: dealerOption.value, summary: '自动化出库' })
    expect(outbound.code).toBe(200)
    const processed = await mockService.action('warehouse', outbound.data!.id, 'process', { decision: 'outbound', reason: '确认出库' })
    expect(processed.code, processed.msg).toBe(200)
    expect(processed.data?.status).toBe('completed')
    const device = useDatabaseStore().records('devices').find((item) => item.code === deviceOption.value)
    expect(device?.ownerId).toBe(dealerOption.value)
    expect(useDatabaseStore().records('warehouse').some((item) => item.category === '在库' && item.deviceSN === deviceOption.value)).toBe(false)
    expect(useDatabaseStore().records('stock-movements').some((item) => item.deviceSN === deviceOption.value && item.category === '设备出库')).toBe(true)
    expect(useDatabaseStore().records('ownership-history').some((item) => item.deviceSN === deviceOption.value && item.operationType === '设备出库')).toBe(true)
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

  it('updates the device dealer relation after the configured service-transfer approvals', async () => {
    const auth = useAuthStore()
    auth.logout()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    const device = (await mockService.all('devices')).data.find((item) => item.ownerId === auth.session?.ownerId)!
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
    expect(updatedDevice.ownerId).toBe(target.value)
    expect(useDatabaseStore().records('ownership-history').some((item) => item.deviceId === device.id && item.toOwnerId === target.value && item.operationType === '售后转移')).toBe(true)
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
