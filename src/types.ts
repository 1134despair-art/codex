export type RoleKey = 'platform' | 'tier1' | 'tier2' | 'custom'
export type DataDomain = 'cn' | 'global'
export type DataScope = 'all' | 'descendants' | 'self'
export type CrudMode = 'full' | 'managed' | 'workflow' | 'readonly'
export type FieldType = 'text' | 'textarea' | 'select' | 'multiSelect' | 'lineItems' | 'componentItems' | 'date' | 'number' | 'switch' | 'image' | 'firmware' | 'pdf' | 'password'
export type FilterType = 'text' | 'select' | 'dateRange'
export type RequirementStatus = '通过' | '后端豁免' | '未通过'

export interface RequirementSource {
  primaryModule: string
  secondaryFeature: string
  tertiaryFeature: string
  fieldName: string
  fieldType: string
  description: string
  specialRequirement: string
  logicDescription: string
}

export interface RequirementRecord {
  id: string
  excelRow: number
  source: RequirementSource
  semanticModule: string
  route: string
  pageLocation: string
  interaction: string
  simulationBoundary: string
  permission: string
  service: string
  evidence: string
  testId: string
  status: RequirementStatus
}

export interface RequirementAuditResult {
  requirementId: string
  status: RequirementStatus
  evidence: string
  testId: string
  notes: string
}

export interface ApiResult<T> {
  code: number
  msg: string
  data: T
}

export interface TableDataInfo<T> {
  code: number
  msg: string
  rows: T[]
  total: number
}

export interface PageQuery {
  pageNum: number
  pageSize: number
  keyword?: string
  status?: string
  tab?: string
  orderByColumn?: string
  isAsc?: 'asc' | 'desc'
  filters?: Record<string, unknown>
  relationFilters?: Record<string, string | string[]>
}

export interface RelatedNavigationItem {
  key: string
  label: string
  icon: string
  targetModule: string
  targetTab?: string
  relationFilters: Record<string, string | string[]>
  count: number
  level: 'primary' | 'secondary'
}

export interface EntityRecord {
  id: string
  code: string
  name: string
  summary?: string
  category?: string
  region?: string
  owner?: string
  ownerId: string
  status: string
  domain: DataDomain
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

export interface UserSession {
  accountId: string
  account: string
  displayName: string
  role: RoleKey
  roleId: string
  roleLabel: string
  ownerId: string
  domain: DataDomain
  dataScope: DataScope
  permissions: string[]
  firstLogin: boolean
}

export interface NavItem {
  route: string
  label: string
  icon: string
  permission: string
  section?: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export interface TabConfig {
  key: string
  label: string
  field?: string
  value?: string
  source?: string
  excludeValues?: string[]
}

export interface ColumnConfig {
  field: string
  label: string
  width?: number
  minWidth?: number
  type?: 'text' | 'main' | 'status' | 'mono' | 'number' | 'money' | 'date' | 'image' | 'link'
  mask?: 'account'
}

export interface FieldConfig {
  field: string
  label: string
  type: FieldType
  required?: boolean
  placeholder?: string
  options?: Array<{ label: string; value: string }>
  optionSource?: string
  span?: 1 | 2
  readonly?: boolean
  min?: number
  max?: number
  sensitive?: boolean
  requiredOnCreate?: boolean
  visibleWhen?: { field: string; value?: string | number | boolean; values?: Array<string | number | boolean> }
}

export interface FilterConfig {
  field: string
  label: string
  type: FilterType
  placeholder?: string
  fields?: string[]
  options?: Array<{ label: string; value: string }>
  optionSource?: string
  exact?: boolean
}

export interface DetailTabConfig {
  key: string
  label: string
  kind: 'fields' | 'table' | 'timeline'
  source?: string
  title?: string
  description?: string
  columns?: ColumnConfig[]
}

export interface ActionConfig {
  key: string
  label: string
  permission?: string
  tone?: 'primary' | 'danger'
  allowedStatuses?: string[]
  fields?: FieldConfig[]
  impact?: string
}

export interface ModuleConfig {
  key: string
  route: string
  title: string
  eyebrow: string
  description: string
  icon: string
  permission: string
  crud: CrudMode
  primaryLabel?: string
  primaryByTab?: Record<string, string | undefined>
  tabs: TabConfig[]
  columns: ColumnConfig[]
  tabColumns?: Record<string, ColumnConfig[]>
  fields: FieldConfig[]
  tabFields?: Record<string, FieldConfig[]>
  filters: FilterConfig[]
  tabFilters?: Record<string, FilterConfig[]>
  tabRowActions?: Record<string, string[]>
  statusTones?: Record<string, string>
  detailTabs: DetailTabConfig[]
  rowActions?: string[]
  actions?: ActionConfig[]
  auditOnly?: boolean
  exportable?: boolean
}

export interface StoredDatabase {
  version: 15
  updatedAt: string
  records: Record<string, EntityRecord[]>
}

export interface ReferenceScreen {
  id: string
  hash: string
  action?: string
  modalTab?: string
  label: string
  file?: string
}
