import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const reference = JSON.parse(await readFile(path.join(root, 'src', 'config', 'reference-screens.json'), 'utf8'))
const output = path.join(root, 'docs', 'screen-state-matrix.md')
const screens = reference.screens
const pageCount = screens.filter((screen) => !screen.action && !screen.id.startsWith('auth-')).length
const authCount = screens.filter((screen) => screen.id.startsWith('auth-')).length
const overlayCount = screens.filter((screen) => screen.action).length
const lines = [
  `# ${screens.length} 状态验收矩阵`,
  '',
  `> 共 ${screens.length} 个状态：${authCount} 个认证状态、${pageCount} 个页面/Tab、${overlayCount} 个抽屉和弹窗。截图位于 \`screenshots/generated/\`。`,
  '',
  '| 序号 | 状态 ID | 路由 | 动作 | 浮层 Tab | 截图文件 |',
  '| ---: | --- | --- | --- | --- | --- |',
  ...screens.map((screen, index) => `| ${index + 1} | \`${screen.id}\` | \`${screen.hash}\` | ${screen.action ? `\`${screen.action}\`` : '-'} | ${screen.modalTab ? `\`${screen.modalTab}\`` : '-'} | \`${screen.file}\` |`),
  '',
  '## 验收门槛',
  '',
  '- 每个 ID 对应一个可直接导航或通过 `window.__openAction()` 打开的确定性状态。',
  '- 1440px 全量截图必须非空、无页面横向溢出；1024px 核心页面自动收起侧栏。',
  '- 抽屉、弹窗等待进入动画完成后截图，避免把过渡帧当作最终界面。',
]

await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, `${lines.join('\n')}\n`, 'utf8')
console.log(`Generated ${output} with ${screens.length} states (${authCount}/${pageCount}/${overlayCount}).`)
