import type { ActionConfig, ColumnConfig, DetailTabConfig, FieldConfig, FilterConfig, ModuleConfig, NavGroup } from '@/types'
import { deviceTypes } from '@/config/device-catalog'

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
const countries = ['中国', '美国', '英国', '澳大利亚', '新加坡'].map((value) => ({ label: value, value }))
const afterSalesRequiredFieldOptions = [
  ['deviceSN', '设备 SN'], ['contact', '联系方式'], ['description', '问题描述'],
  ['attachments', '图片/视频附件'], ['faultCategory', '故障分类'], ['installationRegion', '安装地区'],
].map(([value, label]) => ({ label, value }))

const codeColumn: ColumnConfig = { field: 'code', label: '业务编号', width: 156, type: 'mono' }
const dateColumn = (field: string, label: string): ColumnConfig => ({ field, label, width: 160, type: 'date' })
const statusColumn: ColumnConfig = { field: 'status', label: '状态', width: 104, type: 'status' }
const namedStatusColumn = (label: string): ColumnConfig => ({ ...statusColumn, label })
const deviceSNColumn: ColumnConfig = { field: 'deviceSN', label: '设备 SN', width: 176, type: 'mono' }
const deviceTypeColumn: ColumnConfig = { field: 'deviceType', label: '设备类型', minWidth: 140 }
const deviceModelColumn: ColumnConfig = { field: 'deviceModel', label: '设备型号', minWidth: 130, type: 'mono' }
const relatedDeviceSNColumn: ColumnConfig = { field: 'code', label: '设备 SN', width: 176, type: 'mono' }
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
    exportable: true,
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
    key: 'users', route: 'users', title: '用户管理', eyebrow: '客户与渠道', description: '管理 App 注册用户、账号状态和绑定设备；敏感账号信息默认脱敏。', icon: 'users', permission: 'users:view', crud: 'managed', primaryLabel: undefined,
    tabs: [{ key: 'all', label: '全部用户' }, { key: 'active', label: '正常', field: 'status', value: 'normal' }, { key: 'disabled', label: '已禁用', field: 'status', value: 'disabled' }],
    filters: [textFilter('account', '用户账号', '手机号、邮箱或 APPID', ['account']), textFilter('name', '用户昵称', '输入昵称', ['name']), selectFilter('category', '注册方式', ['邮箱', '手机', 'Google', '微信', 'APPID'].map((value) => ({ label: value, value }))), dateFilter('createdAt', '注册时间'), selectFilter('status', '账号状态', accountStatusOptions)],
    columns: [{ field: 'code', label: '用户 ID', width: 146, type: 'mono' }, { field: 'account', label: '账号', minWidth: 180, type: 'main', mask: 'account' }, { field: 'name', label: '昵称', width: 128 }, { field: 'category', label: '注册方式', width: 104 }, { field: 'deviceCount', label: '绑定设备数', width: 112, type: 'link' }, dateColumn('createdAt', '注册时间'), { field: 'lastActive', label: '最近活跃', width: 120 }, namedStatusColumn('账号状态')],
    fields: [],
    detailTabs: [overviewTab, { key: 'devices', label: '绑定设备', kind: 'table', source: 'user-devices', title: '绑定设备', description: '当前账号实际绑定的设备，可执行强制解绑。', columns: [relatedDeviceSNColumn, deviceTypeColumn, deviceModelColumn, { field: 'region', label: '销售地区', width: 120 }, { field: 'boundAt', label: '绑定时间', width: 160, type: 'date' }, { field: 'status', label: '设备状态', width: 100, type: 'status' }] }, { key: 'waypoints', label: '航点数据', kind: 'table', source: 'waypoints', title: '航点数据', description: '当前用户上传并保存到服务器的航点记录，本地未上传航点不会进入后台。', columns: [{ field: 'code', label: '航点编号', width: 138, type: 'mono' }, { field: 'name', label: '航点名称', minWidth: 120 }, { field: 'deviceSN', label: '来源设备 SN', minWidth: 160, type: 'mono' }, { field: 'location', label: '位置名称', minWidth: 150 }, { field: 'coordinates', label: '坐标', minWidth: 170, type: 'mono' }, { field: 'recordedAt', label: '上传时间', width: 168, type: 'date' }, { field: 'syncStatus', label: '同步状态', width: 100, type: 'status' }] }],
    rowActions: ['detail', 'toggle', 'reset-password'], actions: commonActions.filter((item) => ['toggle', 'reset-password'].includes(item.key)),
  }),
  createModule({
    key: 'dealers', route: 'dealers', title: '经销商管理', eyebrow: '客户与渠道', description: '维护一级/二级渠道层级、负责地区、默认质保期限、设备范围和账号状态。', icon: 'store', permission: 'dealers:view', primaryByTab: { all: '新增经销商', tier1: '新增一级经销商', tier2: '新增二级经销商', disabled: undefined },
    tabs: [{ key: 'all', label: '全部经销商' }, { key: 'tier1', label: '一级经销商', field: 'tier', value: '一级' }, { key: 'tier2', label: '二级经销商', field: 'tier', value: '二级' }, { key: 'disabled', label: '已禁用', field: 'status', value: 'disabled' }],
    filters: [textFilter('keyword', '关键词', '账号、名称或地区', ['account', 'name', 'region']), selectFilter('tier', '层级', ['一级', '二级'].map((value) => ({ label: value, value }))), selectFilter('status', '状态', accountStatusOptions), dateFilter('createdAt', '创建时间')],
    columns: [{ field: 'name', label: '经销商名称', minWidth: 190, type: 'main' }, { field: 'account', label: '账号', minWidth: 180 }, { field: 'region', label: '负责地区', width: 150 }, { field: 'tier', label: '层级', width: 90 }, { field: 'parentDealer', label: '上级经销商', minWidth: 170 }, { field: 'defaultWarrantyYears', label: '默认整机质保/年', width: 140, type: 'number' }, { field: 'deviceCount', label: '管理设备数', width: 112, type: 'number' }, statusColumn],
    fields: [textField('account', '登录账号', true), { field: 'initialPassword', label: '初始密码', type: 'password', requiredOnCreate: true }, textField('name', '经销商名称', true), { ...dynamicSelectField('region', '负责地区', 'dealer-regions', true), placeholder: '从区域字典选择负责地区' }, selectField('tier', '经销商层级', ['一级', '二级'].map((value) => ({ label: value, value })), true), { ...dynamicSelectField('parentDealerId', '上级经销商', 'tier1-dealers', true), visibleWhen: { field: 'tier', value: '二级' } }, { ...numberField('defaultWarrantyYears', '经销商默认整机质保期（年）', true), min: 1 }, textField('phone', '联系电话', true), textField('email', '联系邮箱'), selectField('status', '账号状态', accountStatusOptions, true)],
    detailTabs: [overviewTab, { key: 'devices', label: '设备范围', kind: 'table', source: 'dealer-devices', columns: [relatedDeviceSNColumn, deviceTypeColumn, deviceModelColumn, { field: 'region', label: '销售地区', width: 120 }, statusColumn] }, { key: 'service', label: '售后数据', kind: 'table', source: 'dealer-service', columns: [codeColumn, { field: 'name', label: '业务内容', minWidth: 200 }, { field: 'category', label: '售后类型', width: 130 }, { field: 'amount', label: '涉及费用', width: 110, type: 'money' }, statusColumn] }, { key: 'accounts', label: '账号管理', kind: 'table', source: 'dealer-accounts', columns: [{ field: 'account', label: '登录账号', minWidth: 190 }, { field: 'name', label: '姓名', width: 120 }, { field: 'role', label: '角色', width: 130 }, statusColumn] }],
    rowActions: ['detail', 'edit', 'toggle', 'reset-password'], actions: commonActions.filter((item) => ['toggle', 'reset-password'].includes(item.key)),
  }),
  createModule({
    key: 'projects', route: 'projects', title: '安装管理', eyebrow: '客户与渠道', description: '新增和维护设备安装项目、绑定设备、所属经销商与质保到期情况，并保留客户信息变更历史。', icon: 'ship-wheel', permission: 'projects:view', primaryLabel: '新增安装项目',
    statusTones: { warning: 'error' },
    tabs: [{ key: 'all', label: '全部项目' }, { key: 'warranty', label: '质保临期', field: 'status', value: 'warning' }, { key: 'expired', label: '已过期', field: 'status', value: 'expired' }],
    filters: [textFilter('keyword', '项目搜索', '船名、SN 号、船东或安装地区', ['name', 'deviceSN', 'shipOwner', 'installationRegion']), { field: 'ownerId', label: '所属经销商', type: 'select', optionSource: 'dealers' }, selectFilter('status', '项目状态', [{ label: '正常', value: 'normal' }, { label: '待跨区审核', value: 'pending' }, { label: '质保临期', value: 'warning' }, { label: '已过期', value: 'expired' }, { label: '审核驳回', value: 'rejected' }]), dateFilter('createdAt', '创建时间')],
    columns: [{ field: 'name', label: '船名', minWidth: 150, type: 'main' }, deviceSNColumn, deviceTypeColumn, deviceModelColumn, { field: 'shipOwner', label: '船东姓名', width: 130 }, { field: 'factoryRegion', label: '出厂地区', minWidth: 130 }, { field: 'installationRegion', label: '安装地区', minWidth: 130 }, { field: 'owner', label: '所属经销商', minWidth: 170 }, { field: 'warrantyUntil', label: '质保到期日', width: 130, type: 'date' }, statusColumn],
    fields: [textField('name', '船名', true), dynamicSelectField('deviceType', '设备类型', 'device-types', true), dynamicSelectField('deviceModel', '设备型号', 'device-models', true), dynamicSelectField('deviceSN', '设备 SN', 'accessible-devices', true), { ...textField('deviceName', '设备名称'), readonly: true }, { ...textField('specification', '产品规格'), readonly: true }, textField('shipOwner', '船东姓名', true), { ...textField('factoryRegion', '出厂地区', true), readonly: true }, textField('installationRegion', '实际安装地区', true), { ...textField('owner', '所属经销商', true), readonly: true }, { field: 'warrantyUntil', label: '质保到期日（未激活时为空）', type: 'date', readonly: true }, textareaField('summary', '项目备注')],
    detailTabs: [overviewTab, { key: 'devices', label: '绑定设备', kind: 'table', source: 'project-devices', columns: [relatedDeviceSNColumn, deviceTypeColumn, deviceModelColumn, { field: 'firmware', label: '固件版本', width: 110 }, statusColumn] }, { key: 'warranty', label: '质保信息', kind: 'fields', source: 'project-warranty' }, { key: 'service', label: '售后记录', kind: 'table', source: 'project-service', columns: [codeColumn, { field: 'name', label: '服务事项', minWidth: 200 }, { field: 'category', label: '类型', width: 120 }, statusColumn] }, { key: 'history', label: '项目变更历史', kind: 'table', source: 'project-history', columns: [dateColumn('createdAt', '变更时间'), { field: 'changeType', label: '变更类型', width: 110 }, { field: 'snapshot', label: '原记录快照', minWidth: 300 }, { field: 'operator', label: '操作人', width: 120 }] }],
    rowActions: ['detail', 'edit', 'delete'], actions: commonActions.filter((item) => item.key === 'delete'),
  }),
  createModule({
    key: 'devices', route: 'devices', title: '设备管理', eyebrow: '设备与产品', description: '查看设备身份、销售地区、最近一次使用地区、激活绑定、固件与连接状态；使用地区来自用户授权后的 APP 上报。', icon: 'cpu', permission: 'devices:view', crud: 'managed', primaryLabel: '录入设备', primaryByTab: { all: '录入设备', online: undefined, inactive: '录入未激活设备', disabled: undefined },
    tabs: [{ key: 'all', label: '全部设备' }, { key: 'online', label: '已连接', field: 'status', value: 'online' }, { key: 'offline', label: '未连接', field: 'status', value: 'offline' }, { key: 'inactive', label: '未激活', field: 'activation', value: 'inactive' }, { key: 'disabled', label: '远程禁用', field: 'status', value: 'disabled' }],
    filters: [textFilter('code', '设备序列号', '输入完整 SN', ['code'], true), selectFilter('name', '设备型号', deviceTypes), selectFilter('country', '销售国家', countries), textFilter('region', '销售地区', '输入省、市或区域', ['region']), { field: 'ownerId', label: '所属经销商', type: 'select', optionSource: 'dealers' }, selectFilter('activation', '激活状态', [{ label: '未激活', value: 'inactive' }, { label: '已激活', value: 'activated' }]), selectFilter('bindingStatus', '绑定状态', [{ label: '未绑定', value: 'unbound' }, { label: '已绑定', value: 'bound' }])],
    columns: [{ field: 'code', label: '设备 SN', width: 176, type: 'mono' }, { field: 'deviceName', label: '设备名称', minWidth: 150, type: 'main' }, { field: 'deviceType', label: '设备类型', minWidth: 150 }, { field: 'deviceModel', label: '设备型号', width: 130, type: 'mono' }, { field: 'specification', label: '产品规格', minWidth: 150 }, { field: 'region', label: '销售地区', minWidth: 140 }, { field: 'lastUsedRegion', label: '最近一次使用地区', minWidth: 170 }, { field: 'owner', label: '所属经销商', minWidth: 180 }, { field: 'activation', label: '激活状态', width: 110, type: 'status' }, { field: 'account', label: '绑定用户', minWidth: 150 }, { field: 'activationDate', label: '激活日期', width: 130, type: 'date' }, { field: 'firmware', label: '固件版本', width: 110, type: 'mono' }, statusColumn],
    fields: [textField('code', '设备 SN', true), { ...dynamicSelectField('name', '产品/型号', 'product-descriptors', true) }, { ...textField('deviceName', '设备名称'), readonly: true }, { ...textField('deviceType', '设备类型'), readonly: true }, { ...textField('deviceModel', '设备型号'), readonly: true }, { ...textField('specification', '产品规格'), readonly: true }, textField('region', '销售地区', true), { ...textField('lastUsedRegion', '最近一次使用地区（用户授权上报）'), readonly: true }, { ...textField('lastUsedAt', '最近使用时间'), readonly: true }, { field: 'components', label: '子物料序列号与规格', type: 'componentItems', span: 2 }, { ...textField('communicationId', '通信设备 ID'), readonly: true }, { ...textField('chipId', '芯片 ID'), readonly: true }, { ...textField('mainboardSerial', '主板编号'), readonly: true }, { ...textField('coreComponentSerials', '核心部件编号'), readonly: true }],
    detailTabs: [overviewTab, { key: 'components', label: '子物料明细', kind: 'table', source: 'device-components', columns: [{ field: 'serialNumber', label: '子物料序列号', minWidth: 190, type: 'mono' }, { field: 'specification', label: '规格', minWidth: 200 }, dateColumn('createdAt', '登记时间'), statusColumn] }, { key: 'ownership', label: '设备归属', kind: 'table', source: 'ownership-history', columns: [{ field: 'createdAt', label: '变更时间', width: 160, type: 'date' }, { field: 'fromOwner', label: '原归属', minWidth: 160 }, { field: 'toOwner', label: '新归属', minWidth: 160 }, { field: 'operationType', label: '变更类型', width: 120 }, { field: 'operator', label: '操作人', width: 120 }] }, { key: 'firmware', label: '固件记录', kind: 'table', source: 'firmware-history', columns: [{ field: 'createdAt', label: '更新时间', width: 160, type: 'date' }, { field: 'fromVersion', label: '原版本', width: 110, type: 'mono' }, { field: 'toVersion', label: '目标版本', width: 110, type: 'mono' }, { field: 'updateMode', label: '更新方式', width: 120 }, statusColumn] }, { key: 'service', label: '售后记录', kind: 'table', source: 'device-service', columns: [codeColumn, { field: 'name', label: '售后事项', minWidth: 200 }, { field: 'category', label: '类型', width: 120 }, statusColumn] }],
    rowActions: ['detail', 'change-region', 'unbind', 'remote-disable', 'remote-enable'], actions: [action('change-region', '修改销售地区', '仅修改设备的销售国家和地区，并保留变更原因。', [selectField('country', '销售国家', countries, true), textField('region', '销售地区', true), reasonField]), action('unbind', '强制解绑', '解除用户绑定，原 SN 将追加 -1，并同步归属历史。', [reasonField], undefined, 'danger'), action('remote-disable', '远程禁用', '在线设备生成模拟成功指令；离线设备会明确登记为待联网下发，不宣称设备已经响应。', [reasonField], ['online', 'offline'], 'danger'), action('remote-enable', '远程启用', '纯前端环境会生成一条可追踪的远程启用模拟指令，不代表真实设备已经响应。', [reasonField], ['disabled'])],
  }),
  createModule({
    key: 'product-catalog', route: 'product-catalog', title: '产品与型号', eyebrow: '设备与产品', description: '维护产品名称、设备类型、型号、规格和参考价格；设备录入统一引用产品主档。', icon: 'boxes', permission: 'product-catalog:view', primaryLabel: '新增产品型号',
    tabs: [{ key: 'all', label: '全部产品' }, { key: 'enabled', label: '已启用', field: 'status', value: 'normal' }, { key: 'disabled', label: '已停用', field: 'status', value: 'disabled' }],
    filters: [textFilter('keyword', '产品查询', '产品名称、类型、型号或规格', ['name', 'deviceType', 'deviceModel', 'specification']), selectFilter('status', '状态', accountStatusOptions)],
    columns: [codeColumn, { field: 'name', label: '产品名称', minWidth: 160, type: 'main' }, { field: 'deviceType', label: '设备类型', minWidth: 150 }, { field: 'deviceModel', label: '设备型号', width: 130, type: 'mono' }, { field: 'specification', label: '规格', minWidth: 170 }, { field: 'referencePrice', label: '参考价格', width: 120, type: 'money' }, dateColumn('updatedAt', '更新时间'), statusColumn],
    fields: [textField('code', '产品编号', true), textField('name', '产品名称', true), textField('deviceType', '设备类型', true), textField('deviceModel', '设备型号', true), textField('specification', '规格', true), { ...numberField('referencePrice', '参考价格', true), min: 0 }, selectField('status', '状态', accountStatusOptions, true), textareaField('summary', '产品说明')],
    detailTabs: [overviewTab, { key: 'prices', label: '价格历史', kind: 'table', source: 'price-history', columns: [dateColumn('createdAt', '生效时间'), { field: 'oldPrice', label: '原价格', width: 120, type: 'money' }, { field: 'newPrice', label: '新价格', width: 120, type: 'money' }, { field: 'operator', label: '操作人', width: 120 }] }, historyTab],
    rowActions: ['detail', 'edit', 'toggle'], actions: commonActions.filter((item) => item.key === 'toggle'),
  }),
  createModule({
    key: 'warehouses', route: 'warehouses', title: '仓库 / 仓位管理', eyebrow: '仓储与采购', description: '在一个入口查询仓库主档及其仓位；仓库、仓位仅允许新增、编辑和停用，不提供删除。', icon: 'warehouse', permission: 'warehouses:view', primaryLabel: '新增仓库',
    columns: [codeColumn, { field: 'name', label: '仓库名称', minWidth: 180, type: 'main' }, { field: 'category', label: '仓库类型', width: 120 }, { field: 'region', label: '所在地区', minWidth: 160 }, { field: 'manager', label: '负责人', minWidth: 150 }, dateColumn('updatedAt', '更新时间'), statusColumn],
    fields: [textField('code', '仓库编号', true), textField('name', '仓库名称', true), selectField('category', '仓库类型', [{ label: '中心仓', value: '中心仓' }, { label: '区域仓', value: '区域仓' }, { label: '海外仓', value: '海外仓' }], true), textField('region', '所在地区', true), textField('manager', '负责人', true), selectField('status', '状态', accountStatusOptions, true), textareaField('summary', '仓库说明')],
    detailTabs: [overviewTab, { key: 'locations', label: '库位', kind: 'table', source: 'warehouse-locations', columns: [codeColumn, { field: 'name', label: '库位名称', minWidth: 150 }, { field: 'capacity', label: '容量', width: 100, type: 'number' }, statusColumn] }, historyTab],
    rowActions: ['detail', 'edit', 'toggle'], actions: commonActions.filter((item) => item.key === 'toggle'),
  }),
  createModule({
    key: 'warehouse-locations', route: 'warehouse-locations', title: '库位管理', eyebrow: '仓储与采购', description: '维护仓库内的库位编码和容量，库位必须归属于一个有效仓库。', icon: 'map-pin', permission: 'warehouse-locations:view', primaryLabel: '新增库位',
    columns: [codeColumn, { field: 'name', label: '库位名称', minWidth: 150, type: 'main' }, { field: 'warehouseName', label: '所属仓库', minWidth: 180 }, { field: 'capacity', label: '容量', width: 100, type: 'number' }, dateColumn('updatedAt', '更新时间'), statusColumn],
    fields: [textField('code', '库位编码', true), textField('name', '库位名称', true), dynamicSelectField('warehouseId', '所属仓库', 'warehouses', true), { ...textField('warehouseName', '仓库名称'), readonly: true }, { ...numberField('capacity', '容量', true), min: 1 }, selectField('status', '状态', accountStatusOptions, true), textareaField('summary', '库位说明')],
    rowActions: ['detail', 'edit', 'toggle'], actions: commonActions.filter((item) => item.key === 'toggle'),
  }),
  createModule({
    key: 'warehouse', route: 'warehouse', title: '仓库设备', eyebrow: '仓储与采购', description: '管理在库设备、出库、调货审批和设备归属变更。', icon: 'warehouse', permission: 'warehouse:view', crud: 'workflow', primaryLabel: '设备入库', primaryByTab: { stock: '设备入库', outbound: '创建出库单', transfer: '发起调货申请', ownership: undefined },
    tabs: [{ key: 'stock', label: '仓库区', field: 'category', value: '在库' }, { key: 'outbound', label: '设备出库', field: 'category', value: '出库' }, { key: 'transfer', label: '库存调货', field: 'category', value: '调货' }, { key: 'ownership', label: '归属查询', source: 'ownership-history' }],
    filters: [textFilter('keyword', '设备查询', '设备 SN 或型号', ['deviceSN', 'deviceModel', 'code', 'name']), dateFilter('inboundAt', '入库时间'), selectFilter('status', '业务状态', workflowStatusOptions)],
    columns: [deviceSNColumn, deviceTypeColumn, deviceModelColumn, { field: 'quantity', label: '数量', width: 80, type: 'number' }, { field: 'targetDealer', label: '接收经销商', minWidth: 170 }, dateColumn('inboundAt', '入库/申请时间'), statusColumn],
    tabColumns: {
      stock: [{ field: 'deviceSN', label: '设备 SN', width: 180, type: 'mono' }, { field: 'deviceType', label: '设备类型', minWidth: 150 }, { field: 'deviceModel', label: '设备型号', minWidth: 150 }, { field: 'specification', label: '规格', minWidth: 160 }, { field: 'warehouseName', label: '仓库', minWidth: 150 }, { field: 'warehouseLocation', label: '库位', width: 110 }, { field: 'country', label: '销售国家', width: 110 }, dateColumn('inboundAt', '入库时间'), statusColumn],
      outbound: [codeColumn, { ...deviceSNColumn, label: '设备清单', minWidth: 220, width: undefined }, deviceTypeColumn, deviceModelColumn, { field: 'targetDealer', label: '接收经销商', minWidth: 190 }, dateColumn('createdAt', '创建时间'), statusColumn],
      transfer: [codeColumn, { ...deviceSNColumn, label: '设备清单', minWidth: 220, width: undefined }, deviceTypeColumn, deviceModelColumn, { field: 'sourceDealer', label: '原经销商', minWidth: 170 }, { field: 'targetDealer', label: '目标经销商', minWidth: 170 }, statusColumn],
      ownership: [deviceSNColumn, deviceTypeColumn, deviceModelColumn, { field: 'currentOwner', label: '当前归属', minWidth: 180 }, dateColumn('createdAt', '变更时间'), { field: 'fromOwner', label: '原归属', minWidth: 180 }, { field: 'toOwner', label: '新归属', minWidth: 180 }, { field: 'operationType', label: '变更类型', width: 130 }, { field: 'operator', label: '操作人', width: 120 }],
    },
    tabFilters: {
      stock: [{ field: 'deviceType', label: '设备类型', type: 'select', optionSource: 'device-types' }, { field: 'deviceModel', label: '设备型号', type: 'select', optionSource: 'device-models' }, textFilter('deviceSN', '设备 SN', '输入完整或部分 SN', ['deviceSN']), dateFilter('inboundAt', '入库时间')],
      outbound: [textFilter('keyword', '出库单查询', '单号、SN 或接收经销商', ['code', 'deviceSN', 'targetDealer']), selectFilter('status', '出库状态', workflowStatusOptions), dateFilter('createdAt', '创建时间')],
      transfer: [textFilter('keyword', '调货单查询', '单号、SN 或经销商', ['code', 'deviceSN', 'sourceDealer', 'targetDealer']), selectFilter('status', '审批状态', workflowStatusOptions)],
      ownership: [textFilter('deviceSN', '设备 SN', '输入完整 SN 查询归属', ['deviceSN'], true)],
    },
    tabRowActions: { stock: ['detail'], outbound: ['detail', 'confirm-outbound', 'reject-outbound'], transfer: ['detail', 'process'], ownership: [] },
    fields: [dynamicSelectField('deviceType', '设备类型', 'device-types', true), dynamicSelectField('deviceModel', '设备型号', 'device-models', true), textField('deviceSN', '设备 SN', true), textField('deviceName', '设备名称', true), { ...textField('specification', '规格'), readonly: true }, textField('region', '销售地区', true), dynamicSelectField('warehouseId', '仓库', 'warehouses', true), dynamicSelectField('warehouseLocationId', '库位', 'warehouse-locations', true)],
    tabFields: {
      outbound: [dynamicMultiSelectField('selectedDevices', '选择在库设备', 'warehouse-devices', true), dynamicSelectField('targetDealerId', '接收经销商', 'dealers', true), textareaField('summary', '出库说明')],
      transfer: [dynamicMultiSelectField('selectedDevices', '选择可调货设备', 'dealer-devices', true), { ...textField('sourceDealer', '原经销商'), readonly: true }, dynamicSelectField('targetDealerId', '目标经销商', 'transfer-target-dealers', true), textareaField('summary', '调货原因', true)],
    },
    detailTabs: [overviewTab, { key: 'devices', label: '设备清单', kind: 'table', source: 'warehouse-devices', columns: [relatedDeviceSNColumn, deviceTypeColumn, deviceModelColumn, { field: 'owner', label: '当前归属', minWidth: 170 }, statusColumn] }, { key: 'history', label: '流转记录', kind: 'timeline', source: 'workflow-events' }],
    rowActions: ['detail', 'process'], actions: [
      action('confirm-outbound', '确认出库', '确认后设备将从平台库存出库，并同步接收经销商归属、库存流水和设备归属历史。', [textareaField('reason', '出库说明')], ['pending', 'processing']),
      action('reject-outbound', '驳回出库', '驳回后出库单终止，设备继续保留在原仓库库存中。', [reasonField], ['pending', 'processing'], 'danger'),
      action('process', '调货审批', '仅用于库存调货申请，审核后按固定流程同步设备归属、历史、统计和日志。', [selectField('decision', '审核结果', [{ label: '审批通过', value: 'approved' }, { label: '审批拒绝', value: 'rejected' }], true), reasonField], ['pending', 'processing']),
    ],
  }),
  createModule({
    key: 'purchase-shipping', route: 'purchase-shipping', title: '采购发货', eyebrow: '设备与库存', description: '承接财务核实并放行后的设备采购单，完成仓库发货、物流登记和采购方收货确认。', icon: 'truck', permission: 'purchase-shipping:view', crud: 'workflow', primaryLabel: undefined,
    tabs: [
      { key: 'pending', label: '待发货', source: 'materials', field: 'purchaseStage', value: 'warehouse_fulfillment' },
      { key: 'shipped', label: '已发货', source: 'materials', field: 'purchaseStage', value: 'shipped' },
      { key: 'received', label: '已收货', source: 'materials', field: 'purchaseStage', value: 'received' },
      { key: 'all', label: '全部采购发货', source: 'materials', field: 'purchaseStage', values: ['warehouse_fulfillment', 'shipped', 'received'] },
    ],
    filters: [textFilter('keyword', '发货单查询', '采购单号、经销商、设备或物流单号', ['code', 'dealer', 'deviceModel', 'trackingNo']), selectFilter('purchaseStage', '发货节点', [{ label: '待发货', value: 'warehouse_fulfillment' }, { label: '已发货', value: 'shipped' }, { label: '已收货', value: 'received' }])],
    columns: [{ field: 'code', label: '采购单号', width: 170, type: 'mono' }, { field: 'dealer', label: '申请经销商', minWidth: 170 }, { field: 'deviceModel', label: '采购设备', minWidth: 180 }, { field: 'quantity', label: '数量', width: 76, type: 'number' }, { field: 'paidAmount', label: '已核实金额', width: 125, type: 'money' }, { field: 'remainingAmount', label: '待付金额', width: 115, type: 'money' }, { field: 'financeConfirmedBy', label: '财务审核人', width: 120 }, { field: 'purchaseStageLabel', label: '当前节点', width: 125 }, { field: 'deliveryStatus', label: '发货状态', width: 110 }, { field: 'trackingNo', label: '物流单号', minWidth: 160, type: 'mono' }],
    fields: [],
    detailTabs: [overviewTab, { key: 'items', label: '采购明细', kind: 'table', source: 'purchase-items', columns: [{ field: 'itemName', label: '设备/物料', minWidth: 190 }, { field: 'itemType', label: '类型', width: 100 }, { field: 'quantity', label: '数量', width: 80, type: 'number' }, { field: 'unitPrice', label: '单价', width: 120, type: 'money' }, { field: 'subtotal', label: '小计', width: 120, type: 'money' }] }, { key: 'expenses', label: '付款记录', kind: 'table', source: 'expense-records', columns: [dateColumn('paidAt', '付款日期'), { field: 'amount', label: '本次付款', width: 130, type: 'money' }, { field: 'paymentProof', label: '付款截图', width: 120, type: 'image' }, { field: 'paymentReference', label: '支付凭证号', minWidth: 180, type: 'mono' }, { field: 'operator', label: '核实人', width: 120 }] }, { key: 'fulfillment', label: '发货与收货', kind: 'table', source: 'purchase-fulfillments', columns: [dateColumn('shippedAt', '发货日期'), { field: 'warehouseName', label: '发货仓库', minWidth: 150 }, { field: 'deviceSN', label: '发货清单', minWidth: 210, type: 'mono' }, { field: 'shipmentPhoto', label: '发货照片', width: 120, type: 'image' }, { field: 'courier', label: '快递公司', width: 130 }, { field: 'trackingNo', label: '物流单号', minWidth: 160, type: 'mono' }, { field: 'receiptPhoto', label: '收货照片', width: 120, type: 'image' }] }, { key: 'logistics', label: '物流信息', kind: 'table', source: 'logistics-records', columns: [{ field: 'courier', label: '快递公司', width: 140 }, { field: 'trackingNo', label: '物流单号', width: 190, type: 'mono' }, { field: 'content', label: '最新轨迹', minWidth: 240 }, dateColumn('updatedAt', '更新时间')] }],
    rowActions: ['detail', 'purchase-ship', 'confirm-purchase-receipt'],
    actions: [
      action('purchase-ship', '仓库发货', '仓库按采购清单选择设备，保存发货照片、快递公司和物流单号；操作会同步库存、设备归属、出库记录和物流记录。', [dynamicMultiSelectField('selectedDevices', '选择在库设备', 'warehouse-devices', true), dynamicSelectField('warehouseId', '发货仓库', 'warehouses', true), dynamicSelectField('courierId', '快递公司', 'enabled-couriers', true), textField('trackingNo', '物流单号', true), { field: 'shipmentPhoto', label: '发货照片', type: 'image', required: true }, { field: 'shippedAt', label: '发货日期', type: 'date', required: true }, textareaField('reason', '发货说明', true)], ['approved']),
      action('confirm-purchase-receipt', '确认采购收货', '确认采购货物已签收；收货照片为可选的本地 Mock 凭证。', [{ field: 'receiptPhoto', label: '收货照片（可选）', type: 'image' }, textareaField('reason', '收货说明', true)], ['shipped']),
    ],
  }),
  createModule({
    key: 'ota', route: 'ota', title: 'OTA 管理', eyebrow: '设备与产品', description: '按产品、设备类型和设备型号管理固件版本、强制更新与发布状态；适用范围同步自产品与型号主数据。', icon: 'package-up', permission: 'ota:view', primaryLabel: '新增固件版本',
    tabs: [{ key: 'versions', label: '固件版本', field: 'category', value: '固件版本' }],
    filters: [textFilter('name', '版本号', '例如 1.0.0', ['name'], true), { field: 'applicableDeviceModels', label: '适用设备型号', type: 'select', optionSource: 'ota-device-models' }, dateFilter('releaseAt', '发布时间'), selectFilter('status', '发布状态', [{ label: '草稿', value: 'draft' }, { label: '已发布', value: 'published' }, { label: '已撤回', value: 'withdrawn' }])],
    columns: [{ field: 'name', label: '版本号', width: 130, type: 'mono' }, { field: 'applicableProductSummary', label: '适用产品', minWidth: 150 }, { field: 'applicableTypeSummary', label: '适用设备类型', minWidth: 150 }, { field: 'applicableModelSummary', label: '适用设备型号', minWidth: 160 }, dateColumn('releaseAt', '发布时间'), { field: 'summary', label: '版本说明', minWidth: 220 }, { field: 'forceUpdate', label: '强制更新', width: 100 }, namedStatusColumn('发布状态')],
    tabRowActions: { versions: ['detail', 'publish'] },
    fields: [textField('name', '版本号', true), dynamicMultiSelectField('applicableProductNames', '适用产品', 'ota-product-names', true), dynamicMultiSelectField('applicableDeviceTypes', '适用设备类型', 'ota-device-types', true), dynamicMultiSelectField('applicableDeviceModels', '适用设备型号', 'ota-device-models', true), textareaField('summary', '版本说明', true), { field: 'firmwareFile', label: '固件文件', type: 'firmware', required: true, span: 2 }, { field: 'forceUpdate', label: '强制更新', type: 'switch' }, selectField('status', '发布状态', [{ label: '草稿', value: 'draft' }, { label: '已发布', value: 'published' }], true)],
    detailTabs: [overviewTab, { key: 'devices', label: '适用设备', kind: 'table', source: 'ota-devices', columns: [relatedDeviceSNColumn, deviceTypeColumn, deviceModelColumn, { field: 'firmware', label: '当前版本', width: 110, type: 'mono' }, statusColumn] }, { key: 'results', label: '升级结果', kind: 'table', source: 'ota-results', columns: [deviceSNColumn, deviceTypeColumn, deviceModelColumn, { field: 'targetVersion', label: '目标版本', width: 120, type: 'mono' }, { field: 'resultLabel', label: '模拟结果', minWidth: 150 }, dateColumn('completedAt', '完成时间')] }, { key: 'rollbacks', label: '回滚记录', kind: 'table', source: 'ota-rollbacks', columns: [{ field: 'targetVersion', label: '回滚版本', width: 120, type: 'mono' }, { field: 'reason', label: '回滚原因', minWidth: 220 }, { field: 'operator', label: '操作人', width: 120 }, dateColumn('createdAt', '操作时间')] }, { key: 'history', label: '发布记录', kind: 'timeline', source: 'workflow-events' }],
    rowActions: ['detail', 'publish', 'rollback'], statusTones: { failed: 'error' }, actions: [action('publish', '发布/撤回', '发布状态将影响适用设备的更新提示，操作会写入日志。', [reasonField], ['draft', 'published', 'withdrawn'], 'danger'), action('rollback', '登记回滚', '记录固件回滚目标和原因；纯前端 Demo 不实际下发设备。', [textField('targetVersion', '回滚目标版本', true), reasonField], ['published'], 'danger')],
  }),
  createModule({
    key: 'repairs', route: 'repairs', title: '故障报修', eyebrow: '服务与售后', description: '从提交、分配、回复到完成跟踪整个报修闭环。', icon: 'wrench', permission: 'repairs:view', crud: 'workflow', primaryLabel: undefined,
    statusTones: { pending: 'error', processing: 'warning' },
    tabs: [{ key: 'all', label: '全部报修' }, { key: 'pending', label: '待处理', field: 'status', value: 'pending' }, { key: 'processing', label: '处理中', field: 'status', value: 'processing' }, { key: 'completed', label: '已完成', field: 'status', value: 'completed' }],
    filters: [textFilter('keyword', '报修查询', '报修单号或用户账号', ['code', 'account']), textFilter('deviceSN', '设备 SN', '输入完整或部分 SN', ['deviceSN']), selectFilter('faultCategory', '故障分类', ['水下电机', '提升', '转向', '接线盒', '其他'].map((value) => ({ label: value, value }))), { field: 'dealerId', label: '代理归属', type: 'select', optionSource: 'dealers', exact: true }, selectFilter('status', '处理状态', workflowStatusOptions), dateFilter('createdAt', '提交时间')],
    columns: [{ field: 'code', label: '报修单号', width: 160, type: 'mono' }, { field: 'account', label: '用户账号', minWidth: 160 }, deviceSNColumn, deviceTypeColumn, deviceModelColumn, { field: 'faultCategory', label: '故障分类', width: 110 }, { field: 'dealer', label: '代理归属', minWidth: 170 }, { field: 'contact', label: '联系方式', width: 140 }, namedStatusColumn('处理状态'), dateColumn('createdAt', '提交时间')],
    detailTabs: [{ ...overviewTab, label: '工单信息' }, { key: 'flow', label: '处理流程', kind: 'timeline', source: 'workflow-events' }, { key: 'reply', label: '回复记录', kind: 'table', source: 'replies', columns: [{ field: 'createdAt', label: '回复时间', width: 160, type: 'date' }, { field: 'operator', label: '回复人', width: 130 }, { field: 'content', label: '回复内容', minWidth: 260 }, { field: 'channel', label: '通知方式', width: 110 }] }, { key: 'billing', label: '维修账单', kind: 'table', source: 'billing-items', columns: [{ field: 'feeType', label: '费用类型', width: 110 }, { field: 'itemName', label: '费用项目', minWidth: 180 }, { field: 'quantity', label: '数量/工时', width: 110, type: 'number' }, { field: 'unitPrice', label: '单价', width: 110, type: 'money' }, { field: 'subtotal', label: '小计', width: 110, type: 'money' }, { field: 'adjustment', label: '调整金额', width: 110, type: 'money' }] }, { key: 'logs', label: '操作日志', kind: 'table', source: 'subject-logs', columns: [dateColumn('createdAt', '操作时间'), { field: 'operationType', label: '操作类型', width: 130 }, { field: 'content', label: '操作内容', minWidth: 240 }, { field: 'operator', label: '操作人', width: 120 }] }],
    rowActions: ['detail', 'assign', 'reply', 'escalate', 'complete', 'record-bill'], actions: [action('assign', '分配处理', '工单将进入处理中并通知指定经销商。', [dynamicSelectField('assigneeId', '处理经销商', 'dealers', true), textareaField('reason', '分配说明', true)], ['pending']), action('reply', '回复用户', '回复内容将保存到工单并生成通知记录。', [textareaField('replyContent', '回复内容', true)], ['processing', 'completed']), action('escalate', '转回总部', '工单归属转回总部售后，并保留流转原因。', [reasonField], ['pending', 'processing'], 'danger'), action('complete', '标记完成', '只有处理中的工单可以完成，结果将写入处理流程。', [textareaField('result', '处理结果', true)], ['processing']), action('record-bill', '生成维修支付订单', '按人工费、物料费和调整金额生成待支付订单；普通用户仅通过订单对应的二维码付款，后续由财务核实截图。', [{ ...numberField('laborHours', '人工工时', true), min: 0.5 }, { ...numberField('laborUnitPrice', '人工单价（元）', true), min: 0 }, { ...numberField('materialAmount', '物料费用（元）'), min: 0 }, { ...numberField('adjustment', '调整金额（元）'), min: -999999 }, textareaField('billingNote', '账单说明')], ['completed'])],
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
    columns: [{ field: 'code', label: '投诉单号', width: 160, type: 'mono' }, { field: 'account', label: '用户账号', minWidth: 170, mask: 'account' }, { field: 'category', label: '投诉类型', width: 110 }, { ...deviceSNColumn, label: '关联 SN' }, deviceTypeColumn, deviceModelColumn, namedStatusColumn('处理状态'), dateColumn('createdAt', '提交时间')],
    detailTabs: [{ ...overviewTab, label: '投诉信息' }, { key: 'handling', label: '处理过程', kind: 'timeline', source: 'workflow-events' }, { key: 'reply', label: '回复记录', kind: 'table', source: 'replies', columns: [dateColumn('createdAt', '回复时间'), { field: 'operator', label: '回复人', width: 130 }, { field: 'content', label: '回复内容', minWidth: 280 }] }, { key: 'logs', label: '操作日志', kind: 'table', source: 'subject-logs', columns: [dateColumn('createdAt', '操作时间'), { field: 'operationType', label: '操作类型', width: 130 }, { field: 'content', label: '操作内容', minWidth: 260 }] }],
    rowActions: ['detail', 'assign', 'reply', 'escalate', 'complete'], actions: [action('assign', '分配处理', '投诉将进入处理中并记录处理人。', [dynamicSelectField('assigneeId', '处理人员', 'assignees', true), reasonField], ['pending']), action('reply', '回复用户', '回复内容会保存并生成本地推送记录。', [textareaField('replyContent', '回复内容', true)], ['processing', 'completed']), action('escalate', '转回总部', '投诉归属转回总部处理，并保留原因和操作记录。', [reasonField], ['pending', 'processing'], 'danger'), action('complete', '标记完成', '处理结果将归档，投诉状态变为已完成。', [textareaField('result', '处理结果', true)], ['processing'])],
  }),
  createModule({
    key: 'materials', route: 'materials', title: '物料采购', eyebrow: '服务与售后', description: '统一处理售后物料和产品采购；设备采购依次经过销售确认、研发确认、导入生产、财务核实、仓库发货和收货确认。', icon: 'package-check', permission: 'materials:view', crud: 'workflow', primaryLabel: '发起售后物料申请', primaryByTab: { all: '发起售后物料申请', approval: undefined, early: '发起提前申请', purchase: '发起产品采购申请', shipping: undefined, completed: undefined, rejected: undefined },
    tabs: [{ key: 'all', label: '全部申请' }, { key: 'approval', label: '待我审批', field: 'status', value: 'pending' }, { key: 'early', label: '售后物料' , field: 'category', value: '提前申请' }, { key: 'purchase', label: '产品采购', field: 'category', value: '设备采购' }, { key: 'shipping', label: '待发货/待登记', field: 'status', value: 'approved' }, { key: 'completed', label: '已完成', field: 'status', value: 'completed' }, { key: 'rejected', label: '已拒绝', field: 'status', value: 'rejected' }],
    filters: [textFilter('keyword', '申请查询', '申请单号、经销商、物料或设备', ['code', 'dealer', 'deviceSN', 'itemName', 'deviceModel']), selectFilter('category', '申请类型', ['普通申请', '提前申请', '设备采购'].map((value) => ({ label: value, value }))), selectFilter('status', '审批状态', [{ label: '待审批', value: 'pending' }, { label: '已审批', value: 'approved' }, { label: '已拒绝', value: 'rejected' }, { label: '已发货', value: 'shipped' }, { label: '已完成', value: 'completed' }])],
    columns: [{ field: 'code', label: '申请单号', width: 160, type: 'mono' }, { field: 'dealer', label: '申请经销商', minWidth: 170 }, { field: 'category', label: '申请类型', width: 108 }, { field: 'itemName', label: '申请内容', minWidth: 170 }, { field: 'quantity', label: '数量', width: 76, type: 'number' }, { field: 'amount', label: '费用', width: 120, type: 'money' }, { ...deviceSNColumn, label: '关联设备 SN' }, deviceTypeColumn, deviceModelColumn, { field: 'warrantyResult', label: '质保校验结果', minWidth: 160 }, dateColumn('applyTime', '申请时间'), namedStatusColumn('审批状态')],
    tabColumns: {
      purchase: [{ field: 'code', label: '采购申请单号', width: 170, type: 'mono' }, { field: 'dealer', label: '申请经销商', minWidth: 170 }, { field: 'initiatedBy', label: '发起人', width: 120 }, { field: 'deviceModel', label: '采购设备', minWidth: 180 }, { field: 'quantity', label: '数量', width: 76, type: 'number' }, { field: 'amount', label: '预算费用', width: 120, type: 'money' }, { field: 'purchaseStageLabel', label: '当前节点', width: 130 }, { field: 'contractStatus', label: '合同状态', width: 110 }, { field: 'deliveryStatus', label: '发货状态', width: 110 }, dateColumn('initiatedAt', '发起时间'), namedStatusColumn('单据状态')],
    },
    fields: [{ ...textField('dealer', '申请经销商'), readonly: true }, dynamicSelectField('materialId', '物料名称', 'active-materials', true), { ...numberField('quantity', '申请数量', true), min: 1 }, dynamicSelectField('deviceSN', '设备 SN', 'accessible-devices', true), { ...textField('deviceType', '设备类型'), readonly: true }, { ...textField('deviceModel', '设备型号'), readonly: true }, { ...textField('warrantyResult', '质保校验结果'), readonly: true }, { ...textField('warrantyUntil', '质保截止日期'), readonly: true }, selectField('category', '申请类型', [{ label: '普通申请', value: '普通申请' }, { label: '提前申请', value: '提前申请' }], true), textareaField('summary', '申请说明')],
    tabFields: {
      purchase: [{ ...textField('dealer', '申请经销商'), readonly: true }, { field: 'purchaseItems', label: '采购明细', type: 'lineItems', optionSource: 'purchasable-items', required: true, span: 2 }, { ...numberField('amount', '预算总费用（元）'), readonly: true }, textareaField('summary', '采购用途与说明', true)],
    },
    tabFilters: {
      purchase: [textFilter('keyword', '采购查询', '申请单号、经销商、发起人或设备型号', ['code', 'dealer', 'initiatedBy', 'deviceModel']), selectFilter('purchaseStage', '采购节点', [{ label: '待销售确认', value: 'sales_confirmation' }, { label: '待研发确认', value: 'rd_confirmation' }, { label: '待导入生产', value: 'production' }, { label: '待财务核实', value: 'finance_confirmation' }, { label: '待仓库发货', value: 'warehouse_fulfillment' }, { label: '已发货', value: 'shipped' }, { label: '已收货', value: 'received' }, { label: '已拒绝', value: 'rejected' }]), selectFilter('contractStatus', '合同状态', [{ label: '待确认', value: '待确认' }, { label: '已签订', value: '已签订' }, { label: '无需合同', value: '无需合同' }])],
    },
    detailTabs: [overviewTab, { key: 'items', label: '采购明细', kind: 'table', source: 'purchase-items', columns: [{ field: 'itemName', label: '设备/物料', minWidth: 190 }, { field: 'itemType', label: '类型', width: 100 }, { field: 'quantity', label: '数量', width: 80, type: 'number' }, { field: 'unitPrice', label: '单价', width: 120, type: 'money' }, { field: 'subtotal', label: '小计', width: 120, type: 'money' }] }, { key: 'approval', label: '采购审批', kind: 'timeline', source: 'approval-steps' }, { key: 'expenses', label: '分次付款记录', kind: 'table', source: 'expense-records', columns: [dateColumn('paidAt', '付款日期'), { field: 'amount', label: '本次付款', width: 130, type: 'money' }, { field: 'paymentProof', label: '付款截图', width: 120, type: 'image' }, { field: 'paymentReference', label: '支付凭证号', minWidth: 180, type: 'mono' }, { field: 'warehouseDecisionLabel', label: '仓库处理决定', minWidth: 140 }, { field: 'operator', label: '核实人', width: 120 }] }, { key: 'fulfillment', label: '发货与收货', kind: 'table', source: 'purchase-fulfillments', columns: [dateColumn('shippedAt', '发货日期'), { field: 'warehouseName', label: '发货仓库', minWidth: 150 }, { field: 'deviceSN', label: '发货清单', minWidth: 210, type: 'mono' }, { field: 'shipmentPhoto', label: '发货照片', width: 120, type: 'image' }, { field: 'courier', label: '快递公司', width: 130 }, { field: 'trackingNo', label: '物流单号', minWidth: 160, type: 'mono' }, { field: 'receiptPhoto', label: '收货照片', width: 120, type: 'image' }, { field: 'operator', label: '发货人', width: 110 }] }, { key: 'logistics', label: '物流信息', kind: 'table', source: 'logistics-records', columns: [{ field: 'courier', label: '快递公司', width: 140 }, { field: 'trackingNo', label: '物流单号', width: 190, type: 'mono' }, { field: 'content', label: '最新轨迹', minWidth: 240 }, dateColumn('updatedAt', '更新时间')] }],
    rowActions: ['detail', 'approve', 'reject', 'ship', 'start-production', 'finance-confirm', 'purchase-ship', 'confirm-purchase-receipt'], actions: [action('approve', '确认当前采购节点', '设备采购按“销售确认 → 研发确认”顺序处理；售后物料沿用配置的审批流。', [textareaField('reason', '确认意见', true)], ['pending']), action('reject', '审批拒绝', '当前节点拒绝后申请终止，不再进入生产、财务或仓库环节。', [reasonField], ['pending'], 'danger'), action('ship', '物料发货', '仅用于售后物料申请；发货时扣减库存并保存发货照片、物流信息和发放记录。', [dynamicSelectField('courierId', '快递公司', 'enabled-couriers', true), textField('trackingNo', '物流单号', true), { field: 'shipmentPhoto', label: '发货照片', type: 'image', required: true }], ['approved']), action('start-production', '导入生产', '本操作只记录采购单已导入生产计划，不代表已发货；完成后进入财务核实。', [textField('productionBatchNo', '生产批次号', true), { field: 'productionAt', label: '导入生产日期', type: 'date', required: true }, textareaField('reason', '生产说明', true)], ['approved']), action('finance-confirm', '财务核实付款', '核实二维码付款截图和金额。支持一个订单多次付款；是否放行仓库由财务明确选择，不以是否全额付款自动判断。', [selectField('contractStatus', '合同状态', [{ label: '已签订', value: '已签订' }, { label: '无需合同', value: '无需合同' }], true), textField('contractNo', '合同编号'), { ...numberField('paidAmount', '本次核实金额（元）', true), min: 0.01 }, { field: 'paymentProof', label: '付款截图', type: 'image', required: true }, textField('paymentReference', '支付凭证号', true), { field: 'paidAt', label: '付款日期', type: 'date', required: true }, selectField('warehouseDecision', '仓库处理决定', [{ label: '允许进入仓库处理', value: 'release' }, { label: '暂不放行，继续核实', value: 'hold' }], true), textareaField('paymentNote', '财务核实备注', true)], ['approved']), action('purchase-ship', '仓库发货', '仓库按采购清单选择设备，保存发货照片、快递公司和物流单号；操作会同步库存、设备归属、出库记录和物流记录。', [dynamicMultiSelectField('selectedDevices', '选择在库设备', 'warehouse-devices', true), dynamicSelectField('warehouseId', '发货仓库', 'warehouses', true), dynamicSelectField('courierId', '快递公司', 'enabled-couriers', true), textField('trackingNo', '物流单号', true), { field: 'shipmentPhoto', label: '发货照片', type: 'image', required: true }, { field: 'shippedAt', label: '发货日期', type: 'date', required: true }, textareaField('reason', '发货说明', true)], ['approved']), action('confirm-purchase-receipt', '确认采购收货', '确认采购货物已签收；收货照片为可选的本地 Mock 凭证。', [{ field: 'receiptPhoto', label: '收货照片（可选）', type: 'image' }, textareaField('reason', '收货说明', true)], ['shipped'])],
  }),
  createModule({
    key: 'material-catalog', route: 'material-catalog', title: '物料与库存', eyebrow: '仓储与采购', description: '维护物料信息、采购价、库存和启用状态。', icon: 'boxes', permission: 'material-catalog:view', primaryByTab: { all: '新增物料', low: undefined, disabled: undefined },
    tabs: [{ key: 'all', label: '全部物料' }, { key: 'low', label: '库存偏低', field: 'status', value: 'low' }, { key: 'disabled', label: '已停用', field: 'status', value: 'disabled' }],
    filters: [textFilter('keyword', '物料查询', '物料名称或编号', ['name', 'materialCode']), selectFilter('status', '库存状态', [{ label: '正常', value: 'normal' }, { label: '库存偏低', value: 'low' }, { label: '已停用', value: 'disabled' }])],
    columns: [{ field: 'materialCode', label: '物料编号', width: 150, type: 'mono' }, { field: 'name', label: '物料名称', minWidth: 190, type: 'main' }, { field: 'category', label: '适用设备', minWidth: 170 }, { field: 'price', label: '采购价', width: 110, type: 'money' }, { field: 'stock', label: '库存数量', width: 100, type: 'number' }, statusColumn],
    fields: [textField('name', '物料名称', true), selectField('category', '适用设备', deviceTypes, true), numberField('price', '采购价', true), numberField('stock', '库存数量', true), selectField('status', '启用状态', [{ label: '正常', value: 'normal' }, { label: '已停用', value: 'disabled' }], true)],
    detailTabs: [overviewTab, { key: 'prices', label: '价格历史', kind: 'table', source: 'price-history', columns: [dateColumn('createdAt', '生效时间'), { field: 'oldPrice', label: '原价格', width: 120, type: 'money' }, { field: 'newPrice', label: '新价格', width: 120, type: 'money' }, { field: 'operator', label: '操作人', width: 120 }] }, historyTab],
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
    key: 'sn-replacement', route: 'sn-replacement', title: '换 SN 管理', eyebrow: '服务与售后', description: '记录原、新设备 SN、名称、型号与类型，校验归属后完成换机。', icon: 'refresh-cw', permission: 'sn-replacement:view', crud: 'workflow', primaryLabel: '发起换 SN', primaryByTab: { records: '发起换 SN', pending: undefined, exceptions: undefined },
    tabs: [{ key: 'records', label: '换 SN 记录' }, { key: 'pending', label: '待确认', field: 'status', value: 'pending' }, { key: 'exceptions', label: '异常记录', field: 'status', value: 'failed' }],
    columns: [{ field: 'originalSN', label: '原设备 SN', width: 168, type: 'mono' }, { field: 'newSN', label: '新设备 SN', width: 168, type: 'mono' }, { field: 'replacementDeviceName', label: '新设备名称', minWidth: 140 }, { field: 'replacementDeviceModel', label: '设备型号', width: 110 }, { field: 'replacementDeviceType', label: '设备类型', width: 120 }, { field: 'owner', label: '当前经销商', minWidth: 170 }, dateColumn('createdAt', '申请时间'), statusColumn],
    fields: [dynamicSelectField('originalSN', '原设备 SN', 'accessible-devices', true), { ...textField('originalDeviceName', '原设备名称'), readonly: true }, { ...textField('originalDeviceModel', '原设备型号'), readonly: true }, { ...textField('originalDeviceType', '原设备类型'), readonly: true }, textField('newSN', '新设备 SN', true), textField('replacementDeviceName', '新设备名称', true), selectField('replacementDeviceDescriptor', '新设备型号', deviceTypes, true), { ...textField('replacementDeviceModel', '型号编码'), readonly: true }, { ...textField('replacementDeviceType', '设备类型'), readonly: true }],
    filters: [textFilter('keyword', '换机查询', '原/新 SN、设备名称或型号', ['originalSN', 'newSN', 'replacementDeviceName', 'replacementDeviceModel', 'replacementDeviceType']), selectFilter('status', '处理状态', workflowStatusOptions)],
    rowActions: ['detail', 'process'], actions: [action('process', '换 SN 确认', '原 SN 将追加 -1，新设备按申请中的名称、型号和类型接续原用户、项目与经销商关系。', [reasonField], ['pending'], 'danger')],
  }),
  createModule({
    key: 'service-transfer', route: 'service-transfer', title: '售后转移', eyebrow: '服务与售后', description: '经销商或总部发起售后责任转移，目标方确认后按费用情况完成总部审批。', icon: 'arrow-left-right', permission: 'service-transfer:view', crud: 'workflow', primaryLabel: '发起售后转移', primaryByTab: { all: '发起售后转移', target: undefined, fee: undefined, completed: undefined, rejected: undefined },
    tabs: [{ key: 'all', label: '全部记录' }, { key: 'target', label: '待接收方确认', field: 'approvalStage', value: 'target_confirmation' }, { key: 'fee', label: '待总部费用审批', field: 'approvalStage', value: 'fee_approval' }, { key: 'completed', label: '已完成', field: 'status', value: 'completed' }, { key: 'rejected', label: '已拒绝', field: 'status', value: 'rejected' }],
    columns: [codeColumn, deviceSNColumn, deviceTypeColumn, deviceModelColumn, { field: 'sourceDealer', label: '原经销商', minWidth: 155 }, { field: 'targetDealer', label: '目标经销商', minWidth: 155 }, { field: 'feeStatus', label: '费用情况', width: 110, type: 'status' }, { field: 'estimatedFee', label: '预计费用', width: 115, type: 'money' }, { field: 'currentApproverName', label: '当前处理人', width: 120 }, statusColumn],
    fields: [dynamicSelectField('deviceSN', '设备 SN', 'accessible-devices', true), { ...textField('deviceType', '设备类型'), readonly: true }, { ...textField('deviceModel', '设备型号'), readonly: true }, { ...textField('sourceDealer', '原经销商'), readonly: true }, dynamicSelectField('targetDealerId', '目标经销商', 'service-target-dealers', true), { field: 'hasFee', label: '是否涉及费用', type: 'switch' }, { ...numberField('estimatedFee', '预计费用（元）'), min: 0, visibleWhen: { field: 'hasFee', value: true } }, { ...selectField('feeBearer', '费用承担方', [{ label: '原经销商', value: '原经销商' }, { label: '目标经销商', value: '目标经销商' }, { label: '总部', value: '总部' }]), visibleWhen: { field: 'hasFee', value: true } }, { ...textareaField('feeDescription', '费用说明'), visibleWhen: { field: 'hasFee', value: true } }, textareaField('summary', '转移原因', true)],
    filters: [textFilter('keyword', '转移查询', '单号、设备 SN 或经销商', ['code', 'deviceSN', 'sourceDealer', 'targetDealer']), selectFilter('feeStatus', '费用情况', [{ label: '无费用', value: '无费用' }, { label: '待总部审批', value: '待总部审批' }, { label: '已登记', value: '已登记' }, { label: '已拒绝', value: '已拒绝' }]), selectFilter('status', '确认状态', workflowStatusOptions)],
    detailTabs: [overviewTab, { key: 'approval', label: '审批记录', kind: 'timeline', source: 'approval-steps' }, { key: 'expenses', label: '费用记录', kind: 'table', source: 'expense-records', columns: [dateColumn('paidAt', '付款日期'), { field: 'amount', label: '实际费用', width: 130, type: 'money' }, { field: 'feeBearer', label: '费用承担方', width: 130 }, { field: 'paymentMethod', label: '付款方式', width: 130 }, { field: 'paymentReference', label: '付款凭证/流水号', minWidth: 190, type: 'mono' }, { field: 'operator', label: '登记人', width: 120 }] }, { key: 'history', label: '流转记录', kind: 'timeline', source: 'workflow-events' }],
    rowActions: ['detail', 'confirm-transfer', 'approve-transfer-fee', 'reject-transfer-fee'], statusTones: { '待总部审批': 'warning', '已登记': 'success', '已拒绝': 'error', '无费用': 'neutral' }, actions: [action('confirm-transfer', '确认售后转移', '目标经销商确认接收；无费用时立即完成，有费用时进入总部费用审批。', [selectField('decision', '确认结果', [{ label: '确认接收', value: 'confirmed' }, { label: '拒绝接收', value: 'rejected' }], true), reasonField], ['pending']), action('approve-transfer-fee', '通过费用审批', '总部登记实际费用和线下付款凭证后完成售后责任转移。', [{ ...numberField('actualFee', '实际费用（元）', true), min: 0.01 }, selectField('paymentMethod', '付款方式', [{ label: '对公转账', value: '对公转账' }, { label: '线下转账', value: '线下转账' }, { label: '现金/其他', value: '现金/其他' }], true), textField('paymentReference', '付款凭证/流水号', true), { field: 'paidAt', label: '付款日期', type: 'date', required: true }, reasonField], ['pending']), action('reject-transfer-fee', '拒绝费用审批', '总部拒绝费用后终止本次售后转移，不变更设备归属。', [reasonField], ['pending'], 'danger'), action('process', '确认转移', '兼容已有演示流程。', [selectField('decision', '确认结果', [{ label: '确认接收', value: 'confirmed' }, { label: '拒绝接收', value: 'rejected' }], true), reasonField], ['pending'])],
  }),
  createModule({
    key: 'installation-transfers', route: 'installation-transfers', title: '安装跨区审核', eyebrow: '客户与渠道', description: '审核设备出厂地区与实际安装地区不一致的安装项目。', icon: 'map-pin', permission: 'installation-transfers:view', crud: 'workflow', primaryLabel: undefined,
    tabs: [{ key: 'pending', label: '待审核', field: 'status', value: 'pending' }, { key: 'approved', label: '已通过', field: 'status', value: 'approved' }, { key: 'rejected', label: '已拒绝', field: 'status', value: 'rejected' }, { key: 'all', label: '全部记录' }],
    filters: [textFilter('keyword', '项目查询', '项目名称、设备 SN 或经销商', ['name', 'projectCode', 'deviceSN', 'dealer']), selectFilter('status', '审核状态', [{ label: '待审核', value: 'pending' }, { label: '已通过', value: 'approved' }, { label: '已拒绝', value: 'rejected' }])],
    columns: [{ field: 'projectCode', label: '项目编号', width: 170, type: 'mono' }, { field: 'name', label: '项目名称', minWidth: 180, type: 'main' }, deviceSNColumn, deviceTypeColumn, deviceModelColumn, { field: 'factoryRegion', label: '出厂地区', width: 140 }, { field: 'installationRegion', label: '安装地区', width: 140 }, { field: 'dealer', label: '申请经销商', minWidth: 170 }, dateColumn('reviewDeadline', '审核截止时间'), { field: 'temporaryUseStatusLabel', label: '临时运行', width: 132 }, statusColumn],
    fields: [], detailTabs: [overviewTab, { key: 'history', label: '审核记录', kind: 'timeline', source: 'workflow-events' }],
    rowActions: ['detail', 'process'], actions: [action('process', '审核跨区安装', '审核通过后安装项目才能完成设备关联；拒绝时必须填写原因。', [selectField('decision', '审核结果', [{ label: '审核通过', value: 'approved' }, { label: '审核拒绝', value: 'rejected' }], true), reasonField], ['pending'])],
  }),
  createModule({
    key: 'cross-region-activations', route: 'cross-region-activations', title: '跨区域激活异常', eyebrow: '客户与渠道', description: '处理 APP 在用户授权定位后上报的区域不匹配记录；当前为 Mock 数据，不代表真实定位接口已接入。', icon: 'triangle-alert', permission: 'cross-region-activations:view', crud: 'workflow', primaryLabel: undefined, exportable: true,
    tabs: [{ key: 'all', label: '全部异常' }, { key: 'pending', label: '待处理', field: 'status', value: 'pending' }, { key: 'resolved', label: '已处理', field: 'status', value: 'resolved' }],
    filters: [textFilter('keyword', '异常查询', '异常编号、设备 SN 或设备名称', ['code', 'deviceSN', 'deviceName']), textFilter('salesRegion', '销售/归属区域', '输入销售或归属区域', ['salesRegion']), textFilter('usedRegion', '发生/使用区域', '输入实际使用区域', ['usedRegion']), selectFilter('status', '异常状态', [{ label: '待处理', value: 'pending' }, { label: '已处理', value: 'resolved' }]), dateFilter('occurredAt', '发生时间')],
    columns: [codeColumn, deviceSNColumn, { field: 'deviceName', label: '设备名称', minWidth: 150, type: 'main' }, { field: 'salesRegion', label: '销售/归属区域', minWidth: 160 }, { field: 'usedRegion', label: '发生/使用区域', minWidth: 160 }, { field: 'exceptionType', label: '异常类型', width: 140 }, namedStatusColumn('异常状态'), dateColumn('occurredAt', '发生时间')],
    fields: [{ ...textField('locationSource', '地区信息来源'), readonly: true }], detailTabs: [overviewTab, { key: 'history', label: '处理记录', kind: 'timeline', source: 'workflow-events' }], rowActions: ['detail', 'resolve'], actions: [action('resolve', '处理异常', '记录核查结论并关闭异常；处理过程将写入审计日志。', [selectField('resolution', '处理结论', [{ label: '确认跨区使用', value: 'confirmed' }, { label: '定位误差', value: 'location_error' }, { label: '已调整销售区域', value: 'region_adjusted' }], true), textareaField('reason', '处理说明', true)], ['pending'])],
  }),
  createModule({
    key: 'warranty', route: 'warranty', title: '质保规则', eyebrow: '服务与售后', description: '按经销商、市场和产品配置质保时长、生效范围与起算点。', icon: 'shield-check', permission: 'warranty:view', primaryLabel: '新增质保规则',
    tabs: [{ key: 'rules', label: '质保规则' }],
    columns: [{ field: 'productType', label: '产品类型', minWidth: 180 }, { field: 'dealer', label: '设置经销商', minWidth: 180 }, { field: 'market', label: '适用市场', width: 100 }, { field: 'warrantyStartPoint', label: '起算点', width: 120 }, { field: 'laborMonths', label: '免人工费/月', width: 120, type: 'number' }, { field: 'materialMonths', label: '物料质保/月', width: 120, type: 'number' }, dateColumn('effectiveFrom', '生效日期'), statusColumn],
    fields: [dynamicSelectField('productType', '产品类型', 'product-descriptors', true), dynamicSelectField('dealerId', '设置经销商', 'warranty-dealers', true), selectField('market', '适用市场', [{ label: '国内', value: '国内' }, { label: '海外', value: '海外' }], true), selectField('warrantyStartPoint', '质保起算点', [{ label: '设备激活日', value: '设备激活日' }, { label: '安装验收日', value: '安装验收日' }, { label: '销售出库日', value: '销售出库日' }], true), { field: 'effectiveFrom', label: '生效日期', type: 'date', required: true }, { field: 'effectiveTo', label: '失效日期', type: 'date' }, numberField('laborMonths', '免人工费时间（月）', true), numberField('materialMonths', '物料质保时间（月）', true), selectField('status', '启用状态', accountStatusOptions, true)],
    filters: [{ field: 'productType', label: '产品类型', type: 'select', optionSource: 'product-descriptors' }, textFilter('dealer', '经销商', '输入经销商名称', ['dealer']), selectFilter('market', '适用市场', [{ label: '国内', value: '国内' }, { label: '海外', value: '海外' }])], detailTabs: [overviewTab, { key: 'history', label: '规则变更历史', kind: 'table', source: 'warranty-history', columns: [dateColumn('createdAt', '变更时间'), { field: 'snapshot', label: '规则快照', minWidth: 280 }, { field: 'operator', label: '操作人', width: 120 }] }], rowActions: ['detail', 'edit'],
  }),
  createModule({
    key: 'approval-center', route: 'approval-center', title: '审批中心', eyebrow: '服务与售后', description: '集中处理平台和总部复杂审批，待办与原业务单、当前节点和操作账号严格关联。', icon: 'circle-check-big', permission: 'approval-center:view', crud: 'readonly', primaryLabel: undefined,
    tabs: [{ key: 'pending', label: '待我处理', field: 'status', value: 'pending' }, { key: 'all', label: '全部审批' }, { key: 'completed', label: '已完成', field: 'status', value: 'approved' }, { key: 'rejected', label: '已拒绝', field: 'status', value: 'rejected' }],
    filters: [textFilter('keyword', '审批查询', '业务单号、名称、发起人或当前处理人', ['subjectCode', 'name', 'initiatedBy', 'currentApproverName']), selectFilter('menuKey', '业务菜单', [{ label: '物料采购', value: 'materials' }, { label: '仓库设备（调货审批）', value: 'warehouse' }, { label: '售后转移（费用审批）', value: 'service-transfer' }])],
    columns: [{ field: 'subjectCode', label: '业务单号', width: 170, type: 'mono' }, { field: 'name', label: '业务内容', minWidth: 190, type: 'main' }, { field: 'menuLabel', label: '业务菜单', minWidth: 170 }, { field: 'initiatedBy', label: '发起人', width: 130 }, { field: 'currentStepLabel', label: '当前节点', minWidth: 160 }, { field: 'currentApproverName', label: '当前处理人', width: 130 }, dateColumn('updatedAt', '更新时间'), namedStatusColumn('审批状态')],
    fields: [], detailTabs: [overviewTab, { key: 'steps', label: '审批节点', kind: 'table', source: 'approval-center-steps', columns: [{ field: 'sequence', label: '顺序', width: 80, type: 'number' }, { field: 'name', label: '节点名称', minWidth: 150 }, { field: 'approverName', label: '审批人', width: 130 }, { field: 'comment', label: '处理意见', minWidth: 220 }, dateColumn('handledAt', '处理时间'), statusColumn] }],
    rowActions: ['detail', 'approve-original', 'reject-original'], actions: [action('approve-original', '审批通过', '处理当前节点并同步原业务单；需要合同、费用或发货信息的节点请进入原业务单操作。', [textareaField('reason', '审批意见', true)], ['pending']), action('reject-original', '审批拒绝', '拒绝当前节点并终止原业务单的后续审批。', [reasonField], ['pending'], 'danger')],
  }),
  createModule({
    key: 'approval-flow', route: 'approval-flow', title: '审批流程', eyebrow: '服务与售后', description: '业务流程与适用菜单为系统固定模板，仅允许配置审核层级和审核人员，配置仅影响新发起的业务。', icon: 'workflow', permission: 'approval-flow:view', primaryLabel: undefined,
    tabs: [{ key: 'flows', label: '流程配置', field: 'category', value: '流程配置' }],
    columns: [{ field: 'name', label: '流程名称', minWidth: 180, type: 'main' }, { field: 'menuLabel', label: '适用菜单', width: 180 }, { field: 'businessFlow', label: '固定业务流程', minWidth: 300 }, { field: 'levels', label: '审核层级', minWidth: 220 }, { field: 'memberNames', label: '审核人员', minWidth: 220 }, dateColumn('updatedAt', '更新时间')],
    fields: [
      { ...textField('name', '流程名称', true), readonly: true },
      { ...selectField('menuKey', '适用菜单', [{ label: '物料采购', value: 'materials' }, { label: '仓库设备（调货审批）', value: 'warehouse' }, { label: '售后转移（费用审批）', value: 'service-transfer' }], true), readonly: true },
      { ...textField('businessFlow', '固定业务流程'), readonly: true, span: 2 },
      selectField('levels', '审核层级', [{ label: '二级 → 一级 → 平台', value: '二级 → 一级 → 平台' }, { label: '一级 → 平台', value: '一级 → 平台' }, { label: '平台直接审核', value: '平台直接审核' }], true),
      { ...dynamicSelectField('level1ApproverId', '二级经销商审核人员', 'tier2-approvers'), visibleWhen: { field: 'levels', value: '二级 → 一级 → 平台' } },
      { ...dynamicSelectField('level1ApproverId', '一级经销商审核人员', 'tier1-approvers'), visibleWhen: { field: 'levels', value: '一级 → 平台' } },
      { ...dynamicSelectField('level2ApproverId', '一级经销商审核人员', 'tier1-approvers'), visibleWhen: { field: 'levels', value: '二级 → 一级 → 平台' } },
      dynamicSelectField('platformApproverId', '平台审核人员', 'platform-assignees', true),
    ],
    filters: [textFilter('keyword', '流程查询', '流程名称或审核人员', ['name', 'memberNames'])], rowActions: ['detail', 'edit'],
  }),
  createModule({
    key: 'issuance', route: 'issuance', title: '物料发放记录', eyebrow: '服务与售后', description: '查询物料发放、领取和旧件/新件实际更换记录。', icon: 'package-open', permission: 'issuance:view', crud: 'workflow', primaryLabel: undefined,
    tabs: [{ key: 'all', label: '全部记录' }, { key: 'shipped', label: '运输中', field: 'status', value: 'shipped' }, { key: 'received', label: '已领取', field: 'status', value: 'received' }, { key: 'replaced', label: '已更换', field: 'status', value: 'completed' }],
    columns: [codeColumn, deviceSNColumn, deviceTypeColumn, deviceModelColumn, { field: 'materialName', label: '物料名称', minWidth: 180 }, { field: 'recipient', label: '发放对象', minWidth: 170 }, dateColumn('issuedAt', '发放时间'), dateColumn('replacedAt', '更换时间'), statusColumn],
    filters: [textFilter('keyword', '发放查询', '物料、领取人或单号', ['code', 'materialName', 'recipient']), selectFilter('status', '履约状态', [{ label: '运输中', value: 'shipped' }, { label: '已领取', value: 'received' }, { label: '已更换', value: 'completed' }])],
    detailTabs: [overviewTab, { key: 'replacement', label: '更换记录', kind: 'table', source: 'replacement-records', columns: [{ field: 'repairCode', label: '维修工单', width: 170, type: 'mono' }, { field: 'oldPartSerial', label: '旧件编号', minWidth: 160, type: 'mono' }, { field: 'newPartSerial', label: '新件编号', minWidth: 160, type: 'mono' }, { field: 'reason', label: '更换原因', minWidth: 220 }, { field: 'operator', label: '操作人', width: 120 }, dateColumn('createdAt', '更换时间')] }], rowActions: ['detail', 'confirm-receipt', 'complete-replacement'], actions: [action('confirm-receipt', '确认收货', '确认物料已由接收方签收，发放记录进入待更换状态。', [textareaField('reason', '收货说明', true)], ['shipped']), action('complete-replacement', '登记更换', '选择关联维修工单并登记旧件、新件和原因；完成后同步关闭原物料申请。', [dynamicSelectField('repairId', '关联维修工单', 'repair-orders', true), textField('oldPartSerial', '旧件编号', true), textField('newPartSerial', '新件编号', true), reasonField], ['received', 'shipped'])],
  }),
  createModule({
    key: 'payments', route: 'payments', title: '支付订单', eyebrow: '财务与支付', description: '二维码付款需要凭证截图与订单人工关联；系统不宣称自动识别金额，财务可对同一订单分多次核实。', icon: 'receipt-text', permission: 'payments:view', crud: 'workflow', primaryLabel: undefined,
    tabs: [{ key: 'all', label: '全部订单' }, { key: 'pending', label: '待支付', field: 'status', value: 'pending' }, { key: 'verifying', label: '待财务核实', field: 'status', value: 'verifying' }, { key: 'verified', label: '已核实', field: 'status', value: 'verified' }],
    filters: [textFilter('keyword', '订单查询', '订单号、账号、业务单号、凭证或费用项目', ['code', 'account', 'subjectCode', 'paymentReference', 'name']), selectFilter('status', '支付状态', [{ label: '待支付', value: 'pending' }, { label: '待财务核实', value: 'verifying' }, { label: '已核实', value: 'verified' }]), dateFilter('paidAt', '付款时间')],
    columns: [{ field: 'code', label: '订单号', width: 180, type: 'mono' }, { field: 'account', label: '用户/经销商', minWidth: 170 }, { field: 'name', label: '费用项目', minWidth: 190 }, { field: 'subjectCode', label: '关联业务单号', width: 170, type: 'mono' }, { field: 'channel', label: '支付方式', width: 110 }, { field: 'paymentInstruction', label: '付款说明', minWidth: 220 }, { field: 'orderAmount', label: '应付金额', width: 110, type: 'money' }, { field: 'paidAmount', label: '已核实金额', width: 120, type: 'money' }, { field: 'remainingAmount', label: '待付金额', width: 110, type: 'money' }, statusColumn],
    detailTabs: [overviewTab, { key: 'transactions', label: '付款核实记录', kind: 'table', source: 'payment-transactions', columns: [dateColumn('paidAt', '付款时间'), { field: 'amount', label: '本次核实金额', width: 130, type: 'money' }, { field: 'paymentProof', label: '付款截图', width: 120, type: 'image' }, { field: 'paymentReference', label: '支付凭证号', minWidth: 180, type: 'mono' }, { field: 'verificationNote', label: '核实说明', minWidth: 180 }, { field: 'operator', label: '核实人', width: 120 }, statusColumn] }, { key: 'items', label: '订单明细', kind: 'table', source: 'billing-items', columns: [{ field: 'feeType', label: '费用类型', width: 120 }, { field: 'itemName', label: '费用项目', minWidth: 190 }, { field: 'quantity', label: '数量/工时', width: 110, type: 'number' }, { field: 'unitPrice', label: '单价', width: 120, type: 'money' }, { field: 'subtotal', label: '小计', width: 120, type: 'money' }, { field: 'adjustment', label: '调整金额', width: 120, type: 'money' }] }, { key: 'history', label: '核实状态记录', kind: 'timeline', source: 'workflow-events' }], rowActions: ['detail', 'finance-verify'], actions: [action('finance-verify', '财务核实', '财务根据用户提交的二维码付款截图人工核实金额并绑定当前订单；系统不会从二维码自动识别订单或金额。', [{ ...numberField('paidAmount', '本次核实金额（元）', true), min: 0.01 }, { field: 'paymentProof', label: '付款截图', type: 'image', required: true }, textField('paymentReference', '支付凭证号', true), { field: 'paidAt', label: '付款日期', type: 'date', required: true }, textareaField('verificationNote', '财务核实说明', true)], ['pending', 'verifying'])],
  }),
  createModule({
    key: 'banners', route: 'banners', title: 'Banner 管理', eyebrow: '内容运营', description: '管理 App 首页 Banner 图片、跳转链接、排序和启用状态。', icon: 'panels-top-left', permission: 'banners:view', primaryLabel: '新增 Banner',
    tabs: [{ key: 'all', label: 'Banner 列表' }],
    filters: [textFilter('name', 'Banner 名称', '输入名称', ['name']), selectFilter('status', '状态', [{ label: '已启用', value: 'normal' }, { label: '已禁用', value: 'disabled' }, { label: '草稿', value: 'draft' }])],
    columns: [{ field: 'image', label: 'Banner 图片', width: 160, type: 'image' }, { field: 'name', label: 'Banner 名称', minWidth: 180, type: 'main' }, { field: 'target', label: '跳转链接', minWidth: 220 }, { field: 'sort', label: '排序', width: 80, type: 'number' }, statusColumn],
    fields: [textField('name', 'Banner 名称', true), { field: 'image', label: 'Banner 图片', type: 'image', required: true, span: 2 }, textField('target', '跳转链接', true), numberField('sort', '排序', true), selectField('status', '状态', [{ label: '已启用', value: 'normal' }, { label: '已禁用', value: 'disabled' }], true)],
    rowActions: ['detail', 'edit', 'toggle', 'delete'], actions: commonActions.filter((item) => ['toggle', 'delete'].includes(item.key)),
  }),
  createModule({
    key: 'faq-documents', route: 'faq-documents', title: '常见问题 PDF', eyebrow: '内容运营', description: '配置 APP 常见问题 PDF，只有已发布文档会在客户端展示。', icon: 'file-text', permission: 'faq-documents:view', primaryLabel: '新增 PDF 文档',
    tabs: [{ key: 'all', label: '全部文档' }, { key: 'published', label: '已发布', field: 'status', value: 'published' }, { key: 'invalid', label: '文件失效', field: 'fileStatus', value: 'invalid' }, { key: 'disabled', label: '已停用', field: 'status', value: 'disabled' }],
    filters: [textFilter('keyword', '文档查询', '标题或文件名', ['name', 'fileName']), { field: 'productType', label: '适用产品', type: 'select', optionSource: 'product-descriptors' }, selectFilter('fileStatus', '文件状态', [{ label: '文件有效', value: 'valid' }, { label: '文件失效', value: 'invalid' }]), selectFilter('status', '发布状态', [{ label: '已发布', value: 'published' }, { label: '已停用', value: 'disabled' }])],
    columns: [{ field: 'name', label: '文档标题', minWidth: 210, type: 'main' }, { field: 'productType', label: '适用产品', minWidth: 170 }, { field: 'documentVersion', label: '资料版本', width: 100, type: 'mono' }, { field: 'fileName', label: 'PDF 文件', minWidth: 220 }, { field: 'fileStatus', label: '文件状态', width: 104, type: 'status' }, { field: 'sort', label: '排序', width: 90, type: 'number' }, dateColumn('updatedAt', '更新时间'), statusColumn],
    fields: [textField('name', '中文标题', true), textField('titleEn', '英文标题', true), dynamicSelectField('productType', '适用产品', 'product-descriptors', true), textField('documentVersion', '资料版本', true), textareaField('summary', '内容摘要', true), { field: 'pdfFile', label: 'PDF 文件', type: 'pdf', required: true, span: 2 }, numberField('sort', '排序', true), selectField('status', '发布状态', [{ label: '已发布', value: 'published' }, { label: '已停用', value: 'disabled' }], true)],
    rowActions: ['detail', 'edit', 'toggle', 'delete'], actions: commonActions.filter((item) => ['toggle', 'delete'].includes(item.key)),
  }),
  createModule({
    key: 'support-settings', route: 'support-settings', title: '客服信息', eyebrow: '内容运营', description: '维护 APP 展示的客服电话、邮箱、服务时间和紧急联系电话。', icon: 'phone', permission: 'support-settings:view', primaryLabel: '新增客服配置',
    tabs: [{ key: 'all', label: '全部配置' }, { key: 'normal', label: '已启用', field: 'status', value: 'normal' }, { key: 'disabled', label: '已停用', field: 'status', value: 'disabled' }],
    filters: [textFilter('keyword', '客服配置查询', '名称、电话或邮箱', ['name', 'servicePhone', 'serviceEmail']), selectFilter('audience', '适用用户', [{ label: '全部用户', value: 'all' }, { label: '普通用户', value: 'user' }, { label: '经销商', value: 'dealer' }]), selectFilter('status', '状态', accountStatusOptions)],
    columns: [{ field: 'name', label: '配置名称', minWidth: 180, type: 'main' }, { field: 'audienceLabel', label: '适用用户', width: 120 }, { field: 'servicePhone', label: '客服电话', width: 150 }, { field: 'serviceEmail', label: '客服邮箱', minWidth: 190 }, { field: 'serviceHours', label: '服务时间', minWidth: 150 }, statusColumn],
    fields: [textField('name', '配置名称', true), selectField('audience', '适用用户', [{ label: '全部用户', value: 'all' }, { label: '普通用户', value: 'user' }, { label: '经销商', value: 'dealer' }], true), textField('servicePhone', '客服电话', true), textField('serviceEmail', '客服邮箱', true), textField('serviceHours', '服务时间', true), textField('emergencyPhone', '紧急联系电话'), selectField('status', '启用状态', accountStatusOptions, true), textareaField('summary', '客服说明')],
    detailTabs: [overviewTab, historyTab], rowActions: ['detail', 'edit', 'toggle'], actions: commonActions.filter((item) => item.key === 'toggle'),
  }),
  createModule({
    key: 'after-sales-types', route: 'after-sales-types', title: '售后类型配置', eyebrow: '服务与售后', description: '配置 APP 可提交的售后类型、必填资料和响应时限。', icon: 'list-checks', permission: 'after-sales-types:view', primaryLabel: '新增售后类型',
    tabs: [{ key: 'all', label: '全部类型' }, { key: 'normal', label: '已启用', field: 'status', value: 'normal' }, { key: 'disabled', label: '已停用', field: 'status', value: 'disabled' }],
    filters: [textFilter('keyword', '售后类型查询', '类型名称或编码', ['name', 'code']), selectFilter('audience', '适用角色', [{ label: '全部用户', value: 'all' }, { label: '普通用户', value: 'user' }, { label: '经销商', value: 'dealer' }]), selectFilter('status', '状态', accountStatusOptions)],
    columns: [codeColumn, { field: 'name', label: '售后类型', minWidth: 180, type: 'main' }, { field: 'audienceLabel', label: '适用角色', width: 120 }, { field: 'requiredFieldsLabel', label: '提交必填资料', minWidth: 280 }, { field: 'responseSlaHours', label: '响应时限/小时', width: 130, type: 'number' }, statusColumn],
    fields: [textField('name', '售后类型名称', true), selectField('audience', '适用角色', [{ label: '全部用户', value: 'all' }, { label: '普通用户', value: 'user' }, { label: '经销商', value: 'dealer' }], true), { field: 'requiredFields', label: '提交必填资料', type: 'multiSelect', options: afterSalesRequiredFieldOptions, required: true, span: 2 }, { ...numberField('responseSlaHours', '响应时限（小时）', true), min: 1, max: 720 }, selectField('status', '启用状态', accountStatusOptions, true), textareaField('summary', '类型说明')],
    detailTabs: [overviewTab, historyTab], rowActions: ['detail', 'edit', 'toggle'], actions: commonActions.filter((item) => item.key === 'toggle'),
  }),
  createModule({
    key: 'app-versions', route: 'app-versions', title: '客户端版本', eyebrow: '系统管理', description: '维护 App/系统版本、发布时间、适用范围和发布状态。', icon: 'package-up', permission: 'app-versions:view', primaryLabel: '新增客户端版本',
    tabs: [{ key: 'all', label: '全部版本' }, { key: 'draft', label: '草稿', field: 'status', value: 'draft' }, { key: 'published', label: '已发布', field: 'status', value: 'published' }, { key: 'disabled', label: '已停用', field: 'status', value: 'disabled' }],
    filters: [textFilter('keyword', '版本查询', '版本号或说明', ['name', 'summary']), selectFilter('platform', '客户端平台', [{ label: 'iOS', value: 'iOS' }, { label: 'Android', value: 'Android' }, { label: 'iOS / Android', value: 'iOS / Android' }]), selectFilter('status', '发布状态', [{ label: '草稿', value: 'draft' }, { label: '已发布', value: 'published' }, { label: '已停用', value: 'disabled' }])],
    columns: [codeColumn, { field: 'name', label: '版本号', width: 130, type: 'mono' }, { field: 'platform', label: '客户端平台', width: 140 }, { field: 'releaseScope', label: '适用范围', minWidth: 170 }, dateColumn('releaseAt', '发布时间'), { field: 'summary', label: '版本说明', minWidth: 220 }, statusColumn],
    fields: [textField('name', '版本号', true), selectField('platform', '客户端平台', [{ label: 'iOS', value: 'iOS' }, { label: 'Android', value: 'Android' }, { label: 'iOS / Android', value: 'iOS / Android' }], true), textField('releaseScope', '适用范围', true), { field: 'releaseAt', label: '发布时间', type: 'date' }, textareaField('summary', '版本说明', true), selectField('status', '发布状态', [{ label: '草稿', value: 'draft' }, { label: '已发布', value: 'published' }, { label: '已停用', value: 'disabled' }], true)],
    rowActions: ['detail', 'edit', 'publish'], actions: [action('publish', '发布/停用', '发布或停用会写入审计日志；Demo 不包含未确认的灰度与强制升级策略。', [reasonField], ['draft', 'published', 'disabled'], 'danger')],
  }),
  createModule({
    key: 'admins', route: 'admins', title: '管理员账号', eyebrow: '系统管理', description: '管理平台与经销商后台账号、角色、数据范围和登录安全。', icon: 'user-cog', permission: 'admins:view', primaryByTab: { all: '新增管理员账号', platform: '新增平台管理员', dealer: '新增经销商管理员', locked: undefined },
    tabs: [{ key: 'all', label: '全部账号' }, { key: 'platform', label: '平台账号', field: 'category', value: '平台' }, { key: 'dealer', label: '经销商账号', field: 'category', value: '经销商' }, { key: 'locked', label: '已锁定', field: 'status', value: 'locked' }],
    filters: [textFilter('keyword', '账号查询', '账号或姓名', ['account', 'name']), selectFilter('role', '角色', [{ label: '平台管理员', value: '平台管理员' }, { label: '总部售后', value: '总部售后' }, { label: '经销商管理员', value: '经销商管理员' }]), selectFilter('status', '账号状态', [...accountStatusOptions, { label: '已锁定', value: 'locked' }])],
    columns: [{ field: 'account', label: '账号', minWidth: 200 }, { field: 'name', label: '姓名', width: 120 }, { field: 'accountLevel', label: '账号级别', width: 120 }, { field: 'role', label: '角色', width: 150 }, { field: 'dataScope', label: '数据范围', minWidth: 170 }, dateColumn('updatedAt', '更新时间'), namedStatusColumn('账号状态')],
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
    columns: [{ field: 'account', label: '操作账号', minWidth: 180 }, dateColumn('createdAt', '操作时间'), { field: 'operationType', label: '操作类型', width: 130 }, { field: 'content', label: '操作内容', minWidth: 240 }, { field: 'resultLabel', label: '操作结果', width: 100 }, { field: 'ip', label: '来源 IP', width: 140, type: 'mono' }, statusColumn], rowActions: ['detail'], actions: [],
  }),
]

