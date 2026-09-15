export interface DeviceIdentity {
  descriptor: string
  deviceName: string
  deviceModel: string
  deviceType: string
  specification: string
}

export const deviceCatalog: DeviceIdentity[] = [
  { descriptor: '顶流机 TF-01', deviceName: '顶流机', deviceModel: 'TF-01', deviceType: '船载设备', specification: '24V/48V 智能推流' },
  { descriptor: '制冰机 CI-02', deviceName: '制冰机', deviceModel: 'CI-02', deviceType: '制冷设备', specification: '220V · 60kg/日' },
  { descriptor: '海水淡化器 SW-04', deviceName: '海水淡化器', deviceModel: 'SW-04', deviceType: '水处理设备', specification: '220V · 400L/日' },
  { descriptor: '电池组 BP-03', deviceName: '电池组', deviceModel: 'BP-03', deviceType: '电源设备', specification: '48V · 200Ah' },
  { descriptor: '网络检测仪 ND-04', deviceName: '网络检测仪', deviceModel: 'ND-04', deviceType: '检测设备', specification: '4G/卫星双模' },
]

export const deviceTypes = deviceCatalog.map((item) => ({ label: item.descriptor, value: item.descriptor }))

export function deviceIdentity(descriptor: unknown): DeviceIdentity {
  const value = String(descriptor || '').trim()
  const known = deviceCatalog.find((item) => item.descriptor === value || item.deviceModel === value || value.endsWith(item.deviceModel))
  if (known) return { ...known }
  const parts = value.split(/\s+/).filter(Boolean)
  const model = parts.length > 1 ? parts.at(-1)! : value
  const name = parts.length > 1 ? parts.slice(0, -1).join(' ') : value
  return { descriptor: value, deviceName: name || value, deviceModel: model, deviceType: name || '其他设备', specification: '待配置' }
}
