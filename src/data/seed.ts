import type { DataDomain, EntityRecord, StoredDatabase } from '@/types'

const now = new Date('2026-08-10T10:30:00+08:00')
const iso = (offset: number) => new Date(now.getTime() - offset * 3_600_000).toISOString()

const owners = [
  { ownerId: 'dealer-t1-sz', owner: '深圳海航设备有限公司', region: '中国 · 广东' },
  { ownerId: 'dealer-t2-xm', owner: '厦门蓝湾船舶服务', region: '中国 · 福建' },
  { ownerId: 'dealer-t1-us', owner: 'Pacific Marine Systems', region: '美国 · California' },
]

const templates: Record<string, Array<Partial<EntityRecord>>> = {
  users: [
    { name: '海风与帆', account: '13812345678', category: '手机', status: 'normal', deviceCount: 3, lastActive: '10 分钟前' },
    { name: 'Captain Allen', account: 'allen@oceanmail.com', category: 'Google', status: 'normal', deviceCount: 1, lastActive: '1 小时前' },
    { name: '远航号', account: '15912341033', category: '微信', status: 'normal', deviceCount: 5, lastActive: '昨天 18:03' },
    { name: 'Marina M', account: 'APPID-9F03A12C', category: 'APPID', status: 'normal', deviceCount: 0, lastActive: '08-07 10:21' },
    { name: '蓝鲸 07', account: '13712349004', category: '手机', status: 'disabled', deviceCount: 2, lastActive: '07-30 15:42' },
  ],
  dealers: [
    { name: '深圳海航设备有限公司', category: '一级', status: 'normal', account: 'service@haihang.cn', organizationId: 'dealer-t1-sz', ownerId: 'dealer-t1-sz', domain: 'cn', defaultWarrantyYears: 2, deviceCount: 1286 },
    { name: '厦门蓝湾船舶服务', category: '二级', status: 'normal', account: 'service@lanwan.cn', organizationId: 'dealer-t2-xm', ownerId: 'dealer-t2-xm', parentDealerId: 'dealer-t1-sz', domain: 'cn', defaultWarrantyYears: 2, deviceCount: 246 },
    { name: 'Pacific Marine Systems', category: '一级', status: 'normal', account: 'ops@pacificmarine.us', organizationId: 'dealer-t1-us', ownerId: 'dealer-t1-us', domain: 'global', deviceCount: 982 },
    { name: 'Harbour Tech Southampton', category: '二级', status: 'normal', account: 'service@harbour.uk', organizationId: 'dealer-t2-uk', ownerId: 'dealer-t2-uk', parentDealerId: 'dealer-t1-us', domain: 'global', deviceCount: 118 },
    { name: '宁波远洋机电', category: '二级', status: 'disabled', account: 'service@nbyy.cn', organizationId: 'dealer-t2-nb', ownerId: 'dealer-t2-nb', parentDealerId: 'dealer-t1-sz', domain: 'cn', defaultWarrantyYears: 2, deviceCount: 86 },
    { name: '青岛远海船舶设备', category: '一级', status: 'normal', account: 'service@qingdao.cn', organizationId: 'dealer-t1-qd', ownerId: 'dealer-t1-qd', domain: 'cn', defaultWarrantyYears: 2, deviceCount: 92 },
  ],
  projects: [
    { name: '远航 18', category: '制冰机 CI-02', status: 'normal', summary: '船东：张海宁 · 质保至 2028-08-09', deviceSN: 'BX202608100021' },
    { name: 'Sea Horizon', category: '海水淡化器 SW-04', status: 'normal', summary: '船东：Allen Carter · 质保至 2028-08-08', deviceSN: 'BX202608090182' },
    { name: '蓝湾 07', category: '顶流机 TF-01', status: 'warning', summary: '质保临期 43 天', deviceSN: 'BX202511140033' },
    { name: 'Arden', category: '电池组 BP-03', status: 'expired', summary: '质保已于 2026-08-03 到期', deviceSN: 'BX202409180205' },
  ],
  devices: [
    { code: 'BX202608100021', name: '制冰机 CI-02', status: 'online', activation: 'normal', firmware: 'v2.3.7', account: '13812345678', summary: '船用 60kg/日' },
    { code: 'BX202608090182', name: '海水淡化器 SW-04', status: 'online', activation: 'normal', firmware: 'v1.8.2', account: 'allen@oceanmail.com', summary: '400L/日' },
    { code: 'BX202608070045', name: '顶流机 TF-01', status: 'offline', activation: 'inactive', firmware: 'v2.4.0', account: '-', summary: '24V 智能控制' },
    { code: 'BX202607280311', name: '电池组 BP-03', status: 'offline', activation: 'normal', firmware: 'v3.1.1', account: 'marina@example.co.uk', summary: '48V 200Ah' },
    { code: 'BX202606120094', name: '网络检测仪 ND-04', status: 'disabled', activation: 'normal', firmware: 'v1.4.6', account: 'marina@example.co.uk', summary: '4G/卫星' },
  ],
  'product-catalog': [
    { code: 'PROD-001', name: '顶流机', deviceType: '船载设备', deviceModel: 'TF-01', descriptor: '顶流机 TF-01', specification: '24V/48V 智能推流', referencePrice: 68000, status: 'normal' },
    { code: 'PROD-002', name: '制冰机', deviceType: '制冷设备', deviceModel: 'CI-02', descriptor: '制冰机 CI-02', specification: '220V · 60kg/日', referencePrice: 92000, status: 'normal' },
    { code: 'PROD-003', name: '海水淡化器', deviceType: '水处理设备', deviceModel: 'SW-04', descriptor: '海水淡化器 SW-04', specification: '220V · 400L/日', referencePrice: 118000, status: 'normal' },
  ],
  warehouses: [
    { code: 'WHS-CN-001', name: '平台中心仓', category: '中心仓', region: '中国 · 广东', address: '深圳市宝安区物联二路 1 号', manager: '平台仓库组', status: 'normal' },
    { code: 'WHS-CN-002', name: '华南备件仓', category: '区域仓', region: '中国 · 福建', address: '厦门市海沧区港航路 18 号', manager: '华南仓储组', status: 'normal' },
    { code: 'WHS-GL-001', name: '海外服务仓', category: '海外仓', region: '美国 · California', address: 'Long Beach Service Center', manager: 'Global Warehouse', status: 'normal', domain: 'global' },
  ],
  'warehouse-locations': [
    { code: 'A-01-01', name: 'A 区 01-01', warehouseId: 'warehouses-0001', warehouseName: '平台中心仓', capacity: 80, status: 'normal' },
    { code: 'A-03-18', name: 'A 区 03-18', warehouseId: 'warehouses-0001', warehouseName: '平台中心仓', capacity: 60, status: 'normal' },
    { code: 'B-01-01', name: 'B 区 01-01', warehouseId: 'warehouses-0002', warehouseName: '华南备件仓', capacity: 40, status: 'normal' },
  ],
  warehouse: [
    { name: '制冰机 CI-02 批次 B2608', category: '在库', status: 'normal', summary: 'A-03-18 · 48 台' },
    { name: '华南 8 月第二批设备', category: '出库', status: 'processing', summary: '48 台 · 接收方深圳海航' },
    { name: '厦门蓝湾调货申请', category: '调货', status: 'pending', summary: '24 台 · 等待平台审批' },
    { name: 'BX202607190077 归属记录', category: '归属', status: 'completed', summary: '深圳海航 → 厦门蓝湾' },
  ],
  ota: [
    { name: 'v2.4.1', category: '固件版本', status: 'processing', deviceType: '顶流机 TF-01', summary: '优化转向控制与离线重连', firmwareFile: 'tf-v2.4.1.bin' },
    { name: 'v2.3.7', category: '固件版本', status: 'published', deviceType: '制冰机 CI-02', summary: '修复低温环境下制冰中断', firmwareFile: 'ci-v2.3.7.bin' },
  ],
  repairs: [
    { name: '制冰机不出冰', category: '制冰系统', status: 'pending', summary: 'BX202608100021 · 用户张三' },
    { name: '海水淡化器出水量不足', category: '高压泵', status: 'processing', summary: 'BX202608090182 · 已分配厦门蓝湾' },
    { name: '电池组电量异常下降', category: '电池管理', status: 'processing', summary: 'BX202607280311 · 正在检测电池状态' },
    { name: '顶流机转向抖动', category: '转向', status: 'completed', summary: '已更换转向传感器' },
  ],
  messages: [
    { name: 'Replacement filter delivery status', category: '物流咨询', status: 'pending', summary: '用户询问滤芯物流进度' },
    { name: '设备绑定后无法显示', category: '账号问题', status: 'forwarded', summary: '已转交深圳海航处理' },
    { name: '如何查看固件版本', category: '使用咨询', status: 'completed', summary: '已回复用户' },
  ],
  complaints: [
    { name: '包装破损且到货延迟', category: '物流', status: 'pending', summary: '关联 SN：BX202608100021' },
    { name: '售后响应时间过长', category: '服务态度', status: 'processing', summary: '已分配客服主管' },
    { name: '制冰效率未达到标称', category: '产品质量', status: 'completed', summary: '已完成现场检测' },
  ],
  materials: [
    { name: '高压泵密封组件 × 2', category: '提前申请', status: 'pending', summary: '质保有效 · SN BX202608090182' },
    { name: '压缩机组件 × 1', category: '普通申请', status: 'approved', summary: '等待填写物流单号' },
    { name: '温度传感器 × 4', category: '普通申请', status: 'completed', summary: '已领取并登记更换' },
    { name: '滤芯组件 × 6', category: '提前申请', status: 'rejected', summary: '设备已过质保期' },
  ],
  'material-catalog': [
    { name: '压缩机组件', category: '制冰机 CI-02', status: 'normal', price: 2860, stock: 46, summary: '预警阈值 10 套' },
    { name: '高压泵密封组件', category: '海水淡化器 SW-04', status: 'low', price: 480, stock: 8, summary: '预警阈值 12 套' },
    { name: '温度传感器', category: '电池组 BP-03', status: 'disabled', price: 92, stock: 0, summary: '当前缺货' },
  ],
  couriers: [
    { name: '顺丰速运', category: '快递公司', status: 'normal', code: 'shunfeng', summary: '今日查询 286 次 · 成功率 99.8%' },
    { name: 'DHL Express', category: '快递公司', status: 'normal', code: 'dhl', summary: '今日查询 74 次 · 成功率 98.6%' },
  ],
  'sn-replacement': [
    { name: 'BX202507190088 → BX202608090248', category: '换 SN 记录', status: 'completed', summary: '绑定用户 138****3392' },
    { name: 'BX202604040031 → BX202608070095', category: '换 SN 记录', status: 'pending', summary: '等待平台确认' },
    { name: 'BX202603020019 → BX202608060088', category: '换 SN 记录', status: 'failed', summary: '新 SN 已存在' },
  ],
  'service-transfer': [
    { name: '深圳海航 → 厦门蓝湾', category: '售后转移', status: 'pending', summary: 'BX202607190077 · 等待原方确认' },
    { name: 'Pacific Marine → Harbour Tech', category: '售后转移', status: 'processing', summary: '等待接收方确认' },
    { name: '华东海事 → 宁波远洋', category: '售后转移', status: 'completed', summary: '已完成归档' },
  ],
  'installation-transfers': [
    { name: '远航 26 安装项目', category: '安装跨区审核', status: 'pending', projectCode: 'PRJ-20260821001', deviceSN: 'DL350020260888', factoryRegion: '广东省汕头市', installationRegion: '福建省厦门市', dealer: '厦门海航设备有限公司', summary: '出厂地区与安装地区不一致，等待平台审核' },
  ],
  warranty: [
    { name: '华南制冰机标准质保', category: '制冰机 CI-02', status: 'normal', summary: '人工费 24 个月 · 物料 24 个月' },
    { name: '北美淡化器延长质保', category: '海水淡化器 SW-04', status: 'normal', summary: '人工费 36 个月 · 物料 30 个月' },
  ],
  'approval-flow': [
    { name: '二级经销商物料申请', category: '物料申请', status: 'normal', summary: '二级 → 一级 → 平台' },
  ],
  issuance: [
    { name: '压缩机组件 × 1', category: '物料发放', status: 'shipped', summary: 'SF1432280193411' },
    { name: '高压泵密封组件 × 2', category: '物料发放', status: 'received', summary: 'DHL8829012841' },
    { name: '温度传感器 × 4', category: '物料发放', status: 'completed', summary: '已于 07-29 完成更换' },
  ],
  payments: [
    { name: '制冰机延保服务', category: '微信支付', status: 'paid', amount: 1280, account: '138****5678', summary: 'CNY' },
    { name: '淡化器上门服务', category: 'PayPal', status: 'paid', amount: 320, account: 'a***@oceanmail.com', summary: 'USD' },
    { name: '电池检测服务', category: '支付宝', status: 'pending', amount: 360, account: '159****1033', summary: 'CNY' },
    { name: '网络设备远程诊断', category: 'Apple Pay', status: 'failed', amount: 85, account: 'm***@example.co.uk', summary: 'GBP' },
    { name: '顶流机技术支持', category: 'Google Pay', status: 'refunded', amount: 120, account: 'a***@marine.com', summary: 'USD' },
  ],
  banners: [
    { name: '夏季设备保养指南', category: '首页顶部', status: 'normal', image: './assets/backgrounds/banner-maintenance.png', target: '内容详情 / GUIDE-2026-08', sort: 1 },
    { name: '海水淡化器滤芯活动', category: '首页顶部', status: 'normal', image: './assets/backgrounds/banner-watermaker.png', target: '商品 / SKU-SW-FILTER', sort: 2 },
    { name: 'Marine Service Network', category: '首页顶部', status: 'draft', image: './assets/backgrounds/banner-service-network.png', target: 'Web / service-network', sort: 1, domain: 'global' },
  ],
  'faq-documents': [
    { name: '顶流机使用与故障排查手册', titleEn: 'Surface Jet User and Troubleshooting Manual', category: '常见问题', status: 'published', summary: '遥控器、安装、操作和常见故障处理说明', fileName: '鲨鱼妹妹顶流机中文.pdf', pdfFile: './documents/topflow-machine-manual-zh.pdf', sort: 1 },
  ],
  'app-versions': [
    { code: 'APP-V3.2.0', name: '3.2.0', platform: 'iOS / Android', releaseScope: '全部用户', releaseAt: '2026-08-21', status: 'published', summary: '后台配置、售后与设备管理能力更新' },
  ],
  admins: [
    { name: '林海', category: '平台', status: 'normal', account: 'admin@shark.cn', summary: '平台管理员 · 全部数据' },
    { name: '王海', category: '平台', status: 'normal', account: 'wangh@shark.cn', summary: '总部售后 · 售后与设备' },
    { name: 'Mark Wilson', category: '经销商', status: 'normal', account: 'mark@pacific.us', summary: '经销商管理员' },
    { name: '测试账号', category: '平台', status: 'locked', account: 'testops@shark.cn', summary: '客服 · 国内数据' },
  ],
  roles: [
    { name: '平台管理员', category: '系统预置', status: 'normal', summary: '全部菜单、按钮和数据权限' },
    { name: '总部售后', category: '系统预置', status: 'normal', summary: '设备、售后和物料审批' },
    { name: '一级经销商管理员', category: '系统预置', status: 'normal', summary: '本级及下级数据' },
    { name: '海外只读审计', category: '自定义', status: 'normal', summary: '海外数据域 · 无写权限' },
  ],
  logs: [
    { name: '登录后台', category: '登录', status: 'normal', summary: 'admin@shark.cn · 127.0.0.1' },
    { name: '远程禁用设备', category: '业务操作', status: 'warning', summary: 'BX202606120094 · 售后确认' },
    { name: '审批物料申请', category: '业务操作', status: 'normal', summary: 'MA20260809071 · 审批通过' },
  ],
  'payment-settings': [
    { name: '微信支付', category: '支付渠道', status: 'normal', summary: '国内用户 · 商户认证已完成' },
    { name: '支付宝', category: '支付渠道', status: 'normal', summary: '国内用户 · 商户认证已完成' },
    { name: 'PayPal', category: '支付渠道', status: 'normal', summary: '海外用户 · Webhook 正常' },
    { name: 'Apple Pay', category: '支付渠道', status: 'normal', summary: '海外用户 · 商户校验正常' },
    { name: 'Google Pay', category: '支付渠道', status: 'normal', summary: '海外用户 · 商户校验正常' },
    { name: '鲨鱼妹妹国内商户', category: '商户配置', status: 'normal', summary: '商户号：**** 6028 · 人民币结算' },
    { name: 'Shark Sister Global', category: '商户配置', status: 'normal', summary: 'Merchant ID: **** 8194 · USD settlement' },
  ],
}

