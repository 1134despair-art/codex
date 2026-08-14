import type { ActionConfig, ColumnConfig, DetailTabConfig, FieldConfig, FilterConfig, ModuleConfig, NavGroup } from '@/types'

const statusOptions = [
  { label: '正常', value: 'normal' }, { label: '待处理', value: 'pending' },
  { label: '处理中', value: 'processing' }, { label: '已完成', value: 'completed' },
  { label: '已禁用', value: 'disabled' }, { label: '草稿', value: 'draft' },
]
const accountStatusOptions = [{ label: '正常', value: 'normal' }, { label: '已禁用', value: 'disabled' }]
const workflowStatusOptions = [
  { label: '待处理', value: 'pending' }, { label: '处理中', value: 'processing' },
  { label: '已完成', value: 'completed' },
]
const deviceTypes = ['顶流机 TF-01', '制冰机 CI-02', '海水淡化器 SW-04', '电池组 BP-03', '网络检测仪 ND-04'].map((value) => ({ label: value, value }))
const countries = ['中国', '美国', '英国', '澳大利亚', '新加坡'].map((value) => ({ label: value, value }))

const codeColumn: ColumnConfig = { field: 'code', label: '业务编号', width: 156, type: 'mono' }
const dateColumn = (field: string, label: string): ColumnConfig => ({ field, label, width: 160, type: 'date' })
const statusColumn: ColumnConfig = { field: 'status', label: '状态', width: 104, type: 'status' }
const namedStatusColumn = (label: string): ColumnConfig => ({ ...statusColumn, label })
const overviewTab: DetailTabConfig = { key: 'overview', label: '基本信息', kind: 'fields' }
const historyTab: DetailTabConfig = { key: 'history', label: '操作记录', kind: 'timeline', source: 'logs', title: '操作记录', description: '记录本条业务数据的所有关键变更。' }

const textFilter = (field: string, label: string, placeholder: string, fields?: string[], exact = false): FilterConfig => ({ field, label, type: 'text', placeholder, fields, exact })
const selectFilter = (field: string, label: string, options: Array<{ label: string; value: string }>): FilterConfig => ({ field, label, type: 'select', options })
const dateFilter = (field = 'createdAt', label = '创建时间'): FilterConfig => ({ field, label, type: 'dateRange' })
const textField = (field: string, label: string, required = false, span?: 1 | 2): FieldConfig => ({ field, label, type: 'text', required, span })
const selectField = (field: string, label: string, options: Array<{ label: string; value: string }>, required = false): FieldConfig => ({ field, label, type: 'select', options, required })
const dynamicSelectField = (field: string, label: string, optionSource: string, required = false): FieldConfig => ({ field, label, type: 'select', optionSource, required })
const dynamicMultiSelectField = (field: string, label: string, optionSource: string, required = false): FieldConfig => ({ field, label, type: 'multiSelect', optionSource, required })
const numberField = (field: string, label: string, required = false): FieldConfig => ({ field, label, type: 'number', required, min: 0 })
const textareaField = (field: string, label: string, required = false): FieldConfig => ({ field, label, type: 'textarea', required, span: 2 })

const action = (key: string, label: string, impact: string, fields: FieldConfig[] = [], allowedStatuses?: string[], tone: 'primary' | 'danger' = 'primary'): ActionConfig => ({ key, label, impact, fields, allowedStatuses, tone })
const reasonField = textareaField('reason', '操作原因', true)
const commonActions: ActionConfig[] = [
  action('toggle', '禁用/启用', '账号状态将立即变化，并写入高风险操作日志。', [reasonField], undefined, 'danger'),
  action('reset-password', '重置密码', '密码将重置为默认密码，账号下次登录必须修改。', [reasonField], undefined, 'danger'),
  action('delete', '删除', '记录会从本地数据库物理删除，且无法撤销。', [reasonField], undefined, 'danger'),
]

function createModule(config: Partial<ModuleConfig> & Pick<ModuleConfig, 'key' | 'route' | 'title' | 'eyebrow' | 'description' | 'icon' | 'permission'>): ModuleConfig {
  return {
    crud: 'full',
    primaryLabel: `新增${config.title.replace(/管理$/, '')}`,
    tabs: [{ key: 'all', label: '全部' }],
    columns: [codeColumn, { field: 'name', label: '名称', minWidth: 180, type: 'main' }, { field: 'category', label: '类型', width: 128 }, { field: 'owner', label: '归属方', minWidth: 160 }, dateColumn('updatedAt', '更新时间'), statusColumn],
    fields: [textField('code', '业务编号', true), textField('name', '名称', true), textField('category', '类型', true), textField('region', '地区', true), textField('owner', '负责人/归属方', true), selectField('status', '状态', statusOptions, true), textareaField('summary', '说明')],
    filters: [textFilter('keyword', '关键词', `搜索${config.title}编号或名称`, ['code', 'name']), selectFilter('status', '状态', statusOptions)],
    detailTabs: [overviewTab, historyTab],
    actions: commonActions,
    ...config,
  }
}

