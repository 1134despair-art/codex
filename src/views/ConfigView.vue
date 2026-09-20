<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import { hasPermission } from '@/config/permissions'
import { exportRecords } from '@/services/excel'
import { mockService } from '@/services/mock'
import { useAuthStore } from '@/stores/auth'
import type { EntityRecord } from '@/types'

interface LocalConfigField {
  field: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'image'
  required?: boolean
  options?: string[]
  allowCreate?: boolean
}

const auth = useAuthStore()
const activeTab = ref('supplierQr')
const records = ref<EntityRecord[]>([])
const loading = ref(false)
const dialogOpen = ref(false)
const editing = ref<EntityRecord | null>(null)
const form = ref<Record<string, unknown>>({ name: '', category: '', summary: '', status: 'normal' })

const page = {
  eyebrow: '财务与支付', title: '支付配置', description: '按供应商维护普通用户扫码付款时使用的收款二维码。',
  tabs: [{ key: 'supplierQr', label: '供应商收款码' }],
}
const moduleKey = 'payment-settings'
const canExport = computed(() => hasPermission(auth.permissions, `${moduleKey}:export`))
const canCreate = computed(() => hasPermission(auth.permissions, `${moduleKey}:create`))
const supplierOptions = computed(() => [...new Set(records.value
  .filter((record) => record.category === '供应商收款码')
  .map((record) => String(record.supplierName || record.name))
  .filter(Boolean))])
const configFields = computed<LocalConfigField[]>(() => {
  return [
    { field: 'supplierName', label: '供应商', type: 'select', options: supplierOptions.value, allowCreate: true, required: true },
    { field: 'accountName', label: '收款户名', type: 'text', required: true },
    { field: 'accountNo', label: '收款账号/备注', type: 'text' },
    { field: 'qrCodeData', label: '收款二维码', type: 'image', required: true },
    { field: 'summary', label: '配置说明', type: 'textarea' },
  ]
})
const visibleRecords = computed(() => {
  return records.value.filter((record) => record.category === '供应商收款码')
})

async function load() {
  loading.value = true
  records.value = (await mockService.all(moduleKey)).data
  loading.value = false
}

function edit(record: EntityRecord) {
  editing.value = record
  form.value = { ...record }
  dialogOpen.value = true
}

function createSupplierQr() {
  editing.value = null
  form.value = {
    name: '',
    category: '供应商收款码',
    supplierName: '',
    channel: '二维码支付',
    accountName: '',
    accountNo: '',
    qrCodeData: '',
    summary: '',
    status: 'normal',
  }
  dialogOpen.value = true
}

async function save() {
  const missing = configFields.value.find((field) => field.required && !String(form.value[field.field] ?? '').trim())
  if (missing) return ElMessage.warning(`请填写${missing.label}`)
  const payload = { ...form.value }
  payload.category = '供应商收款码'
  payload.channel = '二维码支付'
  payload.name = `${String(payload.supplierName)}收款码`
  payload.summary ||= `${String(payload.accountName)} · 二维码收款`
  const response = editing.value
    ? await mockService.update(moduleKey, editing.value.id, payload)
    : await mockService.create(moduleKey, { ...payload, code: `QR-${Date.now().toString().slice(-10)}` })
  if (response.code !== 200) return ElMessage.error(response.msg)
  dialogOpen.value = false
  ElMessage.success(editing.value ? '配置已保存并写入操作日志' : '供应商收款码已新增')
  await load()
}

function selectQrFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return ElMessage.error('二维码仅支持 PNG、JPG 或 WebP 图片')
  if (file.size > 2 * 1024 * 1024) return ElMessage.error('二维码图片不能超过 2 MB')
  const reader = new FileReader()
  reader.onload = () => {
    form.value.qrCodeData = String(reader.result || '')
    ElMessage.success('二维码图片已读取，请保存配置')
  }
  reader.onerror = () => ElMessage.error('二维码图片读取失败')
  reader.readAsDataURL(file)
}

async function toggle(record: EntityRecord) {
  await mockService.action(moduleKey, record.id, 'toggle', '供应商收款码启停')
  ElMessage.success(record.status === 'disabled' ? '配置已启用' : '配置已停用')
  await load()
}

async function exportCurrent() {
  const response = await mockService.exportRows(moduleKey, { pageNum: 1, pageSize: 100, tab: activeTab.value, filters: { category: '供应商收款码' } })
  if (response.code !== 200) return ElMessage.error(response.msg)
  await exportRecords(`${page.title}-${page.tabs.find((item) => item.key === activeTab.value)?.label}`, response.data)
  ElMessage.success(`已导出 ${response.data.length} 条当前配置`)
}

