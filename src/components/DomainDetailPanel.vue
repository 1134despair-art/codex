<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { moduleConfigs, statusLabels } from '@/config/modules'
import { hasPermission } from '@/config/permissions'
import { mockService } from '@/services/mock'
import { useAuthStore } from '@/stores/auth'
import type { ColumnConfig, DetailTabConfig, EntityRecord, RelatedNavigationItem } from '@/types'

const props = withDefaults(defineProps<{ moduleKey: string; record: EntityRecord; tab: DetailTabConfig; navigation?: RelatedNavigationItem[] }>(), { navigation: () => [] })
const emit = defineEmits<{ action: [payload: { moduleKey: string; action: string; record: EntityRecord }]; navigate: [item: RelatedNavigationItem] }>()
const auth = useAuthStore()
const canUnbind = computed(() => auth.session?.role === 'platform' || hasPermission(auth.permissions, 'devices:unbind'))
const loading = ref(false)
const rows = ref<EntityRecord[]>([])
const tabTargetModules: Record<string, string> = {
  'user-devices': 'devices', 'dealer-devices': 'devices', 'project-devices': 'devices', 'warehouse-devices': 'devices', 'ota-devices': 'devices',
  'ownership-history': 'warehouse', 'firmware-history': 'ota', 'project-warranty': 'warranty', 'logistics-records': 'issuance', 'role-permissions': 'roles',
}
const tabNavigation = computed(() => {
  if (props.tab.source === 'warehouse-locations' && hasPermission(auth.permissions, 'warehouse-locations:view')) {
    return {
      key: `warehouse-locations-${props.record.id}`,
      label: '管理库位',
      icon: 'map-pin',
      targetModule: 'warehouse-locations',
      relationFilters: { warehouseId: props.record.id },
      count: rows.value.length,
      level: 'primary',
    } satisfies RelatedNavigationItem
  }
  const target = tabTargetModules[String(props.tab.source || '')]
  return target ? props.navigation.find((item) => item.targetModule === target) : undefined
})

const internalFields = new Set(['id', 'ownerId', 'dealerId', 'domain', 'subjectId', 'subjectCode', 'requestType', 'replacementDeviceDescriptor', 'initiatorAccountId', 'initiatorRole', 'productId', 'warehouseId', 'warehouseLocationId', 'currentApproverId', 'currentApproverAccountId'])
const labels: Record<string, string> = {
  code: '业务编号', name: '名称', account: '账号', category: '类型', region: '销售地区', owner: '归属方', status: '状态', createdAt: '创建时间', updatedAt: '更新时间', summary: '说明', deviceSN: '设备 SN', deviceName: '设备名称', deviceModel: '设备型号', deviceType: '设备类型', country: '销售国家', activation: '激活状态', activationDate: '激活日期', firmware: '固件版本', bindingStatus: '绑定状态', boundAt: '绑定时间', lastUsedRegion: '最近一次使用地区（用户授权上报）', lastUsedAt: '最近使用时间', salesRegion: '销售/归属区域', usedRegion: '发生/使用区域', occurredAt: '发生时间', exceptionType: '异常类型', locationSource: '地区信息来源', shipOwner: '船东姓名', usageRegion: '使用地区', warrantyUntil: '质保到期日', warrantyStartDate: '质保起算日', productType: '产品类型', dealer: '经销商', laborMonths: '免人工费时间', materialMonths: '物料质保时间', content: '内容', contact: '联系方式', faultCategory: '故障分类', assignee: '处理人', result: '处理结果', materialName: '物料名称', itemName: '申请内容', quantity: '数量', estimatedUnitPrice: '预算单价', actualUnitPrice: '成交单价', warrantyResult: '质保校验结果', paymentStatus: '付款状态', paymentMethod: '付款方式', paymentReference: '付款凭证/流水号', paymentNote: '费用备注', courier: '快递公司', trackingNo: '物流单号', originalSN: '原设备 SN', originalDeviceName: '原设备名称', originalDeviceModel: '原设备型号', originalDeviceType: '原设备类型', newSN: '新设备 SN', replacementDeviceName: '新设备名称', replacementDeviceModel: '新设备型号', replacementDeviceType: '新设备类型', sourceDealer: '原代理商', targetDealer: '目标代理商', channel: '支付/通知渠道', amount: '金额', orderAmount: '应付金额', paidAmount: '累计已付金额', remainingAmount: '待付金额', paymentCount: '付款次数', paidAt: '付款日期', role: '角色', dataScope: '数据范围', operationType: '操作类型', ip: '来源 IP', deviceInfo: '设备信息', levels: '审核层级', members: '审核人员', recipient: '发放对象', issuedAt: '发放时间', receivedAt: '收货时间', replacedAt: '更换时间', forceUpdate: '强制更新', releaseAt: '发布时间', applicableProductNames: '适用产品', applicableDeviceTypes: '适用设备类型', applicableDeviceModels: '适用设备型号', targetKey: '跳转标识', targetLabel: '跳转目标', audienceLabel: '适用用户', legacyTarget: '历史跳转值', sort: '排序', phone: '联系电话', email: '联系邮箱', parentDealer: '上级经销商', tier: '经销商层级', deviceCount: '绑定/管理设备数', lastActive: '最近活跃', applyTime: '申请时间', warehouseLocation: '库位',
}
Object.assign(labels, {
  parentOrderCode: '母订单号',
  childOrderCode: '子付款单号',
  installmentNo: '付款期次',
  installmentLabel: '付款期次',
  previousPaidAmount: '付款前累计已付',
  currentPaymentAmount: '本次付款',
  paidAmountAfter: '付款后累计已付',
  remainingAmountAfter: '剩余待付',
  lastChildOrderCode: '最近子付款单号',
  previousVerifiedChildOrderCodes: '此前已核实子单',
  hasFee: '是否涉及费用',
  estimatedFee: '预估费用',
  actualFee: '实际费用',
  feeStatus: '费用状态',
  feeBearer: '费用承担方',
  feeDescription: '费用说明',
  approvalStage: '当前审批阶段',
  initiatedBy: '发起人',
  initiatedAt: '发起时间',
  currentApproverName: '当前审批人',
  specification: '产品规格',
  warehouseName: '仓库',
  warehouseLocation: '库位',
  manufacturedAt: '生产时间',
  inboundAt: '入库时间',
  outboundAt: '出库时间',
  purchaseStageLabel: '采购节点',
  contractStatus: '合同状态',
  contractNo: '合同编号',
  deliveryStatus: '发货状态',
  deliveryMethod: '交付方式',
  deliveryReference: '物流/交付单号',
  trackingNo: '物流单号',
  shipmentPhoto: '发货照片',
  receiptPhoto: '收货照片',
  paymentProof: '付款截图',
  productionBatchNo: '生产批次号',
  productionAt: '导入生产时间',
  warehouseDecisionLabel: '仓库处理决定',
  financeConfirmedBy: '财务确认人',
  financeConfirmedAt: '财务确认时间',
  businessConfirmedBy: '业务确认人',
  businessConfirmedAt: '业务确认时间',
  submittedAt: '自动提交时间',
  reviewDeadline: '审核截止时间',
  temporaryOperationUntil: '临时运行截止时间',
  temporaryUseStatusLabel: '临时运行状态',
})

