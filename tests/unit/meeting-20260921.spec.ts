import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { navGroups, moduleConfigs } from '@/config/modules'
import { parseProductFile } from '@/services/excel'
import { mockService } from '@/services/mock'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'

describe('2026-09-21 backend meeting changes', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    useAuthStore().login('admin@shark.cn', 'Admin123!')
  })

  it('puts approvals and purchasing in their own navigation groups', () => {
    expect(navGroups[1].items.map((item) => item.route)).toEqual(['approval-center'])
    expect(navGroups.find((group) => group.label === '采购管理')?.items.map((item) => item.route)).toEqual(['product-purchase', 'materials', 'material-catalog', 'contracts', 'purchase-shipping', 'couriers'])
    expect(navGroups.find((group) => group.label === '财务与支付')?.items.some((item) => item.route === 'contracts')).toBe(true)
    expect(moduleConfigs['sn-replacement'].title).toBe('维修物料替换')
    expect(moduleConfigs.warehouse.fields.find((field) => field.field === 'warehouseLocationId')?.required).toBeFalsy()
    expect(moduleConfigs.warehouse.tabs[0]).toMatchObject({ key: 'stock', label: '设备入库', field: 'category', value: '在库' })
    for (const route of ['warehouses', 'warehouse-locations', 'warehouse']) {
      expect(moduleConfigs[route].eyebrow).toBe('仓储与物料')
    }
    expect(moduleConfigs['material-catalog'].eyebrow).toBe('采购管理')
    expect(moduleConfigs['product-purchase'].tabs.slice(0, 2).map((tab) => tab.label)).toEqual(['全部订单', '销售订单审批'])
  })

  it('lets headquarters monitor dealer-owned repairs and reply only after return', async () => {
    const database = useDatabaseStore()
    const repair = database.records('repairs').find((item) => item.domain === 'cn' && item.status === 'processing' && item.ownerId !== 'platform')!
    expect(repair).toBeTruthy()
    expect(mockService.canAction('repairs', repair, 'reply')).toMatchObject({ allowed: false, code: 403 })
    expect((await mockService.action('repairs', repair.id, 'reply', { replyContent: '总部越权回复' })).code).toBe(403)
    expect((await mockService.action('repairs', repair.id, 'complete', { result: '总部越权完结' })).code).toBe(403)
    expect((await mockService.get('repairs', repair.id)).code).toBe(200)
    expect((await mockService.action('repairs', repair.id, 'escalate', { reason: '转回总部处理' })).data?.ownerId).toBe('platform')
    expect(mockService.canAction('repairs', database.records('repairs').find((item) => item.id === repair.id)!, 'reply').allowed).toBe(true)
    expect((await mockService.action('repairs', repair.id, 'reply', { replyContent: '总部接手回复' })).code).toBe(200)
  })

  it('keeps dealer handling available for its own repair', async () => {
    const database = useDatabaseStore()
    const repair = database.create('repairs', { code: 'REP-DEALER-MEETING', name: '经销商维修', status: 'processing', ownerId: 'dealer-t2-xm', owner: '二级经销商', domain: 'cn' })
    useAuthStore().logout()
    useAuthStore().login('tier2@dealer.cn', 'Dealer123!')
    expect(mockService.canAction('repairs', repair, 'reply').allowed).toBe(true)
    expect((await mockService.action('repairs', repair.id, 'reply', { replyContent: '经销商处理进度' })).code).toBe(200)
  })

  it('separates unsold inventory from sold device lists, counts, details and exports', async () => {
    const database = useDatabaseStore()
    const inventory = database.records('devices').find((item) => item.inventoryStatus === 'in_stock' && item.domain === 'cn')!
    expect(inventory).toBeTruthy()
    expect((await mockService.inventoryDevices()).data.some((item) => item.id === inventory.id)).toBe(true)
    expect((await mockService.all('devices')).data.some((item) => item.id === inventory.id)).toBe(false)
    expect((await mockService.get('devices', inventory.id)).code).toBe(404)
    expect((await mockService.exportRows('devices', { pageNum: 1, pageSize: 100 })).data.some((item) => item.id === inventory.id)).toBe(false)
    expect(await mockService.count('devices')).toBe((await mockService.all('devices')).data.length)
  })

  it('previews duplicate product rows and imports valid prices atomically', async () => {
    const existing = (await mockService.all('product-catalog')).data
    const csv = new File([
      '产品编号,产品名称,设备类型,设备型号,规格,终端零售价,一级经销商价\n'
      + 'PROD-MEETING-01,测试设备,船载设备,MEETING-01,24V,80000,65000\n'
      + 'PROD-MEETING-02,重复型号,船载设备,MEETING-01,24V,90000,70000',
    ], 'products.csv', { type: 'text/csv' })
    const rows = await parseProductFile(csv, existing)
    expect(rows[0]).toMatchObject({ row: 2, valid: true, retailPrice: 80000, tier1Price: 65000 })
    expect(rows[1].error).toContain('文件内重复')
    const created = await mockService.importProducts(rows.filter((row) => row.valid))
    expect(created.code).toBe(200)
    expect(created.data[0]).toMatchObject({ tier1Price: 65000, retailPrice: 80000, referencePrice: 65000 })
    const renamed = await mockService.update('product-catalog', created.data[0].id, { retailPriceName: '门店建议价', tier1PriceName: '渠道采购价', retailPrice: 82000 })
    expect(renamed.data).toMatchObject({ retailPriceName: '门店建议价', tier1PriceName: '渠道采购价', retailPrice: 82000, tier1Price: 65000 })
    expect(useDatabaseStore().records('price-history').some((item) => item.productId === created.data[0].id && item.priceType === '终端零售价' && item.newPrice === 82000)).toBe(true)
    const before = useDatabaseStore().records('product-catalog').length
    expect((await mockService.importProducts([rows[0]])).code).toBe(409)
    expect(useDatabaseStore().records('product-catalog')).toHaveLength(before)
  })

  it('rejects overlapping QR assignments and resolves a single code for an order dealer', async () => {
    const dealer = useDatabaseStore().records('dealers').find((item) => item.domain === 'cn' && item.status === 'normal')!
    const dealerId = String(dealer.organizationId || dealer.ownerId)
    const payload = { category: '供应商收款码', supplierName: '会议测试供应商', name: '会议测试收款码', accountName: '测试收款户', qrCodeData: 'data:image/png;base64,AA==', dealerIds: [dealerId], status: 'normal' }
    const created = await mockService.create('payment-settings', { ...payload, code: 'QR-MEETING-01' })
    expect(created.code, created.msg).toBe(200)
    expect((await mockService.paymentQrForOrder(dealerId)).data?.code).toBe('QR-MEETING-01')
    expect((await mockService.create('payment-settings', { ...payload, code: 'QR-MEETING-02' })).code).toBe(422)
    expect((await mockService.exportRows('payment-settings', { pageNum: 1, pageSize: 100 })).data.find((item) => item.id === created.data?.id)?.qrCodeData).toBeUndefined()
    const parent = useDatabaseStore().create('payments', { code: 'PAY-MEETING-01', name: '会议订单', category: '二维码支付', orderAmount: 1000, amount: 1000, paidAmount: 0, remainingAmount: 1000, paymentCount: 0, dealerId, status: 'pending', ownerId: dealerId, domain: 'cn' })
    const verified = await mockService.action('payments', parent.id, 'finance-verify', { paidAmount: 300, paymentProof: 'data:image/png;base64,AA==', paymentReference: 'MEETING-REF-01', paidAt: '2026-09-21', verificationNote: '对账测试' })
    expect(verified.code, verified.msg).toBe(200)
    expect(verified.data).toMatchObject({ paymentQrCode: 'QR-MEETING-01', paidAmount: 300 })
    expect(useDatabaseStore().records('payment-transactions').find((item) => item.paymentId === parent.id)).toMatchObject({ paymentQrCode: 'QR-MEETING-01', currentPaymentAmount: 300 })
  })

  it('keeps new overseas product prices in the overseas data domain and currency', async () => {
    useAuthStore().setDomain('global')
    const imported = await mockService.importProducts([{ code: 'PROD-GLOBAL-MEETING', name: '海外设备', deviceType: '船载设备', deviceModel: 'GLOBAL-MEETING', specification: '24V', retailPrice: 1000, tier1Price: 800 }])
    expect(imported.code).toBe(200)
    expect(imported.data[0]).toMatchObject({ domain: 'global', currency: 'USD' })
    expect((await mockService.exportRows('product-catalog', { pageNum: 1, pageSize: 100 })).data.some((item) => item.code === 'PROD-GLOBAL-MEETING')).toBe(true)
    useAuthStore().setDomain('cn')
    expect((await mockService.all('product-catalog')).data.some((item) => item.code === 'PROD-GLOBAL-MEETING')).toBe(false)
  })

  it('keeps overseas currency on purchase expenses and payment installments', async () => {
    useAuthStore().setDomain('global')
    const database = useDatabaseStore()
    const purchase = database.create('materials', {
      code: 'PUR-GLOBAL-MEETING', name: '海外采购', category: '设备采购',
      purchaseStage: 'finance_confirmation', status: 'approved', amount: 1000, orderAmount: 1000,
      paidAmount: 0, currency: 'USD', ownerId: 'platform', owner: '平台中心', domain: 'global',
    })
    const confirmed = await mockService.action('product-purchase', purchase.id, 'finance-confirm', {
      paidAmount: 300, paymentProof: 'data:image/png;base64,AA==', paymentReference: 'GLOBAL-PUR-REF',
      paidAt: '2026-09-21', warehouseDecision: 'hold', contractStatus: '无需合同', paymentNote: '海外付款',
    })
    expect(confirmed.code, confirmed.msg).toBe(200)
    expect(confirmed.data).toMatchObject({ currency: 'USD', paidAmount: 300 })
    expect(String(confirmed.data?.purchaseStageLabel)).toContain('$300')
    expect(database.records('expense-records').find((item) => item.subjectId === purchase.id)).toMatchObject({ currency: 'USD', amount: 300 })
    const bill = database.records('payments').find((item) => item.subjectId === purchase.id)!
    expect(bill).toMatchObject({ currency: 'USD', amount: 1000, paidAmount: 300, remainingAmount: 700 })
    expect(database.records('payment-transactions').find((item) => item.paymentId === bill.id)).toMatchObject({ currency: 'USD' })

    const parent = database.create('payments', {
      code: 'PAY-GLOBAL-MEETING', name: '海外分期账单', orderAmount: 1000, amount: 1000,
      paidAmount: 0, remainingAmount: 1000, paymentCount: 0, currency: 'USD',
      status: 'pending', ownerId: 'platform', owner: '平台中心', domain: 'global',
    })
    const verified = await mockService.action('payments', parent.id, 'finance-verify', {
      paidAmount: 200, paymentProof: 'data:image/png;base64,AA==', paymentReference: 'GLOBAL-PAY-REF',
      paidAt: '2026-09-21', verificationNote: '海外核实',
    })
    expect(verified.code, verified.msg).toBe(200)
    expect(verified.data).toMatchObject({ currency: 'USD', paidAmount: 200 })
    expect(database.records('payment-transactions').find((item) => item.paymentId === parent.id)).toMatchObject({ currency: 'USD', currentPaymentAmount: 200 })
  })
})
