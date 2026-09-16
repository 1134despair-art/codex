import { expect, test, type Page } from '@playwright/test'

async function login(page: Page, account = 'admin@shark.cn', password = 'Admin123!') {
  await page.goto('/#/login')
  await page.locator('.auth-form').getByLabel('账号').fill(account)
  await page.locator('.auth-form').getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page).toHaveURL(/#\/(dashboard|first-password)/)
}

async function logout(page: Page) {
  await page.locator('.account-button').click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await page.waitForURL(/#\/login/)
}

async function selectFirstOption(page: Page, scope: ReturnType<Page['locator']>, label: string) {
  const field = scope.locator('.el-form-item', { hasText: label })
  const combobox = field.getByRole('combobox')
  await field.locator('.el-select').click()
  const controls = await combobox.getAttribute('aria-controls')
  expect(controls).toBeTruthy()
  const option = page.locator(`#${controls}`).getByRole('option').filter({ visible: true }).first()
  await expect(option).toBeVisible()
  await option.click()
}

async function selectOptionContaining(page: Page, scope: ReturnType<Page['locator']>, label: string, text: string) {
  const field = scope.locator('.el-form-item', { hasText: label })
  const combobox = field.getByRole('combobox')
  await field.locator('.el-select').click()
  const controls = await combobox.getAttribute('aria-controls')
  expect(controls).toBeTruthy()
  const option = page.locator(`#${controls}`).getByRole('option').filter({ hasText: text }).first()
  await expect(option).toBeVisible()
  await option.click()
}

async function clickRowAction(page: Page, row: ReturnType<Page['locator']>, label: string) {
  const directAction = row.getByRole('button', { name: label, exact: true })
  if (await directAction.count()) {
    await directAction.click()
    return
  }
  await row.getByRole('button', { name: /更多操作/ }).click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}

async function visibleMenuRoutes(page: Page) {
  return page.locator('.nav-item').evaluateAll((links) => links.map((link) => String((link as HTMLAnchorElement).hash).replace(/^#\//, '')))
}

test('platform launch screen settings persist, export JSON and reject dealer access', async ({ page }, testInfo) => {
  await login(page)
  await page.goto('/#/launch-settings')
  await expect(page.getByRole('heading', { name: 'APP 启动页' })).toBeVisible()
  await expect(page.locator('.launch-preview')).toBeVisible()

  const revision = `v3.2-launch-${Date.now()}`
  await page.getByLabel('配置版本号').fill(revision)
  await page.getByLabel('中文副标题').fill('连接设备，从这里开始')
  await page.getByRole('button', { name: '保存配置' }).click()
  await expect(page.getByText('启动页配置已保存')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('配置版本号')).toHaveValue(revision)
  await expect(page.locator('.preview-content')).toContainText('连接设备，从这里开始')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出配置 JSON' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`launch-screen-${revision}.json`)
  await page.screenshot({ path: testInfo.outputPath('launch-settings.png'), fullPage: true })

  await logout(page)
  await login(page, 'tier1@dealer.cn', 'Dealer123!')
  await page.goto('/#/launch-settings')
  await expect(page).toHaveURL(/#\/403/)
})

test('platform, tier-1 and tier-2 accounts expose the demonstration menu and warranty matrix', async ({ page }) => {
  const platformMenus = [
    'dashboard', 'users', 'dealers', 'projects', 'installation-transfers', 'cross-region-activations', 'devices', 'product-catalog', 'warehouses', 'warehouse', 'ota',
    'repairs', 'messages', 'complaints', 'materials', 'material-catalog', 'issuance',
    'approval-center', 'couriers', 'sn-replacement', 'service-transfer', 'warranty', 'approval-flow', 'after-sales-types',
    'payments', 'payment-settings', 'banners', 'faq-documents', 'support-settings', 'launch-settings', 'app-versions', 'admins', 'roles', 'logs',
  ]
  const tier1Menus = [
    'dashboard', 'users', 'dealers', 'projects', 'devices', 'product-catalog', 'warehouse',
    'repairs', 'messages', 'complaints', 'materials', 'material-catalog', 'issuance',
    'couriers', 'sn-replacement', 'service-transfer', 'warranty', 'approval-flow', 'payments',
  ]
  const tier2Menus = [
    'dashboard', 'projects', 'devices', 'product-catalog', 'warehouse', 'repairs', 'messages', 'complaints',
    'materials', 'material-catalog', 'issuance', 'couriers', 'sn-replacement',
    'service-transfer', 'warranty', 'payments',
  ]

  await login(page)
  expect(await visibleMenuRoutes(page)).toEqual(platformMenus)
  const sidebarIcons = await page.locator('.nav-item .app-icon.line').evaluateAll(async (icons) => Promise.all(icons.map(async (icon) => {
    const maskImage = getComputedStyle(icon).maskImage
    const source = maskImage.match(/url\(["']?(.*?)["']?\)/)?.[1] || ''
    const response = source ? await fetch(new URL(source, document.baseURI)) : null
    const bounds = icon.getBoundingClientRect()
    return { label: icon.parentElement?.textContent?.trim(), ok: response?.ok === true, width: bounds.width, height: bounds.height }
  })))
  expect(sidebarIcons).toHaveLength(platformMenus.length)
  expect(sidebarIcons.filter((icon) => !icon.ok || icon.width === 0 || icon.height === 0)).toEqual([])
  await page.goto('/#/warranty')
  await expect(page.getByRole('button', { name: '新增质保规则' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0)

  await logout(page)
  await login(page, 'tier1@dealer.cn', 'Dealer123!')
  expect(await visibleMenuRoutes(page)).toEqual(tier1Menus)
  await page.goto('/#/warranty')
  await expect(page.getByRole('button', { name: '新增质保规则' })).toBeVisible()
  await expect(page.locator('.business-table .el-table__body tr', { hasText: '深圳海航设备有限公司' }).getByRole('button', { name: '编辑', exact: true })).toBeVisible()
  await expect(page.locator('.business-table .el-table__body tr', { hasText: '厦门蓝湾船舶服务' }).getByRole('button', { name: '编辑', exact: true })).toHaveCount(0)

  await logout(page)
  await login(page, 'tier2@dealer.cn', 'Dealer123!')
  await page.getByRole('textbox', { name: '新密码', exact: true }).fill('DealerDemo123!')
  await page.getByRole('textbox', { name: '确认新密码', exact: true }).fill('DealerDemo123!')
  await page.getByRole('button', { name: '保存并进入后台' }).click()
  expect(await visibleMenuRoutes(page)).toEqual(tier2Menus)
  await page.goto('/#/warranty')
  await expect(page.getByRole('button', { name: '新增质保规则' })).toBeVisible()
  const tier2Rows = page.locator('.business-table .el-table__body tr')
  await expect(tier2Rows).toHaveCount(1)
  await expect(tier2Rows.first()).toContainText('厦门蓝湾船舶服务')
  await expect(tier2Rows.first().getByRole('button', { name: '编辑', exact: true })).toBeVisible()
})

test('customer feedback admin surfaces stay visible and distinct', async ({ page }) => {
  await login(page)
  await expect(page.getByText('注册用户总数', { exact: true })).toBeVisible()
  await expect(page.getByText('今日新增用户', { exact: true })).toBeVisible()
  await expect(page.getByText('新增设备数量', { exact: true })).toBeVisible()

  const warehouseLink = page.locator('.nav-item', { hasText: '仓库与库位' })
  await expect(warehouseLink).toBeVisible()
  await expect(page.locator('.nav-item', { hasText: '库位管理' })).toHaveCount(0)
  await expect(page.locator('.nav-item--priority', { hasText: '审批中心' })).toBeVisible()

  await page.goto('/#/devices')
  await expect(page.getByRole('columnheader', { name: '销售地区' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '最近一次使用地区' })).toBeVisible()

  await page.goto('/#/cross-region-activations')
  await expect(page.getByRole('heading', { name: '跨区域激活异常' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '销售/归属区域' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '发生/使用区域' })).toBeVisible()
  await expect(page.getByText('区域不匹配').first()).toBeVisible()
})

test('headquarters initiates a fee-bearing after-sales transfer through target confirmation and fee approval', async ({ page }) => {
  test.setTimeout(60_000)
  await login(page)
  const context = await page.evaluate(() => {
    const database = JSON.parse(localStorage.getItem('shark-sister-admin.db.v15') || '{}')
    const records = database.records || {}
    const activeSNs = new Set((records['service-transfer'] || []).filter((item: Record<string, unknown>) => item.status === 'pending').map((item: Record<string, unknown>) => item.deviceSN))
    const device = (records.devices || []).find((item: Record<string, unknown>) => item.ownerId !== 'platform' && item.inventoryStatus !== 'in_stock' && !activeSNs.has(item.code))
    const source = (records.dealers || []).find((item: Record<string, unknown>) => String(item.organizationId || item.ownerId) === String(device?.ownerId))
    const target = (records.dealers || []).find((item: Record<string, unknown>) => {
      const targetId = String(item.organizationId || item.ownerId)
      return item.status === 'normal' && item.domain === source?.domain && targetId !== String(source?.organizationId || source?.ownerId)
        && (records['auth-accounts'] || []).some((account: Record<string, unknown>) => account.status === 'normal' && account.ownerId === targetId)
    })
    const targetId = String(target?.organizationId || target?.ownerId)
    const account = (records['auth-accounts'] || []).find((item: Record<string, unknown>) => item.status === 'normal' && item.ownerId === targetId)
    return { sn: String(device?.code || ''), targetName: String(target?.name || ''), account: String(account?.account || ''), password: String(account?.password || '') }
  })
  expect(context.sn).toBeTruthy()
  expect(context.targetName).toBeTruthy()

  await page.goto('/#/service-transfer')
  await page.getByRole('button', { name: '发起售后转移' }).click()
  let dialog = page.locator('.entity-dialog')
  await selectOptionContaining(page, dialog, '设备 SN', context.sn)
  const targetField = dialog.locator('.el-form-item', { hasText: '目标经销商' })
  await targetField.locator('.el-select').click()
  const targetControls = await targetField.getByRole('combobox').getAttribute('aria-controls')
  await page.locator(`#${targetControls}`).getByRole('option', { name: new RegExp(context.targetName) }).click()
  await dialog.locator('.el-form-item', { hasText: '是否涉及费用' }).locator('.el-switch').click()
  await dialog.locator('.el-form-item', { hasText: '预计费用' }).getByRole('spinbutton').fill('3600')
  await selectFirstOption(page, dialog, '费用承担方')
  await dialog.locator('.el-form-item', { hasText: '费用说明' }).locator('textarea').fill('跨区域交接和运输费用')
  await dialog.locator('.el-form-item', { hasText: '转移原因' }).locator('textarea').fill('总部调整售后责任归属')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  let row = page.locator('.business-table .el-table__body tr', { hasText: context.sn }).last()
  await expect(row).toContainText('待总部审批')
  await expect(row).toContainText('3,600')

  await logout(page)
  await login(page, context.account, context.password)
  await page.goto('/#/service-transfer?tab=target')
  row = page.locator('.business-table .el-table__body tr', { hasText: context.sn }).last()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '确认售后转移' }).click()
  let risk = page.locator('.risk-dialog')
  await risk.locator('.el-form-item', { hasText: '确认结果' }).locator('.el-select').click()
  await page.getByRole('option', { name: '确认接收', exact: true }).click()
  await risk.getByLabel('操作原因').fill('目标经销商确认接收设备售后责任')
  await risk.getByRole('button', { name: '确认确认售后转移' }).click()

  await logout(page)
  await login(page)
  await page.goto('/#/service-transfer?tab=fee')
  row = page.locator('.business-table .el-table__body tr', { hasText: context.sn }).last()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '通过费用审批' }).click()
  risk = page.locator('.risk-dialog')
  await risk.locator('.el-form-item', { hasText: '实际费用' }).getByRole('spinbutton').fill('3500')
  await selectFirstOption(page, risk, '付款方式')
  await risk.getByPlaceholder('请输入付款凭证/流水号').fill('E2E-TRF-OFFLINE-001')
  await risk.locator('.el-form-item', { hasText: '付款日期' }).locator('input').fill('2026-08-21')
  await risk.locator('.el-form-item', { hasText: '付款日期' }).locator('input').press('Enter')
  await risk.getByLabel('操作原因').fill('线下费用凭证核对通过')
  await risk.getByRole('button', { name: '确认通过费用审批' }).click()

  await page.goto('/#/service-transfer?tab=completed')
  row = page.locator('.business-table .el-table__body tr', { hasText: context.sn }).last()
  await expect(row).toContainText('已完成')
  await expect(row).toContainText('已登记')
  await row.getByRole('button', { name: '查看详情', exact: true }).click()
  dialog = page.locator('.detail-dialog')
  await dialog.getByRole('tab', { name: '费用记录' }).click()
  await expect(dialog).toContainText('E2E-TRF-OFFLINE-001')

  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.goto('/#/payments?tab=platform')
  const billRow = page.locator('.business-table .el-table__body tr', { hasText: 'E2E-TRF-OFFLINE-001' })
  await expect(billRow).toBeVisible()
  await expect(billRow).toContainText('平台费用登记')
  await expect(billRow).toContainText('3,500')
})

test('platform project edit and delete stay synchronized without an undefined create entry', async ({ page }) => {
  await login(page)
  await expect(page).toHaveURL(/#\/dashboard/)
  await page.goto('/#/projects')
  await expect(page.getByRole('button', { name: /新增项目/ })).toHaveCount(0)
  const row = page.locator('.business-table .el-table__body tr').first()
  await row.getByRole('button', { name: '编辑' }).click()
  await page.getByPlaceholder('请输入船名').fill('Playwright 项目二期')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('Playwright 项目二期')).toBeVisible()

  await page.locator('.business-table .el-table__body tr', { hasText: 'Playwright 项目二期' }).first().getByRole('button', { name: '删除' }).click()
  await page.getByLabel('操作原因').fill('端到端测试清理')
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(page.getByText('Playwright 项目二期', { exact: true })).toHaveCount(0)
})

test('tier-2 account must change password and cannot access admins', async ({ page }) => {
  await login(page, 'tier2@dealer.cn', 'Dealer123!')
  await expect(page).toHaveURL(/#\/first-password/)
  await page.getByRole('textbox', { name: '新密码', exact: true }).fill('DealerNew123!')
  await page.getByRole('textbox', { name: '确认新密码', exact: true }).fill('DealerNew123!')
  await page.getByRole('button', { name: '保存并进入后台' }).click()
  await page.goto('/#/admins')
  await expect(page.getByText('没有访问权限')).toBeVisible()
})

test('dealer creates a device purchase request with an automatically calculated budget', async ({ page }) => {
  await login(page, 'tier2@dealer.cn', 'Dealer123!')
  if (page.url().includes('/first-password')) {
    await page.getByRole('textbox', { name: '新密码', exact: true }).fill('DealerPurchase123!')
    await page.getByRole('textbox', { name: '确认新密码', exact: true }).fill('DealerPurchase123!')
    await page.getByRole('button', { name: '保存并进入后台' }).click()
  }

  await page.goto('/#/materials?tab=purchase')
  await page.getByRole('button', { name: '发起产品采购/销售申请' }).click()
  const dialog = page.locator('.entity-dialog')
  await expect(dialog).toBeVisible()
  const purchaseLine = dialog.locator('.line-item-row').first()
  await purchaseLine.locator('.el-select').click()
  await page.getByRole('option', { name: '设备 · 顶流机 TF-01', exact: true }).click()
  await purchaseLine.getByRole('spinbutton', { name: '数量' }).fill('2')
  await purchaseLine.getByRole('spinbutton', { name: '参考单价' }).fill('68551')
  await purchaseLine.getByRole('spinbutton', { name: '参考单价' }).blur()
  await expect(dialog.locator('.el-form-item', { hasText: '预算总费用' }).locator('input')).toHaveValue('137102')
  await dialog.locator('.el-form-item', { hasText: '采购用途与说明' }).locator('textarea').fill('新增两台船用制冰设备')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()

  const row = page.locator('.business-table .el-table__body tr', { hasText: '137,102' }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText('顶流机 TF-01')
  await expect(row).toContainText('待确认')
  await row.getByRole('button', { name: '查看详情' }).click()
  const detail = page.locator('.detail-dialog')
  await expect(detail.getByRole('tab')).toHaveText(['基本信息', '采购明细', '业务审批', '费用与合同', '仓库发货'])
})

test('device purchase completes business, finance and warehouse fulfillment in the UI', async ({ page }) => {
  test.setTimeout(90_000)
  await login(page, 'tier2@dealer.cn', 'Dealer123!')
  if (page.url().includes('/first-password')) {
    await page.getByRole('textbox', { name: '新密码', exact: true }).fill('DealerFulfillment123!')
    await page.getByRole('textbox', { name: '确认新密码', exact: true }).fill('DealerFulfillment123!')
    await page.getByRole('button', { name: '保存并进入后台' }).click()
  }

  await page.goto('/#/materials?tab=purchase')
  await page.getByRole('button', { name: '发起产品采购/销售申请' }).click()
  const dialog = page.locator('.entity-dialog')
  const purchaseLine = dialog.locator('.line-item-row').first()
  await purchaseLine.locator('.el-select').click()
  await page.getByRole('option', { name: '设备 · 顶流机 TF-01', exact: true }).click()
  await purchaseLine.getByRole('spinbutton', { name: '数量' }).fill('1')
  await purchaseLine.getByRole('spinbutton', { name: '参考单价' }).fill('68000')
  await dialog.locator('.el-form-item', { hasText: '采购用途与说明' }).locator('textarea').fill('会议修改点全链路采购验收')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  let row = page.locator('.business-table .el-table__body tr', { hasText: '68,000' }).first()
  const purchaseCode = (await row.locator('.mono-cell').first().textContent())!.trim()

  await logout(page)
  await login(page, 'tier1@dealer.cn', 'Dealer123!')
  await page.goto('/#/materials')
  row = page.locator('.business-table .el-table__body tr', { hasText: purchaseCode }).first()
  await row.getByRole('button', { name: '审批通过' }).click()
  let risk = page.locator('.risk-dialog')
  await risk.locator('.el-form-item', { hasText: '确认意见' }).locator('textarea').fill('一级经销商确认采购需求')
  await risk.getByRole('button', { name: '确认业务确认通过' }).click()

  await logout(page)
  await login(page)
  await page.goto('/#/approval-center')
  row = page.locator('.business-table .el-table__body tr', { hasText: purchaseCode }).first()
  await expect(row).toContainText('待处理')
  await row.getByRole('button', { name: '审批通过' }).click()
  risk = page.locator('.risk-dialog')
  await risk.locator('.el-form-item', { hasText: '审批意见' }).locator('textarea').fill('总部确认采购业务')
  await risk.getByRole('button', { name: '确认审批通过' }).click()

  await page.goto('/#/materials?tab=purchase')
  row = page.locator('.business-table .el-table__body tr', { hasText: purchaseCode }).first()
  await expect(row).toContainText('待财务确认')
  await row.getByRole('button', { name: '财务确认' }).click()
  risk = page.locator('.risk-dialog')
  await risk.locator('.el-form-item', { hasText: '合同状态' }).locator('.el-select').click()
  await page.getByRole('option', { name: '已签订', exact: true }).click()
  await risk.getByPlaceholder('请输入合同编号').fill('CONTRACT-E2E-PURCHASE-001')
  await risk.locator('.el-form-item', { hasText: '确认金额' }).getByRole('spinbutton').fill('68000')
  await risk.locator('.el-form-item', { hasText: '费用记录方式' }).locator('.el-select').click()
  await page.getByRole('option', { name: '对公转账', exact: true }).click()
  await risk.getByPlaceholder('请输入付款凭证/流水号').fill('BANK-E2E-PURCHASE-001')
  await risk.locator('.el-form-item', { hasText: '确认日期' }).locator('input').fill('2026-09-02')
  await risk.locator('.el-form-item', { hasText: '确认日期' }).locator('input').press('Enter')
  await risk.getByRole('button', { name: '确认财务确认' }).click()
  await expect(row).toContainText('待仓库发货')

  const stock = await page.evaluate(() => {
    const database = JSON.parse(localStorage.getItem('shark-sister-admin.db.v15') || '{}')
    const device = (database.records?.devices || []).find((item: Record<string, unknown>) => item.inventoryStatus === 'in_stock' && item.deviceModel === 'TF-01')
    const warehouse = (database.records?.warehouses || []).find((item: Record<string, unknown>) => item.id === device?.warehouseId)
    return { deviceSN: String(device?.code || ''), warehouseName: String(warehouse?.name || '') }
  })
  expect(stock.deviceSN).toBeTruthy()
  await row.getByRole('button', { name: '仓库发货' }).click()
  risk = page.locator('.risk-dialog')
  const deviceField = risk.locator('.el-form-item', { hasText: '选择在库设备' })
  await deviceField.locator('.el-select').click()
  const deviceControls = await deviceField.getByRole('combobox').getAttribute('aria-controls')
  await page.locator(`#${deviceControls}`).getByRole('option', { name: new RegExp(stock.deviceSN) }).click()
  await page.keyboard.press('Escape')
  const warehouseField = risk.locator('.el-form-item', { hasText: '发货仓库' })
  await warehouseField.locator('.el-select').click()
  const warehouseControls = await warehouseField.getByRole('combobox').getAttribute('aria-controls')
  await page.locator(`#${warehouseControls}`).getByRole('option', { name: new RegExp(stock.warehouseName) }).click()
  await risk.locator('.el-form-item', { hasText: '交付方式' }).locator('.el-select').click()
  await page.getByRole('option', { name: '物流配送', exact: true }).click()
  await risk.getByPlaceholder('请输入物流/交付单号').fill('DELIVERY-E2E-PURCHASE-001')
  await risk.locator('.el-form-item', { hasText: '发货日期' }).locator('input').fill('2026-09-02')
  await risk.locator('.el-form-item', { hasText: '发货日期' }).locator('input').press('Enter')
  await risk.locator('.el-form-item', { hasText: '发货说明' }).locator('textarea').fill('总部仓库完成采购履约')
  await risk.getByRole('button', { name: '确认仓库发货' }).click()
  await expect(row).toContainText('已发货')
})

test('core pages have no console errors or horizontal overflow', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await login(page)
  for (const route of ['dashboard', 'users', 'devices', 'repairs', 'payment-settings', 'logs']) {
    await page.goto(`/#/${route}`)
    await expect(page.locator('main.main-content')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
  expect(errors).toEqual([])
})

test('user related navigation opens filtered devices and restores the source detail', async ({ page }) => {
  await login(page)
  await page.goto('/#/users?tab=all&pageNum=1')
  const row = page.locator('.business-table .el-table__body tr').first()
  await row.getByRole('button', { name: '查看详情' }).click()
  const detail = page.locator('.detail-dialog')
  await expect(detail).toBeVisible()
  await detail.getByRole('button', { name: '查看设备', exact: true }).click()

  await expect(page).toHaveURL(/#\/devices\?.*rel_userId=/)
  await expect(page.locator('.relation-context-bar')).toContainText('来自用户管理')
  await expect(page.locator('.business-table .el-table__body tr').first()).toBeVisible()
  await page.locator('.relation-context-bar').getByRole('button', { name: '返回来源' }).click()

  await expect(page).toHaveURL(/#\/users\?/)
  await expect(page.locator('.detail-dialog')).toBeVisible()
})

test('warehouse creates a pending outbound order from an uploaded SN spreadsheet', async ({ page }) => {
  await login(page)
  await page.goto('/#/warehouse?tab=stock')
  const warehouseSn = (await page.locator('.business-table .el-table__body tr').first().locator('.mono-cell').first().textContent())!.trim()

  await page.goto('/#/warehouse?tab=outbound')
  await page.getByRole('button', { name: '表格出库' }).click()
  const dialog = page.getByRole('dialog', { name: '表格批量出库' })
  await expect(dialog).toBeVisible()
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'warehouse-outbound.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`SN\n${warehouseSn}`, 'utf-8'),
  })
  await expect(dialog.getByText('1 行校验通过')).toBeVisible()
  await selectFirstOption(page, dialog, '接收经销商')
  await dialog.getByPlaceholder('请输入本次批量出库说明').fill('Playwright 表格出库')
  await dialog.getByRole('button', { name: '创建出库单（1 台）' }).click()

  await expect(page.getByText('已创建包含 1 台设备的待确认出库单')).toBeVisible()
  const row = page.locator('.business-table .el-table__body tr', { hasText: warehouseSn }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText('待处理')
})

test('all 34 demo menus, tabs and available details are reachable', async ({ page }) => {
  test.setTimeout(120_000)
  const menus = [
    ['dashboard', '首页'], ['users', '用户管理'], ['dealers', '经销商管理'], ['projects', '项目管理'], ['installation-transfers', '安装跨区审核'], ['cross-region-activations', '跨区域激活异常'],
    ['devices', '设备管理'], ['product-catalog', '产品与型号'], ['warehouses', '仓库与库位'], ['warehouse', '仓库设备'], ['ota', 'OTA 管理'], ['repairs', '故障报修'],
    ['messages', '客服留言'], ['complaints', '投诉管理'], ['materials', '物料采购'], ['material-catalog', '物料与库存'],
    ['issuance', '物料发放记录'], ['approval-center', '审批中心'], ['couriers', '物流配置'], ['sn-replacement', '换 SN 管理'],
    ['service-transfer', '售后转移'], ['warranty', '质保规则'], ['approval-flow', '审批流程'], ['after-sales-types', '售后类型配置'],
    ['payments', '支付订单'], ['payment-settings', '支付配置'], ['banners', 'Banner 管理'], ['faq-documents', '常见问题 PDF'], ['support-settings', '客服信息'],
    ['launch-settings', 'APP 启动页'], ['app-versions', '客户端版本'], ['admins', '管理员账号'], ['roles', '角色权限'], ['logs', '操作日志'],
  ] as const
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await login(page)

  for (const [route, title] of menus) {
    await page.goto(`/#/${route}`)
    await expect(page.locator('main.main-content')).toBeVisible()
    if (route === 'dashboard') await expect(page.getByText('运营工作台', { exact: true })).toBeVisible()
    else await expect(page.locator('.page-heading h1')).toHaveText(title)
    await expect(page.getByText('没有访问权限')).toHaveCount(0)
    await expect(page.getByText('页面不存在')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), route).toBe(true)

    const tabItems = page.locator('.module-tabs .el-tabs__item')
    for (let index = 0; index < await tabItems.count(); index += 1) {
      await tabItems.nth(index).click()
      await expect(tabItems.nth(index)).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('.page-panel')).toBeVisible()
    }

    if (route !== 'dashboard' && route !== 'payment-settings') {
      await page.goto(`/#/${route}`)
      const view = page.locator('.business-table').getByRole('button', { name: '查看' }).first()
      if (await view.count()) {
        await view.click()
        const detail = page.locator('.detail-dialog')
        await expect(detail).toBeVisible()
        await expect(detail.locator('.detail-summary')).toBeVisible()
        await detail.getByRole('button', { name: '关闭', exact: true }).click()
      }
    }
  }

  expect(errors).toEqual([])
})

test('1024px layout collapses the sidebar without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await login(page)
  await page.goto('/#/devices')
  await expect(page.locator('.app-shell')).toHaveClass(/collapsed/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.getByRole('button', { name: '查看' }).first().click()
  const detailDialog = page.locator('.detail-dialog')
  await expect(detailDialog).toBeVisible()
  await expect.poll(() => detailDialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) <= 2
      && rect.top >= 0
      && rect.bottom <= window.innerHeight
  })).toBe(true)
  await expect(page.locator('.el-drawer')).toHaveCount(0)
  await detailDialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByTitle('通知中心').click()
  const notificationDialog = page.locator('.notification-dialog')
  await expect(notificationDialog).toBeVisible()
  await expect.poll(() => notificationDialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) <= 2
  })).toBe(true)
})

test('all 34 business routes stay nonblank and overflow-free at both acceptance viewports', async ({ page }) => {
  test.setTimeout(90_000)
  const routes = [
    'dashboard', 'users', 'dealers', 'projects', 'installation-transfers', 'cross-region-activations', 'devices', 'product-catalog', 'warehouses', 'warehouse', 'ota', 'repairs',
    'messages', 'complaints', 'materials', 'material-catalog', 'issuance', 'approval-center', 'couriers',
    'sn-replacement', 'service-transfer', 'warranty', 'approval-flow', 'after-sales-types', 'payments',
    'payment-settings', 'banners', 'faq-documents', 'support-settings', 'launch-settings', 'app-versions', 'admins', 'roles', 'logs',
  ]
  await login(page)
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport)
    for (const route of routes) {
      await page.goto(`/#/${route}`)
      await expect(page.locator('main.main-content')).toBeVisible()
      const result = await page.evaluate(() => {
        const main = document.querySelector('main.main-content')
        const blocks = [...document.querySelectorAll('.page-heading, .module-tabs, .filter-grid, .table-toolbar, .business-table, .pagination-bar')]
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0)
        const overlaps = blocks.flatMap((rect, index) => blocks.slice(index + 1).map((other) => {
          const overlapWidth = Math.min(rect.right, other.right) - Math.max(rect.left, other.left)
          const overlapHeight = Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top)
          return overlapWidth > 4 && overlapHeight > 4
        })).filter(Boolean).length
        return {
          textLength: main?.textContent?.trim().length || 0,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          overlaps,
        }
      })
      expect(result.textLength, `${viewport.width}x${viewport.height} ${route} nonblank`).toBeGreaterThan(80)
      expect(result.overflow, `${viewport.width}x${viewport.height} ${route} overflow`).toBe(false)
      expect(result.overlaps, `${viewport.width}x${viewport.height} ${route} layout overlap`).toBe(0)
    }
  }
})

