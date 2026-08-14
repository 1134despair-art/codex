import ExcelJS from 'exceljs'
import type { EntityRecord } from '@/types'

const deviceModels = ['制冰机 CI-02', '海水淡化器 SW-04', '顶流机 TF-01', '电池组 BP-03', '网络检测仪 ND-04']

export interface DeviceImportRow {
  row: number
  sn: string
  model: string
  region: string
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

export async function parseDeviceFile(file: File, existingSn: string[]) {
  const rows: Array<{ sn: string; model: string; region: string }> = []
  if (file.name.toLowerCase().endsWith('.csv')) {
    const lines = (await file.text()).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
    const header = lines.shift()?.split(',').map((item) => item.trim()) || []
    const snIndex = header.indexOf('SN')
    const modelIndex = header.indexOf('设备型号')
    const regionIndex = header.indexOf('销售地区')
    if ([snIndex, modelIndex, regionIndex].some((index) => index < 0)) throw new Error('文件必须包含 SN、设备型号、销售地区三列。')
    lines.forEach((line) => {
      const cells = line.split(',').map((item) => item.trim())
      rows.push({ sn: cells[snIndex] || '', model: cells[modelIndex] || '', region: cells[regionIndex] || '' })
    })
  } else {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await file.arrayBuffer())
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new Error('Excel 文件中没有工作表。')
    const headers = (sheet.getRow(1).values as unknown[]).map((value) => String(value || '').trim())
    const snIndex = headers.indexOf('SN')
    const modelIndex = headers.indexOf('设备型号')
    const regionIndex = headers.indexOf('销售地区')
    if ([snIndex, modelIndex, regionIndex].some((index) => index < 1)) throw new Error('文件必须包含 SN、设备型号、销售地区三列。')
    sheet.eachRow((row, index) => {
      if (index === 1) return
      rows.push({ sn: String(row.getCell(snIndex).text).trim(), model: String(row.getCell(modelIndex).text).trim(), region: String(row.getCell(regionIndex).text).trim() })
    })
  }
  const seen = new Set(existingSn)
  return rows.map((item, index): DeviceImportRow => {
    const errors: string[] = []
    if (!item.sn) errors.push('SN 不能为空')
    if (seen.has(item.sn)) errors.push('SN 已存在或文件内重复')
    if (!deviceModels.includes(item.model)) errors.push('设备型号无效')
    if (!item.region) errors.push('销售地区不能为空')
    seen.add(item.sn)
    return { row: index + 2, ...item, valid: errors.length === 0, error: errors.join('；') }
  })
}

export async function downloadDeviceTemplate() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('设备导入模板')
  sheet.columns = [{ header: 'SN', key: 'sn', width: 24 }, { header: '设备型号', key: 'model', width: 24 }, { header: '销售地区', key: 'region', width: 18 }]
  sheet.addRow({ sn: 'BX202608100999', model: '制冰机 CI-02', region: '中国' })
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '设备导入模板.xlsx')
}

export async function exportRecords(title: string, records: EntityRecord[]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(title.slice(0, 31))
  sheet.columns = [
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
