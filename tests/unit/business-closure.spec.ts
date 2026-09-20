import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mockService } from '@/services/mock'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'

describe('business workflow closure', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAuthStore().login('admin@shark.cn', 'Admin123!')
  })

  it('supports multiple payments for one payment order', async () => {
    const database = useDatabaseStore()
    const order = database.create('payments', {
      code: 'PAY-SPLIT-001', name: '分次付款服务订单', category: '二维码支付', sourceType: 'app',
      sourceLabel: 'APP 支付', businessType: 'APP 服务订单', orderAmount: 500, amount: 500,
      paidAmount: 0, remainingAmount: 500, paymentCount: 0, status: 'pending',
      owner: '平台中心', ownerId: 'platform', domain: 'cn',
    })
    const orderAmount = Number(order.orderAmount)
    const firstAmount = Math.round(orderAmount * 0.4 * 100) / 100

    const first = await mockService.action('payments', order.id, 'finance-verify', {
      paidAmount: firstAmount, paymentProof: 'data:image/png;base64,AA==', paymentReference: 'PARTIAL-PAY-001', paidAt: '2026-09-16', verificationNote: '首笔付款核实通过',
    })
    expect(first.code, first.msg).toBe(200)
    expect(first.data).toMatchObject({
      orderRole: 'parent', parentOrderCode: order.code, lastChildOrderCode: `${order.code}-P01`,
      status: 'pending', channel: '二维码支付', paidAmount: firstAmount, remainingAmount: 300, paymentCount: 1,
    })
    const firstChild = database.records('payment-transactions').find((item) => item.paymentId === order.id)
    expect(firstChild).toMatchObject({
      code: `${order.code}-P01`, childOrderCode: `${order.code}-P01`, parentOrderCode: order.code,
      parentPaymentId: order.id, installmentNo: 1, installmentLabel: '第 1 笔付款', orderAmount,
      previousPaidAmount: 0, currentPaymentAmount: firstAmount, paidAmountAfter: firstAmount,
      remainingAmountAfter: 300, status: 'verified', paymentReference: 'PARTIAL-PAY-001',
    })

    const second = await mockService.action('payments', order.id, 'finance-verify', {
      paidAmount: orderAmount - firstAmount, paymentProof: 'data:image/png;base64,BB==', paymentReference: 'PARTIAL-PAY-002', paidAt: '2026-09-17', verificationNote: '尾款核实通过',
    })
    expect(second.code, second.msg).toBe(200)
    expect(second.data).toMatchObject({
      orderRole: 'parent', parentOrderCode: order.code, lastChildOrderCode: `${order.code}-P02`,
      status: 'verified', paidAmount: orderAmount, remainingAmount: 0, paymentCount: 2,
    })
    const children = database.records('payment-transactions')
      .filter((item) => item.paymentId === order.id)
      .sort((left, right) => Number(left.installmentNo) - Number(right.installmentNo))
    expect(children).toHaveLength(2)
    expect(children[1]).toMatchObject({
      code: `${order.code}-P02`, childOrderCode: `${order.code}-P02`, parentOrderCode: order.code,
      parentPaymentId: order.id, installmentNo: 2, installmentLabel: '第 2 笔付款', orderAmount,
      previousPaidAmount: firstAmount, currentPaymentAmount: orderAmount - firstAmount,
      paidAmountAfter: orderAmount, remainingAmountAfter: 0, status: 'verified',
      previousVerifiedChildOrderCodes: `${order.code}-P01`, paymentReference: 'PARTIAL-PAY-002',
    })
  })

  it('lets finance explicitly release a partially paid procurement order', async () => {
    const database = useDatabaseStore()
    const order = database.create('materials', {
      code: 'PUR-SPLIT-001', name: '分次付款采购单', category: '设备采购', amount: 1000,
      orderAmount: 1000, paidAmount: 0, paymentCount: 0, purchaseStage: 'finance_confirmation',
      purchaseStageLabel: '待财务确认', status: 'approved', owner: '测试经销商', ownerId: 'dealer-t1-sz', domain: 'cn',
    })
    const first = await mockService.action('materials', order.id, 'finance-confirm', {
      contractStatus: '已签订', contractNo: 'CONTRACT-SPLIT-001', paidAmount: 400,
      paymentProof: 'data:image/png;base64,AA==', paymentReference: 'BANK-SPLIT-001', paidAt: '2026-09-16', warehouseDecision: 'hold', paymentNote: '首笔款待复核',
    })
    expect(first.data).toMatchObject({ paidAmount: 400, remainingAmount: 600, paymentStatus: '已核实部分付款', purchaseStage: 'finance_confirmation' })

    const second = await mockService.action('materials', order.id, 'finance-confirm', {
      contractStatus: '已签订', contractNo: 'CONTRACT-SPLIT-001', paidAmount: 600,
      paymentProof: 'data:image/png;base64,BB==', paymentReference: 'BANK-SPLIT-002', paidAt: '2026-09-17', warehouseDecision: 'release', paymentNote: '财务放行',
    })
    expect(second.data).toMatchObject({ paidAmount: 1000, remainingAmount: 0, paymentStatus: '已核实付清', purchaseStage: 'warehouse_fulfillment' })
    const shippingQueue = await mockService.list('product-purchase', { pageNum: 1, pageSize: 20, tab: 'shipping' })
    expect(shippingQueue.code).toBe(200)
    expect(shippingQueue.rows).toContainEqual(expect.objectContaining({ id: order.id, purchaseStage: 'warehouse_fulfillment', deliveryStatus: '待发货' }))
    expect(shippingQueue.rows.every((item) => item.category === '设备采购' && item.purchaseStage === 'warehouse_fulfillment')).toBe(true)
    const allShipping = await mockService.list('product-purchase', { pageNum: 1, pageSize: 20, tab: 'all' })
    expect(allShipping.rows).toContainEqual(expect.objectContaining({ id: order.id }))
    expect(allShipping.rows.every((item) => item.category === '设备采购')).toBe(true)
    expect(database.records('expense-records').filter((item) => item.subjectId === order.id)).toHaveLength(2)
    expect(database.records('payments').filter((item) => item.subjectId === order.id)).toHaveLength(2)
  })

  it('moves shipped material through receipt and closes its source request after replacement', async () => {
    const database = useDatabaseStore()
    const repair = database.records('repairs')[0]
    const request = database.create('materials', {
      code: 'MAT-CLOSE-001', name: '售后物料闭环', category: '普通申请', deviceSN: repair.deviceSN,
      status: 'shipped', owner: repair.owner, ownerId: repair.ownerId, domain: repair.domain,
    })
    const issuance = database.create('issuance', {
      code: 'ISS-CLOSE-001', name: '售后物料闭环', materialName: '替换部件', deviceSN: repair.deviceSN,
      sourceRequestId: request.id, sourceRequestCode: request.code, status: 'shipped',
      owner: repair.owner, ownerId: repair.ownerId, domain: repair.domain,
    })

    expect((await mockService.action('issuance', issuance.id, 'confirm-receipt', { reason: '已签收' })).data?.status).toBe('received')
    expect((await mockService.action('issuance', issuance.id, 'complete-replacement', {
      repairId: repair.id, oldPartSerial: 'OLD-CLOSE-001', newPartSerial: 'NEW-CLOSE-001', reason: '换件完成',
    })).data?.status).toBe('completed')
    expect(database.records('materials').find((item) => item.id === request.id)).toMatchObject({ status: 'completed', fulfillmentStatus: '已完成' })
  })

  it('creates supplier-specific QR configurations', async () => {
    const created = await mockService.create('payment-settings', {
      code: 'QR-TEST-001', name: '测试供应商收款码', category: '供应商收款码',
      supplierName: '测试供应商', channel: '二维码支付', accountName: '测试收款户名',
      qrCodeData: 'data:image/png;base64,AA==', status: 'normal',
    })
    expect(created.code, created.msg).toBe(200)
    expect(created.data).toMatchObject({ supplierName: '测试供应商', channel: '二维码支付', status: 'normal' })

    const exported = await mockService.exportRows('payment-settings', { pageNum: 1, pageSize: 100 })
    expect(exported.code, exported.msg).toBe(200)
    expect(exported.data.find((item) => item.code === 'QR-TEST-001')?.qrCodeData).toBeUndefined()
  })
})