const contacts = ['138****5678', '159****1033', 'a***@oceanmail.com', 'm***@example.co.uk']
const faultCategories = ['水下电机', '提升', '转向', '接线盒', '其他']

function enrichRecord(moduleKey: string, record: EntityRecord, index: number): EntityRecord {
  const sequence = index + 1
  const deviceSn = `BX2026${String(8100000 + sequence).padStart(8, '0')}`
  const createdDate = record.createdAt.slice(0, 10)
  const shared = { ...record }
  if (moduleKey === 'users') Object.assign(shared, { deviceCount: Number(record.deviceCount ?? sequence % 4), registrationSource: record.category, contact: record.account })
  if (moduleKey === 'dealers') Object.assign(shared, { tier: record.category === '二级' ? '二级' : '一级', parentDealer: record.category === '二级' ? record.domain === 'global' ? 'Pacific Marine Systems' : '深圳海航设备有限公司' : '-', defaultWarrantyYears: Number(record.defaultWarrantyYears || (record.domain === 'cn' ? 2 : 1)), phone: `1380000${String(1000 + sequence).slice(-4)}`, email: String(record.account || ''), initialPassword: 'Dealer123!', mustChangePassword: true })
  if (moduleKey === 'projects') Object.assign(shared, { shipOwner: ['张海宁', 'Allen Carter', '陈远帆'][index % 3], deviceModel: record.category, usageRegion: record.region, warrantyUntil: record.status === 'expired' ? '2026-08-03' : record.status === 'warning' ? '2026-09-22' : '2028-08-09' })
  if (moduleKey === 'devices') Object.assign(shared, { code: index < templates.devices.length ? record.code : `BX2026${String(8101000 + sequence).padStart(8, '0')}`, country: String(record.region).split(' · ')[0], activation: record.activation === 'inactive' ? 'inactive' : 'activated', activationDate: record.activation === 'inactive' ? '' : createdDate, bindingStatus: record.account === '-' ? 'unbound' : 'bound', boundAt: record.account === '-' ? '' : record.createdAt })
  if (moduleKey === 'warehouse') Object.assign(shared, { deviceSN: deviceSn, deviceModel: ['制冰机 CI-02', '海水淡化器 SW-04', '顶流机 TF-01'][index % 3], quantity: 1 + (index % 24), targetDealer: record.category === '在库' ? '-' : record.owner, inboundAt: record.createdAt })
  if (moduleKey === 'ota') Object.assign(shared, { releaseAt: record.status === 'published' ? record.createdAt : '', forceUpdate: index % 3 === 0 ? '是' : '否' })
  if (moduleKey === 'repairs') Object.assign(shared, { account: contacts[index % contacts.length], deviceSN: deviceSn, faultCategory: faultCategories[index % faultCategories.length], contact: contacts[(index + 1) % contacts.length], description: record.summary, dealerId: record.ownerId, dealer: record.owner, assignee: record.status === 'pending' ? '-' : record.owner })
  if (moduleKey === 'messages') Object.assign(shared, { account: contacts[index % contacts.length], content: record.summary, contact: contacts[(index + 1) % contacts.length], forwardedTo: record.status === 'forwarded' ? record.owner : '-' })
  if (moduleKey === 'complaints') Object.assign(shared, { account: contacts[index % contacts.length], deviceSN: index % 4 === 0 ? '-' : deviceSn, content: record.summary, assignee: record.status === 'pending' ? '-' : record.owner })
  if (moduleKey === 'materials') Object.assign(shared, { dealer: record.owner, materialName: String(record.name).split(' × ')[0], quantity: Number(String(record.name).match(/×\s*(\d+)/)?.[1] || 1), deviceSN: deviceSn, warrantyResult: record.category === '提前申请' && record.status === 'rejected' ? '已过期' : '质保有效', applyTime: record.createdAt })
  if (moduleKey === 'material-catalog') Object.assign(shared, { materialCode: `MAT-${String(sequence).padStart(4, '0')}` })
  if (moduleKey === 'couriers') Object.assign(shared, { courierCode: record.code || `courier-${sequence}`, apiKeyMasked: '********' + String(sequence).padStart(4, '0'), trackingNo: record.category === '轨迹测试' ? record.name : '-' })
  if (moduleKey === 'sn-replacement') {
    const [originalSN = deviceSn, newSN = `${deviceSn}N`] = String(record.name).split(' → ')
    Object.assign(shared, { originalSN, newSN })
  }
  if (moduleKey === 'service-transfer') Object.assign(shared, { deviceSN: deviceSn, sourceDealer: String(record.name).split(' → ')[0] || record.owner, targetDealer: String(record.name).split(' → ')[1] || '厦门蓝湾船舶服务' })
  if (moduleKey === 'warranty') Object.assign(shared, { productType: record.category, dealerId: record.ownerId, dealer: record.owner, laborMonths: index % 2 ? 36 : 24, materialMonths: index % 2 ? 30 : 24 })
  if (moduleKey === 'approval-flow') Object.assign(shared, { category: '流程配置', flowType: 'materials', flowTypeLabel: '物料申请', levels: record.summary || '二级 → 一级 → 平台' })
  if (moduleKey === 'issuance') Object.assign(shared, { materialName: String(record.name).split(' × ')[0], recipient: record.owner, issuedAt: record.createdAt, replacedAt: record.status === 'completed' ? record.updatedAt : '' })
  if (moduleKey === 'payments') Object.assign(shared, { sourceType: 'app', sourceLabel: 'APP 支付', businessType: 'APP 服务订单', channel: record.category, paidAt: record.createdAt })
  if (moduleKey === 'admins') Object.assign(shared, { role: String(record.summary).split(' · ')[0] || '平台管理员', dataScope: String(record.summary).split(' · ')[1] || record.owner })
  if (moduleKey === 'roles') Object.assign(shared, { permissionCount: 8 + (index % 18), dataScope: record.summary })
  if (moduleKey === 'logs') Object.assign(shared, { account: record.owner || 'admin@shark.cn', operator: record.owner || '林海', operationType: record.category === '登录' ? '登录' : record.status === 'warning' ? '高风险操作' : '业务操作', content: record.summary, ip: '127.0.0.1', deviceInfo: 'Windows · Chromium' })
  return shared
}

