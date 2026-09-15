import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const allScreens = JSON.parse(await readFile(path.join(root, 'src', 'config', 'reference-screens.json'), 'utf8')).screens
const idArgument = process.argv.find((argument) => argument.startsWith('--ids='))
const selectedIds = new Set(idArgument?.slice('--ids='.length).split(',').filter(Boolean) || [])
const manifest = selectedIds.size
  ? allScreens.filter((screen) => selectedIds.has(screen.id))
  : process.argv.includes('--overlays')
    ? allScreens.filter((screen) => screen.action)
    : process.argv.includes('--pages')
      ? allScreens.filter((screen) => !screen.action)
      : allScreens
const output = path.join(root, 'screenshots', 'generated')
await mkdir(output, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const session = { account: 'admin@shark.cn', displayName: '林海', role: 'platform', roleLabel: '平台管理员', ownerId: 'platform', domain: 'cn', permissions: ['*:*:*'], firstLogin: false }
const firstLoginSession = { ...session, account: 'tier2@dealer.cn', displayName: '李明', role: 'tier2', roleLabel: '二级经销商', ownerId: 'dealer-t2-xm', permissions: ['dashboard:view'], firstLogin: true }

for (const [index, screen] of manifest.entries()) {
  const publicAuthScreen = ['/login', '/register', '/forgot'].some((hash) => screen.hash.includes(hash))
  const authScreen = publicAuthScreen || screen.hash.includes('/first-password')
  await page.goto(`http://127.0.0.1:4174/?setup=${index}#/login`)
  await page.evaluate(({ publicAuthScreen, firstPassword, session, firstLoginSession }) => {
    if (publicAuthScreen) localStorage.removeItem('shark-sister-admin.session.v1')
    else localStorage.setItem('shark-sister-admin.session.v1', JSON.stringify(firstPassword ? firstLoginSession : session))
  }, { publicAuthScreen, firstPassword: screen.hash.includes('/first-password'), session, firstLoginSession })
  await page.goto(`http://127.0.0.1:4174/?capture=${index}${screen.hash}`)
  await page.waitForFunction(() => window.__prototypeReady === true)
  await page.waitForSelector(authScreen ? '.auth-shell' : '.app-shell', { state: 'visible' })
  if (!authScreen) await page.waitForSelector('.main-content > .page, .main-content > .module-page', { state: 'visible' })
  await page.locator('.el-loading-mask').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  if (screen.action) await page.evaluate((action) => window.__openAction(action), screen.action)
  if (screen.modalTab) await page.evaluate((tab) => window.__setModalTab(tab), screen.modalTab)
  await page.locator('.el-loading-mask').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(screen.action ? 320 : 80)
  await page.screenshot({ path: path.join(output, screen.file || `${screen.id}.png`), fullPage: true })
  process.stdout.write(`\rCaptured ${index + 1}/${manifest.length}`)
}

await browser.close()
process.stdout.write(`\nSaved ${manifest.length} screenshots to ${output}\n`)
