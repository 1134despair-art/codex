const bundledAssets = import.meta.glob<string>(
  ['/src/assets/**/*.{png,jpg,jpeg,webp,svg}', '/src/documents/**/*.pdf'],
  { eager: true, query: '?url', import: 'default' },
)

const resourceUrls = new Map(
  Object.entries(bundledAssets).map(([sourcePath, url]) => [sourcePath.replace(/^\/src/, ''), url]),
)

export function assetUrl(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  const resourcePath = normalized.startsWith('./') ? normalized.slice(1) : normalized

  if (!resourcePath.startsWith('/assets/') && !resourcePath.startsWith('/documents/')) return value
  return resourceUrls.get(resourcePath) || value
}