const configs: ModuleConfig[] = [
  createModule({
    key: 'users', route: 'users', title: '用户管理', eyebrow: '客户与渠道', description: '管理 App 注册用户、账号状态、绑定设备和航点数据；敏感账号信息默认脱敏。', icon: 'users', permission: 'users:view', crud: 'managed', primaryLabel: undefined,
    tabs: [{ key: 'all', label: '全部用户' }, { key: 'active', label: '正常', field: 'status', value: 'normal' }, { key: 'disabled', label: '已禁用', field: 'status', value: 'disabled' }],
    filters: [textFilter('account', '用户账号', '手机号或邮箱', ['account']), textFilter('name', '用户昵称', '输入昵称', ['name']), selectFilter('category', '注册方式', ['邮箱', '手机', 'Google', '微信'].map((value) => ({ label: value, value }))), dateFilter('createdAt', '注册时间'), selectFilter('status', '账号状态', accountStatusOptions)],
    columns: [{ field: 'code', label: '用户 ID', width: 146, type: 'mono' }, { field: 'account', label: '账号', minWidth: 180, type: 'main', mask: 'account' }, { field: 'name', label: '昵称', width: 128 }, { field: 'category', label: '注册方式', width: 104 }, { field: 'deviceCount', label: '绑定设备数', width: 112, type: 'link' }, dateColumn('createdAt', '注册时间'), { field: 'lastActive', label: '最近活跃', width: 120 }, namedStatusColumn('账号状态')],
    fields: [],
    detailTabs: [overviewTab, { key: 'devices', label: '绑定设备', kind: 'table', source: 'user-devices', title: '绑定设备', description: '当前账号实际绑定的设备，可执行强制解绑。', columns: [{ field: 'code', label: '设备 SN', width: 170, type: 'mono' }, { field: 'name', label: '设备型号', minWidth: 170 }, { field: 'region', label: '销售地区', width: 120 }, { field: 'boundAt', label: '绑定时间', width: 160, type: 'date' }, { field: 'status', label: '设备状态', width: 100, type: 'status' }] }, { key: 'waypoints', label: '航点数据', kind: 'table', source: 'waypoints', title: '航点数据', description: '航点按用户账号保存并关联来源设备。', columns: [{ field: 'recordedAt', label: '上传时间', width: 160, type: 'date' }, { field: 'deviceSN', label: '来源设备', width: 170, type: 'mono' }, { field: 'coordinates', label: '经纬度', width: 180 }, { field: 'location', label: '位置描述', minWidth: 180 }, { field: 'status', label: '状态', width: 90, type: 'status' }] }],
    rowActions: ['detail', 'toggle', 'reset-password'], actions: commonActions.filter((item) => ['toggle', 'reset-password'].includes(item.key)),
  }),
  createModule({
    key: 'dealers', route: 'dealers', title: '经销商管理', eyebrow: '客户与渠道', description: '维护一级/二级渠道层级、负责地区、设备范围和账号状态。', icon: 'store', permission: 'dealers:view', primaryByTab: { all: '新增经销商', tier1: '新增一级经销商', tier2: '新增二级经销商', disabled: undefined },
    tabs: [{ key: 'all', label: '全部经销商' }, { key: 'tier1', label: '一级经销商', field: 'tier', value: '一级' }, { key: 'tier2', label: '二级经销商', field: 'tier', value: '二级' }, { key: 'disabled', label: '已禁用', field: 'status', value: 'disabled' }],
    filters: [textFilter('keyword', '关键词', '账号、名称或地区', ['account', 'name', 'region']), selectFilter('tier', '层级', ['一级', '二级'].map((value) => ({ label: value, value }))), selectFilter('status', '状态', accountStatusOptions)],
    columns: [{ field: 'name', label: '经销商名称', minWidth: 190, type: 'main' }, { field: 'account', label: '账号', minWidth: 180 }, { field: 'region', label: '所属地区', width: 130 }, { field: 'tier', label: '层级', width: 90 }, { field: 'parentDealer', label: '上级经销商', minWidth: 170 }, { field: 'deviceCount', label: '管理设备数', width: 112, type: 'number' }, statusColumn],
    fields: [textField('account', '登录账号', true), { field: 'initialPassword', label: '初始密码', type: 'password', requiredOnCreate: true }, textField('name', '经销商名称', true), textField('region', '负责地区', true), selectField('tier', '经销商层级', ['一级', '二级'].map((value) => ({ label: value, value })), true), dynamicSelectField('parentDealerId', '上级经销商', 'tier1-dealers'), textField('phone', '联系电话', true), textField('email', '联系邮箱'), selectField('status', '账号状态', accountStatusOptions, true)],
    detailTabs: [overviewTab, { key: 'devices', label: '设备范围', kind: 'table', source: 'dealer-devices', columns: [{ field: 'code', label: '设备 SN', width: 170, type: 'mono' }, { field: 'name', label: '设备型号', minWidth: 160 }, { field: 'region', label: '销售地区', width: 120 }, statusColumn] }, { key: 'service', label: '售后服务', kind: 'table', source: 'dealer-service', columns: [codeColumn, { field: 'name', label: '业务内容', minWidth: 200 }, { field: 'category', label: '类型', width: 120 }, statusColumn] }, { key: 'accounts', label: '账号管理', kind: 'table', source: 'dealer-accounts', columns: [{ field: 'account', label: '登录账号', minWidth: 190 }, { field: 'name', label: '姓名', width: 120 }, { field: 'role', label: '角色', width: 130 }, statusColumn] }],
    rowActions: ['detail', 'edit', 'toggle', 'reset-password'], actions: commonActions.filter((item) => ['toggle', 'reset-password'].includes(item.key)),
  }),
  createModule({
    key: 'projects', route: 'projects', title: '项目管理', eyebrow: '客户与渠道', description: '查看船舶项目、绑定设备、所属经销商与质保到期情况。', icon: 'ship-wheel', permission: 'projects:view', primaryLabel: undefined,
    statusTones: { warning: 'error' },
    tabs: [{ key: 'all', label: '全部项目' }, { key: 'warranty', label: '质保临期', field: 'status', value: 'warning' }, { key: 'expired', label: '已过期', field: 'status', value: 'expired' }],
    filters: [textFilter('keyword', '项目搜索', '船名、SN 号或船东姓名', ['name', 'deviceSN', 'shipOwner']), { field: 'ownerId', label: '所属经销商', type: 'select', optionSource: 'dealers' }, dateFilter('createdAt', '创建时间')],
    columns: [{ field: 'name', label: '船名', minWidth: 150, type: 'main' }, { field: 'deviceSN', label: '设备 SN', width: 170, type: 'mono' }, { field: 'shipOwner', label: '船东姓名', width: 130 }, { field: 'deviceModel', label: '设备型号', minWidth: 170 }, { field: 'usageRegion', label: '使用地区', width: 120 }, { field: 'owner', label: '所属经销商', minWidth: 170 }, { field: 'warrantyUntil', label: '质保到期日', width: 130, type: 'date' }, statusColumn],
    fields: [textField('name', '船名', true), dynamicSelectField('deviceSN', '设备 SN', 'accessible-devices', true), textField('shipOwner', '船东姓名', true), { ...textField('deviceModel', '设备型号', true), readonly: true }, textField('usageRegion', '使用地区', true), { ...textField('owner', '所属经销商', true), readonly: true }, { field: 'warrantyUntil', label: '质保到期日', type: 'date', required: true, readonly: true }, textareaField('summary', '项目备注')],
    detailTabs: [overviewTab, { key: 'devices', label: '绑定设备', kind: 'table', source: 'project-devices', columns: [{ field: 'code', label: '设备 SN', width: 170, type: 'mono' }, { field: 'name', label: '设备型号', minWidth: 180 }, { field: 'firmware', label: '固件版本', width: 110 }, statusColumn] }, { key: 'warranty', label: '质保信息', kind: 'fields', source: 'project-warranty' }, { key: 'service', label: '售后记录', kind: 'table', source: 'project-service', columns: [codeColumn, { field: 'name', label: '服务事项', minWidth: 200 }, { field: 'category', label: '类型', width: 120 }, statusColumn] }],
    rowActions: ['detail', 'edit', 'delete'], actions: commonActions.filter((item) => item.key === 'delete'),
  }),
  createModule({
    key: 'devices', route: 'devices', title: '设备管理', eyebrow: '设备与库存', description: '查看设备身份、销售地区、激活绑定、固件与远程状态，SN 使用精确检索。', icon: 'cpu', permission: 'devices:view', crud: 'managed', primaryLabel: '录入设备', primaryByTab: { all: '录入设备', online: undefined, inactive: '录入未激活设备', disabled: undefined },
    tabs: [{ key: 'all', label: '全部设备' }, { key: 'online', label: '在线设备', field: 'status', value: 'online' }, { key: 'inactive', label: '未激活', field: 'activation', value: 'inactive' }, { key: 'disabled', label: '远程禁用', field: 'status', value: 'disabled' }],
    filters: [textFilter('code', '设备序列号', '输入完整 SN', ['code'], true), selectFilter('name', '设备型号', deviceTypes), selectFilter('country', '销售国家', countries), textFilter('region', '销售地区', '输入省、市或区域', ['region']), selectFilter('activation', '激活状态', [{ label: '未激活', value: 'inactive' }, { label: '已激活', value: 'activated' }]), selectFilter('bindingStatus', '绑定状态', [{ label: '未绑定', value: 'unbound' }, { label: '已绑定', value: 'bound' }])],
    columns: [{ field: 'code', label: '设备 SN', width: 176, type: 'mono' }, { field: 'name', label: '设备型号', minWidth: 180, type: 'main' }, { field: 'region', label: '销售地区', minWidth: 150 }, { field: 'activation', label: '激活状态', width: 110, type: 'status' }, { field: 'account', label: '绑定用户', minWidth: 150 }, { field: 'activationDate', label: '激活日期', width: 130, type: 'date' }, { field: 'firmware', label: '固件版本', width: 110, type: 'mono' }, statusColumn],
    fields: [textField('code', '设备 SN', true), selectField('name', '设备型号', deviceTypes, true), textField('region', '销售地区', true)],
    detailTabs: [overviewTab, { key: 'ownership', label: '设备归属', kind: 'table', source: 'ownership-history', columns: [{ field: 'createdAt', label: '变更时间', width: 160, type: 'date' }, { field: 'fromOwner', label: '原归属', minWidth: 160 }, { field: 'toOwner', label: '新归属', minWidth: 160 }, { field: 'operationType', label: '变更类型', width: 120 }, { field: 'operator', label: '操作人', width: 120 }] }, { key: 'firmware', label: '固件记录', kind: 'table', source: 'firmware-history', columns: [{ field: 'createdAt', label: '更新时间', width: 160, type: 'date' }, { field: 'fromVersion', label: '原版本', width: 110, type: 'mono' }, { field: 'toVersion', label: '目标版本', width: 110, type: 'mono' }, { field: 'updateMode', label: '更新方式', width: 120 }, statusColumn] }, { key: 'service', label: '售后记录', kind: 'table', source: 'device-service', columns: [codeColumn, { field: 'name', label: '售后事项', minWidth: 200 }, { field: 'category', label: '类型', width: 120 }, statusColumn] }],
    rowActions: ['detail', 'change-region', 'unbind', 'remote-disable', 'remote-enable'], actions: [action('change-region', '修改销售地区', '仅修改设备的销售国家和地区，并保留变更原因。', [selectField('country', '销售国家', countries, true), textField('region', '销售地区', true), reasonField]), action('unbind', '强制解绑', '解除用户绑定，原 SN 将追加 -1，并同步归属历史。', [reasonField], undefined, 'danger'), action('remote-disable', '远程禁用', '纯前端环境会生成一条可追踪的远程禁用模拟指令，不代表真实设备已经响应。', [reasonField], ['online', 'offline'], 'danger'), action('remote-enable', '远程启用', '纯前端环境会生成一条可追踪的远程启用模拟指令，不代表真实设备已经响应。', [reasonField], ['disabled'])],
  }),
  createModule({
    key: 'warehouse', route: 'warehouse', title: '仓库设备', eyebrow: '设备与库存', description: '管理在库设备、出库、调货审批和设备归属变更。', icon: 'warehouse', permission: 'warehouse:view', crud: 'workflow', primaryLabel: '设备入库', primaryByTab: { stock: '设备入库', outbound: '创建出库单', transfer: '发起调货申请', ownership: undefined },
    tabs: [{ key: 'stock', label: '仓库区', field: 'category', value: '在库' }, { key: 'outbound', label: '设备出库', field: 'category', value: '出库' }, { key: 'transfer', label: '库存调货', field: 'category', value: '调货' }, { key: 'ownership', label: '归属查询', source: 'ownership-history' }],
    filters: [textFilter('keyword', '设备查询', '设备 SN 或型号', ['deviceSN', 'deviceModel', 'code', 'name']), dateFilter('inboundAt', '入库时间'), selectFilter('status', '业务状态', workflowStatusOptions)],
    columns: [{ field: 'deviceSN', label: '设备 SN', width: 170, type: 'mono' }, { field: 'deviceModel', label: '设备型号', minWidth: 170 }, { field: 'quantity', label: '数量', width: 80, type: 'number' }, { field: 'targetDealer', label: '接收经销商', minWidth: 170 }, dateColumn('inboundAt', '入库/申请时间'), statusColumn],
    tabColumns: {
      stock: [{ field: 'deviceSN', label: '设备 SN', width: 180, type: 'mono' }, { field: 'deviceModel', label: '设备型号', minWidth: 180 }, { field: 'country', label: '销售国家', width: 110 }, { field: 'warehouseLocation', label: '库位', width: 110 }, dateColumn('inboundAt', '入库时间'), statusColumn],
      outbound: [codeColumn, { field: 'deviceSN', label: '设备清单', minWidth: 220, type: 'mono' }, { field: 'targetDealer', label: '接收经销商', minWidth: 190 }, dateColumn('createdAt', '创建时间'), statusColumn],
      transfer: [codeColumn, { field: 'deviceSN', label: '设备清单', minWidth: 220, type: 'mono' }, { field: 'sourceDealer', label: '原经销商', minWidth: 170 }, { field: 'targetDealer', label: '目标经销商', minWidth: 170 }, statusColumn],
      ownership: [{ field: 'deviceSN', label: '设备 SN', width: 180, type: 'mono' }, { field: 'currentOwner', label: '当前归属', minWidth: 180 }, dateColumn('createdAt', '变更时间'), { field: 'fromOwner', label: '原归属', minWidth: 180 }, { field: 'toOwner', label: '新归属', minWidth: 180 }, { field: 'operationType', label: '变更类型', width: 130 }, { field: 'operator', label: '操作人', width: 120 }],
    },
    tabFilters: {
      stock: [textFilter('deviceSN', '设备 SN', '输入完整或部分 SN', ['deviceSN']), selectFilter('deviceModel', '设备型号', deviceTypes), dateFilter('inboundAt', '入库时间')],
      outbound: [textFilter('keyword', '出库单查询', '单号、SN 或接收经销商', ['code', 'deviceSN', 'targetDealer']), selectFilter('status', '出库状态', workflowStatusOptions), dateFilter('createdAt', '创建时间')],
      transfer: [textFilter('keyword', '调货单查询', '单号、SN 或经销商', ['code', 'deviceSN', 'sourceDealer', 'targetDealer']), selectFilter('status', '审批状态', workflowStatusOptions)],
      ownership: [textFilter('deviceSN', '设备 SN', '输入完整 SN 查询归属', ['deviceSN'], true)],
    },
    tabRowActions: { stock: ['detail'], outbound: ['detail', 'process'], transfer: ['detail', 'process'], ownership: [] },
    fields: [textField('deviceSN', '设备 SN', true), selectField('deviceModel', '设备型号', deviceTypes, true), textField('region', '销售地区', true)],
    tabFields: {
      outbound: [dynamicMultiSelectField('selectedDevices', '选择在库设备', 'warehouse-devices', true), dynamicSelectField('targetDealerId', '接收经销商', 'dealers', true), textareaField('summary', '出库说明')],
      transfer: [dynamicMultiSelectField('selectedDevices', '选择可调货设备', 'dealer-devices', true), { ...textField('sourceDealer', '原经销商'), readonly: true }, dynamicSelectField('targetDealerId', '目标经销商', 'transfer-target-dealers', true), textareaField('summary', '调货原因', true)],
    },
    detailTabs: [overviewTab, { key: 'devices', label: '设备清单', kind: 'table', source: 'warehouse-devices', columns: [{ field: 'code', label: '设备 SN', width: 170, type: 'mono' }, { field: 'name', label: '设备型号', minWidth: 170 }, { field: 'owner', label: '当前归属', minWidth: 170 }, statusColumn] }, { key: 'history', label: '流转记录', kind: 'timeline', source: 'workflow-events' }],
    rowActions: ['detail', 'process'], actions: [action('process', '处理', '根据当前业务类型执行出库确认或调货审批，并同步设备归属、历史、统计和日志。', [selectField('decision', '处理结果', [{ label: '审批通过', value: 'approved' }, { label: '审批拒绝', value: 'rejected' }, { label: '确认出库', value: 'outbound' }], true), reasonField], ['pending', 'processing'])],
  }),
  createModule({
    key: 'ota', route: 'ota', title: 'OTA 管理', eyebrow: '设备与库存', description: '按设备类型管理固件版本、强制更新与发布状态。', icon: 'package-up', permission: 'ota:view', primaryLabel: '新增固件版本',
    tabs: [{ key: 'versions', label: '固件版本', field: 'category', value: '固件版本' }],
    filters: [textFilter('name', '版本号', '例如 1.0.0', ['name'], true), selectFilter('deviceType', '设备类型', deviceTypes), dateFilter('releaseAt', '发布时间'), selectFilter('status', '发布状态', [{ label: '草稿', value: 'draft' }, { label: '已发布', value: 'published' }, { label: '已撤回', value: 'withdrawn' }])],
    columns: [{ field: 'name', label: '版本号', width: 130, type: 'mono' }, { field: 'deviceType', label: '设备类型', minWidth: 180 }, dateColumn('releaseAt', '发布时间'), { field: 'summary', label: '版本说明', minWidth: 220 }, { field: 'forceUpdate', label: '强制更新', width: 100 }, namedStatusColumn('发布状态')],
    tabRowActions: { versions: ['detail', 'publish'] },
    fields: [textField('name', '版本号', true), selectField('deviceType', '适用设备类型', deviceTypes, true), textareaField('summary', '版本说明', true), { field: 'firmwareFile', label: '固件文件', type: 'firmware', required: true, span: 2 }, { field: 'forceUpdate', label: '强制更新', type: 'switch' }, selectField('status', '发布状态', [{ label: '草稿', value: 'draft' }, { label: '已发布', value: 'published' }], true)],
    detailTabs: [overviewTab, { key: 'devices', label: '适用设备', kind: 'table', source: 'ota-devices', columns: [{ field: 'code', label: '设备 SN', width: 170, type: 'mono' }, { field: 'name', label: '设备型号', minWidth: 170 }, { field: 'firmware', label: '当前版本', width: 110, type: 'mono' }, statusColumn] }, { key: 'history', label: '发布记录', kind: 'timeline', source: 'workflow-events' }],
    rowActions: ['detail', 'publish'], statusTones: { failed: 'error' }, actions: [action('publish', '发布/撤回', '发布状态将影响适用设备的更新提示，操作会写入日志。', [reasonField], ['draft', 'published', 'withdrawn'], 'danger')],
  }),
  createModule({
    key: 'repairs', route: 'repairs', title: '故障报修', eyebrow: '服务与售后', description: '从提交、分配、回复到完成跟踪整个报修闭环。', icon: 'wrench', permission: 'repairs:view', crud: 'workflow', primaryLabel: undefined,
    statusTones: { pending: 'error', processing: 'warning' },
    tabs: [{ key: 'all', label: '全部报修' }, { key: 'pending', label: '待处理', field: 'status', value: 'pending' }, { key: 'processing', label: '处理中', field: 'status', value: 'processing' }, { key: 'completed', label: '已完成', field: 'status', value: 'completed' }],
    filters: [textFilter('keyword', '报修查询', '报修单号或用户账号', ['code', 'account']), selectFilter('faultCategory', '故障分类', ['水下电机', '提升', '转向', '接线盒', '其他'].map((value) => ({ label: value, value }))), selectFilter('status', '处理状态', workflowStatusOptions), dateFilter('createdAt', '提交时间')],
    columns: [{ field: 'code', label: '报修单号', width: 160, type: 'mono' }, { field: 'account', label: '用户账号', minWidth: 160 }, { field: 'deviceSN', label: '设备 SN', width: 170, type: 'mono' }, { field: 'faultCategory', label: '故障分类', width: 110 }, { field: 'contact', label: '联系方式', width: 140 }, namedStatusColumn('处理状态'), dateColumn('createdAt', '提交时间')],
    detailTabs: [{ ...overviewTab, label: '工单信息' }, { key: 'flow', label: '处理流程', kind: 'timeline', source: 'workflow-events' }, { key: 'reply', label: '回复记录', kind: 'table', source: 'replies', columns: [{ field: 'createdAt', label: '回复时间', width: 160, type: 'date' }, { field: 'operator', label: '回复人', width: 130 }, { field: 'content', label: '回复内容', minWidth: 260 }, { field: 'channel', label: '通知方式', width: 110 }] }, { key: 'logs', label: '操作日志', kind: 'table', source: 'subject-logs', columns: [dateColumn('createdAt', '操作时间'), { field: 'operationType', label: '操作类型', width: 130 }, { field: 'content', label: '操作内容', minWidth: 240 }, { field: 'operator', label: '操作人', width: 120 }] }],
    rowActions: ['detail', 'assign', 'reply', 'complete'], actions: [action('assign', '分配处理', '工单将进入处理中并通知指定经销商。', [dynamicSelectField('assigneeId', '处理经销商', 'dealers', true), textareaField('reason', '分配说明', true)], ['pending']), action('reply', '回复用户', '回复内容将保存到工单并生成通知记录。', [textareaField('replyContent', '回复内容', true)], ['processing', 'completed']), action('complete', '标记完成', '只有处理中的工单可以完成，结果将写入处理流程。', [textareaField('result', '处理结果', true)], ['processing'])],
  }),
  createModule({
    key: 'messages', route: 'messages', title: '客服留言', eyebrow: '服务与售后', description: '查看用户留言、回复记录和转交经销商状态。', icon: 'messages-square', permission: 'messages:view', crud: 'workflow', primaryLabel: undefined,
    statusTones: { pending: 'error' },
    tabs: [{ key: 'all', label: '全部留言' }, { key: 'unreplied', label: '未回复', field: 'status', value: 'pending' }, { key: 'replied', label: '已回复', field: 'status', value: 'completed' }],
    filters: [textFilter('account', '用户账号', '手机号或邮箱', ['account']), selectFilter('status', '回复状态', [{ label: '未回复', value: 'pending' }, { label: '已回复', value: 'completed' }]), dateFilter('createdAt', '提交时间')],
    columns: [{ field: 'account', label: '用户账号', minWidth: 170 }, { field: 'content', label: '留言内容', minWidth: 280 }, { field: 'contact', label: '联系方式', width: 150 }, namedStatusColumn('回复状态'), dateColumn('createdAt', '提交时间')],
    detailTabs: [overviewTab, { key: 'replies', label: '回复记录', kind: 'table', source: 'replies', columns: [dateColumn('createdAt', '回复时间'), { field: 'operator', label: '回复人', width: 130 }, { field: 'content', label: '回复内容', minWidth: 280 }] }, { key: 'history', label: '流转记录', kind: 'timeline', source: 'workflow-events' }],
    rowActions: ['detail', 'reply', 'forward', 'escalate'], actions: [action('reply', '查看并回复', '回复内容会保存并生成本地推送记录。', [textareaField('replyContent', '回复内容', true)], ['pending', 'forwarded']), action('forward', '转发经销商', '留言归属将转交给指定经销商。', [dynamicSelectField('assigneeId', '接收经销商', 'dealers', true), reasonField], ['pending']), action('escalate', '转单总部', '留言归属将升级为总部处理。', [reasonField], ['pending', 'forwarded'], 'danger')],
  }),
  createModule({
    key: 'complaints', route: 'complaints', title: '投诉管理', eyebrow: '服务与售后', description: '集中处理产品质量、服务态度和物流投诉。', icon: 'message-square-warning', permission: 'complaints:view', crud: 'workflow', primaryLabel: undefined,
    statusTones: { pending: 'error', processing: 'warning' },
    tabs: [{ key: 'all', label: '全部投诉' }, { key: 'pending', label: '待处理', field: 'status', value: 'pending' }, { key: 'processing', label: '处理中', field: 'status', value: 'processing' }, { key: 'completed', label: '已完成', field: 'status', value: 'completed' }],
    filters: [textFilter('keyword', '投诉查询', '投诉单号或用户账号', ['code', 'account']), selectFilter('category', '投诉类型', ['产品质量', '服务态度', '物流', '其他'].map((value) => ({ label: value, value }))), selectFilter('status', '处理状态', workflowStatusOptions), dateFilter('createdAt', '提交时间')],
    columns: [{ field: 'code', label: '投诉单号', width: 160, type: 'mono' }, { field: 'account', label: '用户账号', minWidth: 170, mask: 'account' }, { field: 'category', label: '投诉类型', width: 110 }, { field: 'deviceSN', label: '关联 SN', width: 170, type: 'mono' }, namedStatusColumn('处理状态'), dateColumn('createdAt', '提交时间')],
    detailTabs: [{ ...overviewTab, label: '投诉信息' }, { key: 'handling', label: '处理过程', kind: 'timeline', source: 'workflow-events' }, { key: 'reply', label: '回复记录', kind: 'table', source: 'replies', columns: [dateColumn('createdAt', '回复时间'), { field: 'operator', label: '回复人', width: 130 }, { field: 'content', label: '回复内容', minWidth: 280 }] }, { key: 'logs', label: '操作日志', kind: 'table', source: 'subject-logs', columns: [dateColumn('createdAt', '操作时间'), { field: 'operationType', label: '操作类型', width: 130 }, { field: 'content', label: '操作内容', minWidth: 260 }] }],
    rowActions: ['detail', 'assign', 'reply', 'complete'], actions: [action('assign', '分配处理', '投诉将进入处理中并记录处理人。', [dynamicSelectField('assigneeId', '处理人员', 'assignees', true), reasonField], ['pending']), action('reply', '回复用户', '回复内容会保存并生成本地推送记录。', [textareaField('replyContent', '回复内容', true)], ['processing', 'completed']), action('complete', '标记完成', '处理结果将归档，投诉状态变为已完成。', [textareaField('result', '处理结果', true)], ['processing'])],
  }),
  createModule({
    key: 'materials', route: 'materials', title: '物料申请', eyebrow: '服务与售后', description: '审核物料申请、校验质保、登记物流并跟踪完成。', icon: 'package-check', permission: 'materials:view', crud: 'workflow', primaryLabel: '发起物料申请', primaryByTab: { all: '发起物料申请', approval: undefined, early: '发起提前申请', shipping: undefined, completed: undefined, rejected: undefined },
    tabs: [{ key: 'all', label: '全部申请' }, { key: 'approval', label: '待审批', field: 'status', value: 'pending' }, { key: 'early', label: '提前申请', field: 'category', value: '提前申请' }, { key: 'shipping', label: '待发货', field: 'status', value: 'approved' }, { key: 'completed', label: '已完成', field: 'status', value: 'completed' }, { key: 'rejected', label: '已拒绝', field: 'status', value: 'rejected' }],
    filters: [textFilter('keyword', '申请查询', '申请单号、经销商或设备 SN', ['code', 'dealer', 'deviceSN']), selectFilter('status', '审批状态', [{ label: '待审批', value: 'pending' }, { label: '已审批', value: 'approved' }, { label: '已拒绝', value: 'rejected' }, { label: '已发货', value: 'shipped' }, { label: '已完成', value: 'completed' }])],
    columns: [{ field: 'code', label: '申请单号', width: 160, type: 'mono' }, { field: 'dealer', label: '申请经销商', minWidth: 170 }, { field: 'materialName', label: '物料名称', minWidth: 170 }, { field: 'quantity', label: '数量', width: 76, type: 'number' }, { field: 'deviceSN', label: '设备 SN', width: 170, type: 'mono' }, dateColumn('applyTime', '申请时间'), { field: 'warrantyResult', label: '质保校验', width: 110 }, namedStatusColumn('审批状态')],
    fields: [{ ...textField('dealer', '申请经销商'), readonly: true }, dynamicSelectField('materialId', '物料名称', 'active-materials', true), { ...numberField('quantity', '申请数量', true), min: 1 }, dynamicSelectField('deviceSN', '设备 SN', 'accessible-devices', true), selectField('category', '申请类型', [{ label: '普通申请', value: '普通申请' }, { label: '提前申请', value: '提前申请' }], true), textareaField('summary', '申请说明')],
    detailTabs: [overviewTab, { key: 'approval', label: '审批记录', kind: 'timeline', source: 'approval-steps' }, { key: 'logistics', label: '物流信息', kind: 'table', source: 'logistics-records', columns: [{ field: 'courier', label: '快递公司', width: 140 }, { field: 'trackingNo', label: '物流单号', width: 190, type: 'mono' }, { field: 'content', label: '最新轨迹', minWidth: 240 }, dateColumn('updatedAt', '更新时间')] }],
    rowActions: ['detail', 'approve', 'reject', 'ship'], actions: [action('approve', '审批通过', '仅当前审批节点账号可以处理；末级通过后申请进入待发货状态。', [textareaField('reason', '审批意见', true)], ['pending']), action('reject', '审批拒绝', '申请将被拒绝，后续审批节点终止。', [reasonField], ['pending'], 'danger'), action('ship', '填写发货', '发货时扣减库存，并创建发放记录与物流关联。', [dynamicSelectField('courierId', '快递公司', 'enabled-couriers', true), textField('trackingNo', '物流单号', true)], ['approved'])],
  }),
  createModule({
    key: 'material-catalog', route: 'material-catalog', title: '物料与库存', eyebrow: '服务与售后', description: '维护物料信息、采购价、库存和启用状态。', icon: 'boxes', permission: 'material-catalog:view', primaryByTab: { all: '新增物料', low: undefined, disabled: undefined },
    tabs: [{ key: 'all', label: '全部物料' }, { key: 'low', label: '库存偏低', field: 'status', value: 'low' }, { key: 'disabled', label: '已停用', field: 'status', value: 'disabled' }],
    filters: [textFilter('keyword', '物料查询', '物料名称或编号', ['name', 'materialCode']), selectFilter('status', '库存状态', [{ label: '正常', value: 'normal' }, { label: '库存偏低', value: 'low' }, { label: '已停用', value: 'disabled' }])],
    columns: [{ field: 'materialCode', label: '物料编号', width: 150, type: 'mono' }, { field: 'name', label: '物料名称', minWidth: 190, type: 'main' }, { field: 'category', label: '适用设备', minWidth: 170 }, { field: 'price', label: '采购价', width: 110, type: 'money' }, { field: 'stock', label: '库存数量', width: 100, type: 'number' }, statusColumn],
    fields: [textField('name', '物料名称', true), selectField('category', '适用设备', deviceTypes, true), numberField('price', '采购价', true), numberField('stock', '库存数量', true), selectField('status', '启用状态', [{ label: '正常', value: 'normal' }, { label: '已停用', value: 'disabled' }], true)],
    rowActions: ['detail', 'edit', 'delete'], actions: commonActions.filter((item) => item.key === 'delete'),
  }),
  createModule({
    key: 'couriers', route: 'couriers', title: '物流配置', eyebrow: '服务与售后', description: '配置快递公司、快递100编码和查询凭证，并执行本地模拟测试。', icon: 'truck', permission: 'couriers:view', primaryLabel: '新增快递公司',
    tabs: [{ key: 'companies', label: '快递公司', field: 'category', value: '快递公司' }],
    filters: [textFilter('keyword', '物流查询', '公司名称、编码或物流单号', ['name', 'courierCode', 'trackingNo']), selectFilter('status', '启用状态', accountStatusOptions)],
    columns: [{ field: 'name', label: '快递公司名称', minWidth: 180, type: 'main' }, { field: 'courierCode', label: '快递100编码', width: 150, type: 'mono' }, { field: 'apiKeyMasked', label: 'API Key', width: 150 }, { field: 'trackingNo', label: '测试单号', minWidth: 180, type: 'mono' }, statusColumn],
    fields: [textField('name', '快递公司名称', true), textField('courierCode', '快递100编码', true), { field: 'apiKey', label: 'API Key', type: 'password', required: true, sensitive: true }, selectField('status', '启用状态', accountStatusOptions, true)],
    rowActions: ['detail', 'edit', 'test'], actions: [action('test', '测试查询', '使用静态轨迹模拟快递100查询；结果只写入模拟调用日志，不修改正式配置和履约数据。', [textField('trackingNo', '物流单号', true)])],
  }),
  createModule({
    key: 'sn-replacement', route: 'sn-replacement', title: '换 SN 管理', eyebrow: '服务与售后', description: '校验归属后更换设备 SN，并保留完整审计记录。', icon: 'refresh-cw', permission: 'sn-replacement:view', crud: 'workflow', primaryLabel: '发起换 SN', primaryByTab: { records: '发起换 SN', pending: undefined, exceptions: undefined },
    tabs: [{ key: 'records', label: '换 SN 记录' }, { key: 'pending', label: '待确认', field: 'status', value: 'pending' }, { key: 'exceptions', label: '异常记录', field: 'status', value: 'failed' }],
    columns: [{ field: 'originalSN', label: '原 SN', width: 180, type: 'mono' }, { field: 'newSN', label: '新 SN', width: 180, type: 'mono' }, { field: 'owner', label: '当前经销商', minWidth: 180 }, dateColumn('createdAt', '申请时间'), statusColumn],
    fields: [textField('originalSN', '原 SN', true), textField('newSN', '新 SN', true)],
    filters: [textFilter('keyword', 'SN 查询', '原 SN 或新 SN', ['originalSN', 'newSN']), selectFilter('status', '处理状态', workflowStatusOptions)],
    rowActions: ['detail', 'process'], actions: [action('process', '换 SN 确认', '原 SN 将追加 -1，新 SN 绑定到原用户并写入换 SN 日志。', [reasonField], ['pending'], 'danger')],
  }),
  createModule({
    key: 'service-transfer', route: 'service-transfer', title: '售后转移', eyebrow: '服务与售后', description: '由原经销商发起、目标经销商确认，完整转移售后责任。', icon: 'arrow-left-right', permission: 'service-transfer:view', crud: 'workflow', primaryLabel: '发起转移', primaryByTab: { all: '发起转移', target: undefined, completed: undefined, rejected: undefined },
    tabs: [{ key: 'all', label: '全部记录' }, { key: 'target', label: '待接收方确认', field: 'status', value: 'pending' }, { key: 'completed', label: '已完成', field: 'status', value: 'completed' }, { key: 'rejected', label: '已拒绝', field: 'status', value: 'rejected' }],
    columns: [codeColumn, { field: 'deviceSN', label: '设备 SN', width: 170, type: 'mono' }, { field: 'sourceDealer', label: '原代理商', minWidth: 170 }, { field: 'targetDealer', label: '目标代理商', minWidth: 170 }, statusColumn],
    fields: [textField('deviceSN', '设备 SN', true), { ...textField('sourceDealer', '原代理商'), readonly: true }, dynamicSelectField('targetDealerId', '目标代理商', 'service-target-dealers', true)],
    filters: [textFilter('keyword', '转移查询', '设备 SN 或代理商', ['deviceSN', 'sourceDealer', 'targetDealer']), selectFilter('status', '确认状态', workflowStatusOptions)],
    detailTabs: [overviewTab, { key: 'history', label: '双方确认记录', kind: 'timeline', source: 'workflow-events' }],
    rowActions: ['detail', 'process'], actions: [action('process', '确认转移', '原代理发起后仅目标代理可以确认；确认后设备经销商关系同步更新并保留归属历史。', [selectField('decision', '确认结果', [{ label: '确认接收', value: 'confirmed' }, { label: '拒绝接收', value: 'rejected' }], true), reasonField], ['pending'])],
  }),
  createModule({
    key: 'warranty', route: 'warranty', title: '质保规则', eyebrow: '服务与售后', description: '按经销商和设备类型配置人工费与物料质保时长。', icon: 'shield-check', permission: 'warranty:view', primaryLabel: '新增质保规则',
    tabs: [{ key: 'rules', label: '质保规则' }],
    columns: [{ field: 'productType', label: '产品类型', minWidth: 180 }, { field: 'dealer', label: '设置经销商', minWidth: 180 }, { field: 'laborMonths', label: '免人工费/月', width: 120, type: 'number' }, { field: 'materialMonths', label: '物料质保/月', width: 120, type: 'number' }, dateColumn('updatedAt', '更新时间'), statusColumn],
    fields: [selectField('productType', '产品类型', deviceTypes, true), dynamicSelectField('dealerId', '设置经销商', 'warranty-dealers', true), numberField('laborMonths', '免人工费时间（月）', true), numberField('materialMonths', '物料质保时间（月）', true), selectField('status', '启用状态', accountStatusOptions, true)],
    filters: [selectFilter('productType', '产品类型', deviceTypes), textFilter('dealer', '经销商', '输入经销商名称', ['dealer'])], rowActions: ['detail', 'edit'],
  }),
  createModule({
    key: 'approval-flow', route: 'approval-flow', title: '审批流程', eyebrow: '服务与售后', description: '按审批层级为业务流程配置逐级审核人员。', icon: 'workflow', permission: 'approval-flow:view', primaryLabel: '新增审批流程',
    tabs: [{ key: 'flows', label: '流程配置', field: 'category', value: '流程配置' }],
    columns: [{ field: 'name', label: '流程名称', minWidth: 180, type: 'main' }, { field: 'flowTypeLabel', label: '适用业务', width: 130 }, { field: 'levels', label: '审核层级', minWidth: 220 }, { field: 'memberNames', label: '审核人员', minWidth: 200 }, dateColumn('updatedAt', '更新时间'), statusColumn],
    fields: [textField('name', '流程名称', true), selectField('levels', '审核层级', [{ label: '二级 → 一级 → 平台', value: '二级 → 一级 → 平台' }, { label: '一级 → 平台', value: '一级 → 平台' }, { label: '平台直接审核', value: '平台直接审核' }], true), dynamicSelectField('level1ApproverId', '第一级审核人员', 'assignees'), dynamicSelectField('level2ApproverId', '第二级审核人员', 'assignees'), dynamicSelectField('platformApproverId', '平台审核人员', 'platform-assignees', true), selectField('status', '启用状态', accountStatusOptions, true)],
    filters: [textFilter('keyword', '流程查询', '流程名称或审核人员', ['name', 'memberNames'])], rowActions: ['detail', 'edit'],
  }),
  createModule({
    key: 'issuance', route: 'issuance', title: '物料发放记录', eyebrow: '服务与售后', description: '查询物料发放对象、发放时间和实际更换时间。', icon: 'package-open', permission: 'issuance:view', crud: 'readonly', primaryLabel: undefined,
    tabs: [{ key: 'all', label: '全部记录' }, { key: 'shipped', label: '运输中', field: 'status', value: 'shipped' }, { key: 'received', label: '已领取', field: 'status', value: 'received' }, { key: 'replaced', label: '已更换', field: 'status', value: 'completed' }],
    columns: [codeColumn, { field: 'materialName', label: '物料名称', minWidth: 180 }, { field: 'recipient', label: '发放对象', minWidth: 170 }, dateColumn('issuedAt', '发放时间'), dateColumn('replacedAt', '更换时间'), statusColumn],
    filters: [textFilter('keyword', '发放查询', '物料、领取人或单号', ['code', 'materialName', 'recipient']), selectFilter('status', '履约状态', [{ label: '运输中', value: 'shipped' }, { label: '已领取', value: 'received' }, { label: '已更换', value: 'completed' }])],
    rowActions: ['detail'], actions: [],
  }),
  createModule({
    key: 'payments', route: 'payments', title: '支付订单', eyebrow: '交易与内容', description: '查询 App 服务支付订单、渠道、金额和退款状态。', icon: 'receipt-text', permission: 'payments:view', crud: 'readonly', primaryLabel: undefined,
    tabs: [{ key: 'all', label: '全部订单' }, { key: 'pending', label: '待支付', field: 'status', value: 'pending' }, { key: 'paid', label: '支付成功', field: 'status', value: 'paid' }, { key: 'failed', label: '支付失败', field: 'status', value: 'failed' }, { key: 'refunded', label: '已退款', field: 'status', value: 'refunded' }],
    filters: [textFilter('keyword', '订单查询', '订单号或用户账号', ['code', 'account']), selectFilter('channel', '支付渠道', ['微信支付', '支付宝', 'PayPal', 'Apple Pay', 'Google Pay'].map((value) => ({ label: value, value }))), selectFilter('status', '支付状态', [{ label: '待支付', value: 'pending' }, { label: '支付成功', value: 'paid' }, { label: '支付失败', value: 'failed' }, { label: '已退款', value: 'refunded' }]), dateFilter('paidAt', '支付时间')],
    columns: [{ field: 'code', label: '订单号', width: 180, type: 'mono' }, { field: 'account', label: '用户账号', minWidth: 170 }, { field: 'name', label: '服务项目', minWidth: 180 }, { field: 'channel', label: '支付渠道', width: 120 }, { field: 'amount', label: '金额', width: 110, type: 'money' }, dateColumn('paidAt', '支付时间'), statusColumn],
    detailTabs: [overviewTab, { key: 'history', label: '支付状态记录', kind: 'timeline', source: 'workflow-events' }], rowActions: ['detail'], actions: [],
  }),
  createModule({
    key: 'banners', route: 'banners', title: 'Banner 管理', eyebrow: '交易与内容', description: '管理 App 首页 Banner 图片、跳转链接、排序和启用状态。', icon: 'panels-top-left', permission: 'banners:view', primaryLabel: '新增 Banner',
    tabs: [{ key: 'all', label: 'Banner 列表' }],
    filters: [textFilter('name', 'Banner 名称', '输入名称', ['name']), selectFilter('status', '状态', [{ label: '已启用', value: 'normal' }, { label: '已禁用', value: 'disabled' }, { label: '草稿', value: 'draft' }])],
    columns: [{ field: 'image', label: 'Banner 图片', width: 160, type: 'image' }, { field: 'name', label: 'Banner 名称', minWidth: 180, type: 'main' }, { field: 'target', label: '跳转链接', minWidth: 220 }, { field: 'sort', label: '排序', width: 80, type: 'number' }, statusColumn],
    fields: [textField('name', 'Banner 名称', true), { field: 'image', label: 'Banner 图片', type: 'image', required: true, span: 2 }, textField('target', '跳转链接', true), numberField('sort', '排序', true), selectField('status', '状态', [{ label: '已启用', value: 'normal' }, { label: '已禁用', value: 'disabled' }], true)],
    rowActions: ['detail', 'edit', 'toggle', 'delete'], actions: commonActions.filter((item) => ['toggle', 'delete'].includes(item.key)),
  }),
  createModule({
    key: 'admins', route: 'admins', title: '管理员账号', eyebrow: '系统管理', description: '管理平台与经销商后台账号、角色、数据范围和登录安全。', icon: 'user-cog', permission: 'admins:view', primaryByTab: { all: '新增管理员账号', platform: '新增平台管理员', dealer: '新增经销商管理员', locked: undefined },
    tabs: [{ key: 'all', label: '全部账号' }, { key: 'platform', label: '平台账号', field: 'category', value: '平台' }, { key: 'dealer', label: '经销商账号', field: 'category', value: '经销商' }, { key: 'locked', label: '已锁定', field: 'status', value: 'locked' }],
    filters: [textFilter('keyword', '账号查询', '账号或姓名', ['account', 'name']), selectFilter('role', '角色', [{ label: '平台管理员', value: '平台管理员' }, { label: '总部售后', value: '总部售后' }, { label: '经销商管理员', value: '经销商管理员' }]), selectFilter('status', '账号状态', [...accountStatusOptions, { label: '已锁定', value: 'locked' }])],
    columns: [{ field: 'account', label: '账号', minWidth: 200 }, { field: 'name', label: '姓名', width: 120 }, { field: 'role', label: '角色', width: 150 }, { field: 'dataScope', label: '数据范围', minWidth: 170 }, dateColumn('updatedAt', '更新时间'), namedStatusColumn('账号状态')],
    fields: [textField('account', '管理员账号', true), { field: 'initialPassword', label: '初始密码', type: 'password', requiredOnCreate: true }, textField('name', '姓名', true), dynamicSelectField('roleId', '角色', 'roles', true), dynamicSelectField('ownerId', '归属组织', 'dealer-organizations', true), selectField('status', '账号状态', accountStatusOptions, true)],
    rowActions: ['detail', 'edit', 'toggle', 'reset-password'], actions: commonActions.filter((item) => ['toggle', 'reset-password'].includes(item.key)),
  }),
  createModule({
    key: 'roles', route: 'roles', title: '角色权限', eyebrow: '系统管理', description: '查看角色并配置菜单与操作权限。', icon: 'shield-user', permission: 'roles:view', primaryLabel: undefined,
    tabs: [{ key: 'roles', label: '角色列表', field: 'category', excludeValues: ['权限矩阵', '权限变更'] }],
    filters: [textFilter('name', '角色名称', '输入角色名称', ['name'])],
    columns: [{ field: 'name', label: '角色名称', minWidth: 180, type: 'main' }, { field: 'permissionCount', label: '权限数量', width: 110, type: 'number' }, { field: 'dataScope', label: '数据范围', minWidth: 200 }, dateColumn('updatedAt', '更新时间'), statusColumn],
    fields: [textField('name', '角色名称', true), selectField('dataScope', '数据范围', [{ label: '全部数据', value: 'all' }, { label: '本级及下级', value: 'descendants' }, { label: '仅本组织', value: 'self' }], true), textareaField('summary', '角色说明')],
    detailTabs: [overviewTab, { key: 'permissions', label: '权限列表', kind: 'table', source: 'role-permissions', columns: [{ field: 'name', label: '菜单/操作', minWidth: 220 }, { field: 'code', label: '权限标识', minWidth: 220, type: 'mono' }, { field: 'category', label: '权限类型', width: 120 }] }], rowActions: ['detail', 'permissions'], actions: [action('permissions', '配置权限', '保存菜单与操作权限，并记录权限变更。')],
  }),
  createModule({
    key: 'logs', route: 'logs', title: '操作日志', eyebrow: '系统管理', description: '追踪增删改、审批、登录与高风险操作。', icon: 'scroll-text', permission: 'logs:view', crud: 'readonly', primaryLabel: undefined, auditOnly: true,
    tabs: [{ key: 'operations', label: '业务操作', field: 'category', value: '业务操作' }, { key: 'login', label: '登录日志', field: 'category', value: '登录' }, { key: 'risk', label: '高风险操作', field: 'status', value: 'warning' }],
    filters: [textFilter('account', '操作账号', '输入账号或姓名', ['account', 'operator']), dateFilter('createdAt', '操作时间'), selectFilter('operationType', '操作类型', [{ label: '登录', value: '登录' }, { label: '新增', value: '新增' }, { label: '编辑', value: '编辑' }, { label: '删除', value: '删除' }, { label: '高风险操作', value: '高风险操作' }])],
    columns: [{ field: 'account', label: '操作账号', minWidth: 180 }, dateColumn('createdAt', '操作时间'), { field: 'operationType', label: '操作类型', width: 130 }, { field: 'content', label: '操作内容', minWidth: 260 }, { field: 'ip', label: '来源 IP', width: 140, type: 'mono' }, statusColumn], rowActions: ['detail'], actions: [],
  }),
]

