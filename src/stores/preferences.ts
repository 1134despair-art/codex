import { defineStore } from 'pinia'

export const PREFERENCES_KEY = 'shark-sister-admin.prefs.v1'
const DEFAULT_EXPANDED_GROUPS = ['工作台', '审批中心', '客户与渠道', '设备与产品', '采购管理', '仓储管理', '服务与售后', '财务与支付', '内容运营', '系统管理']

interface Preferences {
  collapsed: boolean
  pageSize: number
  expandedGroups: string[]
  navigationCustomized: boolean
}

function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}') as Partial<Preferences>
    return {
      collapsed: saved.collapsed ?? false,
      pageSize: saved.pageSize ?? 10,
      expandedGroups: saved.navigationCustomized ? saved.expandedGroups || [] : [...DEFAULT_EXPANDED_GROUPS],
      navigationCustomized: saved.navigationCustomized ?? false,
    }
  } catch {
    return { collapsed: false, pageSize: 10, expandedGroups: [...DEFAULT_EXPANDED_GROUPS], navigationCustomized: false }
  }
}

export const usePreferencesStore = defineStore('preferences', {
  state: () => readPreferences(),
  actions: {
    persist() {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ collapsed: this.collapsed, pageSize: this.pageSize, expandedGroups: this.expandedGroups, navigationCustomized: this.navigationCustomized }))
    },
    setCollapsed(value: boolean) {
      this.collapsed = value
      this.persist()
    },
    setPageSize(value: number) {
      this.pageSize = value
      this.persist()
    },
    setExpandedGroups(value: string[]) {
      this.expandedGroups = value
      this.navigationCustomized = true
      this.persist()
    },
  },
})
