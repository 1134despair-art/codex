import ExcelJS from 'exceljs'
import { deviceIdentity } from '@/config/device-catalog'
import type { ColumnConfig, EntityRecord } from '@/types'

const deviceModels = ['制冰机 CI-02', '海水淡化器 SW-04', '顶流机 TF-01', '电池组 BP-03', '网络检测仪 ND-04']

export interface DeviceImportRow {
  row: number
  sn: string
  model: string
  deviceType: string
  specification: string
  region: string
  warehouseName?: string
  warehouseLocation?: string
  components: Array<{ serialNumber: string; specification: string }>
  valid: boolean
  error: string
}

export interface DeviceOutboundRow {
  row: number
  sn: string
  model: string
  warehouseLocation: string
  valid: boolean
  error: string
}

export interface MaterialImportRow {
  row: number
  materialCode: string
  name: string
  category: string
  price: number
  stock: number
  valid: boolean
  error: string
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

type RawDeviceImportRow = Omit<DeviceImportRow, 'row' | 'valid' | 'error'> & { componentError?: string }

function parseComponentColumns(serialValue: string, specificationValue: string) {
  const split = (value: string) => value.split(/[;；、|]/).map((item) => item.trim()).filter(Boolean)
  const serials = split(serialValue)
  const specifications = split(specificationValue)
  if (!serials.length && !specifications.length) return { components: [] as DeviceImportRow['components'], error: '' }
  if (serials.length !== specifications.length) return { components: [] as DeviceImportRow['components'], error: '子物料序列号与规格必须成对填写且数量一致' }
  return { components: serials.map((serialNumber, index) => ({ serialNumber, specification: specifications[index] })), error: '' }
}

export async function parseDeviceFile(file: File, existingSn: string[], existingComponentSerials: string[] = []) {
  const rows: RawDeviceImportRow[] = []
  if (file.name.toLowerCase().endsWith('.csv')) {
    const lines = (await file.text()).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
    const header = lines.shift()?.split(',').map((item) => item.trim()) || []
    const snIndex = header.indexOf('SN')
    const modelIndex = header.indexOf('设备型号')
    const typeIndex = header.indexOf('设备类型')
    const specificationIndex = header.indexOf('产品规格')
    const regionIndex = header.indexOf('销售地区')
    const componentSerialIndex = header.indexOf('子物料序列号')
    const componentSpecificationIndex = header.indexOf('子物料规格')
    if ([snIndex, modelIndex, regionIndex].some((index) => index < 0)) throw new Error('文件必须包含 SN、设备型号、销售地区三列。')
    lines.forEach((line) => {
      const cells = line.split(',').map((item) => item.trim())
      const parsed = parseComponentColumns(componentSerialIndex >= 0 ? cells[componentSerialIndex] || '' : '', componentSpecificationIndex >= 0 ? cells[componentSpecificationIndex] || '' : '')
      const model = cells[modelIndex] || ''
      const identity = deviceIdentity(model)
      rows.push({ sn: cells[snIndex] || '', model, deviceType: typeIndex >= 0 ? cells[typeIndex] || '' : identity.deviceType, specification: specificationIndex >= 0 ? cells[specificationIndex] || '' : identity.specification, region: cells[regionIndex] || '', warehouseName: cells[header.indexOf('仓库/机构')] || '', warehouseLocation: cells[header.indexOf('库位')] || '', components: parsed.components, componentError: parsed.error })
    })
  } else {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await file.arrayBuffer())
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new Error('Excel 文件中没有工作表。')
    const headers = (sheet.getRow(1).values as unknown[]).map((value) => String(value || '').trim())
    const snIndex = headers.indexOf('SN')
    const modelIndex = headers.indexOf('设备型号')
    const typeIndex = headers.indexOf('设备类型')
    const specificationIndex = headers.indexOf('产品规格')
    const regionIndex = headers.indexOf('销售地区')
    const warehouseNameIndex = headers.indexOf('仓库/机构')
    const warehouseLocationIndex = headers.indexOf('库位')
    const componentSerialIndex = headers.indexOf('子物料序列号')
    const componentSpecificationIndex = headers.indexOf('子物料规格')
    if ([snIndex, modelIndex, regionIndex].some((index) => index < 1)) throw new Error('文件必须包含 SN、设备型号、销售地区三列。')
    sheet.eachRow((row, index) => {
      if (index === 1) return
      const parsed = parseComponentColumns(componentSerialIndex > 0 ? String(row.getCell(componentSerialIndex).text).trim() : '', componentSpecificationIndex > 0 ? String(row.getCell(componentSpecificationIndex).text).trim() : '')
      const model = String(row.getCell(modelIndex).text).trim()
      const identity = deviceIdentity(model)
      rows.push({ sn: String(row.getCell(snIndex).text).trim(), model, deviceType: typeIndex > 0 ? String(row.getCell(typeIndex).text).trim() : identity.deviceType, specification: specificationIndex > 0 ? String(row.getCell(specificationIndex).text).trim() : identity.specification, region: String(row.getCell(regionIndex).text).trim(), warehouseName: warehouseNameIndex > 0 ? String(row.getCell(warehouseNameIndex).text).trim() : '', warehouseLocation: warehouseLocationIndex > 0 ? String(row.getCell(warehouseLocationIndex).text).trim() : '', components: parsed.components, componentError: parsed.error })
    })
  }
  const seen = new Set(existingSn)
  const seenComponents = new Set(existingComponentSerials)
  return rows.map((item, index): DeviceImportRow => {
    const errors: string[] = []
    if (!item.sn) errors.push('SN 不能为空')
    if (seen.has(item.sn)) errors.push('SN 已存在或文件内重复')
    if (!deviceModels.includes(item.model)) errors.push('设备型号无效')
    const identity = deviceIdentity(item.model)
    if (!item.deviceType) errors.push('设备类型不能为空')
    else if (deviceModels.includes(item.model) && item.deviceType !== identity.deviceType) errors.push('设备类型与型号不匹配')
    if (!item.specification) errors.push('产品规格不能为空')
    else if (deviceModels.includes(item.model) && item.specification !== identity.specification) errors.push('产品规格与型号不匹配')
    if (!item.region) errors.push('销售地区不能为空')
    if (item.componentError) errors.push(item.componentError)
    for (const component of item.components) {
      if (seenComponents.has(component.serialNumber)) errors.push(`子物料序列号 ${component.serialNumber} 已存在或文件内重复`)
      seenComponents.add(component.serialNumber)
    }
    seen.add(item.sn)
    const normalized = { ...item }
    delete normalized.componentError
    return { row: index + 2, ...normalized, valid: errors.length === 0, error: errors.join('；') }
  })
}