function prototypeEvent(event: Event) {
  const { action } = (event as CustomEvent<{ action?: string }>).detail || {}
  if (action?.includes('edit') || action?.includes('config')) {
    if (visibleRecords.value[0]) edit(visibleRecords.value[0])
  }
}

onMounted(() => { load(); window.addEventListener('prototype-open', prototypeEvent) })
onBeforeUnmount(() => window.removeEventListener('prototype-open', prototypeEvent))
</script>

<template>
  <section class="module-page config-page">
    <header class="page-heading">
      <div><div class="eyebrow">{{ page.eyebrow }}</div><h1>{{ page.title }}</h1><p>{{ page.description }}</p></div>
      <div class="heading-actions">
        <el-button v-if="canExport" @click="exportCurrent"><AppIcon name="download" :size="16" />导出当前配置</el-button>
        <el-button v-if="canCreate" type="primary" @click="createSupplierQr"><AppIcon name="plus" :size="16" />新增收款码</el-button>
      </div>
    </header>
    <div v-loading="loading" class="page-panel config-panel">
      <el-tabs v-model="activeTab" class="module-tabs"><el-tab-pane v-for="tab in page.tabs" :key="tab.key" :label="tab.label" :name="tab.key" /></el-tabs>
      <div class="config-toolbar"><div><strong>{{ page.tabs.find((item) => item.key === activeTab)?.label }}</strong><p>为不同供应商维护独立收款二维码，停用后不再提供给订单选择。</p></div><span class="status-chip" data-tone="success"><i></i>配置服务正常</span></div>
      <div class="config-list">
        <article v-for="record in visibleRecords" :key="record.id" class="config-row">
          <span class="qr-thumbnail"><img v-if="record.qrCodeData" :src="String(record.qrCodeData)" :alt="`${record.supplierName}收款二维码`"><AppIcon v-else name="scan-line" :size="24" /></span>
          <div><strong>{{ record.name }}</strong><p>{{ record.summary }}</p><small>{{ record.accountName || '未填写户名' }} · {{ record.accountNo || '未填写账号' }} · 更新于 {{ record.updatedAt }}</small></div>
          <el-switch :model-value="record.status !== 'disabled'" @change="toggle(record)" />
          <el-button link type="primary" @click="edit(record)">编辑</el-button>
        </article>
        <div v-if="!visibleRecords.length" class="empty-state"><AppIcon name="inbox" :size="34" /><strong>暂无供应商收款码</strong><p>新增供应商并上传对应的收款二维码。</p></div>
      </div>
    </div>
    <el-dialog v-model="dialogOpen" :title="editing ? '编辑供应商收款码' : '新增供应商收款码'" width="620px" align-center append-to-body class="entity-dialog">
      <div class="impact-callout info"><AppIcon name="shield-check" :size="22" /><div><strong>收款码配置提示</strong><p>普通用户付款时将看到对应供应商的二维码，请确认收款户名和图片准确无误。</p></div></div>
      <el-form label-position="top" class="entity-form">
        <el-form-item v-for="field in configFields" :key="field.field" :label="field.label" :required="field.required" :class="{ 'span-two': field.type === 'textarea' }">
          <el-input v-if="field.type === 'text'" v-model="form[field.field]" :placeholder="`请输入${field.label}`" />
          <el-input v-else-if="field.type === 'textarea'" v-model="form[field.field]" type="textarea" :rows="4" maxlength="300" show-word-limit />
          <el-select v-else-if="field.type === 'select'" v-model="form[field.field]" :filterable="field.allowCreate" :allow-create="field.allowCreate" default-first-option style="width: 100%"><el-option v-for="option in field.options" :key="option" :label="option" :value="option" /></el-select>
          <div v-else class="qr-uploader">
            <img v-if="form[field.field]" :src="String(form[field.field])" alt="收款二维码预览">
            <div v-else><AppIcon name="scan-line" :size="34" /><strong>上传收款二维码</strong><small>PNG/JPG/WebP，最大 2 MB</small></div>
            <label class="el-button"><input type="file" accept="image/png,image/jpeg,image/webp" hidden @change="selectQrFile">选择图片</label>
          </div>
        </el-form-item>
        <el-form-item label="启用状态"><el-switch v-model="form.status" active-value="normal" inactive-value="disabled" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" @click="save">保存配置</el-button></template>
    </el-dialog>
  </section>
</template>