test('sidebar groups expand, collapse and remember their state', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('link', { name: '数据概览' })).toHaveCount(0)
  await page.goto('/#/analytics')
  await expect(page).toHaveURL(/#\/dashboard/)
  const operations = page.locator('.nav-group', { has: page.getByRole('button', { name: '客户与渠道' }) })
  const trigger = operations.getByRole('button', { name: '客户与渠道' })

  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(operations.locator('.nav-group-items')).toHaveCSS('opacity', '1')
  await expect(page.locator('.nav-group-trigger[aria-expanded="true"]')).toHaveCount(6)
  await expect(page.locator('.nav-subgroup-title')).toContainText(['工单服务', '物料履约', '售后配置', '交易管理', '内容运营'])
  await expect(page.locator('.nav-badge')).toHaveCount(0)

  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await page.reload()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await page.goto('/#/users')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(operations.getByRole('link', { name: '用户管理' })).toBeVisible()
})

test('user details keep server-saved waypoints out of the admin interface', async ({ page }) => {
  await login(page)
  await page.goto('/#/users')
  await page.getByRole('button', { name: '查看详情' }).first().click()
  const dialog = page.getByRole('dialog', { name: '用户管理详情' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('tab')).toHaveText(['基本信息', '绑定设备'])
  await expect(dialog.getByRole('tab', { name: '航点数据' })).toHaveCount(0)
})

test('module filters keep labels above controls and navigation spacing compact', async ({ page }) => {
  await login(page)
  await page.goto('/#/payments?tab=failed')
  const filter = page.locator('.filter-field').first()
  await expect(filter.locator('.filter-label')).toBeVisible()
  const positions = await filter.evaluate((element) => {
    const label = element.querySelector<HTMLElement>('.filter-label')!.getBoundingClientRect()
    const control = element.querySelector<HTMLElement>('.domain-filter-control, .domain-date-filter')!.getBoundingClientRect()
    return { labelBottom: label.bottom, controlTop: control.top, controlHeight: control.height }
  })
  expect(positions.labelBottom).toBeLessThanOrEqual(positions.controlTop)
  expect(positions.controlHeight).toBeLessThanOrEqual(40)
  await expect(filter.locator('.filter-search > .el-input__wrapper')).toHaveCount(1)
  const borderLayers = await filter.locator('.filter-search').evaluate((element) => {
    const root = getComputedStyle(element)
    const wrapper = getComputedStyle(element.querySelector<HTMLElement>('.el-input__wrapper')!)
    return { outerBorder: root.borderTopWidth, innerShadow: wrapper.boxShadow }
  })
  expect(borderLayers.outerBorder).toBe('0px')
  expect(borderLayers.innerShadow).not.toBe('none')
  await filter.locator('input').focus()
  const focusLayers = await filter.locator('.filter-search').evaluate((element) => {
    const root = getComputedStyle(element)
    const wrapper = getComputedStyle(element.querySelector<HTMLElement>('.el-input__wrapper')!)
    return { outerBorder: root.borderTopWidth, inputOutline: getComputedStyle(element.querySelector('input')!).outlineStyle, wrapperShadow: wrapper.boxShadow }
  })
  expect(focusLayers.outerBorder).toBe('0px')
  expect(focusLayers.inputOutline).toBe('none')
  expect(focusLayers.wrapperShadow).not.toContain('3px')
  const gap = await page.locator('.nav-item').first().evaluate((element) => getComputedStyle(element).columnGap)
  expect(gap).toBe('6px')

  const repairDealer = await page.evaluate(() => {
    const database = JSON.parse(localStorage.getItem('shark-sister-admin.db.v15') || '{}')
    const repair = (database.records?.repairs || []).find((item: Record<string, unknown>) => item.dealerId && item.dealer)
    return { id: String(repair?.dealerId || ''), name: String(repair?.dealer || '') }
  })
  await page.goto('/#/repairs')
  const dealerFilter = page.locator('.filter-field', { hasText: '代理归属' })
  await expect(dealerFilter).toBeVisible()
  await dealerFilter.locator('.el-select').click()
  const dealerControls = await dealerFilter.getByRole('combobox').getAttribute('aria-controls')
  await page.locator(`#${dealerControls}`).getByRole('option', { name: new RegExp(repairDealer.name) }).click()
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const repairRows = page.locator('.business-table .el-table__body tr')
  await expect(repairRows.first()).toContainText(repairDealer.name)
  expect(await repairRows.count()).toBeGreaterThan(0)
})

test('single-device inbound creates one visible stock record and keeps one input border', async ({ page }) => {
  await login(page)
  await page.goto('/#/warehouse?tab=stock')
  await page.getByRole('button', { name: '设备入库' }).click()

  const dialog = page.locator('.entity-dialog')
  await expect(dialog).toBeVisible()
  const regionField = dialog.locator('.el-form-item', { hasText: '销售地区' })
  const regionInput = regionField.locator('input')
  await regionInput.focus()
  const borderLayers = await regionField.locator('.el-input').evaluate((element) => {
    const root = getComputedStyle(element)
    const input = getComputedStyle(element.querySelector('input')!)
    const wrapper = getComputedStyle(element.querySelector<HTMLElement>('.el-input__wrapper')!)
    return { outerBorder: root.borderTopWidth, inputOutline: input.outlineStyle, wrapperShadow: wrapper.boxShadow }
  })
  expect(borderLayers.outerBorder).toBe('0px')
  expect(borderLayers.inputOutline).toBe('none')
  expect(borderLayers.wrapperShadow).not.toBe('none')

  const sn = 'WH-E2E-20260812001'
  await selectOptionContaining(page, dialog, '设备类型', '制冷设备')
  await selectOptionContaining(page, dialog, '设备型号', 'CI-02')
  await dialog.getByPlaceholder('请输入设备 SN').fill(sn)
  await regionInput.fill('中国 · 广东')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()

  const row = page.locator('.business-table .el-table__body tr', { hasText: sn }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText('制冷设备')
  await expect(row).toContainText('CI-02')
  await expect(row).toContainText('220V · 60kg/日')
  await expect(row).toContainText('正常')
})

test('platform can create data from every remaining V3.2 maintenance form', async ({ page }) => {
  test.setTimeout(90_000)
  await login(page)

  await page.goto('/#/dealers')
  await page.getByRole('button', { name: '新增经销商' }).click()
  let dialog = page.locator('.entity-dialog')
  await dialog.getByPlaceholder('请输入登录账号').fill('e2edealer@shark.cn')
  await dialog.getByPlaceholder('请输入初始密码').fill('Dealer123!')
  await dialog.getByPlaceholder('请输入经销商名称').fill('端到端菜单经销商')
  await dialog.getByPlaceholder('请输入负责地区').fill('中国 · 浙江')
  await dialog.locator('.el-form-item', { hasText: '经销商层级' }).locator('.el-select').click()
  await page.getByRole('option', { name: '一级', exact: true }).click()
  await dialog.getByPlaceholder('请输入联系电话').fill('13800138009')
  await dialog.getByPlaceholder('请输入联系邮箱').fill('e2edealer@shark.cn')
  await dialog.locator('.el-form-item', { hasText: '账号状态' }).locator('.el-select').click()
  await page.getByRole('option', { name: '正常', exact: true }).click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.business-table .el-table__body tr', { hasText: '端到端菜单经销商' })).toBeVisible()

  await page.goto('/#/devices')
  await page.getByRole('button', { name: '录入设备' }).click()
  dialog = page.locator('.entity-dialog')
  await dialog.getByPlaceholder('请输入设备 SN').fill('E2E-MENU-DEVICE-20260812')
  await dialog.locator('.el-form-item', { hasText: '产品/型号' }).locator('.el-select').click()
  await page.getByRole('option', { name: /^制冰机 CI-02/ }).click()
  await dialog.getByPlaceholder('请输入销售地区').fill('中国 · 广东')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  const deviceRow = page.locator('.business-table .el-table__body tr', { hasText: 'E2E-MENU-DEVICE-20260812' })
  await expect(deviceRow).toBeVisible()
  await expect(deviceRow).toContainText('未激活')
  await expect(deviceRow).toContainText('v1.0.0')

  await page.goto('/#/ota')
  await page.getByRole('button', { name: '新增固件版本' }).click()
  dialog = page.locator('.entity-dialog')
  await dialog.getByPlaceholder('请输入版本号').fill('8.7.6')
  await dialog.locator('.el-form-item', { hasText: '适用产品型号' }).locator('.el-select').click()
  await page.getByRole('option', { name: /^制冰机 CI-02/ }).click()
  await dialog.locator('.el-form-item', { hasText: '版本说明' }).locator('textarea').fill('端到端全菜单固件')
  await dialog.locator('.el-form-item', { hasText: '固件文件' }).locator('input[type="file"]').setInputFiles({ name: 'e2e-menu.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('demo firmware') })
  await dialog.locator('.el-form-item', { hasText: '发布状态' }).locator('.el-select').click()
  await page.getByRole('option', { name: '草稿', exact: true }).click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.business-table .el-table__body tr', { hasText: '8.7.6' })).toContainText('端到端全菜单固件')

  await page.goto('/#/material-catalog')
  await page.getByRole('button', { name: '新增物料' }).click()
  dialog = page.locator('.entity-dialog')
  await dialog.getByPlaceholder('请输入物料名称').fill('端到端菜单密封组件')
  await dialog.locator('.el-form-item', { hasText: '适用设备' }).locator('.el-select').click()
  await page.getByRole('option', { name: /^制冰机 CI-02/ }).click()
  await dialog.locator('.el-form-item', { hasText: '采购价' }).locator('input').fill('168')
  await dialog.locator('.el-form-item', { hasText: '库存数量' }).locator('input').fill('25')
  await dialog.locator('.el-form-item', { hasText: '启用状态' }).locator('.el-select').click()
  await page.getByRole('option', { name: '正常', exact: true }).click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.business-table .el-table__body tr', { hasText: '端到端菜单密封组件' })).toContainText('25')

  await page.goto('/#/couriers')
  await page.getByRole('button', { name: '新增快递公司' }).click()
  dialog = page.locator('.entity-dialog')
  await dialog.getByPlaceholder('请输入快递公司名称').fill('端到端菜单快递')
  await dialog.getByPlaceholder('请输入快递100编码').fill('e2e-menu-express')
  await dialog.getByPlaceholder('请输入API Key').fill('e2e-secret-5678')
  await dialog.locator('.el-form-item', { hasText: '启用状态' }).locator('.el-select').click()
  await page.getByRole('option', { name: '正常', exact: true }).click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  const courierRow = page.locator('.business-table .el-table__body tr', { hasText: '端到端菜单快递' })
  await expect(courierRow).toBeVisible()
  await expect(courierRow).toContainText('********5678')
})

test('dealer-created records continue through platform approval and target-dealer confirmation', async ({ page }) => {
  test.setTimeout(120_000)
  await login(page, 'tier1@dealer.cn', 'Dealer123!')

  await page.goto('/#/devices')
  const replacementSource = 'BX202608100021'
  const transferSource = 'BX202607280311'
  await expect(page.locator('.business-table .el-table__body tr', { hasText: replacementSource })).toBeVisible()
  await expect(page.locator('.business-table .el-table__body tr', { hasText: transferSource })).toBeVisible()

  await page.goto('/#/warranty')
  await page.getByRole('button', { name: '新增质保规则' }).click()
  let dialog = page.locator('.entity-dialog')
  await dialog.locator('.el-form-item', { hasText: '产品类型' }).locator('.el-select').click()
  await page.getByRole('option', { name: /^电池组 BP-03/ }).click()
  await selectFirstOption(page, dialog, '设置经销商')
  await dialog.locator('.el-form-item', { hasText: '免人工费时间' }).locator('input').fill('18')
  await dialog.locator('.el-form-item', { hasText: '物料质保时间' }).locator('input').fill('24')
  await dialog.locator('.el-form-item', { hasText: '启用状态' }).locator('.el-select').click()
  await page.getByRole('option', { name: '正常', exact: true }).click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.business-table .el-table__body tr', { hasText: '电池组 BP-03' })).toContainText('24')

  await page.goto('/#/materials')
  await page.getByRole('button', { name: '发起物料申请' }).click()
  dialog = page.locator('.entity-dialog')
  await selectFirstOption(page, dialog, '物料名称')
  await dialog.locator('.el-form-item', { hasText: '申请数量' }).locator('input').fill('1')
  await selectFirstOption(page, dialog, '设备 SN')
  await dialog.locator('.el-form-item', { hasText: '申请类型' }).locator('.el-select').click()
  await page.getByRole('option', { name: '普通申请', exact: true }).click()
  await dialog.locator('.el-form-item', { hasText: '申请说明' }).locator('textarea').fill('端到端跨角色物料申请')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  const materialRow = page.locator('.business-table .el-table__body tr', { hasText: replacementSource }).first()
  await expect(materialRow).toBeVisible()
  const materialCode = (await materialRow.locator('.mono-cell').first().textContent())!.trim()

  await page.goto('/#/warehouse?tab=transfer')
  await page.getByRole('button', { name: '发起调货申请' }).click()
  dialog = page.locator('.entity-dialog')
  const transferSelect = dialog.locator('.el-form-item', { hasText: '选择可调货设备' }).locator('.el-select')
  await transferSelect.click()
  const transferControls = await transferSelect.getByRole('combobox').getAttribute('aria-controls')
  const transferOption = page.locator(`#${transferControls}`).getByRole('option').filter({ hasNotText: replacementSource }).filter({ hasNotText: transferSource }).first()
  await expect(transferOption).toBeVisible()
  const selectedTransferText = await transferOption.innerText()
  const selectedTransferSN = selectedTransferText.split(' · ')[0].trim()
  await transferOption.click()
  await page.keyboard.press('Escape')
  await expect(page.locator(`#${transferControls}`)).not.toBeVisible()
  await selectFirstOption(page, dialog, '目标经销商')
  await dialog.locator('.el-form-item', { hasText: '调货原因' }).locator('textarea').fill('端到端跨角色调货')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  const transferRow = page.locator('.business-table .el-table__body tr').first()
  await expect(transferRow).toBeVisible()
  const warehouseCode = (await transferRow.locator('.mono-cell').first().textContent())!.trim()

  await page.goto('/#/sn-replacement')
  await page.getByRole('button', { name: '发起换 SN' }).click()
  dialog = page.locator('.entity-dialog')
  await selectOptionContaining(page, dialog, '原设备 SN', replacementSource)
  await expect(dialog.locator('.el-form-item', { hasText: '原设备型号' }).locator('input')).not.toHaveValue('')
  await expect(dialog.locator('.el-form-item', { hasText: '原设备类型' }).locator('input')).not.toHaveValue('')
  await dialog.getByPlaceholder('请输入新设备 SN').fill('E2E-DEALER-NEW-SN-20260812')
  await dialog.getByPlaceholder('请输入新设备名称').fill('端到端换机设备')
  const replacementModelField = dialog.locator('.el-form-item', { hasText: '新设备型号' })
  await replacementModelField.locator('.el-select').click()
  const replacementModelControls = await replacementModelField.getByRole('combobox').getAttribute('aria-controls')
  await page.locator(`#${replacementModelControls}`).getByRole('option', { name: '海水淡化器 SW-04' }).click()
  await expect(dialog.locator('.el-form-item', { hasText: '型号编码' }).locator('input')).toHaveValue('SW-04')
  await expect(dialog.locator('.el-form-item', { hasText: '设备类型' }).last().locator('input')).toHaveValue('水处理设备')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  let row = page.locator('.business-table .el-table__body tr', { hasText: 'E2E-DEALER-NEW-SN-20260812' }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText('端到端换机设备')
  await expect(row).toContainText('SW-04')
  await expect(row).toContainText('水处理设备')
  await row.getByRole('button', { name: '处理' }).click()
  let risk = page.locator('.risk-dialog')
  await risk.getByLabel('操作原因').fill('端到端换 SN 确认')
  await risk.getByRole('button', { name: '确认换 SN 确认' }).click()
  await expect(row).toContainText('已完成')

  await page.goto('/#/service-transfer')
  await page.getByRole('button', { name: '发起售后转移' }).click()
  dialog = page.locator('.entity-dialog')
  await selectOptionContaining(page, dialog, '设备 SN', transferSource)
  await selectFirstOption(page, dialog, '目标经销商')
  await dialog.locator('.el-form-item', { hasText: '转移原因' }).locator('textarea').fill('端到端售后转移')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  row = page.locator('.business-table .el-table__body tr', { hasText: transferSource }).first()
  await expect(row).toBeVisible()
  expect(selectedTransferSN).not.toBe(transferSource)

  await logout(page)
  await login(page, 'service@qingdao.cn', 'Dealer123!')
  await page.goto('/#/service-transfer')
  row = page.locator('.business-table .el-table__body tr', { hasText: transferSource }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '确认售后转移' }).click()
  risk = page.locator('.risk-dialog')
  await risk.locator('.el-form-item', { hasText: '确认结果' }).locator('.el-select').click()
  await page.getByRole('option', { name: '确认接收', exact: true }).click()
  await risk.getByLabel('操作原因').fill('目标经销商端到端确认')
  await risk.getByRole('button', { name: '确认确认售后转移' }).click()
  await expect(row).toContainText('已完成')

  await logout(page)
  await login(page)
  await page.goto('/#/materials')
  row = page.locator('.business-table .el-table__body tr', { hasText: materialCode }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '通过' }).click()
  risk = page.locator('.risk-dialog')
  await risk.locator('.el-form-item', { hasText: '确认意见' }).locator('textarea').fill('平台端到端审批')
  await risk.getByRole('button', { name: '确认业务确认通过' }).click()
  await expect(row).toContainText('已审批')
  await row.getByRole('button', { name: '物料发货' }).click()
  risk = page.locator('.risk-dialog')
  await selectFirstOption(page, risk, '快递公司')
  await risk.getByPlaceholder('请输入物流单号').fill('E2E-DEALER-SHIP-20260812')
  await risk.getByRole('button', { name: '确认物料发货' }).click()
  await expect(row).toContainText('运输中')
  await row.getByRole('button', { name: '查看详情', exact: true }).click()
  await page.getByRole('tab', { name: '物流信息' }).click()
  await expect(page.locator('.detail-dialog')).toContainText('E2E-DEALER-SHIP-20260812')
  await page.locator('.detail-dialog').getByRole('button', { name: '关闭', exact: true }).click()

  await page.goto('/#/warehouse?tab=transfer')
  row = page.locator('.business-table .el-table__body tr', { hasText: warehouseCode }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '处理' }).click()
  risk = page.locator('.risk-dialog')
  await risk.locator('.el-form-item', { hasText: '处理结果' }).locator('.el-select').click()
  await page.getByRole('option', { name: '审批通过', exact: true }).click()
  await risk.getByLabel('操作原因').fill('平台端到端调货审批')
  await risk.getByRole('button', { name: '确认处理' }).click()
  await expect(row).toContainText('已完成')

  await page.goto('/#/issuance')
  await expect(page.locator('.business-table .el-table__body tr').first()).toContainText('运输中')
})

test('App-originated repair, message and complaint records complete their backend workflows', async ({ page }) => {
  test.setTimeout(120_000)
  await login(page)

  await page.goto('/#/repairs?tab=pending')
  let row = page.locator('.business-table .el-table__body tr').first()
  await expect(row).toBeVisible()
  const repairCode = (await row.locator('.mono-cell').first().textContent())!.trim()
  await row.getByRole('button', { name: '分配' }).click()
  let risk = page.locator('.risk-dialog')
  await selectFirstOption(page, risk, '处理经销商')
  await risk.locator('.el-form-item', { hasText: '分配说明' }).locator('textarea').fill('自动化分配至可处理经销商')
  await risk.getByRole('button', { name: '确认分配处理' }).click()
  await expect(page.locator('.business-table .el-table__body tr', { hasText: repairCode })).toHaveCount(0)

  await page.goto('/#/repairs?tab=processing')
  row = page.locator('.business-table .el-table__body tr', { hasText: repairCode }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '回复' }).click()
  risk = page.locator('.risk-dialog')
  await risk.locator('.el-form-item', { hasText: '回复内容' }).locator('textarea').fill('已完成远程排查，准备关闭工单。')
  await risk.getByRole('button', { name: '确认回复用户' }).click()
  await clickRowAction(page, row, '标记完成')
  risk = page.locator('.risk-dialog')
  await risk.locator('.el-form-item', { hasText: '处理结果' }).locator('textarea').fill('设备恢复正常，工单处理完成。')
  await risk.getByRole('button', { name: '确认标记完成' }).click()
  await page.goto('/#/repairs?tab=completed')
  row = page.locator('.business-table .el-table__body tr', { hasText: repairCode }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '查看详情', exact: true }).click()
  await page.getByRole('tab', { name: '回复记录' }).click()
  await expect(page.locator('.detail-dialog')).toContainText('已完成远程排查')
  await page.locator('.detail-dialog').getByRole('button', { name: '关闭', exact: true }).click()

  await page.goto('/#/messages?tab=unreplied')
  row = page.locator('.business-table .el-table__body tr').first()
  await expect(row).toBeVisible()
  const messageContent = (await row.locator('td').nth(2).textContent())!.trim()
  await row.getByRole('button', { name: '回复' }).click()
  risk = page.locator('.risk-dialog')
  await risk.locator('.el-form-item', { hasText: '回复内容' }).locator('textarea').fill('留言已受理，处理结果已通过站内通知同步。')
  await risk.getByRole('button', { name: '确认查看并回复' }).click()
  await page.goto('/#/messages?tab=replied')
  await expect(page.locator('.business-table .el-table__body tr', { hasText: messageContent })).toBeVisible()

  await page.goto('/#/complaints?tab=pending')
  row = page.locator('.business-table .el-table__body tr').first()
  await expect(row).toBeVisible()
  const complaintCode = (await row.locator('.mono-cell').first().textContent())!.trim()
  await row.getByRole('button', { name: '分配' }).click()
  risk = page.locator('.risk-dialog')
  await selectFirstOption(page, risk, '处理人员')
  await risk.locator('.el-form-item', { hasText: '操作原因' }).locator('textarea').fill('投诉分配给当前数据域处理人员')
  await risk.getByRole('button', { name: '确认分配处理' }).click()
  await page.goto('/#/complaints?tab=processing')
  row = page.locator('.business-table .el-table__body tr', { hasText: complaintCode }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '回复' }).click()
  risk = page.locator('.risk-dialog')
  await risk.locator('.el-form-item', { hasText: '回复内容' }).locator('textarea').fill('已联系用户核实投诉情况。')
  await risk.getByRole('button', { name: '确认回复用户' }).click()
  await clickRowAction(page, row, '标记完成')
  risk = page.locator('.risk-dialog')
  await risk.locator('.el-form-item', { hasText: '处理结果' }).locator('textarea').fill('问题已解决并完成回访。')
  await risk.getByRole('button', { name: '确认标记完成' }).click()
  await page.goto('/#/complaints?tab=completed')
  await expect(page.locator('.business-table .el-table__body tr', { hasText: complaintCode })).toBeVisible()
})