export async function downloadDeviceTemplate() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('设备导入模板')
  sheet.columns = [{ header: 'SN', key: 'sn', width: 24 }, { header: '设备类型', key: 'deviceType', width: 24 }, { header: '设备型号', key: 'model', width: 24 }, { header: '产品规格', key: 'specification', width: 24 }, { header: '销售地区', key: 'region', width: 18 }, { header: '仓库/机构', key: 'warehouseName', width: 22 }, { header: '库位', key: 'warehouseLocation', width: 16 }, { header: '子物料序列号', key: 'componentSerials', width: 30 }, { header: '子物料规格', key: 'componentSpecifications', width: 30 }]
  sheet.addRow({ sn: 'BX202608100999', deviceType: '船用制冰设备', model: '制冰机 CI-02', specification: '220V · 60kg/日', region: '中国', warehouseName: '平台中心仓', warehouseLocation: 'A-01-01', componentSerials: 'PUMP-001；CTRL-001', componentSpecifications: '海水泵 P-20；控制器 C-02' })
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '设备导入模板.xlsx')
}

export async function parseMaterialFile(file: File, existingCodes: string[]) {
  const rows: Array<Omit<MaterialImportRow, 'row' | 'valid' | 'error'>> = []
  const append = (values: string[]) => rows.push({ materialCode: values[0] || '', name: values[1] || '', category: values[2] || '', price: Number(values[3] || 0), stock: Number(values[4] || 0) })
  if (file.name.toLowerCase().endsWith('.csv')) {
    const lines = (await file.text()).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
    const headers = lines.shift()?.split(',').map((item) => item.trim()) || []
    const indexes = ['物料编号', '物料名称', '适用设备', '采购价', '库存数量'].map((header) => headers.indexOf(header))
    if (indexes.some((index) => index < 0)) throw new Error('文件必须包含物料编号、物料名称、适用设备、采购价、库存数量五列。')
    lines.forEach((line) => { const cells = line.split(',').map((item) => item.trim()); append(indexes.map((index) => cells[index] || '')) })
  } else {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await file.arrayBuffer())
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new Error('Excel 文件中没有工作表。')
    const headers = (sheet.getRow(1).values as unknown[]).map((value) => String(value || '').trim())
    const indexes = ['物料编号', '物料名称', '适用设备', '采购价', '库存数量'].map((header) => headers.indexOf(header))
    if (indexes.some((index) => index < 1)) throw new Error('文件必须包含物料编号、物料名称、适用设备、采购价、库存数量五列。')
    sheet.eachRow((row, index) => { if (index > 1) append(indexes.map((cellIndex) => String(row.getCell(cellIndex).text).trim())) })
  }
  const seen = new Set(existingCodes)
  return rows.map((item, index): MaterialImportRow => {
    const errors: string[] = []
    if (!item.materialCode) errors.push('物料编号不能为空')
    if (seen.has(item.materialCode)) errors.push('物料编号已存在或文件内重复')
    if (!item.name) errors.push('物料名称不能为空')
    if (!deviceModels.includes(item.category)) errors.push('适用设备型号无效')
    if (!(item.price > 0)) errors.push('采购价必须大于 0')
    if (!Number.isInteger(item.stock) || item.stock < 0) errors.push('库存数量必须为非负整数')
    if (item.materialCode) seen.add(item.materialCode)
    return { row: index + 2, ...item, valid: errors.length === 0, error: errors.join('；') }
  })
}

