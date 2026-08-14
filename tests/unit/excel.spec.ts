import { describe, expect, it } from 'vitest'
import { parseDeviceFile } from '@/services/excel'

describe('device import validation', () => {
  it('accepts valid CSV rows and reports duplicate/model errors', async () => {
    const file = new File([
      'SN,设备型号,销售地区\nBX-NEW-001,制冰机 CI-02,中国\nBX-OLD-001,海水淡化器 SW-04,中国\nBX-NEW-002,未知型号,英国',
    ], 'devices.csv', { type: 'text/csv' })
    const rows = await parseDeviceFile(file, ['BX-OLD-001'])
    expect(rows[0].valid).toBe(true)
    expect(rows[1].error).toContain('SN 已存在')
    expect(rows[2].error).toContain('设备型号无效')
  })

  it('accepts any non-empty country or sales region from V3.2 data', async () => {
    const file = new File(['SN,设备型号,销售地区\nBX-NEW-003,制冰机 CI-02,德国'], 'region.csv', { type: 'text/csv' })
    const rows = await parseDeviceFile(file, [])
    expect(rows[0].valid).toBe(true)
  })

  it('rejects files with missing required columns', async () => {
    const file = new File(['SN,设备型号\nBX-001,制冰机 CI-02'], 'missing.csv', { type: 'text/csv' })
    await expect(parseDeviceFile(file, [])).rejects.toThrow('必须包含 SN、设备型号、销售地区三列')
  })
})
