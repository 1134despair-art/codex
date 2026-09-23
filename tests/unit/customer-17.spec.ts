import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { moduleConfigs, navGroups } from '@/config/modules'
import { parseProductText } from '@/services/excel'
import { mockService } from '@/services/mock'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'

describe('dealer and procurement navigation requirements', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    useAuthStore().login('admin@shark.cn', 'Admin123!')
  })

  it('disables dealer login without removing its business identity or App users', async () => {
    const database = useDatabaseStore()
    const dealer = database.records('dealers').find((item) => item.organizationId === 'dealer-t2-xm')!
    const appAccounts = database.records('user-auth-accounts').map((item) => ({ id: item.id, status: item.status }))
    const devices = database.records('devices').filter((item) => item.ownerId === dealer.organizationId).map((item) => item.id)
    expect((await mockService.action('dealers', dealer.id, 'toggle', { reason: '暂停后台登录' })).code).toBe(200)
    expect((await mockService.options('dealers')).data.some((item) => item.value === dealer.organizationId)).toBe(true)
    expect(database.records('devices').filter((item) => item.ownerId === dealer.organizationId).map((item) => item.id)).toEqual(devices)
    expect(database.records('user-auth-accounts').map((item) => ({ id: item.id, status: item.status }))).toEqual(appAccounts)
    useAuthStore().logout()
    expect(() => useAuthStore().login('tier2@dealer.cn', 'Dealer123!')).toThrow('账号已禁用')
  })

  it('keeps warehouse stock out of distributed devices and shows contract and shipment views', async () => {
    const database = useDatabaseStore()
    const devices = (await mockService.all('devices')).data
    expect(devices.every((item) => item.ownerId !== 'platform' && item.inventoryStatus !== 'in_stock')).toBe(true)
    expect((await mockService.create('devices', { code: 'NO-DIRECT-ENTRY' })).code).toBe(409)
    expect((await mockService.importDevices([{ sn: 'NO-DIRECT-IMPORT', model: '制冰机 CI-02', region: '中国 · 广东' }], 'devices')).code).toBe(409)
    expect(database.records('devices').some((item) => item.code === 'NO-DIRECT-ENTRY' || item.code === 'NO-DIRECT-IMPORT')).toBe(false)
    const contracts = await mockService.list('contracts', { pageNum: 1, pageSize: 100, tab: 'all' })
    expect(contracts.code).toBe(200)
    expect(contracts.rows.every((item) => item.category === '设备采购')).toBe(true)
    expect((await mockService.list('purchase-shipping', { pageNum: 1, pageSize: 100, tab: 'all' })).code).toBe(200)
    expect(navGroups.find((group) => group.label === '采购管理')?.items.map((item) => item.route)).toEqual(['product-purchase', 'materials', 'material-catalog', 'contracts', 'purchase-shipping', 'couriers'])
  })

  it('attaches a concrete module and record to each dealer service row', async () => {
    const dealer = useDatabaseStore().records('dealers').find((item) => item.organizationId === 'dealer-t1-sz')!
    const related = await mockService.related('dealers', dealer.id, 'dealer-service')
    expect(related.code).toBe(200)
    expect(related.data.length).toBeGreaterThan(0)
    expect(related.data.every((item) => moduleConfigs[String(item.sourceModule)] && item.sourceLabel === moduleConfigs[String(item.sourceModule)].title)).toBe(true)
  })

  it('validates pasted tabular product text with the same duplicate checks as file import', () => {
    const header = '产品编号\t产品名称\t设备类型\t设备型号\t规格\t终端零售价\t一级经销商价'
    const rows = parseProductText(`${header}\nTXT-001\t测试产品\t船载设备\tTXT-01\t24V\t1000\t800\nTXT-001\t重复产品\t船载设备\tTXT-02\t24V\t1000\t800`, [])
    expect(rows[0]).toMatchObject({ code: 'TXT-001', valid: true, tier1Price: 800 })
    expect(rows[1].valid).toBe(false)
  })

  it('keeps the two confirmed business prices and their editable labels without deleting legacy data', async () => {
    const product = useDatabaseStore().records('product-catalog').find((item) => item.domain === 'cn')!
    const legacy = [{ name: '历史协议价', price: 3200 }]
    useDatabaseStore().update('product-catalog', product.id, { extraPrices: legacy })
    expect((await mockService.update('product-catalog', product.id, { extraPrices: [{ name: '活动价', price: 3500 }] })).code).toBe(422)
    expect((await mockService.update('product-catalog', product.id, { retailPriceName: '门店建议价', tier1PriceName: '渠道采购价', retailPrice: 3400 })).code).toBe(200)
    const displayed = await mockService.get('product-catalog', product.id)
    expect(displayed.data).toMatchObject({ retailPriceName: '门店建议价', tier1PriceName: '渠道采购价', referencePrice: product.referencePrice })
    expect(displayed.data).not.toHaveProperty('extraPrices')
    const current = await mockService.related('product-catalog', product.id, 'product-prices')
    expect(current.data.map((item) => item.priceName)).toEqual(['门店建议价', '渠道采购价'])
    expect(useDatabaseStore().records('price-history').some((item) => item.productId === product.id && item.priceType === '终端零售价' && item.newPrice === 3400)).toBe(true)
    expect(useDatabaseStore().records('product-catalog').find((item) => item.id === product.id)?.extraPrices).toEqual(legacy)
    expect((await mockService.update('product-catalog', product.id, { retailPriceName: '相同', tier1PriceName: '相同' })).code).toBe(422)
    useDatabaseStore().update('product-catalog', product.id, { ownerId: 'dealer-t2-xm' })
    useAuthStore().logout()
    useAuthStore().login('tier2@dealer.cn', 'Dealer123!')
    const visible = await mockService.related('product-catalog', product.id, 'product-prices')
    expect(visible.data.map((item) => item.priceName)).toEqual(['门店建议价'])
    expect(visible.data[0]).not.toHaveProperty('extraPrices')
  })
})
