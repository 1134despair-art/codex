import { describe, expect, it } from 'vitest'
import { parseDeviceFile, parseMaterialFile, parseOutboundFile } from '@/services/excel'
import type { EntityRecord } from '@/types'

describe('device import validation', () => {
  it('parses and validates material CSV rows', async () => {
    const file = new File(['物料编号,物料名称,适用设备,采购价,库存数量\nMAT-NEW-001,密封组件,制冰机 CI-02,168,20\nMAT-OLD,重复物料,制冰机 CI-02,0,-1'], 'materials.csv', { type: 'text/csv' })
    const rows = await parseMaterialFile(file, ['MAT-OLD'])
    expect(rows[0]).toMatchObject({ materialCode: 'MAT-NEW-001', price: 168, stock: 20, valid: true })
    expect(rows[1].valid).toBe(false)
    expect(rows[1].error).toContain('已存在')
  })

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

  it('imports child material serial numbers and specifications as paired device data', async () => {
    const file = new File([
      'SN,设备型号,销售地区,子物料序列号,子物料规格\nBX-COMP-001,制冰机 CI-02,中国,PUMP-001；CTRL-001,海水泵 P-20；控制器 C-02\nBX-COMP-002,制冰机 CI-02,中国,PUMP-OLD,海水泵 P-20\nBX-COMP-003,制冰机 CI-02,中国,ONLY-001,',
    ], 'components.csv', { type: 'text/csv' })
    const rows = await parseDeviceFile(file, [], ['PUMP-OLD'])
    expect(rows[0].components).toEqual([{ serialNumber: 'PUMP-001', specification: '海水泵 P-20' }, { serialNumber: 'CTRL-001', specification: '控制器 C-02' }])
    expect(rows[0].valid).toBe(true)
    expect(rows[1].error).toContain('子物料序列号 PUMP-OLD 已存在')
    expect(rows[2].error).toContain('必须成对填写')
  })

  it('rejects files with missing required columns', async () => {
    const file = new File(['SN,设备型号\nBX-001,制冰机 CI-02'], 'missing.csv', { type: 'text/csv' })
    await expect(parseDeviceFile(file, [])).rejects.toThrow('必须包含 SN、设备型号、销售地区三列')
  })

  it('validates batch outbound SN rows against current warehouse inventory', async () => {
    const file = new File([
      '设备SN\nWH-AVAILABLE-001\nWH-AVAILABLE-001\nWH-OUTBOUND-001',
    ], 'outbound.csv', { type: 'text/csv' })
    const available: EntityRecord[] = [{
      id: 'device-1',
      code: 'WH-AVAILABLE-001',
      name: '制冰机 CI-02',
      warehouseLocation: 'A-01',
      ownerId: 'platform',
      status: 'offline',
      domain: 'cn',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    }]
    const rows = await parseOutboundFile(file, available)
    expect(rows[0]).toMatchObject({ sn: 'WH-AVAILABLE-001', model: '制冰机 CI-02', warehouseLocation: 'A-01', valid: true })
    expect(rows[1].error).toContain('文件内 SN 重复')
    expect(rows[2].error).toContain('设备不在平台仓库或已出库')
  })

  it('rejects outbound files without an SN column', async () => {
    const file = new File(['设备型号\n制冰机 CI-02'], 'outbound-missing.csv', { type: 'text/csv' })
    await expect(parseOutboundFile(file, [])).rejects.toThrow('文件必须包含 SN 列')
  })
})
