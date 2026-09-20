import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { moduleConfigs, navGroups } from '@/config/modules'
import { mockService } from '@/services/mock'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'

describe('customer feedback admin adjustments', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    useAuthStore().login('admin@shark.cn', 'Admin123!')
  })

  it('combines warehouse and location navigation without exposing delete actions', () => {
    const inventoryRoutes = navGroups.find((group) => group.label === '仓储与采购')!.items.map((item) => item.route)
    expect(inventoryRoutes).toContain('warehouses')
    expect(inventoryRoutes).not.toContain('warehouse-locations')
    expect(moduleConfigs.warehouses.title).toBe('仓库 / 仓位管理')
    expect(moduleConfigs.warehouses.detailTabs.some((tab) => tab.source === 'warehouse-locations')).toBe(true)
    expect(moduleConfigs.warehouses.rowActions).not.toContain('delete')
    expect(moduleConfigs['warehouse-locations'].rowActions).not.toContain('delete')
  })

  it('keeps sales region separate from the latest authorized usage region', async () => {
    const device = (await mockService.all('devices')).data.find((item) => item.lastUsedRegion)!
    expect(device.region).toBeTruthy()
    expect(device.lastUsedRegion).toBeTruthy()
    expect(moduleConfigs.devices.columns.map((column) => column.field)).toEqual(expect.arrayContaining(['region', 'lastUsedRegion']))
  })

  it('processes cross-region activation exceptions linked to devices', async () => {
    const database = useDatabaseStore()
    const anomalies = (await mockService.all('cross-region-activations')).data
    expect(anomalies.length).toBeGreaterThan(0)
    expect(anomalies[0]).toEqual(expect.objectContaining({
      deviceSN: expect.any(String),
      salesRegion: expect.any(String),
      usedRegion: expect.any(String),
      occurredAt: expect.any(String),
      locationSource: 'APP 用户授权定位（Mock）',
    }))
    expect(database.records('devices').some((device) => device.code === anomalies[0].deviceSN)).toBe(true)
    expect(moduleConfigs['cross-region-activations'].crud).toBe('workflow')
    expect(moduleConfigs['cross-region-activations'].rowActions).toContain('resolve')
    const pending = anomalies.find((item) => item.status === 'pending')!
    const resolved = await mockService.action('cross-region-activations', pending.id, 'resolve', { resolution: 'confirmed', reason: '核实为跨区域使用' })
    expect(resolved.data).toMatchObject({ status: 'resolved', resolution: 'confirmed', resolvedBy: '林海' })
  })

  it('backfills supplier-specific payment QR configurations', async () => {
    const supplierQr = (await mockService.all('payment-settings')).data.filter((item) => item.category === '供应商收款码')
    expect(supplierQr.length).toBeGreaterThanOrEqual(2)
    expect(supplierQr.every((item) => item.supplierName && item.channel === '二维码支付')).toBe(true)
    expect((await mockService.all('payment-settings')).data.every((item) => item.category === '供应商收款码')).toBe(true)
  })

  it('uses the unified procurement business name in approval data', () => {
    const database = useDatabaseStore()
    expect(moduleConfigs.materials.title).toBe('物料采购')
    expect(database.records('approval-flow').filter((item) => item.menuKey === 'materials').every((item) => item.menuLabel === '物料采购')).toBe(true)
    expect(database.records('approval-instances').filter((item) => item.menuKey === 'materials').every((item) => item.menuLabel === '物料采购')).toBe(true)
  })

  it('separates product purchasing from after-sales material fulfillment', async () => {
    const purchaseRoutes = navGroups.find((group) => group.label === '仓储与采购')!.items.map((item) => item.route)
    expect(purchaseRoutes).toContain('product-purchase')
    expect(purchaseRoutes).not.toContain('purchase-shipping')
    expect(moduleConfigs.materials.tabs.map((tab) => tab.key)).not.toContain('purchase')
    expect(moduleConfigs['product-purchase'].tabs.map((tab) => tab.key)).toEqual(['all', 'approval', 'production', 'finance', 'shipping', 'shipped', 'completed', 'rejected'])
    const materialRows = await mockService.list('materials', { pageNum: 1, pageSize: 100, tab: 'all' })
    const purchaseRows = await mockService.list('product-purchase', { pageNum: 1, pageSize: 100, tab: 'all' })
    expect(materialRows.rows.every((item) => item.category !== '设备采购')).toBe(true)
    expect(purchaseRows.rows.every((item) => item.category === '设备采购')).toBe(true)
  })
})
