import { cp, mkdir, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.resolve(root, '..')
const bundledAssets = path.join(root, 'src', 'assets')

await mkdir(bundledAssets, { recursive: true })
await cp(path.join(workspace, 'ui-prototype', 'assets', 'icons'), path.join(bundledAssets, 'icons'), { recursive: true, force: true })
await cp(path.join(workspace, 'ui-prototype', 'assets', 'backgrounds'), path.join(bundledAssets, 'backgrounds'), { recursive: true, force: true })
await cp(path.join(workspace, 'ui-prototype', 'assets', 'illustrations'), path.join(bundledAssets, 'illustrations'), { recursive: true, force: true })
await copyFile(path.join(workspace, 'ui-prototype', 'assets', 'manifest.json'), path.join(bundledAssets, 'manifest.json'))
await copyFile(path.join(workspace, 'design-system', 'design-tokens.css'), path.join(root, 'src', 'styles', 'tokens.css'))
await copyFile(path.join(workspace, 'ui-prototype', 'screenshots', 'manifest.json'), path.join(root, 'src', 'config', 'reference-screens.json'))

console.log('Design tokens, image assets and the 152-screen reference manifest are synchronized.')
