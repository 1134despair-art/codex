import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { navGroups } from '@/config/modules'
import { hasPermission } from '@/config/permissions'
import { mockService } from '@/services/mock'
import { useAuthStore } from '@/stores/auth'

const expectedMenus = {
  platform: [
    'dashboard', 'users', 'dealers', 'projects', 'installation-transfers', 'devices', 'product-catalog', 'warehouses', 'warehouse-locations', 'warehouse', 'ota',
    'repairs', 'messages', 'complaints', 'materials', 'material-catalog', 'issuance',
    'approval-center', 'couriers', 'sn-replacement', 'service-transfer', 'warranty', 'approval-flow', 'after-sales-types',
    'payments', 'payment-settings', 'banners', 'faq-documents', 'support-settings', 'launch-settings', 'app-versions', 'admins', 'roles', 'logs',
  ],
  tier1: [
    'dashboard', 'users', 'dealers', 'projects', 'devices', 'product-catalog', 'warehouse',
    'repairs', 'messages', 'complaints', 'materials', 'material-catalog', 'issuance',
    'couriers', 'sn-replacement', 'service-transfer', 'warranty', 'approval-flow', 'payments',
  ],
  tier2: [
    'dashboard', 'projects', 'devices', 'product-catalog', 'warehouse', 'repairs', 'messages', 'complaints',
    'materials', 'material-catalog', 'issuance', 'couriers', 'sn-replacement',
    'service-transfer', 'warranty', 'payments',
  ],
} as const

function visibleMenus(permissions: string[]) {
  return navGroups.flatMap((group) => group.items)
    .filter((item) => hasPermission(permissions, item.permission))
    .map((item) => item.route)
}

describe('platform and dealer demonstration permission matrix', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it.each([
    ['platform', 'admin@shark.cn', 'Admin123!'],
    ['tier1', 'tier1@dealer.cn', 'Dealer123!'],
    ['tier2', 'tier2@dealer.cn', 'Dealer123!'],
  ] as const)('shows the exact %s menu baseline', (role, account, password) => {
    const auth = useAuthStore()
    const session = auth.login(account, password)
    expect(session.role).toBe(role)
    expect(visibleMenus(auth.permissions)).toEqual(expectedMenus[role])
  })

  it('lets tier-1 dealers maintain only their own warranty rules', async () => {
    const auth = useAuthStore()
    auth.login('tier1@dealer.cn', 'Dealer123!')
    expect(hasPermission(auth.permissions, 'warranty:create')).toBe(true)
    expect(hasPermission(auth.permissions, 'warranty:edit')).toBe(true)

    const rows = (await mockService.all('warranty')).data
    const own = rows.find((item) => item.ownerId === auth.session?.ownerId)!
    const child = rows.find((item) => item.ownerId !== auth.session?.ownerId)!
    expect(mockService.canAction('warranty', own, 'edit').allowed).toBe(true)
    expect(mockService.canAction('warranty', child, 'edit')).toMatchObject({ allowed: false, code: 403 })
    expect((await mockService.update('warranty', own.id, { laborMonths: 30 })).code).toBe(200)
    expect((await mockService.update('warranty', child.id, { laborMonths: 30 })).code).toBe(403)

    const created = await mockService.create('warranty', {
      productType: '顶流机 TF-01', dealerId: auth.session!.ownerId,
      laborMonths: 18, materialMonths: 24, status: 'normal',
    })
    expect(created.code, created.msg).toBe(200)
  })

  it('keeps platform warranty access read-only and gives tier-2 its own edit scope', async () => {
    const auth = useAuthStore()
    auth.login('admin@shark.cn', 'Admin123!')
    const platformRow = (await mockService.all('warranty')).data[0]
    expect(mockService.canAction('warranty', platformRow, 'edit')).toMatchObject({ allowed: false, code: 403 })
    expect((await mockService.update('warranty', platformRow.id, { laborMonths: 48 })).code).toBe(403)

    auth.logout()
    auth.login('tier2@dealer.cn', 'Dealer123!')
    const tier2Rows = (await mockService.all('warranty')).data
    expect(tier2Rows).toHaveLength(1)
    expect(tier2Rows[0].ownerId).toBe(auth.session?.ownerId)
    expect(mockService.canAction('warranty', tier2Rows[0], 'edit').allowed).toBe(true)
  })
})