const materialConfig = configs.find((item) => item.route === 'materials')!
const productWorkflowActions = materialConfig.actions?.filter((item) => item.key !== 'ship') || []
const productPurchaseColumns = materialConfig.tabColumns?.purchase || materialConfig.columns
materialConfig.description = '处理售后物料申请、分级审批、仓库发货、物流登记和收货确认；产品采购已拆分为独立业务菜单。'
materialConfig.primaryByTab = { all: '发起售后物料申请', approval: undefined, early: '发起提前申请', shipping: undefined, completed: undefined, rejected: undefined }
materialConfig.tabs = materialConfig.tabs.filter((tab) => tab.key !== 'purchase')
materialConfig.filters = materialConfig.filters.map((filter) => filter.field === 'category'
  ? selectFilter('category', '申请类型', ['普通申请', '提前申请'].map((value) => ({ label: value, value })))
  : filter)
delete materialConfig.tabColumns?.purchase
delete materialConfig.tabFilters?.purchase
materialConfig.rowActions = materialConfig.rowActions?.filter((key) => !['start-production', 'finance-confirm', 'purchase-ship', 'confirm-purchase-receipt'].includes(key))

const productPurchaseConfig = createModule({
  key: 'product-purchase', route: 'product-purchase', title: '产品采购', eyebrow: '仓储与采购',
  description: '独立管理产品采购申请、销售确认、研发确认、导入生产、财务核实、仓库发货和采购方收货闭环。',
  icon: 'package-check', permission: 'product-purchase:view', crud: 'workflow', primaryLabel: '发起产品采购申请',
  primaryByTab: { all: '发起产品采购申请', approval: undefined, production: undefined, finance: undefined, shipping: undefined, shipped: undefined, completed: undefined, rejected: undefined },
  tabs: [
    { key: 'all', label: '全部采购', source: 'materials', field: 'category', value: '设备采购' },
    { key: 'approval', label: '待采购审批', source: 'materials', field: 'purchaseStage', values: ['sales_confirmation', 'rd_confirmation'] },
    { key: 'production', label: '待导入生产', source: 'materials', field: 'purchaseStage', value: 'production' },
    { key: 'finance', label: '待财务核实', source: 'materials', field: 'purchaseStage', value: 'finance_confirmation' },
    { key: 'shipping', label: '待仓库发货', source: 'materials', field: 'purchaseStage', value: 'warehouse_fulfillment' },
    { key: 'shipped', label: '待确认收货', source: 'materials', field: 'purchaseStage', value: 'shipped' },
    { key: 'completed', label: '已完成', source: 'materials', field: 'purchaseStage', value: 'received' },
    { key: 'rejected', label: '已拒绝', source: 'materials', field: 'purchaseStage', value: 'rejected' },
  ],
  filters: [
    textFilter('keyword', '采购查询', '采购单号、经销商、发起人或产品型号', ['code', 'dealer', 'initiatedBy', 'deviceModel', 'itemName']),
    selectFilter('purchaseStage', '采购节点', [{ label: '待销售确认', value: 'sales_confirmation' }, { label: '待研发确认', value: 'rd_confirmation' }, { label: '待导入生产', value: 'production' }, { label: '待财务核实', value: 'finance_confirmation' }, { label: '待仓库发货', value: 'warehouse_fulfillment' }, { label: '待确认收货', value: 'shipped' }, { label: '已完成', value: 'received' }, { label: '已拒绝', value: 'rejected' }]),
    selectFilter('contractStatus', '合同状态', [{ label: '待确认', value: '待确认' }, { label: '已签订', value: '已签订' }, { label: '无需合同', value: '无需合同' }]),
  ],
  columns: productPurchaseColumns,
  fields: [
    { ...textField('dealer', '申请经销商'), readonly: true },
    { field: 'purchaseItems', label: '采购明细', type: 'lineItems', optionSource: 'purchasable-items', required: true, span: 2 },
    { ...numberField('amount', '预算总费用（元）'), readonly: true },
    textareaField('summary', '采购用途与说明', true),
  ],
  detailTabs: materialConfig.detailTabs,
  rowActions: ['detail', 'approve', 'reject', 'start-production', 'finance-confirm', 'purchase-ship', 'confirm-purchase-receipt'],
  actions: productWorkflowActions,
})

