import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { hasPermission } from '@/config/permissions'
import { useAuthStore } from '@/stores/auth'
import { useDatabaseStore } from '@/stores/database'

describe('authentication and permissions', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('locks an account after five failed attempts', () => {
    const auth = useAuthStore()
    for (let attempt = 1; attempt <= 4; attempt += 1) expect(() => auth.login('admin@shark.cn', 'wrong')).toThrow(`还可尝试 ${5 - attempt} 次`)
    expect(() => auth.login('admin@shark.cn', 'wrong')).toThrow('锁定 30 分钟')
    expect(() => auth.login('admin@shark.cn', 'Admin123!')).toThrow('账号已锁定')
  })

  it('loads role permissions and completes first login', () => {
    const auth = useAuthStore()
    const session = auth.login('tier2@dealer.cn', 'Dealer123!')
    expect(session.firstLogin).toBe(true)
    expect(hasPermission(auth.permissions, 'projects:view')).toBe(true)
    expect(hasPermission(auth.permissions, 'projects:edit')).toBe(true)
    expect(hasPermission(auth.permissions, 'admins:view')).toBe(false)
    auth.completeFirstLogin()
    expect(auth.session?.firstLogin).toBe(false)
  })

  it('only lets platform accounts change the data domain', () => {
    const auth = useAuthStore()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    auth.setDomain('global')
    expect(auth.session?.domain).toBe('cn')
    auth.logout()
    auth.login('admin@shark.cn', 'Admin123!')
    expect(hasPermission(auth.permissions, 'dashboard:view')).toBe(true)
    expect(hasPermission(auth.permissions, 'admins:view')).toBe(true)
    auth.setDomain('global')
    expect(auth.session?.domain).toBe('global')
  })

  it('loads permissions from the saved role and refreshes the active session', () => {
    const auth = useAuthStore()
    const database = useDatabaseStore()
    auth.login('tier2@dealer.cn', 'Dealer123!')
    const roleId = auth.session!.roleId
    database.update('roles', roleId, { permissions: ['dashboard:view', 'devices:view'], permissionCount: 2 })
    auth.refreshSession()
    expect(auth.permissions).toEqual(['dashboard:view', 'devices:view'])
    expect(hasPermission(auth.permissions, 'projects:edit')).toBe(false)
  })

  it('persists the password chosen during first-login setup', () => {
    const auth = useAuthStore()
    auth.login('tier2@dealer.cn', 'Dealer123!')
    auth.completeFirstLogin('NewDealer123!')
    auth.logout()
    expect(auth.login('tier2@dealer.cn', 'NewDealer123!').firstLogin).toBe(false)
  })
})
