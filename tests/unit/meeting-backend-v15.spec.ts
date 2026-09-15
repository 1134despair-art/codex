import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mockService } from '@/services/mock'
import { moduleConfigs } from '@/config/modules'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'

describe('2026-09-01 meeting backend requirements', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('keeps products, warehouses, locations and stocked devices in one consistent model', async () => {
    const auth = useAuthStore()
    auth.login('admin@shark.cn', 'Admin123!')
    const database = useDatabaseStore()

    expect(database.database.version).toBe(15)
    expect(database.records('product-catalog').every((item) => item.deviceType && item.deviceModel && item.specification)).toBe(true)
    expect(database.records('warehouses').length).toBeGreaterThanOrEqual(3)
    expect(database.records('warehouse-locations').every((item) => database.records('warehouses').some((warehouse) => warehouse.id === item.warehouseId))).toBe(true)

    const warehouse = database.records('warehouses').find((item) => item.domain === 'cn' && item.status === 'normal')!
    const location = database.records('warehouse-locations').find((item) => item.warehouseId === warehouse.id && item.status === 'normal')!
    const created = await mockService.create('warehouse', {
      category: '在库', deviceSN: 'MEETING-STOCK-001', deviceModel: '制冰机 CI-02', region: '中国 · 广东',
      warehouseId: warehouse.id, warehouseLocationId: location.id,
    })
    expect(created.code, created.msg).toBe(200)
    expect(created.data).toMatchObject({ warehouseId: warehouse.id, warehouseLocationId: location.id, deviceType: '制冷设备', deviceModel: 'CI-02', specification: '220V · 60kg/日' })
    expect(database.records('devices').find((item) => item.code === 'MEETING-STOCK-001')).toMatchObject({ warehouseId: warehouse.id, warehouseLocationId: location.id, inventoryStatus: 'in_stock' })
  })

  it('runs device procurement through business, finance and warehouse shipment without skipping nodes', async () => {
    const auth = useAuthStore()
    const database = useDatabaseStore()
    auth.login('admin@shark.cn', 'Admin123!')
    const inStock = database.records('devices').find((item) => item.domain === 'cn' && item.inventoryStatus === 'in_stock' && item.ownerId === 'platform')!
    expect(inStock).toBeTruthy()
    const descriptor = String(inStock.name)
    const warehouseId = String(inStock.warehouseId)
    const targetOwnerId = 'dealer-t2-xm'

    auth.logout()
    auth.login('tier2@dealer.cn', 'Dealer123!')
    const created = await mockService.create('materials', {
      category: '设备采购',
      purchaseItems: [{ itemKey: `descriptor:${descriptor}`, quantity: 1, unitPrice: 88000 }],
      summary: '客户会议采购全链路验证',
    })
    expect(created.code, created.msg).toBe(200)
    expect(created.data).toMatchObject({ purchaseStage: 'business_confirmation', purchaseStageLabel: '待业务确认', initiatedBy: '李明', contractStatus: '待确认' })
    expect((await mockService.action('materials', created.data!.id, 'finance-confirm', {})).code).toBe(403)

    auth.logout()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    const tier1Pending = (await mockService.get('materials', created.data!.id)).data!
    expect(tier1Pending).toMatchObject({ status: 'pending' })
    expect((await mockService.action('materials', tier1Pending.id, 'approve', { reason: '一级业务确认' })).code).toBe(200)

    auth.logout()
    auth.login('admin@shark.cn', 'Admin123!')
    const platformPending = (await mockService.all('approval-center')).data.find((item) => item.subjectId === created.data!.id)!
    expect(platformPending.status).toBe('pending')
    const businessConfirmed = await mockService.action('approval-center', platformPending.id, 'approve-original', { reason: '平台业务确认' })
    expect(businessConfirmed.data).toMatchObject({ status: 'approved', purchaseStage: 'finance_confirmation', purchaseStageLabel: '待财务确认' })
    expect((await mockService.action('materials', created.data!.id, 'purchase-ship', {})).code).toBe(409)

    const financed = await mockService.action('materials', created.data!.id, 'finance-confirm', {
      contractStatus: '已签订', contractNo: 'CONTRACT-MEETING-001', paidAmount: 88000,
      paymentMethod: '对公转账', paymentReference: 'BANK-MEETING-001', paidAt: '2026-09-02', paymentNote: 'Demo 财务确认',
    })
    expect(financed.code, financed.msg).toBe(200)
    expect(financed.data).toMatchObject({ status: 'approved', purchaseStage: 'warehouse_fulfillment', purchaseStageLabel: '待仓库发货', contractStatus: '已签订' })

    const shipped = await mockService.action('materials', created.data!.id, 'purchase-ship', {
      selectedDevices: [inStock.code], warehouseId, deliveryMethod: '物流配送', deliveryReference: 'SF-MEETING-001', shippedAt: '2026-09-02', reason: '仓库确认发货',
    })
    expect(shipped.code, shipped.msg).toBe(200)
    expect(shipped.data).toMatchObject({ status: 'shipped', purchaseStage: 'shipped', purchaseStageLabel: '已发货', deliveryStatus: '已发货' })
    expect(database.records('devices').find((item) => item.id === inStock.id)).toMatchObject({ ownerId: targetOwnerId, inventoryStatus: 'outbound', warehouseId: '', warehouseLocationId: '' })
    expect(database.records('warehouse').some((item) => item.category === '在库' && item.deviceSN === inStock.code)).toBe(false)
    expect(database.records('ownership-history')).toContainEqual(expect.objectContaining({ deviceSN: inStock.code, operationType: '设备出库', toOwnerId: targetOwnerId }))
    expect(database.records('purchase-fulfillments')).toContainEqual(expect.objectContaining({ subjectId: created.data!.id, deviceSN: inStock.code, warehouseId }))
    expect(database.records('payments')).toContainEqual(expect.objectContaining({ subjectId: created.data!.id, amount: 88000, sourceType: 'platform' }))
  })

  it('redacts production and central warehouse fields for dealer views, relations and exports', async () => {
    const auth = useAuthStore()
    auth.login('admin@shark.cn', 'Admin123!')
    const database = useDatabaseStore()
    const dealerDevice = database.records('devices').find((item) => item.ownerId === 'dealer-t1-sz' && item.domain === 'cn')!
    database.update('devices', dealerDevice.id, { warehouseName: '平台中心仓', warehouseLocation: 'A 区 01-01', manufacturedAt: '2026-07-01', inboundAt: '2026-07-02' })
    database.create('ownership-history', { name: dealerDevice.name, deviceId: dealerDevice.id, deviceSN: dealerDevice.code, fromOwner: '平台中心仓', toOwner: dealerDevice.owner, warehouseName: '平台中心仓', manufacturedAt: '2026-07-01', operationType: '设备出库', status: 'completed', owner: dealerDevice.owner, ownerId: dealerDevice.ownerId, domain: dealerDevice.domain })
    expect((await mockService.get('devices', dealerDevice.id)).data).toMatchObject({ warehouseName: '平台中心仓', manufacturedAt: '2026-07-01' })

    auth.logout()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    const dealerView = (await mockService.get('devices', dealerDevice.id)).data!
    expect(dealerView).not.toHaveProperty('warehouseName')
    expect(dealerView).not.toHaveProperty('manufacturedAt')
    const history = (await mockService.related('devices', dealerDevice.id, 'ownership-history')).data
    expect(history[0]).not.toHaveProperty('warehouseName')
    expect(history[0]).not.toHaveProperty('manufacturedAt')
    expect(history[0].fromOwner).toBe('平台仓储')
    const exported = (await mockService.exportRows('devices', { pageNum: 1, pageSize: 100, relationFilters: { id: dealerDevice.id } })).data
    expect(exported[0]).not.toHaveProperty('warehouseName')
    expect(exported[0]).not.toHaveProperty('manufacturedAt')
  })

  it('derives device type and model from the same SN across every device business view', async () => {
    const auth = useAuthStore()
    auth.login('admin@shark.cn', 'Admin123!')
    const database = useDatabaseStore()
    const linkedModules = ['projects', 'repairs', 'complaints', 'materials', 'service-transfer', 'installation-transfers', 'issuance']

    for (const moduleKey of linkedModules) {
      const source = database.records(moduleKey).find((item) => {
        const sn = String(item.deviceSN || '')
        return database.records('devices').some((device) => device.code === sn)
      })
      expect(source, `${moduleKey} 缺少可校验的设备关联种子数据`).toBeTruthy()
      const device = database.records('devices').find((item) => item.code === source!.deviceSN)!
      const displayed = (await mockService.all(moduleKey)).data.find((item) => item.id === source!.id)!
      expect(displayed, `${moduleKey} 未返回关联记录`).toMatchObject({
        deviceId: device.id,
        deviceType: device.deviceType,
        deviceModel: device.deviceModel,
      })
    }

    const project = moduleConfigs.projects
    expect(project.fields.map((field) => field.field).slice(1, 4)).toEqual(['deviceType', 'deviceModel', 'deviceSN'])
    expect(project.fields.find((field) => field.field === 'deviceType')?.optionSource).toBe('device-types')
    expect(project.fields.find((field) => field.field === 'deviceModel')?.optionSource).toBe('device-models')
    expect(project.fields.find((field) => field.field === 'deviceSN')?.optionSource).toBe('accessible-devices')
    expect(moduleConfigs['service-transfer'].fields.find((field) => field.field === 'deviceSN')?.optionSource).toBe('accessible-devices')
    expect(moduleConfigs['sn-replacement'].fields.find((field) => field.field === 'originalSN')?.optionSource).toBe('accessible-devices')
  })
})
