import { defineStore } from 'pinia'
import { useDatabaseStore } from '@/stores/database'
import type { DataDomain, DataScope, EntityRecord, RoleKey, UserSession } from '@/types'

const SESSION_KEY = 'shark-sister-admin.session.v1'

function readSession(): UserSession | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') } catch { return null }
}

function sessionFromAccount(account: EntityRecord, role: EntityRecord): UserSession {
  return {
    accountId: account.id,
    account: String(account.account),
    displayName: String(account.displayName || account.name),
    role: String(role.roleKey || account.roleKey || 'custom') as RoleKey,
    roleId: role.id,
    roleLabel: role.name,
    ownerId: account.ownerId,
    domain: account.domain,
    dataScope: String(role.dataScope || account.dataScope || 'self') as DataScope,
    permissions: Array.isArray(role.permissions) ? role.permissions.map(String) : [],
    firstLogin: Boolean(account.firstLogin),
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({ session: readSession() as UserSession | null }),
  getters: {
    isAuthenticated: (state) => Boolean(state.session),
    permissions: (state) => state.session?.permissions || [],
  },
  actions: {
    persistSession() {
      if (this.session) localStorage.setItem(SESSION_KEY, JSON.stringify(this.session))
      else localStorage.removeItem(SESSION_KEY)
    },
    resolveAccount(accountName: string) {
      return useDatabaseStore().records('auth-accounts').find((item) => item.account === accountName)
    },
    refreshSession() {
      if (!this.session) return null
      const database = useDatabaseStore()
      const account = database.records('auth-accounts').find((item) => item.id === this.session?.accountId || item.account === this.session?.account)
      if (!account || account.status === 'disabled') {
        this.logout()
        return null
      }
      const role = database.records('roles').find((item) => item.id === account.roleId)
      if (!role || role.status === 'disabled') {
        this.logout()
        return null
      }
      const selectedDomain = this.session.domain
      this.session = sessionFromAccount(account, role)
      if (this.session.role === 'platform') this.session.domain = selectedDomain
      this.persistSession()
      return this.session
    },
    login(accountName: string, password: string) {
      const database = useDatabaseStore()
      const account = this.resolveAccount(accountName)
      if (!account) {
        database.audit('登录失败', `${accountName} · 账号或密码错误`, accountName, false)
        throw new Error('账号或密码错误，还可尝试 4 次。')
      }
      const lockedUntil = Number(account.lockedUntil || 0)
      if (account.status === 'locked' && lockedUntil <= Date.now()) database.update('auth-accounts', account.id, { status: 'normal', failedAttempts: 0, lockedUntil: 0 })
      if (account.status === 'disabled') {
        database.audit('登录失败', `${accountName} · 账号已禁用`, accountName, true, account)
        throw new Error('账号已禁用，请联系平台管理员。')
      }
      if ((account.status === 'locked' || lockedUntil > Date.now()) && lockedUntil > Date.now()) {
        database.audit('登录失败', `${accountName} · 账号处于锁定状态`, accountName, true, account)
        throw new Error('账号已锁定，请在 30 分钟后重试。')
      }
      if (account.password !== password) {
        const failedAttempts = Number(account.failedAttempts || 0) + 1
        const locked = failedAttempts >= 5
        database.update('auth-accounts', account.id, {
          failedAttempts,
          status: locked ? 'locked' : account.status,
          lockedUntil: locked ? Date.now() + 30 * 60 * 1000 : 0,
        })
        database.audit('登录失败', `${accountName} · 密码错误 · 第 ${failedAttempts} 次`, accountName, locked, account)
        throw new Error(locked ? '密码连续错误 5 次，账号已锁定 30 分钟。' : `账号或密码错误，还可尝试 ${5 - failedAttempts} 次。`)
      }
      const role = database.records('roles').find((item) => item.id === account.roleId)
      if (!role || role.status === 'disabled') throw new Error('账号角色不可用，请联系平台管理员。')
      database.update('auth-accounts', account.id, { failedAttempts: 0, lockedUntil: 0, status: 'normal', lastLoginAt: new Date().toISOString() })
      this.session = sessionFromAccount(account, role)
      this.persistSession()
      database.audit('登录后台', accountName, this.session.displayName, false, account)
      return this.session
    },
    recordLoginFailure(account: string, reason: string) {
      useDatabaseStore().audit('登录失败', `${account || '未知账号'} · ${reason}`, account || '匿名用户', true)
    },
    completeFirstLogin(password?: string) {
      if (!this.session) return
      const database = useDatabaseStore()
      database.update('auth-accounts', this.session.accountId, { firstLogin: false, ...(password ? { password } : {}) })
      this.session.firstLogin = false
      this.persistSession()
      database.audit('首次登录修改密码', this.session.account, this.session.displayName, true)
    },
    setDomain(domain: DataDomain) {
      if (!this.session || this.session.role !== 'platform') return
      this.session.domain = domain
      this.persistSession()
    },
    logout() {
      if (this.session) useDatabaseStore().audit('退出登录', this.session.account, this.session.displayName)
      this.session = null
      this.persistSession()
    },
  },
})
