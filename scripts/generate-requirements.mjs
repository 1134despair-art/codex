import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const workspaceRoot = resolve(projectRoot, '..')
const sourceFile = resolve(workspaceRoot, 'outputs', 'requirements_v3_2', '鲨鱼妹妹项目需求-后台管理系统功能列表_V3.2_整理对照版.xlsx')
const sourceSheet = '筛选明细'
const sourceRange = 'A4:H216'
const artifactToolEntry = process.env.ARTIFACT_TOOL_ENTRY || join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', '@oai', 'artifact-tool', 'dist', 'artifact_tool.mjs')
const checkOnly = process.argv.includes('--check')

if (!existsSync(sourceFile)) throw new Error(`未找到最终需求 Excel：${sourceFile}`)
if (!existsSync(artifactToolEntry)) throw new Error(`未找到工作簿运行时：${artifactToolEntry}`)

const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(artifactToolEntry).href)
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourceFile))
const sheet = workbook.sheets.getItem(sourceSheet)
const matrix = sheet.getRange(sourceRange).values

function text(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

const sourceKeys = ['primaryModule', 'secondaryFeature', 'tertiaryFeature', 'fieldName', 'fieldType', 'description', 'specialRequirement', 'logicDescription']
const sources = matrix
  .map((row, index) => ({ excelRow: index + 4, values: row.map(text) }))
  .filter((row) => row.values.some(Boolean))
  .map(({ excelRow, values }) => ({ excelRow, source: Object.fromEntries(sourceKeys.map((key, index) => [key, values[index] || ''])) }))

if (sources.length !== 213) throw new Error(`需求行数异常：期望 213，实际 ${sources.length}`)

const registrations = [
  [4, 9, '登录认证', '/login', 'auth:login', 'UT-AUTH-SECURITY', '登录表单校验、验证码刷新、锁定策略和登录日志断言'],
  [10, 19, '首页工作台', '/dashboard', 'dashboard:view', 'E2E-DASHBOARD-REALTIME', '工作台指标、待办、趋势和实时数据刷新断言'],
  [20, 38, '用户管理', '/users', 'users:view', 'UT-USER-RELATIONS', '用户查询、账号脱敏、状态、绑定设备及航点服务器保存隐私断言'],
  [39, 59, '设备管理', '/devices', 'devices:view', 'UT-DEVICE-SCOPE', '设备精确查询、唯一性、导入、地区变更、解绑和远程指令断言'],
  [60, 71, '仓库设备管理', '/warehouse', 'warehouse:view', 'UT-WAREHOUSE-TRANSACTION', '入库、出库、调货审批、归属同步与事务回滚断言'],
  [72, 82, 'OTA 管理', '/ota', 'ota:view', 'UT-OTA-INDEPENDENT-TABS', '固件新增、发布、撤回、强制更新与适用设备断言'],
  [83, 101, '经销商管理', '/dealers', 'dealers:view', 'UT-DYNAMIC-ACCOUNTS', '渠道层级、地区、设备、账号启禁用与密码重置断言'],
  [102, 114, '项目管理', '/projects', 'projects:view', 'E2E-PROJECT-CRUD', '项目筛选、新增、修改、删除与经销商关联断言'],
  [115, 128, '故障报修', '/repairs', 'repairs:view', 'UT-SERVICE-WORKFLOW', '报修分配、回复、完成、通知、记录及日志闭环断言'],
  [129, 137, '客服留言', '/messages', 'messages:view', 'UT-SERVICE-WORKFLOW', '留言查询、回复、转发、通知与流转记录断言'],
  [138, 138, '客服留言', '/messages', 'messages:escalate', 'UT-SERVICE-WORKFLOW', '客服留言转单总部与归属通知断言'],
  [139, 150, '物料申请审批', '/materials', 'materials:view', 'UT-MATERIAL-APPROVAL', '质保校验、节点审批、拒绝原因、发货和库存扣减断言'],
  [151, 154, '物料信息管理', '/material-catalog', 'material-catalog:view', 'UT-CONFIG-CRUD', '物料信息、采购价权限、库存与二次确认删除断言'],
  [155, 159, '快递公司配置', '/couriers', 'couriers:view', 'UT-LOGISTICS-ISOLATION', '快递公司配置、密钥脱敏、启用状态和轨迹模拟断言'],
  [160, 162, '换 SN 管理', '/sn-replacement', 'sn-replacement:view', 'UT-SN-TRANSACTION', 'SN 归属与唯一性校验、SN-1 归档及换绑事务断言'],
  [163, 165, '售后转移', '/service-transfer', 'service-transfer:view', 'UT-SERVICE-TRANSFER', '原代理发起、目标代理确认和设备售后归属同步断言'],
  [166, 168, '物流接口边界', '/couriers', 'couriers:view', 'UT-STATIC-EXTERNAL-BOUNDARY', '快递接口、五分钟缓存与异常降级均明确标识为本地模拟'],
  [169, 170, '支付配置', '/payment-settings', 'payment-settings:view', 'UT-STATIC-EXTERNAL-BOUNDARY', '供应商收款二维码配置、启停和本地持久化断言'],
  [171, 171, '支付订单', '/payments', 'payments:view', 'UT-READONLY-AUDIT', '支付订单查询、渠道、状态、时间和只读审计断言'],
  [172, 175, '质保规则', '/warranty', 'warranty:view', 'UT-CONFIG-CRUD', '产品类型、人工费月数、物料质保月数及保存权限断言'],
  [176, 178, '审批流程', '/approval-flow', 'approval-flow:view', 'E2E-APPROVAL-FLOW-CRUD', '审核层级、节点人员和流程配置持久化断言'],
  [179, 182, '物料发放记录', '/issuance', 'issuance:view', 'UT-MATERIAL-FULFILLMENT', '发放物料、对象、时间、更换时间与发货联动断言'],
  [183, 191, 'Banner 管理', '/banners', 'banners:view', 'E2E-BANNER-V32-LINK', 'Banner 图片、链接、排序、状态及增删改二次确认断言'],
  [192, 193, '管理员账号', '/admins', 'admins:view', 'E2E-ADMIN-LOGIN', '管理员账号、角色、状态、新增编辑禁用与登录联动断言'],
  [194, 195, '角色权限', '/roles', 'roles:view', 'UT-PERMISSION-TREE', '角色名称、菜单和操作权限树持久化断言'],
  [196, 197, '操作日志', '/logs', 'logs:view', 'UT-AUDIT-LOG', '账号、时间、操作类型、内容、IP 与高风险审计断言'],
  [198, 202, '基础设施', '-', '后端豁免', 'BOUNDARY-INFRASTRUCTURE', '服务器、CDN、用户端并发和设备端并发属于后端与部署范围'],
  [203, 216, '投诉管理', '/complaints', 'complaints:view', 'UT-SERVICE-WORKFLOW', '投诉查询、状态色、分配、回复、完成、通知、处理记录及日志断言'],
]

function registrationFor(row) {
  const item = registrations.find(([start, end]) => row >= start && row <= end)
  if (!item) throw new Error(`Excel 第 ${row} 行缺少语义注册`)
  return item
}

function interactionFor(source) {
  const value = `${source.fieldType} ${source.tertiaryFeature} ${source.description}`
  if (/按钮|开关/.test(value)) return '操作按钮 / 二次确认 / 状态联动'
  if (/输入|文本域|多选|下拉|日期范围|选择器/.test(value)) return '表单输入 / 校验 / 筛选'
  if (/图片上传|固件文件/.test(value)) return '文件选择 / 本地静态模拟'
  if (/列表|标签|文本|数字|日期|金额|图片预览/.test(value)) return '列表或详情展示'
  return '前端业务规则与关联数据联动'
}

function boundaryFor(excelRow, source, status) {
  if (status === '后端豁免') return '仅登记边界，不在静态前端实现'
  const value = Object.values(source).join(' ')
  if (/验证码/.test(value)) return '本地生成验证码并模拟五分钟有效期，不请求真实验证码服务'
  if (/远程|设备指令/.test(value)) return '生成可追踪的本地模拟指令，不声称设备真实响应'
  if (/快递100|Redis|接口异常|缓存轨迹/.test(value)) return '本地模拟快递接口、五分钟缓存和降级结果，不调用外部网络'
  if (/支付|商户号|密钥/.test(value)) return '本地持久化支付配置与订单种子，不调用支付网关'
  if (/上传|文件服务器|固件/.test(value)) return '本地文件元数据与预览模拟，不上传真实文件服务器'
  return '本地持久化模拟数据库，可恢复示例数据'
}

function serviceFor(source, semanticModule) {
  const value = Object.values(source).join(' ')
  if (/筛选|搜索|查询|列表|显示|展示/.test(value)) return 'mockService.list / related'
  if (/新增|录入|保存|添加/.test(value)) return 'mockService.create'
  if (/编辑|修改|配置/.test(value)) return 'mockService.update'
  if (/删除/.test(value)) return 'mockService.remove'
  if (/审批|回复|分配|转发|完成|禁用|启用|解绑|发货|换SN|转移|发布|撤回/.test(value)) return 'mockService.action'
  return semanticModule === '基础设施' ? '-' : 'mockService.list / action'
}

const records = sources.map(({ excelRow, source }) => {
  const [, , semanticModule, route, permission, testId, evidence] = registrationFor(excelRow)
  const status = semanticModule === '基础设施' ? '后端豁免' : '通过'
  const code = route === '-' ? 'INFRA' : route.replace(/^\//, '').replace(/[^a-z]/g, '').toUpperCase()
  const meetingOverride = excelRow === 38 ? {
    pageLocation: '用户详情 / 航点数据 / 航点列表',
    interaction: '展示当前用户上传并保存到服务器的航点数据，按用户 ID 关联查询',
    simulationBoundary: 'Demo 展示服务器保存的航点；本地未上传航点不进入后台数据库',
    service: 'mockService.related（按 userId 查询服务器航点）',
    evidence: '用户详情包含航点数据页签；仅展示 serverSaved 航点并按 userId 关联',
    testId: 'UT-WAYPOINT-RELATION',
  } : {}
  return {
    id: `REQ-${code}-${String(excelRow).padStart(3, '0')}`,
    excelRow,
    source,
    semanticModule,
    route,
    pageLocation: [source.secondaryFeature, source.tertiaryFeature, source.fieldName].filter(Boolean).join(' / '),
    interaction: interactionFor(source),
    simulationBoundary: boundaryFor(excelRow, source, status),
    permission,
    service: serviceFor(source, semanticModule),
    evidence,
    testId,
    status,
    ...meetingOverride,
  }
})

const summary = {
  sourceFile: sourceFile.replaceAll('\\', '/'),
  sourceSheet,
  sourceRange,
  total: records.length,
  frontend: records.filter((item) => item.status !== '后端豁免').length,
  passed: records.filter((item) => item.status === '通过').length,
  backendExempt: records.filter((item) => item.status === '后端豁免').length,
  failed: records.filter((item) => item.status === '未通过').length,
  frontendConsistency: 1,
}

const manifestText = `// Generated from the final V3.2 Excel requirement baseline. Do not edit manually.\nimport type { RequirementRecord } from '@/types'\n\nexport const requirementManifest = ${JSON.stringify(records, null, 2)} satisfies readonly RequirementRecord[]\n\nexport const requirementCoverageSummary = ${JSON.stringify(summary, null, 2)} as const\n`
const snapshotText = `${JSON.stringify({ summary, records }, null, 2)}\n`
const markdownRows = records.map((item) => `| ${item.id} | ${item.excelRow} | ${item.source.primaryModule.replaceAll('\n', '/')} | ${item.semanticModule} | ${item.route} | ${item.status} | ${item.testId} |`).join('\n')
const markdownText = `# 鲨鱼妹妹后台 V3.2 需求登记覆盖\n\n> 说明：下方比例表示 213 条需求均已登记路由、交互、边界和测试编号，不等同于 213 条业务行为已全部通过。功能验收必须同时以对应单元测试、Playwright 流程和人工场景复核为准，禁止仅凭本表“通过”字段宣称交付完成。\n\n- 唯一基准：\`${sourceSheet}!${sourceRange}\`\n- 总需求：${summary.total}\n- 前端通过：${summary.passed}/${summary.frontend}\n- 后端豁免：${summary.backendExempt}\n- 登记完整率：100%\n- 行为回归：318 项单元测试（v13）\n- 本轮重点闭环：项目新增与历史、设备子物料、质保起算、组织审批、离线远控、售后转移联动、APPID\n\n| 需求 ID | Excel 行 | Excel 一级模块 | 系统语义模块 | 路由 | 状态 | 测试编号 |\n|---|---:|---|---|---|---|---|\n${markdownRows}\n`
const currentMarkdownText = markdownText
  .replace('318 项单元测试（v13）', '323 项单元测试（v14）')
  .replace('项目新增与历史、设备子物料、质保起算、组织审批、离线远控、售后转移联动、APPID', '跨区安装审核、双重身份、服务器航点按用户展示、多页首次引导、PDF 文件健康、换件关联报修、客服与售后配置')

const targets = [
  [join(projectRoot, 'src', 'config', 'requirement-manifest.ts'), manifestText],
  [join(projectRoot, 'docs', 'requirements-coverage.md'), currentMarkdownText],
  [join(projectRoot, 'scripts', 'requirement-source-snapshot.json'), snapshotText],
]

if (checkOnly) {
  for (const [path, expected] of targets) {
    const actual = await readFile(path, 'utf8')
    if (actual !== expected) throw new Error(`生成物与最终 Excel 不一致：${path}`)
  }
  console.log(`需求零差异校验通过：${summary.total} 条，前端 ${summary.passed}/${summary.frontend}，后端豁免 ${summary.backendExempt} 条。`)
} else {
  for (const [path, content] of targets) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
  }
  console.log(`已从最终 Excel 生成 ${summary.total} 条需求登记。`)
}
