import { describe, expect, it } from 'vitest'
import { assetUrl } from '@/services/assets'

describe('bundled asset URLs', () => {
  it('resolves legacy relative and root paths to the same bundled resource', () => {
    const relative = assetUrl('./assets/backgrounds/auth-marine-operations.png')
    const root = assetUrl('/assets/backgrounds/auth-marine-operations.png')

    expect(relative).toBe(root)
    expect(relative).not.toBe('./assets/backgrounds/auth-marine-operations.png')
  })

  it('resolves bundled documents', () => {
    expect(assetUrl('./documents/topflow-machine-manual-zh.pdf')).not.toBe('./documents/topflow-machine-manual-zh.pdf')
  })

  it('preserves user uploads and external URLs', () => {
    expect(assetUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
    expect(assetUrl('blob:https://example.com/id')).toBe('blob:https://example.com/id')
    expect(assetUrl('https://example.com/image.png')).toBe('https://example.com/image.png')
    expect(assetUrl('uploaded-image.png')).toBe('uploaded-image.png')
  })
})
