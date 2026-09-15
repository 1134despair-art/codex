<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, type UploadFile } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import { hasPermission } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'
import type { EntityRecord } from '@/types'

interface OnboardingPage {
  id: string
  title: string
  summary: string
  image: string
  durationMs: number
}

interface LaunchConfigForm {
  enabled: boolean
  onboardingEnabled: boolean
  onboardingRevision: string
  onboardingPages: OnboardingPage[]
  revision: string
  title: string
  titleEn: string
  subtitle: string
  subtitleEn: string
  backgroundImage: string
  logoImage: string
  durationMs: number
  allowSkip: boolean
}

const DEFAULT_BACKGROUND = './assets/backgrounds/launch-screen.png'
const DEFAULT_LOGO = './assets/backgrounds/launch-logo.png'
const database = useDatabaseStore()
const auth = useAuthStore()
const saving = ref(false)
const previewMode = ref<'splash' | 'onboarding'>('splash')
const previewPageIndex = ref(0)
const backgroundInput = ref<HTMLInputElement | null>(null)
const logoInput = ref<HTMLInputElement | null>(null)
const current = ref<EntityRecord | null>(null)
const form = ref<LaunchConfigForm>({
  enabled: true,
  onboardingEnabled: true,
  onboardingRevision: 'onboarding-v1',
  onboardingPages: [
    { id: 'onboarding-device', title: '连接设备', summary: '快速完成设备绑定并查看运行状态。', image: DEFAULT_BACKGROUND, durationMs: 2200 },
    { id: 'onboarding-service', title: '管理设备全生命周期', summary: '安装、质保、报修和费用记录始终可追溯。', image: DEFAULT_BACKGROUND, durationMs: 2200 },
    { id: 'onboarding-waypoint', title: '决定航点保存位置', summary: '首次绑定时选择本地或服务器，后续可在设置中修改。', image: DEFAULT_BACKGROUND, durationMs: 2400 },
  ],
  revision: 'v3.2-default',
  title: '鲨鱼妹妹',
  titleEn: 'Shark Sister',
  subtitle: '连接海上设备，掌握每一次运行状态',
  subtitleEn: 'Connected control for every journey',
  backgroundImage: DEFAULT_BACKGROUND,
  logoImage: DEFAULT_LOGO,
  durationMs: 1800,
  allowSkip: true,
})

const previewDuration = computed(() => `${(form.value.durationMs / 1000).toFixed(1)} 秒`)
const activeOnboardingPage = computed(() => form.value.onboardingPages[previewPageIndex.value] || form.value.onboardingPages[0])
const onboardingPreviewDuration = computed(() => `${((activeOnboardingPage.value?.durationMs || 0) / 1000).toFixed(1)} 秒`)
const canExport = computed(() => hasPermission(auth.permissions, 'launch-settings:export'))

onMounted(load)

function load() {
  current.value = database.records('launch-settings')[0] || null
  if (!current.value) return
  const storedPages = Array.isArray(current.value.onboardingPages) ? current.value.onboardingPages as Array<Record<string, unknown>> : []
  const onboardingPages = storedPages.length ? storedPages.map((page, index) => ({
    id: String(page.id || `onboarding-${index + 1}`),
    title: String(page.title || `引导页 ${index + 1}`),
    summary: String(page.summary || ''),
    image: String(page.image || current.value?.backgroundImage || DEFAULT_BACKGROUND),
    durationMs: Number(page.durationMs || 2200),
  })) : [{ id: 'onboarding-1', title: String(current.value.onboardingTitle || '连接设备'), summary: String(current.value.onboardingSummary || ''), image: String(current.value.backgroundImage || DEFAULT_BACKGROUND), durationMs: 2200 }]
  form.value = {
    enabled: current.value.enabled !== false,
    onboardingEnabled: current.value.onboardingEnabled !== false,
    onboardingRevision: String(current.value.onboardingRevision || 'onboarding-v1'),
    onboardingPages,
    revision: String(current.value.revision || 'v3.2-default'),
    title: String(current.value.title || '鲨鱼妹妹'),
    titleEn: String(current.value.titleEn || 'Shark Sister'),
    subtitle: String(current.value.subtitle || ''),
    subtitleEn: String(current.value.subtitleEn || ''),
    backgroundImage: String(current.value.backgroundImage || DEFAULT_BACKGROUND),
    logoImage: String(current.value.logoImage || DEFAULT_LOGO),
    durationMs: Number(current.value.durationMs || 1800),
    allowSkip: current.value.allowSkip !== false,
  }
}