configs.push(productPurchaseConfig)
configs.splice(configs.findIndex((item) => item.route === 'purchase-shipping'), 1)

export const moduleConfigs: Record<string, ModuleConfig> = Object.fromEntries(configs.map((item) => [item.route, item]))

export const navGroups: NavGroup[] = [
  { label: '工作台', items: [
    { route: 'dashboard', label: '首页', icon: 'layout-dashboard', permission: 'dashboard:view' },
  ] },
  { label: '客户与渠道', items: ['users', 'dealers', 'projects', 'installation-transfers', 'cross-region-activations'].map((route) => ({ route, label: moduleConfigs[route].title, icon: moduleConfigs[route].icon, permission: moduleConfigs[route].permission })) },
  { label: '设备与产品', items: ['product-catalog', 'devices', 'ota'].map((route) => ({ route, label: moduleConfigs[route].title, icon: moduleConfigs[route].icon, permission: moduleConfigs[route].permission })) },
  { label: '仓储与采购', items: ['product-purchase', 'warehouses', 'warehouse', 'material-catalog'].map((route) => ({ route, label: moduleConfigs[route].title, icon: moduleConfigs[route].icon, permission: moduleConfigs[route].permission })) },
  { label: '服务与售后', items: [
    ...['repairs', 'messages', 'complaints'].map((route) => ({ route, label: moduleConfigs[route].title, icon: moduleConfigs[route].icon, permission: moduleConfigs[route].permission, section: '工单服务' })),
    ...['materials', 'issuance', 'sn-replacement', 'service-transfer'].map((route) => ({ route, label: moduleConfigs[route].title, icon: moduleConfigs[route].icon, permission: moduleConfigs[route].permission, section: '售后履约' })),
    ...['approval-center', 'warranty', 'couriers', 'after-sales-types', 'approval-flow'].map((route) => ({ route, label: moduleConfigs[route].title, icon: moduleConfigs[route].icon, permission: moduleConfigs[route].permission, section: route === 'approval-center' ? '审批中心' : '售后配置' })),
  ] },
  { label: '财务与支付', items: [
    { route: 'payments', label: '支付订单', icon: 'receipt-text', permission: 'payments:view', section: '交易管理' },
    { route: 'payment-settings', label: '支付配置', icon: 'wallet-cards', permission: 'payment-settings:view', section: '交易管理' },
  ] },
  { label: '内容运营', items: [
    { route: 'banners', label: 'Banner 管理', icon: 'panels-top-left', permission: 'banners:view', section: '内容运营' },
    { route: 'faq-documents', label: '常见问题 PDF', icon: 'scroll-text', permission: 'faq-documents:view', section: '内容运营' },
    { route: 'support-settings', label: '客服信息', icon: 'phone', permission: 'support-settings:view', section: '内容运营' },
  ] },
  { label: '系统管理', items: [
    { route: 'launch-settings', label: 'APP 启动页', icon: 'image-up', permission: 'launch-settings:view', section: '客户端配置' },
    { route: 'app-versions', label: '客户端版本', icon: 'package-up', permission: 'app-versions:view', section: '客户端配置' },
    ...['admins', 'roles', 'logs'].map((route) => ({ route, label: moduleConfigs[route].title, icon: moduleConfigs[route].icon, permission: moduleConfigs[route].permission, section: '权限与审计' })),
  ] },
]

