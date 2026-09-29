import type { DataDomain, EntityRecord } from '@/types'

type RecordMap = Record<string, EntityRecord[]>

const ROOT_SEEDS = [
  { suffix: 'DEVICE', name: '整机设备', summary: '顶流机、制冰机、海水淡化器等整机产品' },
  { suffix: 'AFTERSALE', name: '售后物料', summary: '维修、更换和售后服务使用的配件物料' },
  { suffix: 'RAW', name: '原料', summary: '生产和装配使用的原材料' },
] as const

const CHILD_SEEDS = [
  { suffix: 'MECHANICAL', name: '机械配件', parent: '售后物料' },
  { suffix: 'ELECTRICAL', name: '电气配件', parent: '售后物料' },
  { suffix: 'CONSUMABLE', name: '耗材', parent: '售后物料' },
  { suffix: 'RAW-MATERIAL', name: '原材料', parent: '原料' },
] as const

function now() {
  return new Date().toISOString()
}

function seedCategory(categories: EntityRecord[], domain: DataDomain, payload: { code: string; name: string; parentId?: string; summary: string }) {
  const existing = categories.find((item) => item.domain === domain && item.code === payload.code)
  if (existing) return existing
  const timestamp = now()
  const category: EntityRecord = {
    id: `product-category-${domain}-${payload.code.toLowerCase()}`,
    code: payload.code,
    name: payload.name,
    parentId: payload.parentId || '',
    summary: payload.summary,
    category: '产品分类',
    status: 'normal',
    owner: '平台中心',
    ownerId: 'platform',
    domain,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  categories.push(category)
  return category
}

export function productCategoryDescendantIds(categories: EntityRecord[], categoryId: string) {
  const descendants = new Set<string>([categoryId])
  let changed = true
  while (changed) {
    changed = false
    for (const category of categories) {
      if (!descendants.has(String(category.parentId || '')) || descendants.has(category.id)) continue
      descendants.add(category.id)
      changed = true
    }
  }
  return [...descendants]
}

export function productCategoryPath(categories: EntityRecord[], categoryId: string) {
  const byId = new Map(categories.map((item) => [item.id, item]))
  const names: string[] = []
  const visited = new Set<string>()
  let current = byId.get(categoryId)
  while (current && !visited.has(current.id)) {
    names.unshift(String(current.name))
    visited.add(current.id)
    current = byId.get(String(current.parentId || ''))
  }
  return names.join(' -> ')
}

export function synchronizeProductCategoryHierarchy(records: RecordMap) {
  records['product-categories'] ||= []
  records['product-catalog'] ||= []
  records['material-catalog'] ||= []
  const categories = records['product-categories']
  const products = records['product-catalog']
  const materials = records['material-catalog']
  const domains = new Set<DataDomain>([
    ...categories.map((item) => item.domain),
    ...products.map((item) => item.domain),
    ...materials.map((item) => item.domain),
    'cn',
  ])

  for (const domain of domains) {
    const roots = new Map<string, EntityRecord>()
    for (const seed of ROOT_SEEDS) {
      const root = seedCategory(categories, domain, {
        code: `PCG-${domain.toUpperCase()}-${seed.suffix}`,
        name: seed.name,
        summary: seed.summary,
      })
      roots.set(seed.name, root)
    }
    for (const seed of CHILD_SEEDS) {
      seedCategory(categories, domain, {
        code: `PCG-${domain.toUpperCase()}-${seed.suffix}`,
        name: seed.name,
        parentId: roots.get(seed.parent)?.id,
        summary: `${seed.parent}下的${seed.name}分类`,
      })
    }

    const afterSalesRoot = roots.get('售后物料')
    const afterSalesChildren = categories.filter((item) => item.domain === domain && item.parentId === afterSalesRoot?.id)
    for (const material of materials.filter((item) => item.domain === domain)) {
      const current = categories.find((item) => item.id === material.productCategoryId)
      const validCategory = current && afterSalesRoot && productCategoryDescendantIds(categories, afterSalesRoot.id).includes(current.id)
      if (validCategory) continue
      const materialName = String(material.name || '')
      const preferredName = /传感器|电气|电源|控制|线路|电机/.test(materialName)
        ? '电气配件'
        : /滤芯|耗材|密封|润滑/.test(materialName)
          ? '耗材'
          : '机械配件'
      material.productCategoryId = afterSalesChildren.find((item) => item.name === preferredName)?.id || afterSalesChildren[0]?.id || afterSalesRoot?.id || ''
    }

    const deviceRoot = roots.get('整机设备')
    for (const category of categories.filter((item) => item.domain === domain)) {
      if ('parentId' in category || ROOT_SEEDS.some((seed) => category.code === `PCG-${domain.toUpperCase()}-${seed.suffix}`)) continue
      category.parentId = deviceRoot?.id || ''
    }
  }

  const categoryById = new Map(categories.map((item) => [item.id, item]))
  for (const category of categories) {
    const parent = categoryById.get(String(category.parentId || ''))
    category.parentName = parent?.name || '所有分类'
    category.path = productCategoryPath(categories, category.id) || category.name
    category.level = String(category.path).split(' -> ').length
    category.childCount = categories.filter((item) => item.parentId === category.id).length
    category.directProductCount = products.filter((product) => product.productCategoryId === category.id).length
    category.directMaterialCount = materials.filter((material) => material.productCategoryId === category.id).length
    const descendantIds = new Set(productCategoryDescendantIds(categories, category.id))
    category.productCount = products.filter((product) => descendantIds.has(String(product.productCategoryId || ''))).length
    category.materialCount = materials.filter((material) => descendantIds.has(String(material.productCategoryId || ''))).length
    category.itemCount = Number(category.productCount || 0) + Number(category.materialCount || 0)
  }

  for (const product of products) {
    const category = categoryById.get(String(product.productCategoryId || ''))
    if (!category) continue
    product.productCategory = category.name
    product.productCategoryPath = category.path
  }

  for (const material of materials) {
    const category = categoryById.get(String(material.productCategoryId || ''))
    if (!category) continue
    material.productCategory = category.name
    material.productCategoryPath = category.path
  }
}
