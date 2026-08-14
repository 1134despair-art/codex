<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import { mockService } from '@/services/mock'
import type { EntityRecord } from '@/types'

interface LocalConfigField {
  field: string
  label: string
  type: 'text' | 'password' | 'textarea' | 'select' | 'switch' | 'number'
  required?: boolean
  options?: string[]
}

const route = useRoute()
const activeTab = ref('base')
const records = ref<EntityRecord[]>([])
const loading = ref(false)
const dialogOpen = ref(false)
const editing = ref<EntityRecord | null>(null)
const form = ref<Record<string, unknown>>({ name: '', category: '', summary: '', status: 'normal' })

const page = {
  eyebrow: '交易与内容', title: '支付配置', description: '维护微信、支付宝、PayPal、Apple Pay、Google Pay 五类固定支付开关及商户参数。',
  tabs: [{ key: 'channels', label: '支付开关' }, { key: 'merchant', label: '商户参数' }],
}
const moduleKey = 'payment-settings'
const categoryMap: Record<string, string> = { channels: '支付渠道', merchant: '商户配置' }
const currentCategory = computed(() => categoryMap[activeTab.value] || '')
const configFields = computed<LocalConfigField[]>(() => {
  const common: LocalConfigField[] = [{ field: 'name', label: '配置名称', type: 'text', required: true }]
  if (activeTab.value === 'channels') return []
  return [...common, { field: 'merchantId', label: '商户号', type: 'text', required: true }, { field: 'secretKey', label: '商户密钥', type: 'password' }, { field: 'currency', label: '结算币种', type: 'select', options: ['CNY', 'USD', 'GBP', 'AUD'] }, { field: 'summary', label: '结算说明', type: 'textarea', required: true }]
})
const visibleRecords = computed(() => {
  return records.value.filter((record) => record.category === currentCategory.value)
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

async function save() {
  if (!editing.value) return
  const missing = configFields.value.find((field) => field.required && !String(form.value[field.field] ?? '').trim())
  if (missing) return ElMessage.warning(`请填写${missing.label}`)
  const payload = { ...form.value }
  if (payload.secretKey) {
    payload.secretKeyMasked = `********${String(payload.secretKey).slice(-4)}`
    delete payload.secretKey
  }
  const response = await mockService.update(moduleKey, editing.value.id, payload)
  if (response.code !== 200) return ElMessage.error(response.msg)
  dialogOpen.value = false
  ElMessage.success('配置已保存并写入操作日志')
  await load()
}

async function toggle(record: EntityRecord) {
  await mockService.action(moduleKey, record.id, 'toggle', '支付渠道启停')
  ElMessage.success(record.status === 'disabled' ? '配置已启用' : '配置已停用')
  await load()
}

function prototypeEvent(event: Event) {
  const { action, tab } = (event as CustomEvent<{ action?: string; tab?: string }>).detail || {}
  if (tab && page.tabs.some((item) => item.key === tab)) activeTab.value = tab
  if (action?.includes('edit') || action?.includes('config')) {
    if (visibleRecords.value[0]) edit(visibleRecords.value[0])
  }
}

function syncRouteTab() {
  const requested = String(route.query.tab || page.tabs[0].key)
  activeTab.value = page.tabs.some((item) => item.key === requested) ? requested : page.tabs[0].key
}

watch(() => route.query.tab, syncRouteTab)
onMounted(() => { syncRouteTab(); load(); window.addEventListener('prototype-open', prototypeEvent) })
onBeforeUnmount(() => window.removeEventListener('prototype-open', prototypeEvent))
</script>

<template>
  <section class="module-page config-page">
    <header class="page-heading">
      <div><div class="eyebrow">{{ page.eyebrow }}</div><h1>{{ page.title }}</h1><p>{{ page.description }}</p></div>
    </header>
    <div v-loading="loading" class="page-panel config-panel">
      <el-tabs v-model="activeTab" class="module-tabs"><el-tab-pane v-for="tab in page.tabs" :key="tab.key" :label="tab.label" :name="tab.key" /></el-tabs>
      <div class="config-toolbar"><div><strong>{{ page.tabs.find((item) => item.key === activeTab)?.label }}</strong><p>敏感信息仅展示末四位，保存后不可查看原文。</p></div><span class="status-chip" data-tone="success"><i></i>配置服务正常</span></div>
      <div class="config-list">
        <article v-for="record in visibleRecords" :key="record.id" class="config-row">
          <span class="config-icon"><AppIcon name="wallet-cards" :size="20" /></span>
          <div><strong>{{ record.name }}</strong><p>{{ record.summary }}</p><small>{{ record.category }} · 更新于 {{ record.updatedAt }}</small></div>
          <el-switch :model-value="record.status !== 'disabled'" @change="toggle(record)" />
          <el-button v-if="activeTab === 'merchant'" link type="primary" @click="edit(record)">编辑</el-button>
        </article>
        <div v-if="!visibleRecords.length" class="empty-state"><AppIcon name="inbox" :size="34" /><strong>当前分类暂无配置</strong><p>V3.2 固定支付配置数据暂不可用。</p></div>
      </div>
    </div>
    <el-dialog v-model="dialogOpen" title="编辑商户参数" width="620px" align-center append-to-body class="entity-dialog">
      <div class="impact-callout info"><AppIcon name="shield-check" :size="22" /><div><strong>支付配置安全提示</strong><p>静态版仅保存脱敏演示字段，不会连接支付网关或存储真实密钥。</p></div></div>
      <el-form label-position="top" class="entity-form">
        <el-form-item v-for="field in configFields" :key="field.field" :label="field.label" :required="field.required" :class="{ 'span-two': field.type === 'textarea' }">
          <el-input v-if="field.type === 'text'" v-model="form[field.field]" :placeholder="`请输入${field.label}`" />
          <el-input v-else-if="field.type === 'password'" v-model="form[field.field]" type="password" show-password autocomplete="new-password" placeholder="保存后仅显示脱敏值" />
          <el-input v-else-if="field.type === 'textarea'" v-model="form[field.field]" type="textarea" :rows="4" maxlength="300" show-word-limit />
          <el-select v-else-if="field.type === 'select'" v-model="form[field.field]" style="width: 100%"><el-option v-for="option in field.options" :key="option" :label="option" :value="option" /></el-select>
          <el-switch v-else-if="field.type === 'switch'" v-model="form[field.field]" />
          <el-input-number v-else v-model="form[field.field]" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="启用状态"><el-switch v-model="form.status" active-value="normal" inactive-value="disabled" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" @click="save">保存配置</el-button></template>
    </el-dialog>
  </section>
</template>
