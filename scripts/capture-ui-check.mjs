import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'screenshots', 'ui-check')
const session = {
  account: 'admin@shark.cn',
  displayName: '林海',
  role: 'platform',
  roleLabel: '平台管理员',
  ownerId: 'platform',
  domain: 'cn',
  permissions: ['*:*:*'],
  firstLogin: false,
}

await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })

await page.goto('http://127.0.0.1:4174/#/login')
await page.evaluate((value) => localStorage.setItem('shark-sister-admin.session.v1', JSON.stringify(value)), session)
await page.reload()

for (const shot of [
  { name: 'dashboard-1440.png', route: 'dashboard', width: 1440, height: 1000 },
  { name: 'dashboard-1920.png', route: 'dashboard', width: 1920, height: 1000 },
  { name: 'dashboard-2133.png', route: 'dashboard', width: 2133, height: 1000 },
  { name: 'users-1440.png', route: 'users', width: 1440, height: 1000 },
  { name: 'users-2133.png', route: 'users', width: 2133, height: 1000 },
  { name: 'devices-1024.png', route: 'devices', width: 1024, height: 900 },
  { name: 'repairs-1440.png', route: 'repairs', width: 1440, height: 1000 },
  { name: 'payment-settings-1440.png', route: 'payment-settings', width: 1440, height: 1000 },
  { name: 'settings-2133.png', route: 'settings', width: 2133, height: 1000 },
  { name: 'dashboard-1024.png', route: 'dashboard', width: 1024, height: 900 },
]) {
  await page.setViewportSize({ width: shot.width, height: shot.height })
  await page.goto(`http://127.0.0.1:4174/?ui-check-setup=${encodeURIComponent(shot.name)}#/login`)
  await page.evaluate((collapsed) => localStorage.setItem('shark-sister-admin.prefs.v1', JSON.stringify({ collapsed, pageSize: 10, expandedGroups: [], navigationCustomized: false })), shot.width < 1280)
  await page.goto(`http://127.0.0.1:4174/?ui-check=${encodeURIComponent(shot.name)}#/${shot.route}`)
  await page.waitForFunction(() => window.__prototypeReady === true)
  await page.waitForSelector(shot.route === 'dashboard' ? '.dashboard-page' : '.module-page')
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(output, shot.name), fullPage: true })
}

await browser.close()
process.stdout.write(`Saved UI checks to ${output}\n`)
