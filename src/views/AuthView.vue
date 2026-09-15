<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ mode: 'login' | 'first-password' }>()
const router = useRouter()
const auth = useAuthStore()
const loading = ref(false)
const captcha = ref('7K4P')
const captchaExpiresAt = ref(Date.now() + 5 * 60 * 1000)
const form = reactive({ account: 'admin@shark.cn', password: 'Admin123!', captcha: '7K4P', confirmPassword: '' })
const title = computed(() => props.mode === 'login' ? '登录运营管理后台' : '首次登录修改密码')
const lead = computed(() => props.mode === 'login' ? '使用管理员或经销商账号登录。连续输错 5 次将锁定 30 分钟。' : '首次登录必须设置新密码后才能进入后台。')

function refreshCaptcha() {
  captcha.value = Math.random().toString(36).slice(2, 6).toUpperCase()
  captchaExpiresAt.value = Date.now() + 5 * 60 * 1000
  form.captcha = ''
}

async function submit() {
  loading.value = true
  try {
    if (props.mode === 'login') {
      if (form.account.trim().length < 4 || form.account.trim().length > 20) throw new Error('账号长度应为 4-20 位。')
      if (form.password.length < 6 || form.password.length > 20) throw new Error('密码长度应为 6-20 位。')
      if (Date.now() > captchaExpiresAt.value) { auth.recordLoginFailure(form.account, '验证码已过期'); throw new Error('图形验证码已过期，请刷新后重试。') }
      if (form.captcha.toUpperCase() !== captcha.value) { auth.recordLoginFailure(form.account, '验证码错误'); throw new Error('图形验证码不正确。') }
      const session = auth.login(form.account.trim(), form.password)
      await router.push(session.firstLogin ? '/first-password' : '/dashboard')
    } else {
      if (form.password.length < 8 || form.password !== form.confirmPassword) throw new Error('新密码至少 8 位，且两次输入必须一致。')
      auth.completeFirstLogin(form.password)
      ElMessage.success('密码已更新')
      await router.push('/dashboard')
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
    if (props.mode === 'login') refreshCaptcha()
  } finally { loading.value = false }
}

onMounted(() => {
  if (props.mode === 'first-password') {
    form.password = ''
    if (!auth.session) router.replace('/login')
  }
})
</script>

<template>
  <main class="auth-shell">
    <section class="auth-visual" aria-label="鲨鱼妹妹海上设备运维场景">
      <img :src="'./assets/backgrounds/auth-marine-operations.png'" alt="搭载海水处理设备的海上作业船">
      <div class="auth-visual-content">
        <div class="auth-brand"><span class="brand-mark"><AppIcon name="waves" :size="20" /></span><div><strong>鲨鱼妹妹</strong><small>Marine Equipment Operations</small></div></div>
        <div class="auth-story">
          <div class="auth-story-kicker">EQUIPMENT LIFECYCLE / 设备全生命周期</div>
          <h1>让每一台海上设备，都有清晰的归属与责任链。</h1>
          <p>从出库、激活到售后与固件升级，在同一数据域内追踪设备状态、经销商协作和服务结果。</p>
          <div class="route-line"><span>设备入库</span><span>渠道交付</span><span>用户激活</span><span>售后服务</span></div>
        </div>
        <div class="auth-visual-foot"><span>国内数据域 · Asia/Shanghai</span><span>服务状态正常</span></div>
      </div>
    </section>
    <section class="auth-panel">
      <div class="auth-form">
        <p class="auth-kicker">ADMIN OPERATIONS / 国内数据域</p>
        <h2>{{ title }}</h2><p class="auth-lead">{{ lead }}</p>
        <el-form label-position="top" @submit.prevent="submit">
          <template v-if="mode === 'first-password'">
            <el-form-item label="新密码"><el-input v-model="form.password" type="password" show-password /></el-form-item>
            <el-form-item label="确认新密码"><el-input v-model="form.confirmPassword" type="password" show-password /></el-form-item>
          </template>
          <template v-else>
            <el-form-item label="账号"><el-input v-model="form.account"><template #prefix><AppIcon name="user-round" /></template></el-input></el-form-item>
            <el-form-item label="密码"><el-input v-model="form.password" type="password" show-password><template #prefix><AppIcon name="lock-keyhole" /></template></el-input></el-form-item>
            <el-form-item><template #label><div class="label-row"><span>图形验证码</span><button type="button" class="text-action" @click="refreshCaptcha">点击刷新</button></div></template><div class="captcha-row"><el-input v-model="form.captcha" maxlength="4" /><button type="button" class="captcha" @click="refreshCaptcha">{{ captcha }}</button></div></el-form-item>
            <el-checkbox checked>在此设备保持登录 7 天，公共电脑请勿勾选。</el-checkbox>
          </template>
          <el-button class="auth-submit" type="primary" :loading="loading" native-type="submit">{{ mode === 'login' ? '登录后台' : '保存并进入后台' }} <AppIcon name="arrow-right" /></el-button>
        </el-form>
        <p v-if="mode !== 'login'" class="auth-link"><RouterLink to="/login">返回登录</RouterLink></p>
      </div>
    </section>
  </main>
</template>
