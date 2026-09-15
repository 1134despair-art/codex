import type { EntityRecord } from '@/types'

function wildcardMatches(pattern: string, value: string) {
  if (!pattern.includes('*')) return pattern === value
  const parts = pattern.split(/\*+/).filter(Boolean)
  if (!parts.length) return false
  let cursor = 0
  for (const [index, part] of parts.entries()) {
    const position = value.indexOf(part, cursor)
    if (position < 0 || index === 0 && position !== 0) return false
    cursor = position + part.length
  }
  return pattern.endsWith('*') || value.endsWith(parts.at(-1) || '')
}

export function accountMatches(candidate: unknown, account: unknown) {
  const left = String(candidate || '').trim().toLowerCase()
  const right = String(account || '').trim().toLowerCase()
  if (!left || !right || left === '-' || right === '-') return false
  if (left === right) return true
  return wildcardMatches(left, right) || wildcardMatches(right, left)
}

export function deviceMatchesUser(device: EntityRecord, user: EntityRecord) {
  return device.userId === user.id || accountMatches(device.account, user.account)
}

export function recordsRelatedToUser(moduleKey: string, user: EntityRecord, records: Record<string, EntityRecord[]>) {
  const devices = (records.devices || []).filter((device) => deviceMatchesUser(device, user))
  if (moduleKey === 'devices') return devices
  const deviceSns = new Set(devices.map((device) => String(device.code)).filter(Boolean))
  return (records[moduleKey] || []).filter((record) => record.userId === user.id
    || accountMatches(record.account, user.account)
    || Boolean(record.deviceSN && deviceSns.has(String(record.deviceSN))))
}