test('approval flow create stays visible and uses generated identifiers', async ({ page }) => {
  await login(page)
  await page.goto('/#/approval-flow')
  const tableRows = page.locator('.business-table .el-table__body tr')
  await expect(tableRows.first()).toBeVisible()
  const before = await tableRows.count()
  await page.getByRole('button', { name: '新增审批流程' }).click()
  await page.getByPlaceholder('请输入流程名称').fill('E2E 调货备用审批流程')
  await page.locator('.el-form-item', { hasText: '适用菜单' }).locator('.el-select').click()
  await page.getByRole('option', { name: '仓库设备（调货审批）', exact: true }).click()
  await page.locator('.el-form-item', { hasText: '审核层级' }).locator('.el-select').click()
  await page.getByRole('option', { name: '平台直接审核', exact: true }).click()
  const memberSelect = page.locator('.el-form-item', { hasText: '平台审核人员' }).locator('.el-select')
  await memberSelect.click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.locator('.el-form-item', { hasText: '启用状态' }).locator('.el-select').click()
  await page.getByRole('option', { name: '已禁用', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  const row = page.locator('.business-table .el-table__body tr', { hasText: 'E2E 调货备用审批流程' }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText('仓库设备（调货审批）')
  await expect(page.locator('.business-table .el-table__body tr')).toHaveCount(before + 1)
  await expect(row.locator('.main-cell small')).toHaveText(/^APF-\d{11}$/)
})

test('module export follows the role export permission and current tab', async ({ page }) => {
  await login(page)
  await page.goto('/#/devices?tab=online')
  const exportButton = page.getByTitle('导出当前筛选结果')
  await expect(exportButton).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await exportButton.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toContain('设备管理-已连接')

  await logout(page)
  await page.evaluate(() => {
    const key = 'shark-sister-admin.db.v15'
    const database = JSON.parse(localStorage.getItem(key) || '{}')
    const role = database.records.roles.find((item: Record<string, unknown>) => item.roleKey === 'tier1')
    role.permissions = role.permissions.filter((permission: string) => permission !== 'devices:export')
    localStorage.setItem(key, JSON.stringify(database))
  })
  await page.reload()
  await login(page, 'tier1@dealer.cn', 'Dealer123!')
  await page.goto('/#/devices')
  await expect(page.getByTitle('导出当前筛选结果')).toHaveCount(0)
})

test('business pages fill supported viewports and keep functional text readable', async ({ page }) => {
  await page.setViewportSize({ width: 2133, height: 1000 })
  await login(page)

  for (const width of [2133, 1920, 1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1024 ? 900 : 1000 })
    for (const route of ['dashboard', 'users', 'devices', 'repairs', 'payment-settings', 'logs']) {
      await page.goto(`/#/${route}`)
      await expect(page.locator('main.main-content')).toBeVisible()
      const result = await page.evaluate(() => {
        const main = document.querySelector<HTMLElement>('.main-content')!
        const content = document.querySelector<HTMLElement>('.page, .module-page')!
        const mainRect = main.getBoundingClientRect()
        const contentRect = content.getBoundingClientRect()
        const fontViolations = Array.from(document.querySelectorAll<HTMLElement>('small, p, time, .eyebrow, td, th, button, a, label, dt'))
          .filter((element) => {
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            return rect.width > 0 && rect.height > 0
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && Boolean(element.textContent?.trim())
              && Number.parseFloat(style.fontSize) < 12
              && !element.closest('.notify-button, .title-with-count, .captcha')
          })
          .map((element) => element.textContent?.trim().slice(0, 40))
        return {
          leftGap: contentRect.left - mainRect.left,
          rightGap: window.innerWidth - contentRect.right,
          hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          fontViolations,
        }
      })
      const expectedGap = width < 1280 ? 16 : 24
      expect(Math.round(result.leftGap)).toBe(expectedGap)
      expect(Math.round(result.rightGap)).toBe(expectedGap)
      expect(result.hasOverflow).toBe(false)
      expect(result.fontViolations).toEqual([])
    }
  }
})

test('account trigger is single-line and dropdown exposes account context', async ({ page }) => {
  await login(page)
  const trigger = page.getByRole('button', { name: '林海账号菜单' })
  await expect(trigger).toBeVisible()
  await expect(trigger.locator('small')).toHaveCount(0)
  await trigger.click()
  const summary = page.locator('.account-menu-summary')
  await expect(summary).toContainText('林海')
  await expect(summary).toContainText('平台管理员')
  await expect(summary).toContainText('admin@shark.cn')
  await expect(summary).toContainText('国内数据域')
})

test('Banner uses the V3.2 text jump link and fixed enabled states', async ({ page }) => {
  await login(page)
  await page.goto('/#/banners')
  await page.getByRole('button', { name: /新增.*Banner/ }).click()
  await page.getByPlaceholder('请输入Banner 名称').fill('经销商项目入口')
  await page.locator('.el-form-item', { hasText: 'Banner 图片' }).locator('input[type="file"]').setInputFiles('public/assets/illustrations/empty-no-results.png')
  await expect(page.locator('.image-uploader img')).toBeVisible()
  await page.getByPlaceholder('请输入跳转链接').fill('/projects')
  await page.locator('.el-form-item', { hasText: '状态' }).locator('.el-select').click()
  await page.getByRole('option', { name: '已启用', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.business-table .el-table__body tr', { hasText: '经销商项目入口' })).toContainText('/projects')
})

test('administrator creation, first-password setup and disable affect login', async ({ page }) => {
  test.setTimeout(60_000)
  await login(page)
  await page.goto('/#/admins')
  await page.getByRole('button', { name: '新增管理员账号' }).click()
  await page.getByPlaceholder('请输入管理员账号').fill('e2e-ops@shark.cn')
  await page.getByPlaceholder('请输入初始密码').fill('Ops12345!')
  await page.getByPlaceholder('请输入姓名').fill('端到端客服')
  await page.locator('.el-form-item', { hasText: '角色' }).locator('.el-select').click()
  await page.getByRole('option', { name: '总部售后 · all', exact: true }).click()
  await page.locator('.el-form-item', { hasText: '归属组织' }).locator('.el-select').click()
  await page.getByRole('option', { name: '平台中心', exact: true }).click()
  await page.locator('.el-form-item', { hasText: '账号状态' }).locator('.el-select').click()
  await page.getByRole('option', { name: '正常', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('端到端客服', { exact: true })).toBeVisible()

  await logout(page)
  await login(page, 'e2e-ops@shark.cn', 'Ops12345!')
  await expect(page).toHaveURL(/#\/first-password/)
  await page.getByRole('textbox', { name: '新密码', exact: true }).fill('OpsNew123!')
  await page.getByRole('textbox', { name: '确认新密码', exact: true }).fill('OpsNew123!')
  await page.getByRole('button', { name: '保存并进入后台' }).click()
  await expect(page).toHaveURL(/#\/dashboard/)

  await logout(page)
  await login(page)
  await page.goto('/#/admins')
  const row = page.locator('.business-table .el-table__body tr', { hasText: '端到端客服' }).first()
  await clickRowAction(page, row, '禁用')
  await page.getByLabel('操作原因').fill('停用测试账号')
  await page.getByRole('button', { name: '确认禁用', exact: true }).click()
  await expect(page.locator('.risk-dialog')).toHaveCount(0)
  await logout(page)
  await page.locator('.auth-form').getByLabel('账号').fill('e2e-ops@shark.cn')
  await page.locator('.auth-form').getByLabel('密码').fill('OpsNew123!')
  await page.getByRole('button', { name: '登录后台' }).click()
  await expect(page.getByText('账号已禁用，请联系平台管理员。')).toBeVisible()
})
