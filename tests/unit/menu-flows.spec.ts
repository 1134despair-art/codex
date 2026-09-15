import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { moduleConfigs, navGroups } from '@/config/modules'
import { mockService } from '@/services/mock'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'

function login(account = 'admin@shark.cn', password = 'Admin123!') {
  const auth = useAuthStore()
  auth.logout()
  auth.login(account, password)
  return auth
}

describe('V3.2 complete menu business flows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    login()
  })

  it('opens every configured menu, tab and first detail without empty or permission failures', async () => {
    const routes = navGroups.flatMap((group) => group.items.map((item) => item.route))
    expect(routes).toHaveLength(34)
    expect(new Set(routes).size).toBe(34)

    for (const route of routes) {
      if (route === 'dashboard') continue
      if (route === 'payment-settings') {
        const rows = await mockService.all(route)
        expect(rows.code, route).toBe(200)
        expect(rows.data.length).toBeGreaterThan(0)
        expect(rows.data.every((item) => item.domain === 'cn')).toBe(true)
        continue
      }
      if (route === 'launch-settings') {
        const launchConfig = useDatabaseStore().records('launch-settings')
        expect(launchConfig).toHaveLength(1)
        expect(launchConfig[0]).toMatchObject({ revision: 'v3.2-default', enabled: true })
        continue
      }
      const config = moduleConfigs[route]
      expect(config, route).toBeDefined()
      for (const tab of config.tabs) {
        const result = await mockService.list(route, { pageNum: 1, pageSize: 50, tab: tab.key })
        expect(result.code, `${route}/${tab.key}: ${result.msg}`).toBe(200)
        if (result.rows[0] && !tab.source) {
          const detail = await mockService.get(route, result.rows[0].id)
          expect(detail.code, `${route}/${tab.key}/detail: ${detail.msg}`).toBe(200)
        }
      }
    }

    expect(await mockService.count('users')).toBeGreaterThan(0)
    expect(await mockService.count('devices', 'bound')).toBeGreaterThan(0)
    expect(await mockService.count('dealers', 'active')).toBeGreaterThan(0)
  }, 30_000)

  it('provides a transparent PNG icon for every sidebar menu item', () => {
    for (const group of navGroups) {
      for (const item of group.items) {
        const iconPath = resolve(process.cwd(), 'public', 'assets', 'icons', 'line', `${item.icon}.png`)
        expect(existsSync(iconPath), `${group.label}/${item.label}: ${item.icon}.png`).toBe(true)
      }
    }
  })

  it('creates and edits every platform-maintained entity allowed by V3.2', async () => {
    const platformApprover = (await mockService.options('platform-assignees')).data[0].value
    const platformRole = (await mockService.options('roles')).data.find((item) => item.label.startsWith('平台管理员'))!.value
    const tier1 = (await mockService.options('tier1-dealers')).data[0].value
    const cases = [
      { module: 'dealers', payload: { account: 'menu-tier2@dealer.cn', initialPassword: 'Dealer123!', name: '菜单巡检二级经销商', region: '中国 · 浙江', tier: '二级', parentDealerId: tier1, phone: '13800138001', email: 'menu-tier2@dealer.cn', status: 'normal' } },
      { module: 'devices', payload: { code: 'MENU-DEVICE-20260812', name: '制冰机 CI-02', region: '中国 · 广东' } },
      { module: 'warehouse', payload: { category: '在库', deviceSN: 'MENU-WH-20260812', deviceModel: '海水淡化器 SW-04', region: '中国 · 福建' } },
      { module: 'ota', payload: { name: '9.8.7', deviceType: '制冰机 CI-02', summary: '全菜单自动化固件', firmwareFile: 'menu-firmware.bin · 1.00 MB · 校验通过', forceUpdate: false, status: 'draft' } },
      { module: 'material-catalog', payload: { name: '菜单巡检密封组件', category: '制冰机 CI-02', price: 128, stock: 20, status: 'normal' } },
      { module: 'couriers', payload: { name: '菜单巡检快递', courierCode: 'menu-express', apiKey: 'menu-secret-1234', status: 'normal' } },
      { module: 'approval-flow', payload: { name: '菜单巡检平台审批', menuKey: 'warehouse', levels: '平台直接审核', platformApproverId: platformApprover, status: 'disabled' } },
      { module: 'banners', payload: { name: '菜单巡检 Banner', image: './assets/backgrounds/banner-maintenance.png', target: '/service', sort: 20, status: 'normal' } },
      { module: 'faq-documents', payload: { name: '菜单巡检常见问题', titleEn: 'Menu FAQ', summary: 'PDF 配置巡检', pdfFile: '/documents/topflow-machine-manual-zh.pdf', fileName: 'menu-faq.pdf', sort: 20, status: 'published' } },
      { module: 'support-settings', payload: { name: '菜单巡检客服配置', audience: 'all', servicePhone: '400-800-2026', serviceEmail: 'service@shark.cn', serviceHours: '周一至周日 09:00-18:00', status: 'normal' } },
      { module: 'after-sales-types', payload: { name: '菜单巡检售后类型', audience: 'user', requiredFields: ['deviceSN', 'description'], responseSlaHours: 24, status: 'normal' } },
      { module: 'admins', payload: { account: 'menu-admin@shark.cn', initialPassword: 'Admin123!', name: '菜单巡检管理员', roleId: platformRole, ownerId: 'platform', status: 'normal' } },
    ]

    for (const item of cases) {
      const created = await mockService.create(item.module, item.payload)
      expect(created.code, `${item.module}/create: ${created.msg}`).toBe(200)
      expect(created.data?.id, item.module).toBeTruthy()
      const listed = await mockService.all(item.module)
      expect(listed.data.some((record) => record.id === created.data?.id), `${item.module}/list`).toBe(true)

      if (['dealers', 'material-catalog', 'couriers', 'approval-flow', 'banners', 'faq-documents', 'support-settings', 'after-sales-types', 'admins'].includes(item.module)) {
        const originalMembers = created.data?.memberNames
        const edited = await mockService.update(item.module, created.data!.id, { name: `${created.data!.name}（已编辑）` })
        expect(edited.code, `${item.module}/edit: ${edited.msg}`).toBe(200)
        expect(edited.data?.name).toContain('已编辑')
        if (item.module === 'approval-flow') expect(edited.data?.memberNames).toBe(originalMembers)
      }
    }

    const courier = useDatabaseStore().records('couriers').find((item) => item.courierCode === 'menu-express')!
    expect(courier.apiKey).toBeUndefined()
    expect(courier.apiKeyMasked).toBe('********1234')
    const device = useDatabaseStore().records('devices').find((item) => item.code === 'MENU-DEVICE-20260812')!
    expect(device).toMatchObject({ activation: 'inactive', bindingStatus: 'unbound', firmware: 'v1.0.0', status: 'offline' })
  })

  it('runs users, devices and projects through their configured operations', async () => {
    const database = useDatabaseStore()
    const user = (await mockService.all('users')).data.find((item) => item.status === 'normal')!
    const account = database.records('user-auth-accounts').find((item) => item.subjectId === user.id)!
    expect((await mockService.action('users', user.id, 'toggle', { reason: '全菜单巡检' })).data?.status).toBe('disabled')
    expect(database.records('user-auth-accounts').find((item) => item.id === account.id)?.status).toBe('disabled')
    expect((await mockService.action('users', user.id, 'reset-password', { reason: '全菜单巡检' })).code).toBe(200)

    const device = (await mockService.all('devices')).data.find((item) => item.status === 'online')!
    const changed = await mockService.action('devices', device.id, 'change-region', { country: '中国', region: '中国 · 江苏', reason: '全菜单巡检' })
    expect(changed.data?.region).toBe('中国 · 江苏')
    expect((await mockService.action('devices', device.id, 'remote-disable', { reason: '纯前端模拟巡检' })).data?.status).toBe('disabled')
    expect((await mockService.action('devices', device.id, 'remote-enable', { reason: '恢复演示设备' })).data?.status).toBe('online')
    expect(database.records('device-commands').some((item) => item.deviceId === device.id && item.result === 'simulated_success')).toBe(true)

    const project = (await mockService.all('projects')).data[0]
    expect((await mockService.update('projects', project.id, { shipOwner: '菜单巡检船东' })).data?.shipOwner).toBe('菜单巡检船东')
    expect((await mockService.create('projects', { name: '菜单巡检新增项目', deviceSN: device.code, shipOwner: '新增船东', usageRegion: '广东' })).code).toBe(200)
  })

  it('runs repair, message and complaint records through assignment, reply and completion', async () => {
    const dealer = (await mockService.options('dealers')).data[0]
    const assignee = (await mockService.options('assignees')).data.find((item) => item.value)
    const notificationsBefore = useDatabaseStore().records('notifications').length

    const repair = (await mockService.all('repairs')).data.find((item) => item.status === 'pending')!
    expect((await mockService.action('repairs', repair.id, 'assign', { assigneeId: dealer.value, reason: '菜单巡检分配' })).data?.status).toBe('processing')
    expect((await mockService.action('repairs', repair.id, 'reply', { replyContent: '菜单巡检回复' })).code).toBe(200)
    expect((await mockService.action('repairs', repair.id, 'complete', { result: '菜单巡检完成' })).data?.status).toBe('completed')

    const message = (await mockService.all('messages')).data.find((item) => item.status === 'pending')!
    expect((await mockService.action('messages', message.id, 'forward', { assigneeId: dealer.value, reason: '菜单巡检转发' })).data?.status).toBe('forwarded')
    expect((await mockService.action('messages', message.id, 'reply', { replyContent: '菜单巡检留言回复' })).data?.status).toBe('completed')

    const complaint = (await mockService.all('complaints')).data.find((item) => item.status === 'pending')!
    expect(assignee).toBeTruthy()
    expect((await mockService.action('complaints', complaint.id, 'assign', { assigneeId: assignee!.value, reason: '菜单巡检分配' })).data?.status).toBe('processing')
    expect((await mockService.action('complaints', complaint.id, 'reply', { replyContent: '菜单巡检投诉回复' })).code).toBe(200)
    expect((await mockService.action('complaints', complaint.id, 'complete', { result: '菜单巡检投诉完成' })).data?.status).toBe('completed')

    expect(useDatabaseStore().records('notifications').length).toBeGreaterThan(notificationsBefore)
  })

  it('runs dealer-only warranty, SN replacement and after-sales transfer flows', async () => {
    login('tier1@dealer.cn', 'Dealer123!')
    const auth = useAuthStore()
    const dealerId = auth.session!.ownerId
    const warranty = await mockService.create('warranty', { productType: '电池组 BP-03', dealerId, laborMonths: 18, materialMonths: 24, status: 'normal' })
    expect(warranty.code, warranty.msg).toBe(200)
    expect((await mockService.update('warranty', warranty.data!.id, { laborMonths: 20 })).data?.laborMonths).toBe(20)

    const original = (await mockService.all('devices')).data.find((item) => item.ownerId === dealerId && !String(item.code).endsWith('-1'))!
    const replacement = await mockService.create('sn-replacement', { originalSN: original.code, newSN: 'MENU-SN-20260812', replacementDeviceName: '前甲板备用淡化设备', replacementDeviceDescriptor: '海水淡化器 SW-04' })
    expect(replacement.code, replacement.msg).toBe(200)
    expect(replacement.data).toMatchObject({ originalDeviceModel: expect.any(String), originalDeviceType: expect.any(String), replacementDeviceName: '前甲板备用淡化设备', replacementDeviceModel: 'SW-04', replacementDeviceType: '水处理设备' })
    expect((await mockService.action('sn-replacement', replacement.data!.id, 'process', { reason: '菜单巡检换机' })).data?.status).toBe('completed')
    expect(useDatabaseStore().records('devices').find((item) => item.code === 'MENU-SN-20260812')).toMatchObject({ deviceName: '前甲板备用淡化设备', deviceModel: 'SW-04', deviceType: '水处理设备', name: '海水淡化器 SW-04' })
    expect(useDatabaseStore().records('devices').some((item) => item.code === `${original.code}-1` && item.bindingStatus === 'unbound')).toBe(true)

    const transferDevice = (await mockService.all('devices')).data.find((item) => item.ownerId === dealerId && item.code !== 'MENU-SN-20260812')!
    const target = (await mockService.options('service-target-dealers', { deviceSN: transferDevice.code })).data[0]
    expect(target).toBeTruthy()
    const transfer = await mockService.create('service-transfer', { deviceSN: transferDevice.code, targetDealerId: target.value, summary: '菜单巡检售后转移' })
    expect(transfer.code, transfer.msg).toBe(200)
    const targetAccount = useDatabaseStore().records('auth-accounts').find((item) => item.ownerId === target.value && item.status === 'normal')!
    login(String(targetAccount.account), String(targetAccount.password))
    expect((await mockService.action('service-transfer', transfer.data!.id, 'process', { decision: 'confirmed', reason: '菜单巡检接收' })).data?.status).toBe('completed')
    expect(useDatabaseStore().records('devices').find((item) => item.id === transferDevice.id)?.ownerId).toBe(target.value)
  })

  it('runs material request approval, shipping and issuance linkage across three roles', async () => {
    login('tier2@dealer.cn', 'Dealer123!')
    const material = (await mockService.options('active-materials')).data[0]
    const device = (await mockService.all('devices')).data[0]
    const request = await mockService.create('materials', { materialId: material.value, quantity: 1, deviceSN: device.code, category: '普通申请', summary: '全菜单巡检' })
    expect(request.code, request.msg).toBe(200)

    login('tier1@dealer.cn', 'Dealer123!')
    expect((await mockService.action('materials', request.data!.id, 'approve', { reason: '一级巡检通过' })).data?.status).toBe('pending')
    login()
    expect((await mockService.action('materials', request.data!.id, 'approve', { reason: '平台巡检通过' })).data?.status).toBe('approved')
    const courier = (await mockService.options('enabled-couriers')).data[0]
    expect((await mockService.action('materials', request.data!.id, 'ship', { courierId: courier.value, trackingNo: 'MENU-SHIP-20260812' })).data?.status).toBe('shipped')
    expect(useDatabaseStore().records('issuance').some((item) => item.sourceRequestId === request.data!.id && item.trackingNo === 'MENU-SHIP-20260812')).toBe(true)
  })

  it('reviews a cross-region installation and keeps the published FAQ PDF editable', async () => {
    const transfer = (await mockService.all('installation-transfers')).data.find((item) => item.status === 'pending')!
    const reviewed = await mockService.action('installation-transfers', transfer.id, 'process', { decision: 'approved', reason: '出厂与安装信息核验通过' })
    expect(reviewed.code, reviewed.msg).toBe(200)
    expect(reviewed.data).toMatchObject({ status: 'approved', reviewer: '林海' })

    const faq = (await mockService.all('faq-documents')).data.find((item) => item.status === 'published')!
    expect(faq.pdfFile).toMatch(/\.pdf$/)
    expect((await mockService.update('faq-documents', faq.id, { summary: '更新后的 PDF 说明' })).data?.summary).toBe('更新后的 PDF 说明')
  })

  it('updates fixed payment settings and role permissions while keeping audit modules immutable', async () => {
    const channel = (await mockService.all('payment-settings')).data.find((item) => item.category === '支付渠道')!
    expect((await mockService.action('payment-settings', channel.id, 'toggle', { reason: '菜单巡检开关' })).data?.status).toBe('disabled')
    const merchant = (await mockService.all('payment-settings')).data.find((item) => item.category === '商户配置')!
    expect((await mockService.update('payment-settings', merchant.id, { summary: '菜单巡检商户参数' })).data?.summary).toBe('菜单巡检商户参数')

    const role = (await mockService.all('roles')).data.find((item) => item.roleKey === 'custom')!
    const roleResult = await mockService.action('roles', role.id, 'permissions', { permissions: ['dashboard:view', 'repairs:view'] })
    expect(roleResult.data?.permissions).toEqual(['dashboard:view', 'repairs:view'])

    for (const module of ['payments', 'issuance', 'logs', 'users', 'devices', 'warehouse', 'ota', 'repairs', 'messages', 'complaints', 'materials', 'roles']) {
      const row = (await mockService.all(module)).data[0]
      expect(row, module).toBeTruthy()
      const result = await mockService.update(module, row.id, { name: '不应被写入' })
      expect(result.code, `${module} must be immutable`).toBe(405)
    }
  })

  it('rejects missing required fields and unsupported create operations at the service boundary', async () => {
    for (const module of ['dealers', 'devices', 'warehouse', 'ota', 'material-catalog', 'couriers', 'approval-flow', 'banners', 'admins']) {
      const result = await mockService.create(module, {})
      expect(result.code, `${module}: ${result.msg}`).toBe(422)
    }
    expect((await mockService.create('projects', { name: '缺少设备的项目' })).code).toBe(422)
    for (const module of ['users', 'repairs', 'messages', 'complaints', 'issuance', 'payments', 'roles', 'logs']) {
      expect((await mockService.create(module, { name: '不应创建' })).code, module).toBe(403)
    }
  })
})