async function save() {
  if (!form.value.revision.trim()) return ElMessage.warning('请填写配置版本号')
  if (!form.value.title.trim() || !form.value.titleEn.trim()) return ElMessage.warning('请填写中英文应用名称')
  if (!form.value.backgroundImage || !form.value.logoImage) return ElMessage.warning('请上传启动页背景和品牌标识')
  if (form.value.onboardingEnabled && !form.value.onboardingRevision.trim()) return ElMessage.warning('请填写引导内容版本')
  if (form.value.onboardingEnabled && !form.value.onboardingPages.length) return ElMessage.warning('首次引导至少需要一页内容')
  if (form.value.onboardingPages.some((page) => !page.title.trim() || !page.summary.trim())) return ElMessage.warning('请补齐每一页的标题和说明')
  saving.value = true
  const payload = {
    ...form.value,
    onboardingTitle: form.value.onboardingPages[0]?.title || '',
    onboardingSummary: form.value.onboardingPages[0]?.summary || '',
    name: 'APP 启动页', category: '客户端配置', status: form.value.enabled ? 'normal' : 'disabled',
  }
  current.value = current.value
    ? database.update('launch-settings', current.value.id, payload) || current.value
    : database.create('launch-settings', payload)
  database.audit('编辑启动页配置', `${form.value.revision} · ${previewDuration.value}`, auth.session?.displayName || '平台管理员', false, current.value)
  saving.value = false
  ElMessage.success('启动页配置已保存')
}

function addOnboardingPage() {
  form.value.onboardingPages.push({ id: `onboarding-${Date.now().toString(36)}`, title: '', summary: '', image: DEFAULT_BACKGROUND, durationMs: 2200 })
  previewPageIndex.value = form.value.onboardingPages.length - 1
  previewMode.value = 'onboarding'
}

function removeOnboardingPage(index: number) {
  if (form.value.onboardingPages.length === 1) return ElMessage.warning('首次引导至少保留一页')
  form.value.onboardingPages.splice(index, 1)
  previewPageIndex.value = Math.min(previewPageIndex.value, form.value.onboardingPages.length - 1)
}

function moveOnboardingPage(index: number, offset: -1 | 1) {
  const target = index + offset
  if (target < 0 || target >= form.value.onboardingPages.length) return
  const [page] = form.value.onboardingPages.splice(index, 1)
  form.value.onboardingPages.splice(target, 0, page)
  previewPageIndex.value = target
}

async function onOnboardingImage(index: number, upload: UploadFile) {
  if (!upload.raw) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(upload.raw.type)) return ElMessage.warning('引导页图片仅支持 PNG、JPG 或 WebP')
  if (upload.raw.size > 5 * 1024 * 1024) return ElMessage.warning('引导页图片不能超过 5MB')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(upload.raw!)
  }).catch(() => '')
  if (dataUrl) form.value.onboardingPages[index].image = dataUrl
}

function chooseImage(target: 'background' | 'logo') {
  if (target === 'background') backgroundInput.value?.click()
  else logoInput.value?.click()
}

function readImage(event: Event, target: 'background' | 'logo') {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg'].includes(file.type)) return ElMessage.warning('仅支持 PNG 或 JPG 图片')
  if (file.size > 5 * 1024 * 1024) return ElMessage.warning('图片大小不能超过 5MB')
  const reader = new FileReader()
  reader.onload = () => {
    if (target === 'background') form.value.backgroundImage = String(reader.result || '')
    else form.value.logoImage = String(reader.result || '')
  }
  reader.readAsDataURL(file)
}

function restoreAsset(target: 'background' | 'logo') {
  if (target === 'background') form.value.backgroundImage = DEFAULT_BACKGROUND
  else form.value.logoImage = DEFAULT_LOGO
}

function exportConfig() {
  if (!canExport.value) return ElMessage.error('无权导出启动页配置')
  const payload = JSON.stringify(form.value, null, 2)
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `launch-screen-${form.value.revision || 'config'}.json`
  link.click()
  URL.revokeObjectURL(url)
  ElMessage.success('启动页配置 JSON 已导出')
}
</script>