export async function downloadMaterialTemplate() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('物料导入模板')
  sheet.columns = [{ header: '物料编号', key: 'materialCode', width: 20 }, { header: '物料名称', key: 'name', width: 24 }, { header: '适用设备', key: 'category', width: 24 }, { header: '采购价', key: 'price', width: 14 }, { header: '库存数量', key: 'stock', width: 14 }]
  sheet.addRow({ materialCode: 'MAT-1001', name: '制冰机密封组件', category: '制冰机 CI-02', price: 168, stock: 20 })
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '物料导入模板.xlsx')
}

export async function parseOutboundFile(file: File, availableDevices: EntityRecord[]) {
  const sourceRows: Array<{ row: number; sn: string }> = []
  if (file.name.toLowerCase().endsWith('.csv')) {
    const lines = (await file.text()).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
    const headers = lines.shift()?.split(',').map((item) => item.trim()) || []
    const snIndex = headers.findIndex((item) => ['SN', '设备SN', '设备 SN'].includes(item))
    if (snIndex < 0) throw new Error('文件必须包含 SN 列。')
    lines.forEach((line, index) => {
      const cells = line.split(',').map((item) => item.trim())
      sourceRows.push({ row: index + 2, sn: cells[snIndex] || '' })
    })
  } else {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await file.arrayBuffer())
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new Error('Excel 文件中没有工作表。')
    const headers = (sheet.getRow(1).values as unknown[]).map((value) => String(value || '').trim())
    const snIndex = headers.findIndex((item) => ['SN', '设备SN', '设备 SN'].includes(item))
    if (snIndex < 1) throw new Error('文件必须包含 SN 列。')
    sheet.eachRow((row, index) => {
      if (index === 1) return
      sourceRows.push({ row: index, sn: String(row.getCell(snIndex).text).trim() })
    })
  }

  const devices = new Map(availableDevices.map((device) => [String(device.code).trim(), device]))
  const seen = new Set<string>()
  return sourceRows.map((item): DeviceOutboundRow => {
    const errors: string[] = []
    const device = devices.get(item.sn)
    if (!item.sn) errors.push('SN 不能为空')
    if (item.sn && seen.has(item.sn)) errors.push('文件内 SN 重复')
    if (item.sn && !device) errors.push('设备不在平台仓库或已出库')
    if (item.sn) seen.add(item.sn)
    return {
      ...item,
      model: String(device?.name || '-'),
      warehouseLocation: String(device?.warehouseLocation || '-'),
      valid: errors.length === 0,
      error: errors.join('；'),
    }
  })
}

export async function downloadOutboundTemplate() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('设备出库模板')
  sheet.columns = [{ header: 'SN', key: 'sn', width: 24 }]
  sheet.addRow({ sn: 'WH202608100001' })
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '设备出库模板.xlsx')
}

export async function exportRecords(title: string, records: EntityRecord[], columns?: ColumnConfig[]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(title.slice(0, 31))
  sheet.columns = columns?.length
    ? columns.map((column) => ({ header: column.label, key: column.field, width: Math.max(14, Math.min(42, Math.round(Number(column.width || column.minWidth || 180) / 8))) }))
    : [
        { header: '业务编号', key: 'code', width: 22 }, { header: '名称', key: 'name', width: 30 }, { header: '类型', key: 'category', width: 18 }, { header: '地区', key: 'region', width: 20 }, { header: '归属', key: 'owner', width: 28 }, { header: '状态', key: 'status', width: 14 }, { header: '更新时间', key: 'updatedAt', width: 24 }, { header: '说明', key: 'summary', width: 40 },
      ]
  records.forEach((record) => sheet.addRow(record))
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${title}-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export async function compressBanner(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('请选择 PNG、JPG 或 WebP 图片。')
  if (file.size > 2 * 1024 * 1024) throw new Error('Banner 图片不能超过 2 MB。')
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 400
  const context = canvas.getContext('2d')!
  const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height)
  const width = bitmap.width * scale
  const height = bitmap.height * scale
  context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.82)
}
