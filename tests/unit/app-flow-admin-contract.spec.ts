import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mockService } from '@/services/mock'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'

describe('APP flow backend contracts', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    useAuthStore().login('admin@shark.cn', 'Admin123!')
  })

  it('updates the device sales region only when the exception is resolved by adjustment', async () => {
    const database = useDatabaseStore()
    const anomaly = (await mockService.all('cross-region-activations')).data.find((item) => item.status === 'pending' && item.usedRegion)!
    const device = database.records('devices').find((item) => item.code === anomaly.deviceSN)!
    const original = String(device.region)
    const resolved = await mockService.action('cross-region-activations', anomaly.id, 'resolve', { resolution: 'region_adjusted', reason: '总部核实实际使用地区' })
    expect(resolved.code, resolved.msg).toBe(200)
    expect(resolved.data).toMatchObject({ previousSalesRegion: original, adjustedSalesRegion: anomaly.usedRegion, status: 'resolved' })
    expect(database.records('devices').find((item) => item.id === device.id)?.region).toBe(anomaly.usedRegion)
    expect(database.records('ownership-history')).toContainEqual(expect.objectContaining({ deviceSN: device.code, operationType: '调整销售地区', fromOwner: original, toOwner: anomaly.usedRegion }))
  })

  it('requires customer phone and lets the dealer set a project warranty date while headquarters remains read-only', async () => {
    const auth = useAuthStore()
    auth.logout()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    const device = (await mockService.all('devices')).data.find((item) => item.ownerId === auth.session?.ownerId)!
    const payload = { name: '客户安装项目', deviceSN: device.code, shipOwner: '客户', installationRegion: String(device.region), dealerWarrantyUntil: '2028-12-31' }
    expect((await mockService.create('projects', payload)).code).toBe(422)
    const created = await mockService.create('projects', { ...payload, customerPhone: '13800000006', customerEmail: 'owner@example.com', shipLength: '12 米' })
    expect(created.code, created.msg).toBe(200)
    expect(created.data).toMatchObject({ warrantyUntil: '2028-12-31', customerPhone: '13800000006', shipLength: '12 米' })
    const material = useDatabaseStore().records('material-catalog').find((item) => item.status !== 'disabled' && Number(item.stock) > Number(item.reservedStock || 0))!
    const request = await mockService.resolveFields('materials', { category: '提前申请', materialId: material.id, quantity: 1, deviceSN: device.code })
    expect(request.data.warrantyUntil).toBe('2028-12-31')
    expect((await mockService.create('materials', { ...request.data, quantity: 1.5, summary: '非法数量' })).code).toBe(422)

    auth.logout()
    auth.login('admin@shark.cn', 'Admin123!')
    expect((await mockService.update('projects', created.data!.id, { dealerWarrantyUntil: '2029-12-31' })).code).toBe(422)
  })

  it('marks repair handling complete without claiming that the user has confirmed it', async () => {
    const repair = (await mockService.all('repairs')).data.find((item) => item.status === 'pending')!
    const dealer = (await mockService.options('dealers')).data[0]
    expect((await mockService.action('repairs', repair.id, 'assign', { assigneeId: dealer.value, reason: '按设备归属分派' })).code).toBe(200)
    expect((await mockService.action('repairs', repair.id, 'complete', { result: '总部直接完结' })).code).toBe(403)
    expect((await mockService.action('repairs', repair.id, 'escalate', { reason: '转回总部处理' })).code).toBe(200)
    const completed = await mockService.action('repairs', repair.id, 'complete', { result: '故障已经处理' })
    expect(completed.data).toMatchObject({ status: 'completed', userConfirmationStatus: 'pending', userConfirmationLabel: '待用户确认' })
    expect(useDatabaseStore().records('notifications')).toContainEqual(expect.objectContaining({ name: '报修处理结果待用户确认' }))
  })
})