<template>
  <section class="module-page launch-config-page">
    <header class="page-heading">
      <div><div class="eyebrow">系统管理</div><h1>APP 启动页</h1><p>分别配置每次启动的短时品牌画面，以及仅首次安装展示的产品引导页。</p></div>
      <div class="heading-actions"><el-button v-if="canExport" @click="exportConfig"><AppIcon name="download" :size="16" />导出配置 JSON</el-button><el-button type="primary" :loading="saving" @click="save"><AppIcon name="save" :size="16" />保存配置</el-button></div>
    </header>

    <div class="page-panel launch-config-panel">
      <div class="config-editor">
        <div class="config-status"><div><span class="status-chip" :data-tone="form.enabled ? 'success' : 'neutral'"><i />{{ form.enabled ? '当前启用' : '当前停用' }}</span><strong>{{ form.revision || '未设置版本' }}</strong></div><p>APP 配置地址返回导出的 JSON 结构即可生效。</p></div>

        <el-form label-position="top" class="launch-form">
          <div class="form-section">
            <div class="section-heading"><strong>展示规则</strong><span>版本变化后重新展示一次</span></div>
            <div class="field-grid">
              <el-form-item label="配置版本号" required><el-input v-model="form.revision" maxlength="40" placeholder="例如 v3.2-launch-02" /></el-form-item>
              <el-form-item label="展示时长"><el-input-number v-model="form.durationMs" :min="800" :max="5000" :step="100" controls-position="right" /></el-form-item>
              <el-form-item label="启用启动页"><el-switch v-model="form.enabled" /></el-form-item>
              <el-form-item label="允许跳过"><el-switch v-model="form.allowSkip" /></el-form-item>
            </div>
          </div>

          <div class="form-section">
            <div class="section-heading"><strong>中英文案</strong><span>标题保持简短，副标题不超过两行</span></div>
            <div class="field-grid">
              <el-form-item label="中文应用名" required><el-input v-model="form.title" maxlength="20" show-word-limit /></el-form-item>
              <el-form-item label="英文应用名" required><el-input v-model="form.titleEn" maxlength="30" show-word-limit /></el-form-item>
              <el-form-item label="中文副标题"><el-input v-model="form.subtitle" maxlength="40" show-word-limit /></el-form-item>
              <el-form-item label="英文副标题"><el-input v-model="form.subtitleEn" maxlength="70" show-word-limit /></el-form-item>
            </div>
          </div>

          <div class="form-section">
            <div class="section-heading"><strong>首次安装引导</strong><span>页数、顺序、文案和停留时间独立配置</span></div>
            <div class="field-grid">
              <el-form-item label="启用首次引导"><el-switch v-model="form.onboardingEnabled" /></el-form-item>
              <el-form-item label="引导内容版本" required><el-input v-model="form.onboardingRevision" maxlength="40" placeholder="例如 onboarding-v2" /></el-form-item>
            </div>
            <div class="onboarding-page-list">
              <article v-for="(page, index) in form.onboardingPages" :key="page.id" class="onboarding-page-item" :class="{ active: previewMode === 'onboarding' && previewPageIndex === index }" @click="previewMode = 'onboarding'; previewPageIndex = index">
                <div class="onboarding-page-order"><strong>{{ index + 1 }}</strong><span>第 {{ index + 1 }} 页</span></div>
                <div class="onboarding-page-fields">
                  <el-input v-model="page.title" maxlength="30" show-word-limit placeholder="引导页标题" @click.stop />
                  <el-input v-model="page.summary" type="textarea" :rows="2" maxlength="100" show-word-limit placeholder="说明用户在这一页能了解什么" @click.stop />
                  <div class="onboarding-page-meta">
                    <el-input-number v-model="page.durationMs" :min="800" :max="10000" :step="100" controls-position="right" aria-label="停留时间" @click.stop />
                    <span>毫秒</span>
                    <el-upload action="#" :auto-upload="false" :show-file-list="false" accept="image/png,image/jpeg,image/webp" :on-change="(upload: UploadFile) => onOnboardingImage(index, upload)" @click.stop><el-button size="small"><AppIcon name="image-up" :size="15" />更换图片</el-button></el-upload>
                  </div>
                </div>
                <img :src="page.image || form.backgroundImage" alt="引导页图片预览">
                <div class="onboarding-page-actions">
                  <el-button text title="上移" :disabled="index === 0" @click.stop="moveOnboardingPage(index, -1)"><AppIcon name="chevron-left" :size="15" /></el-button>
                  <el-button text title="下移" :disabled="index === form.onboardingPages.length - 1" @click.stop="moveOnboardingPage(index, 1)"><AppIcon name="chevron-right" :size="15" /></el-button>
                  <el-button text title="删除" :disabled="form.onboardingPages.length === 1" @click.stop="removeOnboardingPage(index)"><AppIcon name="trash-2" :size="15" /></el-button>
                </div>
              </article>
              <el-button class="add-onboarding-page" @click="addOnboardingPage"><AppIcon name="plus" :size="16" />添加引导页</el-button>
            </div>
          </div>

          <div class="form-section">
            <div class="section-heading"><strong>图片素材</strong><span>PNG/JPG，单张不超过 5MB</span></div>
            <div class="asset-fields">
              <div class="asset-field"><img :src="form.backgroundImage" alt="启动页背景预览"><div><strong>启动页背景</strong><p>建议 390 × 844 或同等比例</p><el-button size="small" @click="chooseImage('background')">更换图片</el-button><el-button size="small" link @click="restoreAsset('background')">恢复默认</el-button></div></div>
              <div class="asset-field"><img class="logo-asset" :src="form.logoImage" alt="品牌标识预览"><div><strong>品牌标识</strong><p>建议透明 PNG，正方形画布</p><el-button size="small" @click="chooseImage('logo')">更换图片</el-button><el-button size="small" link @click="restoreAsset('logo')">恢复默认</el-button></div></div>
            </div>
          </div>
        </el-form>
        <input ref="backgroundInput" class="file-input" type="file" accept="image/png,image/jpeg" @change="readImage($event, 'background')">
        <input ref="logoInput" class="file-input" type="file" accept="image/png,image/jpeg" @change="readImage($event, 'logo')">
      </div>

      <aside class="launch-preview-wrap" aria-label="启动页实时预览">
        <div class="preview-heading"><div><strong>实时预览</strong><span>390 × 844</span></div><span>{{ previewMode === 'splash' ? previewDuration : onboardingPreviewDuration }}</span></div>
        <el-radio-group v-model="previewMode" size="small" class="preview-mode"><el-radio-button value="splash">启动画面</el-radio-button><el-radio-button value="onboarding">首次引导</el-radio-button></el-radio-group>
        <div class="launch-preview">
          <img class="preview-background" :src="previewMode === 'splash' ? form.backgroundImage : activeOnboardingPage?.image || form.backgroundImage" alt="">
          <div class="preview-status"><b>9:41</b><span>▮▮▮⌁ ▰</span></div>
          <span v-if="form.allowSkip" class="preview-skip">跳过</span>
          <div class="preview-content"><img :src="form.logoImage" alt=""><strong>{{ previewMode === 'splash' ? form.title : activeOnboardingPage?.title }}</strong><p>{{ previewMode === 'splash' ? form.subtitle : activeOnboardingPage?.summary }}</p></div>
          <div v-if="previewMode === 'onboarding'" class="preview-progress"><i v-for="(_, index) in form.onboardingPages" :key="index" :class="{ active: index === previewPageIndex }" @click="previewPageIndex = index" /></div>
          <div v-if="previewMode === 'splash' ? !form.enabled : !form.onboardingEnabled" class="preview-disabled"><AppIcon name="circle-x" :size="22" /><span>{{ previewMode === 'splash' ? '启动画面已停用' : '首次引导已停用' }}</span></div>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.preview-mode{display:flex;margin:-6px 0 14px}.preview-mode :deep(.el-radio-button){flex:1}.preview-mode :deep(.el-radio-button__inner){width:100%}
