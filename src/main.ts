import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import '@/styles/tokens.css'
import '@/styles/app.css'
import App from './App.vue'
import router from './router'
import { hasPermission } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(ElementPlus, { locale: zhCn, size: 'default' })
app.directive('has-permi', {
  mounted(element, binding) {
    const auth = useAuthStore()
    if (!hasPermission(auth.permissions, binding.value)) element.remove()
  },
})
app.mount('#app')
