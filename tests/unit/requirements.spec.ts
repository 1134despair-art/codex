import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { moduleConfigs } from '@/config/modules'
import { actionPermission } from '@/config/permissions'
import { requirementCoverageSummary, requirementManifest } from '@/config/requirement-manifest'
import type { RequirementRecord } from '@/types'
import sourceSnapshot from '../../scripts/requirement-source-snapshot.json'

const requirements: readonly RequirementRecord[] = requirementManifest

const implementedRoutes = new Set([
  '/login', '/dashboard', '/payment-settings',
  ...Object.values(moduleConfigs).map((config) => `/${config.route}`),
])
const executableTestIds = new Set([
  'UT-AUTH-SECURITY', 'E2E-DASHBOARD-REALTIME', 'UT-USER-RELATIONS', 'UT-DEVICE-SCOPE',
  'UT-WAREHOUSE-TRANSACTION', 'UT-OTA-INDEPENDENT-TABS', 'UT-DYNAMIC-ACCOUNTS', 'E2E-PROJECT-CRUD',
  'UT-SERVICE-WORKFLOW', 'UT-MATERIAL-APPROVAL', 'UT-CONFIG-CRUD', 'UT-LOGISTICS-ISOLATION',
  'UT-SN-TRANSACTION', 'UT-SERVICE-TRANSFER', 'UT-STATIC-EXTERNAL-BOUNDARY', 'UT-READONLY-AUDIT',
  'E2E-APPROVAL-FLOW-CRUD', 'UT-MATERIAL-FULFILLMENT', 'E2E-BANNER-V32-LINK', 'E2E-ADMIN-LOGIN',
  'UT-PERMISSION-TREE', 'UT-AUDIT-LOG',
])

describe('V3.2 final Excel requirement baseline', () => {
  it('is regenerated from 筛选明细!A4:H216 with zero differences', () => {
    expect(() => execFileSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/run-coverage-generator.ps1', '--check',
    ], { cwd: process.cwd(), stdio: 'pipe' })).not.toThrow()
    expect(requirementManifest).toEqual(sourceSnapshot.records)
  }, 30_000)

  it('reports 208/208 frontend pass, five backend exemptions and 100% consistency', () => {
    expect(requirementCoverageSummary).toMatchObject({
      sourceSheet: '筛选明细', sourceRange: 'A4:H216', total: 213,
      frontend: 208, passed: 208, backendExempt: 5, failed: 0, frontendConsistency: 1,
    })
    expect(requirements.filter((item) => item.status === '通过')).toHaveLength(208)
    expect(requirements.filter((item) => item.status === '后端豁免').map((item) => item.excelRow)).toEqual([198, 199, 200, 201, 202])
    expect(requirements.filter((item) => item.status === '未通过')).toEqual([])
  })

  it('preserves all eight original Excel fields exactly for all 213 requirements', () => {
    expect(requirementManifest).toHaveLength(213)
    for (const [index, requirement] of requirementManifest.entries()) {
      expect(requirement.excelRow).toBe(index + 4)
      expect(Object.keys(requirement.source)).toEqual([
        'primaryModule', 'secondaryFeature', 'tertiaryFeature', 'fieldName',
        'fieldType', 'description', 'specialRequirement', 'logicDescription',
      ])
      expect(requirement.source).toEqual(sourceSnapshot.records[index].source)
    }
  })

  it('keeps anomalous Excel hierarchy separate from semantic routes', () => {
    expect(requirementManifest.find((item) => item.excelRow === 192)).toMatchObject({
      source: { primaryModule: 'Banner管理', secondaryFeature: '管理员账号' },
      semanticModule: '管理员账号', route: '/admins',
    })
    expect(requirementManifest.find((item) => item.excelRow === 196)).toMatchObject({ semanticModule: '操作日志', route: '/logs' })
    expect(requirementManifest.find((item) => item.excelRow === 203)).toMatchObject({ semanticModule: '投诉管理', route: '/complaints' })
  })

  it.each(requirementManifest)('$id has route, evidence and an executable acceptance registration', (requirement) => {
    expect(requirement.id).toMatch(/^REQ-[A-Z]+-\d{3}$/)
    expect(requirement.pageLocation.length).toBeGreaterThan(0)
    expect(requirement.interaction.length).toBeGreaterThan(0)
    expect(requirement.simulationBoundary.length).toBeGreaterThan(0)
    expect(requirement.evidence.length).toBeGreaterThan(0)
    if (requirement.status === '后端豁免') {
      expect(requirement.route).toBe('-')
      expect(requirement.permission).toBe('后端豁免')
      expect(requirement.testId).toBe('BOUNDARY-INFRASTRUCTURE')
    } else {
      expect(implementedRoutes.has(requirement.route)).toBe(true)
      expect(executableTestIds.has(requirement.testId)).toBe(true)
    }
  })

  it('aligns visible status labels, sensitive accounts and remote action permissions', () => {
    expect(moduleConfigs.users.columns.find((column) => column.field === 'status')?.label).toBe('账号状态')
    expect(moduleConfigs.users.columns.find((column) => column.field === 'account')?.mask).toBe('account')
    expect(moduleConfigs.repairs.columns.find((column) => column.field === 'status')?.label).toBe('处理状态')
    expect(moduleConfigs.messages.columns.find((column) => column.field === 'status')?.label).toBe('回复状态')
    expect(moduleConfigs.materials.columns.find((column) => column.field === 'status')?.label).toBe('审批状态')
    expect(moduleConfigs.ota.columns.find((column) => column.field === 'status')?.label).toBe('发布状态')
    expect(moduleConfigs.devices.rowActions).toContain('remote-disable')
    expect(moduleConfigs.devices.rowActions).toContain('remote-enable')
    expect(actionPermission('devices', 'remote-disable')).toBe('devices:remote')
    expect(actionPermission('devices', 'remote-enable')).toBe('devices:remote')
  })
})