export const moduleConfigs: Record<string, ModuleConfig> = Object.fromEntries(configs.map((item) => [item.route, item]))

export const navGroups: NavGroup[] = [
  { label: '工作台', items: [
    { route: 'dashboard', label: '首页', icon: 'layout-dashboard', permission: 'dashboard:view' },
  ] },
  { label: '客户与渠道', items: ['users', 'dealers', 'projects'].map((route) => ({ route, label: moduleConfigs[route].title, icon: moduleConfigs[route].icon, permission: moduleConfigs[route].permission })) },
  { label: '设备与库存', items: ['devices', 'warehouse', 'ota'].map((route) => ({ route, label: moduleConfigs[route].title, icon: moduleConfigs[route].icon, permission: moduleConfigs[route].permission })) },
  { label: '服务与售后', items: [
    ...['repairs', 'messages', 'complaints'].map((route) => ({ route, label: moduleConfigs[route].title, icon: moduleConfigs[route].icon, permission: moduleConfigs[route].permission, section: '工单服务' })),
    ...['materials', 'material-catalog', 'issuance'].map((route) => ({ route, label: moduleConfigs[route].title, icon: moduleConfigs[route].icon, permission: moduleConfigs[route].permission, section: '物料履约' })),
    ...['couriers', 'sn-replacement', 'service-transfer', 'warranty', 'approval-flow'].map((route) => ({ route, label: moduleConfigs[route].title, icon: moduleConfigs[route].icon, permission: moduleConfigs[route].permission, section: '售后配置' })),
  ] },
  { label: '交易与内容', items: [
    { route: 'payments', label: '支付订单', icon: 'receipt-text', permission: 'payments:view', section: '交易管理' },
    { route: 'payment-settings', label: '支付配置', icon: 'wallet-cards', permission: 'payment-settings:view', section: '交易管理' },
    { route: 'banners', label: 'Banner 管理', icon: 'panels-top-left', permission: 'banners:view', section: '内容运营' },
  ] },
  { label: '系统管理', items: [
    ...['admins', 'roles', 'logs'].map((route) => ({ route, label: moduleConfigs[route].title, icon: moduleConfigs[route].icon, permission: moduleConfigs[route].permission, section: '权限与审计' })),
  ] },
]