const sourceRecord = computed(() => props.tab.source && rows.value[0] ? rows.value[0] : props.record)
const fieldEntries = computed(() => {
  const config = moduleConfigs[props.moduleKey]
  const preferred = props.tab.key === 'overview'
    ? [...config.columns.map((item) => item.field), ...config.fields.filter((item) => !(item.sensitive && auth.session?.role !== 'platform')).map((item) => item.field)]
    : Object.keys(sourceRecord.value)
  return [...new Set(preferred)]
    .filter((field) => !internalFields.has(field) && sourceRecord.value[field] !== undefined && sourceRecord.value[field] !== '')
    .map((field) => ({ field, label: labels[field] || config.fields.find((item) => item.field === field)?.label || field, value: sourceRecord.value[field] }))
})

function display(value: unknown) {
  if (value === true) return '是'
  if (value === false) return '否'
  if (value === null || value === undefined || value === '') return '-'
  return Array.isArray(value) ? value.join('、') : String(value)
}

function isStatusField(field: string) {
  return ['status', 'activation', 'bindingStatus', 'warrantyResult'].includes(field)
}

function isImageValue(value: unknown) {
  return typeof value === 'string' && value.startsWith('data:image/')
}

function displayField(field: string, value: unknown) {
  if (isStatusField(field)) return statusMeta(value).label
  if (field === 'account' && ['users', 'complaints'].includes(props.moduleKey)) return maskAccount(value)
  if (['amount', 'orderAmount', 'paidAmount', 'remainingAmount', 'previousPaidAmount', 'currentPaymentAmount', 'paidAmountAfter', 'remainingAmountAfter', 'estimatedUnitPrice', 'actualUnitPrice', 'unitPrice', 'estimatedFee', 'actualFee'].includes(field) && Number.isFinite(Number(value))) return `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (/(At|Date|Until)$/.test(field) && typeof value === 'string') return value.replace('T', ' ').replace('.000Z', '').slice(0, 19)
  return display(value)
}

function maskAccount(value: unknown) {
  const account = display(value)
  if (account.includes('@')) {
    const [name, domain] = account.split('@')
    return `${name.slice(0, 2)}${'*'.repeat(Math.max(3, name.length - 2))}@${domain}`
  }
  if (account.length >= 7) return `${account.slice(0, 3)}****${account.slice(-4)}`
  return account
}

function statusMeta(value: unknown) {
  if (props.moduleKey === 'payments') {
    const paymentStatuses: Record<string, { label: string; tone: string }> = {
      pending: { label: '待付款/继续付款', tone: 'warning' }, verifying: { label: '待财务核实', tone: 'warning' }, verified: { label: '已付清', tone: 'success' },
    }
    if (paymentStatuses[String(value)]) return paymentStatuses[String(value)]
  }
  const base = statusLabels[String(value)] || { label: display(value), tone: 'neutral' }
  return { ...base, tone: moduleConfigs[props.moduleKey].statusTones?.[String(value)] || base.tone }
}

function isDate(column: ColumnConfig) {
  return column.type === 'date'
}

async function load() {
  rows.value = []
  if (!props.tab.source) return
  loading.value = true
  try {
    const response = await mockService.related(props.moduleKey, props.record.id, props.tab.source)
    rows.value = response.data
  } finally {
    loading.value = false
  }
}

watch(() => [props.record.id, props.tab.key], load, { immediate: true })
</script>

<template>
  <div v-loading="loading" class="domain-detail-panel" :data-tab="tab.key">
    <dl v-if="tab.kind === 'fields'" class="detail-grid">
      <div v-for="item in fieldEntries" :key="item.field">
        <dt>{{ item.label }}</dt>
        <dd>
          <span v-if="isStatusField(item.field)" class="status-chip" :data-tone="statusMeta(item.value).tone"><i></i>{{ displayField(item.field, item.value) }}</span>
          <img v-else-if="isImageValue(item.value)" class="detail-proof-image" :src="String(item.value)" :alt="item.label">
          <span v-else>{{ displayField(item.field, item.value) }}</span>
        </dd>
      </div>
    </dl>

    <template v-else-if="tab.kind === 'table'">
      <div class="related-head">
        <div><div class="eyebrow">{{ record.code }}</div><h3>{{ tab.title || tab.label }}</h3><p>{{ tab.description || `查看与当前记录关联的${tab.label}。` }}</p></div>
        <div class="related-head-actions"><span class="relation-count">{{ rows.length }} 条记录</span><el-button v-if="tabNavigation" type="primary" plain @click="emit('navigate', tabNavigation)">前往{{ moduleConfigs[tabNavigation.targetModule]?.title || tabNavigation.label }}</el-button></div>
      </div>
      <el-table :data="rows" max-height="360" class="detail-related-table">
        <el-table-column v-for="column in tab.columns" :key="column.field" :prop="column.field" :label="column.label" :width="column.width" :min-width="column.minWidth" show-overflow-tooltip>
          <template #default="scope">
            <span v-if="column.type === 'status'" class="status-chip" :data-tone="statusMeta(scope.row[column.field]).tone"><i></i>{{ statusMeta(scope.row[column.field]).label }}</span>
            <img v-else-if="column.type === 'image' && scope.row[column.field]" class="detail-table-image" :src="String(scope.row[column.field])" :alt="column.label">
            <code v-else-if="column.type === 'mono'" class="mono-cell">{{ display(scope.row[column.field]) }}</code>
            <span v-else-if="column.type === 'money'" class="money-cell">¥{{ Number(scope.row[column.field] || 0).toLocaleString() }}</span>
            <span v-else-if="isDate(column)">{{ display(scope.row[column.field]).replace('T', ' ').slice(0, 19) }}</span>
            <span v-else>{{ display(scope.row[column.field]) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="tab.source === 'user-devices' && canUnbind" label="操作" width="96" fixed="right">
          <template #default="scope"><el-button link type="danger" @click="emit('action', { moduleKey: 'devices', action: 'unbind', record: scope.row })">强制解绑</el-button></template>
        </el-table-column>
        <template #empty><div class="detail-empty"><AppIcon name="inbox" :size="28" /><strong>暂无{{ tab.label }}</strong><p>当前记录还没有关联数据。</p></div></template>
      </el-table>
    </template>

    <template v-else>
      <div class="related-head">
        <div><div class="eyebrow">{{ record.code }}</div><h3>{{ tab.title || tab.label }}</h3><p>{{ tab.description || `按时间查看${tab.label}。` }}</p></div>
        <span class="relation-count">{{ rows.length }} 个节点</span>
      </div>
      <div v-if="rows.length" class="timeline domain-timeline">
        <article v-for="item in rows" :key="item.id"><i></i><div><strong>{{ item.title || item.name }}</strong><p>{{ item.content || item.summary }}</p><small>{{ display(item.createdAt).replace('T', ' ').slice(0, 19) }} · {{ item.operator || item.owner }}</small></div></article>
      </div>
      <div v-else class="detail-empty"><AppIcon name="inbox" :size="28" /><strong>暂无{{ tab.label }}</strong><p>后续关键操作会自动记录在这里。</p></div>
    </template>
  </div>
</template>
