import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { moduleConfigs, navGroups } from '@/config/modules'
import { hasPermission } from '@/config/permissions'
import { mockService, pendingApprovalCount } from '@/services/mock'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'

describe('2026-09-28 customer meeting requirements', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    useAuthStore().login('admin@shark.cn', 'Admin123!')
  })

  it('configures city sales regions and maps multiple regions to a dealer', async () => {
    const database = useDatabaseStore()
    const regions = database.records('sales-regions').filter((item) => item.domain === 'cn').slice(0, 2)
    expect(regions).toHaveLength(2)
    expect(regions.every((item) => item.country && item.province && item.city)).toBe(true)

    const created = await mockService.create('dealers', {
      account: 'region@dealer.cn', initialPassword: 'Dealer123!', name: '会议多区域经销商',
      salesRegionIds: regions.map((item) => item.id), tier: '一级', defaultWarrantyYears: 2,
      phone: '13800138028', status: 'normal',
    })
    expect(created.code, created.msg).toBe(200)
    expect(created.data?.salesRegionIds).toEqual(regions.map((item) => item.id))
    expect(String(created.data?.region)).toContain(String(regions[0].city))
    expect(String(created.data?.region)).toContain(String(regions[1].city))
  })

  it('transfers only unactivated devices to a selected sales dealer with history', async () => {
    const database = useDatabaseStore()
    const inactive = database.records('devices').find((item) => item.activation === 'inactive' && item.domain === 'cn')!
    const target = database.records('dealers').find((item) => item.status === 'normal' && String(item.organizationId || item.ownerId) !== inactive.ownerId)!
    const transferred = await mockService.action('devices', inactive.id, 'change-region', {
      targetDealerId: target.organizationId || target.ownerId, reason: '客户会议确认调整',
    })
    expect(transferred.code, transferred.msg).toBe(200)
    expect(transferred.data).toMatchObject({ owner: target.name, ownerId: target.organizationId || target.ownerId, region: target.region })
    expect(database.records('ownership-history')).toContainEqual(expect.objectContaining({ deviceId: inactive.id, operationType: '未激活设备销售代理商转移' }))

    const activated = database.records('devices').find((item) => item.activation === 'activated' && item.domain === 'cn')!
    expect((await mockService.action('devices', activated.id, 'change-region', {
      targetDealerId: target.organizationId || target.ownerId, reason: '不应直接调整',
    })).code).toBe(409)
  })

  it('records field-level changes when a pending whole-machine purchase is edited', async () => {
    const auth = useAuthStore()
    const database = useDatabaseStore()
    const product = database.records('product-catalog')[0]
    auth.logout()
    auth.login('tier2@dealer.cn', 'Dealer123!')
    const created = await mockService.create('materials', {
      category: '设备采购',
      purchaseItems: [{ itemKey: `product:${product.id}`, quantity: 1, unitPrice: product.tier2Price }],
      summary: '原采购说明',
    })
    expect(created.code, created.msg).toBe(200)

    const edited = await mockService.update('materials', created.data!.id, {
      summary: '审批期间补充后的采购说明', changeReason: '客户补充用途',
    })
    expect(edited.code, edited.msg).toBe(200)
    expect(database.records('purchase-change-history')).toContainEqual(expect.objectContaining({
      subjectId: created.data!.id, field: 'summary', oldValue: '原采购说明',
      newValue: '审批期间补充后的采购说明', reason: '客户补充用途',
    }))
  })

  it('requires a product category and records all three product price histories', async () => {
    const database = useDatabaseStore()
    const category = database.records('product-categories')[0]
    const created = await mockService.create('product-catalog', {
      code: 'MEETING-PRODUCT-001', productCategoryId: category.id, name: '会议测试产品',
      deviceType: '测试设备', deviceModel: 'MT-0928', specification: '24V',
      terminalPrice: 3000, tier1Price: 2000, tier2Price: 2400, status: 'normal',
    })
    expect(created.code, created.msg).toBe(200)
    expect(created.data).toMatchObject({ productCategory: category.name, terminalPrice: 3000, tier1Price: 2000, tier2Price: 2400 })

    const updated = await mockService.update('product-catalog', created.data!.id, {
      terminalPrice: 3200, tier1Price: 2100, tier2Price: 2500,
    })
    expect(updated.code, updated.msg).toBe(200)
    expect(database.records('price-history').filter((item) => item.productId === created.data!.id).map((item) => item.priceType).sort())
      .toEqual(['一级经销商价', '二级经销商价', '终端销售价'].sort())
  })

  it('keeps product categories hierarchical and protects parent-child relationships', async () => {
    const database = useDatabaseStore()
    const deviceRoot = database.records('product-categories').find((item) => item.name === '整机设备' && item.domain === 'cn')!
    const deviceChildren = database.records('product-categories').filter((item) => item.parentId === deviceRoot.id)
    expect(deviceChildren.length).toBeGreaterThanOrEqual(3)
    expect(database.records('product-catalog').every((item) => String(item.productCategoryPath || '').includes(' -> '))).toBe(true)

    const parent = await mockService.create('product-categories', {
      code: 'PCG-MEETING-PARENT', name: '会议分类', parentId: '', status: 'normal', summary: '父级分类',
    })
    expect(parent.code, parent.msg).toBe(200)
    const child = await mockService.create('product-categories', {
      code: 'PCG-MEETING-CHILD', name: '会议子分类', parentId: parent.data!.id, status: 'normal', summary: '子级分类',
    })
    expect(child.code, child.msg).toBe(200)
    expect(child.data).toMatchObject({ path: '会议分类 -> 会议子分类', parentName: '会议分类', level: 2 })

    const renamed = await mockService.update('product-categories', parent.data!.id, { name: '会议分类（已更新）' })
    expect(renamed.code, renamed.msg).toBe(200)
    expect(database.records('product-categories').find((item) => item.id === child.data!.id)?.path).toBe('会议分类（已更新） -> 会议子分类')

    const circular = await mockService.update('product-categories', parent.data!.id, { parentId: child.data!.id })
    expect(circular.code).toBe(422)
    expect(circular.msg).toContain('循环层级')

    const deleteParent = await mockService.remove('product-categories', parent.data!.id, '验证父分类保护')
    expect(deleteParent.code).toBe(409)
    expect(deleteParent.msg).toContain('下级分类')
  })

  it('filters a parent category with all descendant products and blocks deleting a category in use', async () => {
    const database = useDatabaseStore()
    const root = database.records('product-categories').find((item) => item.name === '整机设备' && item.domain === 'cn')!
    const ids = database.records('product-categories').filter((item) => item.id === root.id || String(item.path).startsWith(`${root.path} -> `)).map((item) => item.id)
    const result = await mockService.list('product-catalog', {
      pageNum: 1, pageSize: 50, tab: 'all', filters: { productCategoryId: ids },
    })
    expect(result.total).toBeGreaterThan(0)
    expect(result.rows.every((item) => ids.includes(String(item.productCategoryId)))).toBe(true)
    expect(result.rows.every((item) => String(item.productCategoryPath).startsWith('整机设备 -> '))).toBe(true)

    const linkedCategory = database.records('product-categories').find((item) => database.records('product-catalog').some((product) => product.productCategoryId === item.id))!
    const removed = await mockService.remove('product-categories', linkedCategory.id, '验证产品关联保护')
    expect(removed.code).toBe(409)
    expect(removed.msg).toContain('已有产品使用')
  })

  it('keeps dealer menus free of warehouse configuration and lets headquarters create service records', async () => {
    const auth = useAuthStore()
    const database = useDatabaseStore()
    auth.logout()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    for (const permission of ['warehouse:view', 'warehouses:view', 'warehouse-locations:view', 'material-catalog:view', 'couriers:view']) {
      expect(hasPermission(auth.permissions, permission), permission).toBe(false)
    }

    auth.logout()
    auth.login('admin@shark.cn', 'Admin123!')
    const device = database.records('devices').find((item) => item.domain === 'cn')!
    const repair = await mockService.create('repairs', {
      account: '13800138000', deviceSN: device.code, faultCategory: '其他',
      contact: '13800138000', summary: '总部根据客户来电代建报修',
    })
    expect(repair.code, repair.msg).toBe(200)
    expect(repair.data).toMatchObject({ status: 'pending', submittedFrom: '后台代建' })

    const material = database.records('material-catalog').find((item) => item.status === 'normal')!
    const recipient = database.records('dealers').find((item) => item.status === 'normal' && item.domain === 'cn')!
    const issuance = await mockService.create('issuance', {
      materialId: material.id, deviceSN: device.code, recipientId: recipient.organizationId || recipient.ownerId,
      quantity: 1, trackingNo: 'MEETING-ISS-001', summary: '总部主动发放售后物料',
    })
    expect(issuance.code, issuance.msg).toBe(200)
    expect(issuance.data).toMatchObject({ category: '总部主动发放', recipient: recipient.name, status: 'shipped' })
  })

  it('keeps approval management separate and counts only approvals actionable by the current account', () => {
    const auth = useAuthStore()
    const database = useDatabaseStore()
    const approvalGroup = navGroups.find((group) => group.label === '审批管理')
    const serviceGroup = navGroups.find((group) => group.label === '服务与售后')
    expect(approvalGroup?.items.map((item) => item.route)).toEqual(['approval-center', 'approval-flow'])
    expect(serviceGroup?.items.some((item) => item.route === 'approval-center' || item.route === 'approval-flow')).toBe(false)

    const initialCount = pendingApprovalCount()
    const instance = database.create('approval-instances', {
      code: 'APR-BADGE-001', sourceModule: 'materials', subjectId: 'missing-subject',
      status: 'pending', ownerId: 'platform', domain: auth.session!.domain,
    })
    database.create('approval-steps', {
      instanceId: instance.id, sequence: 1, name: '当前账号审批', status: 'pending',
      approverAccountId: auth.session!.accountId, approverName: auth.session!.displayName,
      ownerId: 'platform', domain: auth.session!.domain,
    })
    database.create('approval-instances', {
      code: 'APR-BADGE-002', sourceModule: 'materials', subjectId: 'missing-subject-2',
      status: 'pending', ownerId: 'platform', domain: auth.session!.domain,
    })
    expect(pendingApprovalCount()).toBe(initialCount + 1)
  })

  it('uses master-data options for regions, user accounts and dealer filters', async () => {
    expect(moduleConfigs.devices.fields.find((field) => field.field === 'region')).toMatchObject({ type: 'select', optionSource: 'sales-region-names' })
    expect(moduleConfigs.warehouses.fields.find((field) => field.field === 'region')).toMatchObject({ type: 'select', optionSource: 'sales-region-names' })
    expect(moduleConfigs.projects.fields.find((field) => field.field === 'installationRegion')).toMatchObject({ type: 'select', optionSource: 'sales-region-names' })
    expect(moduleConfigs.repairs.fields.find((field) => field.field === 'account')).toMatchObject({ type: 'select', optionSource: 'app-user-accounts' })
    expect(moduleConfigs.warranty.filters.find((field) => field.field === 'dealer')).toMatchObject({ type: 'select', optionSource: 'dealer-names' })

    const regionOptions = await mockService.options('sales-region-names')
    const accountOptions = await mockService.options('app-user-accounts')
    expect(regionOptions.data.length).toBeGreaterThan(0)
    expect(regionOptions.data.every((item) => item.label === item.value)).toBe(true)
    expect(accountOptions.data).toContainEqual(expect.objectContaining({ value: '13812345678' }))
  })

  it('integrates after-sales materials into the product category hierarchy', async () => {
    const database = useDatabaseStore()
    const materials = database.records('material-catalog')
    expect(materials.every((item) => String(item.productCategoryPath).startsWith('售后物料 ->'))).toBe(true)
    expect(moduleConfigs['material-catalog'].fields.some((field) => field.field === 'stock')).toBe(false)
    expect(moduleConfigs['material-catalog'].fields.find((field) => field.field === 'productCategoryId')).toMatchObject({ type: 'select', optionSource: 'after-sales-product-categories', required: true })
    const category = database.records('product-categories').find((item) => Number(item.materialCount) > 0)!
    expect(category).toBeTruthy()
    expect(category.itemCount).toBe(Number(category.productCount) + Number(category.materialCount))
    expect((await mockService.remove('product-categories', String(materials[0].productCategoryId), '验证物料关联保护')).code).toBe(409)
  })

  it('grants headquarters service accounts SN replacement permissions', async () => {
    const auth = useAuthStore()
    auth.logout()
    expect(auth.login('wangh@shark.cn', 'Admin123!')).toBeTruthy()
    expect(hasPermission(auth.permissions, 'sn-replacement:create')).toBe(true)
    const device = (await mockService.all('devices')).data.find((item) => item.ownerId !== 'platform')!
    const created = await mockService.create('sn-replacement', {
      originalSN: device.code,
      newSN: 'SN-HQ-SERVICE-001',
      replacementDeviceName: device.deviceName,
      replacementDeviceDescriptor: device.name,
    })
    expect(created.code, created.msg).toBe(200)
    expect(created.data).toMatchObject({ ownerId: device.ownerId, status: 'pending' })
  })
})