export const statusLabels: Record<string, { label: string; tone: string }> = {
  normal: { label: '正常', tone: 'success' }, active: { label: '当前生效', tone: 'success' }, online: { label: '已连接', tone: 'success' }, activated: { label: '已激活', tone: 'success' }, bound: { label: '已绑定', tone: 'success' }, paid: { label: '支付成功', tone: 'success' }, verified: { label: '已核实', tone: 'success' }, published: { label: '已发布', tone: 'success' }, approved: { label: '已审批', tone: 'success' }, completed: { label: '已完成', tone: 'success' }, resolved: { label: '已处理', tone: 'success' }, received: { label: '已领取', tone: 'success' }, consumed: { label: '已扣减', tone: 'success' }, synced: { label: '已同步', tone: 'success' },
  pending: { label: '待处理', tone: 'warning' }, verifying: { label: '待财务核实', tone: 'warning' }, partial: { label: '部分付款', tone: 'warning' }, waiting: { label: '等待前序审批', tone: 'neutral' }, processing: { label: '处理中', tone: 'info' }, warning: { label: '临期', tone: 'warning' }, low: { label: '库存偏低', tone: 'warning' }, shipped: { label: '运输中', tone: 'info' }, draft: { label: '草稿', tone: 'neutral' }, inactive: { label: '未激活', tone: 'neutral' }, unbound: { label: '未绑定', tone: 'neutral' }, offline: { label: '未连接', tone: 'neutral' }, forwarded: { label: '已转发', tone: 'info' }, transferred: { label: '已转移', tone: 'neutral' }, replaced: { label: '已换机', tone: 'neutral' }, withdrawn: { label: '已撤回', tone: 'neutral' },
  valid: { label: '文件有效', tone: 'success' }, invalid: { label: '文件失效', tone: 'error' },
  disabled: { label: '已禁用', tone: 'error' }, failed: { label: '失败', tone: 'error' }, rejected: { label: '已拒绝', tone: 'error' }, expired: { label: '已过期', tone: 'error' }, locked: { label: '已锁定', tone: 'error' }, refunded: { label: '已退款', tone: 'neutral' },
}