export const statusLabels: Record<string, { label: string; tone: string }> = {
  normal: { label: '正常', tone: 'success' }, active: { label: '当前生效', tone: 'success' }, online: { label: '在线', tone: 'success' }, activated: { label: '已激活', tone: 'success' }, bound: { label: '已绑定', tone: 'success' }, paid: { label: '支付成功', tone: 'success' }, published: { label: '已发布', tone: 'success' }, approved: { label: '已审批', tone: 'success' }, completed: { label: '已完成', tone: 'success' }, received: { label: '已领取', tone: 'success' }, consumed: { label: '已扣减', tone: 'success' },
  pending: { label: '待处理', tone: 'warning' }, waiting: { label: '等待前序审批', tone: 'neutral' }, processing: { label: '处理中', tone: 'info' }, warning: { label: '临期', tone: 'warning' }, low: { label: '库存偏低', tone: 'warning' }, shipped: { label: '运输中', tone: 'info' }, draft: { label: '草稿', tone: 'neutral' }, inactive: { label: '未激活', tone: 'neutral' }, unbound: { label: '未绑定', tone: 'neutral' }, offline: { label: '离线', tone: 'neutral' }, forwarded: { label: '已转发', tone: 'info' }, transferred: { label: '已转移', tone: 'neutral' }, replaced: { label: '已换机', tone: 'neutral' }, withdrawn: { label: '已撤回', tone: 'neutral' },
  disabled: { label: '已禁用', tone: 'error' }, failed: { label: '失败', tone: 'error' }, rejected: { label: '已拒绝', tone: 'error' }, expired: { label: '已过期', tone: 'error' }, locked: { label: '已锁定', tone: 'error' }, refunded: { label: '已退款', tone: 'neutral' },
}
