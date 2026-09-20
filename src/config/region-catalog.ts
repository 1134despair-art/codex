export interface DealerRegionOption {
  label: string
  value: string
  domain: 'cn' | 'global'
}

// 经销商负责地区统一从此区域字典读取，避免表单自由填写产生重复或不可筛选的数据。
export const dealerRegionOptions: DealerRegionOption[] = [
  ...['北京', '天津', '上海', '江苏', '浙江', '福建', '山东', '广东', '海南', '辽宁'].map((region) => ({
    label: `中国 · ${region}`,
    value: `中国 · ${region}`,
    domain: 'cn' as const,
  })),
  { label: '美国 · California', value: '美国 · California', domain: 'global' },
  { label: '美国 · Nevada', value: '美国 · Nevada', domain: 'global' },
  { label: '英国 · Southampton', value: '英国 · Southampton', domain: 'global' },
  { label: '澳大利亚 · New South Wales', value: '澳大利亚 · New South Wales', domain: 'global' },
  { label: '新加坡', value: '新加坡', domain: 'global' },
]
