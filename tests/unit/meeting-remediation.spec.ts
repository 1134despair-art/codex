import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mockService } from '@/services/mock'
import { moduleConfigs } from '@/config/modules'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'

describe('meeting gap remediation', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    useAuthStore().login('admin@shark.cn', 'Admin123!')
  })

  it('keeps exactly one protected super administrator', async () => {
    const database = useDatabaseStore()
    const superAdmins = database.records('admins').filter((item) => item.isSuperAdmin)
    expect(superAdmins).toHaveLength(1)
    expect(superAdmins[0].accountLevel).toBe('超级管理员')
    const disabled = await mockService.action('admins', superAdmins[0].id, 'toggle', { reason: '自动化校验' })
    expect(disabled.code).toBe(409)
    expect(database.records('admins').find((item) => item.id === superAdmins[0].id)?.status).toBe('normal')
    expect(database.records('logs').some((item) => item.result === 'failed' && item.subjectId === superAdmins[0].id)).toBe(true)
  })

  it('generates unique device identity mapping without manual input', async () => {
    const warehouseId = useDatabaseStore().records('warehouses').find((item) => item.status === 'normal' && item.domain === 'cn')!.id
    const inbound = await mockService.create('warehouse', { category: '在库', deviceSN: 'AUTO-ID-20260821', deviceModel: '制冰机 CI-02', region: '中国 · 广东', warehouseId })
    expect(inbound.code, inbound.msg).toBe(200)
    expect(useDatabaseStore().records('devices').find((item) => item.code === 'AUTO-ID-20260821')).toMatchObject({
      communicationId: 'COMM-ID20260821', chipId: 'CHIP-ID20260821',
      mainboardSerial: 'MB-ID20260821', coreComponentSerials: 'CORE-ID20260821',
      status: 'offline', inventoryStatus: 'in_stock', ownerId: 'platform',
    })
  })

  it('records product and material price changes without rewriting history', async () => {
    const database = useDatabaseStore()
    expect(database.records('product-catalog').map((item) => item.descriptor)).toEqual(expect.arrayContaining([
      '顶流机 TF-01', '制冰机 CI-02', '海水淡化器 SW-04', '电池组 BP-03', '网络检测仪 ND-04',
    ]))
    const product = database.records('product-catalog')[0]
    const productUpdate = await mockService.update('product-catalog', product.id, { referencePrice: Number(product.referencePrice) + 1000 })
    expect(productUpdate.code).toBe(200)
    expect(database.records('price-history').some((item) => item.productId === product.id && item.oldPrice !== item.newPrice)).toBe(true)

    const material = database.records('material-catalog')[0]
    expect((await mockService.update('material-catalog', material.id, { price: Number(material.price) + 10 })).code).toBe(200)
    expect(database.records('price-history').some((item) => item.productId === material.id)).toBe(true)
  })

  it('records OTA simulation results and rollback history', async () => {
    const database = useDatabaseStore()
    const created = await mockService.create('ota', { name: '9.9.1', applicableProductNames: ['制冰机'], applicableDeviceTypes: ['制冷设备'], applicableDeviceModels: ['CI-02'], summary: '产品型号联动测试', firmwareFile: 'ci-9.9.1.bin', forceUpdate: false, status: 'draft' })
    expect(created.code, created.msg).toBe(200)
    expect(created.data).toMatchObject({ applicableProductSummary: '制冰机', applicableTypeSummary: '制冷设备', applicableModelSummary: 'CI-02' })
    expect(created.data).not.toHaveProperty('compatibleModel')
    expect(created.data).not.toHaveProperty('releaseScope')
    expect((await mockService.action('ota', created.data!.id, 'publish', { reason: '发布演示' })).code).toBe(200)
    const results = database.records('ota-results').filter((item) => item.firmwareId === created.data!.id)
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((item) => item.deviceModel === 'CI-02')).toBe(true)
    expect((await mockService.action('ota', created.data!.id, 'rollback', { targetVersion: '2.3.7', reason: '回归稳定版本' })).code).toBe(200)
    expect(database.records('ota-rollbacks').some((item) => item.firmwareId === created.data!.id)).toBe(true)
  })

  it('separates startup splash configuration from first-install onboarding', () => {
    const launch = useDatabaseStore().records('launch-settings')[0]
    expect(launch).toMatchObject({ onboardingEnabled: true, onboardingRevision: 'onboarding-v1' })
    expect(launch.onboardingPages).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: expect.any(String), summary: expect.any(String), durationMs: expect.any(Number) }),
    ]))
    expect((launch.onboardingPages as unknown[]).length).toBeGreaterThanOrEqual(3)
  })

  it('requires a matching repair order and part identities before completing replacement', async () => {
    const database = useDatabaseStore()
    const repairs = database.records('repairs')
    const issuance = database.records('issuance').find((item) => ['shipped', 'received'].includes(item.status) && repairs.some((repair) => repair.deviceSN === item.deviceSN))!
    const repair = repairs.find((item) => item.deviceSN === issuance.deviceSN)!
    if (issuance.status === 'shipped') {
      expect((await mockService.action('issuance', issuance.id, 'complete-replacement', {
        repairId: repair.id, oldPartSerial: 'OLD-001', newPartSerial: 'NEW-001', reason: '未签收',
      })).code).toBe(409)
      expect((await mockService.action('issuance', issuance.id, 'confirm-receipt', { reason: '已签收' })).code).toBe(200)
    }
    const invalid = await mockService.action('issuance', issuance.id, 'complete-replacement', { oldPartSerial: 'PART-001', newPartSerial: 'PART-001', reason: '测试' })
    expect(invalid.code).toBe(422)
    const completed = await mockService.action('issuance', issuance.id, 'complete-replacement', { repairId: repair.id, oldPartSerial: 'OLD-001', newPartSerial: 'NEW-001', reason: '故障件更换' })
    expect(completed.code).toBe(200)
    expect(database.records('replacement-records')).toContainEqual(expect.objectContaining({ issuanceId: issuance.id, repairId: repair.id, repairCode: repair.code }))
    expect(database.records('repairs').find((item) => item.id === repair.id)).toMatchObject({ hasReplacement: true, replacementNote: 'OLD-001 → NEW-001' })
  })

  it('creates a cross-region installation review from the project data flow', async () => {
    const database = useDatabaseStore()
    const device = database.records('devices').find((item) => item.region && item.ownerId !== 'platform')!
    database.update('devices', device.id, { activation: 'inactive', activationDate: '' })
    const created = await mockService.create('projects', {
      name: '跨区安装自动化项目',
      deviceSN: device.code,
      shipOwner: '测试船东',
      customerPhone: '13800000001',
      installationRegion: '中国 · 海南',
      summary: '验证出厂地区与实际安装地区不一致时自动送审',
    })
    expect(created.code, created.msg).toBe(200)
    expect(created.data).toMatchObject({ factoryRegion: device.region, installationRegion: '中国 · 海南', crossRegionStatus: 'pending', status: 'pending' })
    const transfer = database.records('installation-transfers').find((item) => item.projectId === created.data!.id)!
    expect(transfer).toEqual(expect.objectContaining({
      projectId: created.data!.id,
      factoryRegion: device.region,
      installationRegion: '中国 · 海南',
      temporaryUseStatusLabel: '48 小时临时可用',
      status: 'pending',
    }))
    expect(new Date(String(transfer.reviewDeadline)).getTime() - new Date(String(transfer.submittedAt)).getTime()).toBe(48 * 60 * 60 * 1000)
    expect(database.records('devices').find((item) => item.id === device.id)).toMatchObject({ activation: 'inactive', activationReviewStatus: 'pending', temporaryOperationUntil: transfer.reviewDeadline })
    const approved = await mockService.action('installation-transfers', transfer.id, 'process', { decision: 'approved', reason: '地区和安装资料核验通过' })
    expect(approved.code, approved.msg).toBe(200)
    expect(approved.data).toMatchObject({ status: 'approved', temporaryUseStatusLabel: '审核通过，正式启用' })
    expect(database.records('devices').find((item) => item.id === device.id)).toMatchObject({ activation: 'activated', activationReviewStatus: 'approved' })
  })

  it('cascades device type, model and SN options and removes redundant stock navigation', async () => {
    const typeOptions = (await mockService.options('device-types')).data
    expect(typeOptions.some((item) => item.value === '制冷设备')).toBe(true)
    const modelOptions = (await mockService.options('device-models', { deviceType: '制冷设备' })).data
    expect(modelOptions.length).toBeGreaterThan(0)
    expect(modelOptions.every((item) => item.value === 'CI-02')).toBe(true)
    const snOptions = (await mockService.options('accessible-devices', { deviceType: '制冷设备', deviceModel: 'CI-02' })).data
    expect(snOptions.length).toBeGreaterThan(0)
    expect(snOptions.every((item) => item.label.includes('制冷设备') && item.label.includes('CI-02'))).toBe(true)
    expect(moduleConfigs.warehouse.tabFilters?.stock?.map((field) => field.field).slice(0, 3)).toEqual(['deviceType', 'deviceModel', 'deviceSN'])

    const database = useDatabaseStore()
    const stock = database.records('warehouse').find((item) => item.category === '在库')!
    const navigation = await mockService.relatedNavigation('warehouse', [stock.id])
    expect(navigation.data[stock.id]?.some((item) => item.label === '查看涉及设备')).toBe(false)
  })

  it('uses a controlled region dictionary and hides the parent field for tier-one dealers', async () => {
    const fields = moduleConfigs.dealers.fields
    expect(fields.some((field) => field.field === 'linkedUserId')).toBe(false)
    expect(fields).toContainEqual(expect.objectContaining({ field: 'region', optionSource: 'dealer-regions', type: 'select' }))
    expect(fields).toContainEqual(expect.objectContaining({ field: 'parentDealerId', visibleWhen: { field: 'tier', value: '二级' } }))
    expect((await mockService.options('dealer-regions')).data.map((item) => item.value)).toContain('中国 · 海南')

    const created = await mockService.create('dealers', {
      account: 'area@dealer.cn',
      initialPassword: 'Dealer123!',
      name: '区域字典演示经销商',
      region: '中国 · 海南',
      tier: '一级',
      parentDealerId: 'dealer-t1-sz',
      defaultWarrantyYears: 2,
      phone: '13800138000',
      status: 'normal',
    })
    expect(created.code, created.msg).toBe(200)
    expect(created.data).toMatchObject({ parentDealerId: '', parentDealer: '-', defaultWarrantyYears: 2 })
    expect(await mockService.create('dealers', { account: 'bad@dealer.cn', initialPassword: 'Dealer123!', name: '无效地区经销商', region: '手动填写地区', tier: '一级', defaultWarrantyYears: 2, phone: '13800138001', status: 'normal' })).toMatchObject({ code: 422, msg: '请选择区域字典中的有效负责地区' })
  })

  it('calculates material warranty from the owning dealer and device activation date', async () => {
    const database = useDatabaseStore()
    const device = database.records('devices').find((item) => item.ownerId !== 'platform' && item.activation === 'activated')!
    const dealer = database.records('dealers').find((item) => String(item.organizationId || item.ownerId) === device.ownerId)!
    database.update('dealers', dealer.id, { defaultWarrantyYears: 1 })
    database.update('devices', device.id, { activationDate: '2020-01-01' })
    for (const rule of database.records('warranty').filter((item) => String(item.dealerId || item.ownerId) === device.ownerId && (item.productType === device.name || item.category === device.name))) database.update('warranty', rule.id, { status: 'disabled' })
    const material = database.records('material-catalog').find((item) => item.status !== 'disabled')!
    const resolved = await mockService.resolveFields('materials', { materialId: material.id, quantity: 1, deviceSN: device.code, category: '提前申请' })
    expect(resolved.data).toMatchObject({ warrantyResult: '已过期，需自费', warrantyStartDate: '2020-01-01', warrantyUntil: '2021-01-01' })
  })

  it('keeps waypoints server-only and exposes document health plus after-sales configuration', () => {
    const database = useDatabaseStore()
    expect(database.records('waypoints').every((item) => item.serverSaved === true && item.storageMode === 'server' && item.adminVisible === true)).toBe(true)
    expect(database.records('users').every((user) => database.records('waypoints').some((item) => item.userId === user.id))).toBe(true)
    expect(database.records('support-settings').some((item) => item.status === 'normal' && item.servicePhone && item.serviceEmail)).toBe(true)
    expect(database.records('after-sales-types').every((item) => Array.isArray(item.requiredFields) && Number(item.responseSlaHours) > 0)).toBe(true)
    expect(database.records('faq-documents').some((item) => item.fileStatus === 'invalid' && item.status === 'disabled' && item.fileError)).toBe(true)
  })

  it('creates multi-item purchase details and matching platform bill items', async () => {
    const auth = useAuthStore()
    const database = useDatabaseStore()
    const product = database.records('product-catalog')[0]
    const material = database.records('material-catalog')[0]
    const expected = Number(product.referencePrice) + Number(material.price) * 2

    auth.logout()
    auth.login('tier2@dealer.cn', 'Dealer123!')
    const created = await mockService.create('materials', {
      category: '设备采购',
      purchaseItems: [
        { itemKey: `product:${product.id}`, quantity: 1, unitPrice: product.referencePrice },
        { itemKey: `material:${material.id}`, quantity: 2, unitPrice: material.price },
      ],
      summary: '设备及随船备件整单采购',
    })
    expect(created.code, created.msg).toBe(200)
    expect(created.data).toMatchObject({ amount: expected, quantity: 3, deviceModel: '多项采购（2 项）' })
    expect(database.records('purchase-items').filter((item) => item.subjectId === created.data!.id)).toHaveLength(2)

    auth.logout()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    expect((await mockService.action('materials', created.data!.id, 'approve', { reason: '一级经销商确认' })).code).toBe(200)
    auth.logout()
    auth.login('admin@shark.cn', 'Admin123!')
    expect((await mockService.action('materials', created.data!.id, 'approve', { reason: '平台终审' })).data?.status).toBe('approved')

    expect((await mockService.action('materials', created.data!.id, 'start-production', {
      productionBatchNo: 'MULTI-PROD-001', productionAt: '2026-08-21', reason: '导入生产',
    })).code).toBe(200)
    expect((await mockService.action('materials', created.data!.id, 'complete-production', {
      productionCompletedAt: '2026-08-21', reason: '生产完成',
    })).code).toBe(200)

    const paidAmount = expected - 100
    expect((await mockService.action('materials', created.data!.id, 'record-expense', {
      paidAmount, paymentProof: 'data:image/png;base64,AA==', paymentReference: 'MULTI-RELEASE-REJECT',
      paidAt: '2026-08-21', warehouseDecision: 'release',
    })).code).toBe(409)
    const recorded = await mockService.action('materials', created.data!.id, 'record-expense', {
      paidAmount, paymentProof: 'data:image/png;base64,AA==', paymentReference: 'MULTI-PURCHASE-001', paidAt: '2026-08-21', paymentNote: '财务核实通过',
    })
    expect(recorded.code, recorded.msg).toBe(200)
    expect(recorded.data).toMatchObject({ purchaseStage: 'finance_confirmation', remainingAmount: 100 })
    const payment = database.records('payments').find((item) => item.subjectId === created.data!.id)!
    const billItems = database.records('billing-items').filter((item) => item.paymentId === payment.id)
    expect(billItems).toHaveLength(2)
    expect(billItems.reduce((sum, item) => sum + Number(item.subtotal) + Number(item.adjustment), 0)).toBe(expected)
  })

  it('imports validated material master data without a backend', async () => {
    const response = await mockService.importMaterials([{ materialCode: 'MAT-AUTO-001', name: '自动化导入密封组件', category: '制冰机 CI-02', price: 188, stock: 12 }])
    expect(response.code, response.msg).toBe(200)
    expect(useDatabaseStore().records('material-catalog')).toContainEqual(expect.objectContaining({ materialCode: 'MAT-AUTO-001', stock: 12, status: 'normal' }))
  })

  it('records a repair bill with labor, material and adjustment details', async () => {
    const database = useDatabaseStore()
    const repair = database.records('repairs').find((item) => item.status === 'completed')!
    const response = await mockService.action('repairs', repair.id, 'record-bill', {
      laborHours: 2.5, laborUnitPrice: 180, materialAmount: 360, adjustment: -10, billingNote: '维修费用待用户扫码支付',
    })
    expect(response.code, response.msg).toBe(200)
    expect(response.data).toMatchObject({ billingAmount: 800, billingStatus: 'pending' })
    const payment = database.records('payments').find((item) => item.subjectId === repair.id && item.subjectModule === 'repairs')!
    const items = database.records('billing-items').filter((item) => item.paymentId === payment.id)
    expect(items.map((item) => item.feeType).sort()).toEqual(['人工费', '物料费'].sort())
    expect(items.reduce((sum, item) => sum + Number(item.subtotal) + Number(item.adjustment), 0)).toBe(800)
    expect(payment).toMatchObject({ channel: '二维码支付', status: 'pending', orderAmount: 800, remainingAmount: 800 })
    expect((await mockService.action('repairs', repair.id, 'record-bill', { laborHours: 1, laborUnitPrice: 1 })).code).toBe(409)
  })

  it('allows complaints to return to headquarters with an audit trail', async () => {
    const database = useDatabaseStore()
    const complaint = database.records('complaints').find((item) => ['pending', 'processing'].includes(item.status))!
    const response = await mockService.action('complaints', complaint.id, 'escalate', { reason: '需总部统一协调' })
    expect(response.code, response.msg).toBe(200)
    expect(response.data).toMatchObject({ status: 'processing', ownerId: 'platform', owner: '总部售后中心' })
    expect(database.records('workflow-events')).toContainEqual(expect.objectContaining({ subjectId: complaint.id, content: '需总部统一协调' }))
  })
})