function buildModuleRecords(moduleKey: string, items: Array<Partial<EntityRecord>>) {
  const records: EntityRecord[] = []
  const targetCount = items.length

  for (let index = 0; index < targetCount; index += 1) {
    const item = items[index % items.length]
    const owner = owners[index % owners.length]
    const domain: DataDomain = item.domain as DataDomain || (index % owners.length === 2 ? 'global' : 'cn')
    const record = {
      id: `${moduleKey}-${String(index + 1).padStart(4, '0')}`,
      code: String(item.code || `${moduleKey.slice(0, 3).toUpperCase()}-${2026081000 + index}`),
      name: String(item.name || `${moduleKey} ${index + 1}`),
      summary: String(item.summary || '本地演示数据'),
      category: String(item.category || '标准'),
      region: String(item.region || owner.region),
      owner: String(item.owner || owner.owner),
      ownerId: String(item.ownerId || owner.ownerId),
      status: String(item.status || 'normal'),
      domain,
      createdAt: iso(index + 12),
      updatedAt: iso(index),
      ...item,
    } as EntityRecord
    records.push(enrichRecord(moduleKey, record, index))
  }
  return records
}

export function createSeedDatabase(): StoredDatabase {
  const records = Object.fromEntries(Object.entries(templates).map(([key, items]) => [key, buildModuleRecords(key, items)])) as Record<string, EntityRecord[]>
  const relation = (moduleKey: string, subject: EntityRecord, index: number, payload: Partial<EntityRecord>): EntityRecord => ({
    id: `${moduleKey}-${subject.id}-${index}`,
    code: String(payload.code || `${moduleKey.slice(0, 3).toUpperCase()}-${index + 1}`),
    name: String(payload.name || subject.name),
    status: String(payload.status || 'normal'),
    ownerId: subject.ownerId,
    owner: subject.owner,
    domain: subject.domain,
    createdAt: String(payload.createdAt || iso(index + 1)),
    updatedAt: String(payload.updatedAt || iso(index)),
    subjectId: subject.id,
    subjectCode: subject.code,
    ...payload,
  })

  records.waypoints = records.users.flatMap((user, userIndex) => [0, 1, 2].map((index) => relation('waypoint', user, index, {
    name: `航点 ${index + 1}`,
    userId: user.id,
    deviceSN: records.devices[(userIndex + index) % records.devices.length].code,
    recordedAt: iso(userIndex * 8 + index),
    coordinates: `${22.52 + userIndex * 0.03 + index * 0.01}, ${114.05 + index * 0.04}`,
    location: ['深圳湾航道', '珠江口外锚地', '大鹏湾作业区'][index],
  })))
  records['ownership-history'] = records.devices.flatMap((device) => [0, 1].map((index) => relation('ownership', device, index, {
    deviceId: device.id,
    deviceSN: device.code,
    fromOwner: index === 0 ? '平台中心仓' : '深圳海航设备有限公司',
    toOwner: index === 0 ? '深圳海航设备有限公司' : device.owner,
    operationType: index === 0 ? '设备出库' : '渠道调货',
    operator: index === 0 ? '平台仓库管理员' : '林海',
  })))
  records['firmware-history'] = records.devices.flatMap((device) => [0, 1].map((index) => relation('firmware', device, index, {
    deviceId: device.id,
    deviceSN: device.code,
    fromVersion: index === 0 ? 'v1.0.0' : 'v2.0.0',
    toVersion: index === 0 ? 'v2.0.0' : device.firmware,
    updateMode: index === 0 ? '用户确认更新' : '灰度更新',
    status: 'completed',
  })))
  const workflowSubjects = ['repairs', 'messages', 'complaints', 'materials', 'warehouse', 'ota', 'service-transfer', 'installation-transfers', 'payments']
  records['workflow-events'] = workflowSubjects.flatMap((moduleKey) => records[moduleKey].flatMap((subject) => [0, 1].map((index) => relation('workflow', subject, index, {
    sourceModule: moduleKey,
    title: index === 0 ? '业务记录已创建' : '状态已更新',
    content: index === 0 ? `创建 ${subject.code}` : `状态更新为 ${subject.status}`,
    operator: index === 0 ? subject.owner : '平台管理员',
  }))))
  records.replies = ['repairs', 'messages', 'complaints'].flatMap((moduleKey) => records[moduleKey].filter((item) => item.status !== 'pending').map((subject, index) => relation('reply', subject, index, {
    sourceModule: moduleKey,
    content: moduleKey === 'repairs' ? '已安排技术人员处理，完成后将同步维修结果。' : '您的反馈已经受理，处理结果将通过站内消息通知。',
    operator: subject.owner,
    channel: '站内信',
  })))
  records['logistics-records'] = records.materials.filter((item) => ['approved', 'shipped', 'completed'].includes(item.status)).map((subject, index) => relation('logistics', subject, index, {
    courier: index % 2 ? 'DHL Express' : '顺丰速运',
    trackingNo: index % 2 ? `DHL8829012${841 + index}` : `SF143228019${3411 + index}`,
    content: subject.status === 'completed' ? '已签收并完成更换' : '运输中 · 已到达转运中心',
  }))
  records['role-permissions'] = records.roles.flatMap((role) => ['菜单访问', '列表查询', '业务操作', '数据范围'].map((category, index) => relation('permission', role, index, {
    name: `${role.name} · ${category}`,
    code: `${String(role.name).includes('平台') ? '*' : role.id.split('-')[1]}:${index === 0 ? 'view' : index === 3 ? 'scope' : '*'}`,
    category,
  })))
  return {
    version: 15,
    updatedAt: new Date().toISOString(),
    records,
  }
}
