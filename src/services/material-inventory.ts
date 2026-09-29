import type { EntityRecord } from '@/types'

type RecordMap = Record<string, EntityRecord[]>

function completedMaterialMovements(records: RecordMap, materialId: string) {
  return (records['stock-movements'] || []).filter((movement) => movement.materialId === materialId && movement.status === 'completed')
}

export function materialStock(records: RecordMap, materialId: string) {
  return completedMaterialMovements(records, materialId).reduce((total, movement) => total + Number(movement.quantity || 0), 0)
}

export function synchronizeMaterialInventory(records: RecordMap) {
  for (const material of records['material-catalog'] || []) {
    const stock = materialStock(records, material.id)
    material.stock = stock
    material.availableStock = Math.max(0, stock - Number(material.reservedStock || 0))
    if (material.status === 'low') material.status = 'normal'
  }
}

export function normalizeMaterialInventory(records: RecordMap) {
  records['stock-movements'] ||= []
  const movements = records['stock-movements']
  const timestamp = new Date().toISOString()

  for (const material of records['material-catalog'] || []) {
    const hasOpening = movements.some((movement) => movement.materialId === material.id && movement.openingStock === true)
    if (hasOpening) continue
    const existingMovementTotal = materialStock(records, material.id)
    const openingQuantity = Number(material.stock || 0) - existingMovementTotal
    movements.push({
      id: `stock-movement-opening-${material.id}`,
      code: `OPEN-${String(material.materialCode || material.code)}`,
      name: `${material.name}期初入库`,
      category: '物料期初入库',
      materialId: material.id,
      materialCode: material.materialCode || material.code,
      quantity: openingQuantity,
      beforeStock: 0,
      afterStock: openingQuantity,
      openingStock: true,
      subjectId: material.id,
      subjectCode: material.code,
      status: 'completed',
      owner: material.owner,
      ownerId: material.ownerId,
      domain: material.domain,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  synchronizeMaterialInventory(records)
}