.heading-actions{display:flex;align-items:center;gap:10px}.heading-actions .el-button{gap:7px}.launch-config-panel{display:grid;grid-template-columns:minmax(0,1fr) 356px;min-height:680px;padding:0;overflow:hidden}.config-editor{padding:24px 28px 34px}.config-status{display:flex;align-items:center;justify-content:space-between;padding-bottom:20px;border-bottom:1px solid var(--border-color,#e3e9f2)}.config-status>div{display:flex;align-items:center;gap:12px}.config-status strong{font-size:14px}.config-status p{margin:0;color:var(--text-secondary,#64748b);font-size:13px}.form-section{padding:23px 0 8px;border-bottom:1px solid var(--border-color,#e3e9f2)}.form-section:last-child{border-bottom:0}.section-heading{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:18px}.section-heading strong{font-size:15px}.section-heading span{color:var(--text-secondary,#64748b);font-size:12px}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}.field-grid :deep(.el-input-number){width:100%}.onboarding-page-list{display:grid;gap:10px;margin:4px 0 14px}.onboarding-page-item{display:grid;grid-template-columns:58px minmax(0,1fr) 92px 34px;align-items:start;gap:12px;padding:12px;border:1px solid var(--border-color,#e3e9f2);border-radius:6px;background:#f8fafc;cursor:pointer}.onboarding-page-item.active{border-color:#8bb5ff;box-shadow:0 0 0 2px rgba(36,105,224,.08)}.onboarding-page-order{display:flex;align-items:center;flex-direction:column;gap:3px;padding-top:4px}.onboarding-page-order strong{display:grid;width:28px;height:28px;place-items:center;color:#2469e0;background:#eaf2ff;border-radius:50%;font-size:13px}.onboarding-page-order span{color:#64748b;font-size:12px}.onboarding-page-fields{display:grid;gap:8px}.onboarding-page-meta{display:flex;align-items:center;gap:7px}.onboarding-page-meta :deep(.el-input-number){width:132px}.onboarding-page-meta>span{color:#64748b;font-size:12px}.onboarding-page-item>img{width:92px;height:112px;object-fit:cover;border:1px solid #dbe4ef;border-radius:5px;background:#eef4ff}.onboarding-page-actions{display:flex;align-items:center;flex-direction:column}.onboarding-page-actions .el-button+.el-button{margin-left:0}.add-onboarding-page{width:100%}.asset-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.asset-field{display:flex;min-height:112px;align-items:center;gap:14px;padding:14px;border:1px solid var(--border-color,#e3e9f2);border-radius:6px;background:#f8fafc}.asset-field>img{width:72px;height:84px;flex:0 0 auto;object-fit:cover;border:1px solid #dbe4ef;border-radius:5px;background:#eef4ff}.asset-field>img.logo-asset{height:72px;object-fit:contain}.asset-field strong,.asset-field p{display:block}.asset-field p{margin:5px 0 9px;color:var(--text-secondary,#64748b);font-size:12px}.asset-field .el-button+.el-button{margin-left:5px}.file-input{display:none}.launch-preview-wrap{padding:24px 28px 30px;border-left:1px solid var(--border-color,#e3e9f2);background:#eef3f9}.preview-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}.preview-heading>div{display:flex;align-items:baseline;gap:9px}.preview-heading strong{font-size:15px}.preview-heading span{color:var(--text-secondary,#64748b);font-size:12px}.launch-preview{position:relative;width:300px;aspect-ratio:390/844;overflow:hidden;border:8px solid #111827;border-radius:34px;background:#f7f9fc;box-shadow:0 18px 42px rgba(36,68,112,.18)}.preview-background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.preview-status{position:absolute;z-index:2;top:9px;right:14px;left:14px;display:flex;align-items:center;justify-content:space-between;color:#0f172a;font-size:9px}.preview-skip{position:absolute;z-index:2;top:27px;right:14px;display:flex;min-width:34px;height:34px;align-items:center;justify-content:center;color:#64748b;background:rgba(255,255,255,.84);border:1px solid #fff;border-radius:20px;font-size:10px}.preview-content{position:absolute;z-index:2;top:43%;right:25px;left:25px;display:flex;align-items:center;flex-direction:column;transform:translateY(-50%);text-align:center}.preview-content img{width:64px;height:64px;object-fit:contain;filter:drop-shadow(0 8px 14px rgba(36,105,224,.18))}.preview-content strong{margin-top:15px;color:#0f172a;font-size:21px}.preview-content p{margin:5px 0 0;color:#64748b;font-size:10px;line-height:1.5}.preview-progress{position:absolute;z-index:2;bottom:22px;left:50%;display:flex;gap:5px;transform:translateX(-50%)}.preview-progress i{width:5px;height:5px;background:#2469e0;border-radius:50%;cursor:pointer;opacity:.35}.preview-progress i.active{width:16px;border-radius:4px;opacity:1}.preview-disabled{position:absolute;z-index:4;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;color:#fff;background:rgba(15,23,42,.64);font-size:14px;font-weight:600}.status-chip[data-tone="neutral"]{color:#64748b;background:#eef2f7}@media(max-width:1100px){.launch-config-panel{grid-template-columns:1fr}.launch-preview-wrap{display:flex;align-items:center;flex-direction:column;border-top:1px solid var(--border-color,#e3e9f2);border-left:0}.preview-heading{width:300px}}@media(max-width:760px){.page-heading{align-items:flex-start;flex-direction:column}.heading-actions{width:100%}.heading-actions .el-button{flex:1}.config-editor{padding:20px}.field-grid,.asset-fields{grid-template-columns:1fr}.config-status{align-items:flex-start;flex-direction:column;gap:8px}.onboarding-page-item{grid-template-columns:44px minmax(0,1fr)}.onboarding-page-item>img{display:none}.onboarding-page-actions{grid-column:2;flex-direction:row}.launch-config-panel{min-width:0}}
</style>
