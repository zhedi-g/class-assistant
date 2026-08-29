// M2 真实链路验证：用真实讯飞 Key + 浏览器虚拟音源跑一遍
// 验证：设置页连通测试、开始上课后 WS 鉴权连接（conn 变绿）、录制期间无致命错误。
// 虚拟音源是固定音调，讯飞不返回文字属预期；本测试只验证链路不验证识别文本。
// 需要真实 dev server 运行中（5173）。本脚本读取 xfyun.local.json（已 gitignore）。
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const cfg = JSON.parse(readFileSync(new URL('../xfyun.local.json', import.meta.url), 'utf8'))
mkdirSync('shots', { recursive: true })

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`)
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-chain'],
})
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
  permissions: ['microphone'],
})
const page = await ctx.newPage()

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })

  // ── 设置页：填入真实 Key 并测试连通 ──
  await page.locator('nav').getByText('设置').click()
  await page.waitForTimeout(400)
  await page.getByPlaceholder('讯飞 APPID').fill(cfg.appId)
  await page.getByPlaceholder('讯飞 APIKey').fill(cfg.apiKey)
  await page.getByPlaceholder('讯飞 APISecret').fill(cfg.apiSecret)
  await page.getByTestId('ifly-test-btn').click()
  await page.waitForSelector('[data-testid="ifly-test-result"]', { timeout: 15000 })
  const r = (await page.getByTestId('ifly-test-result').textContent()) || ''
  check('讯飞连通测试（真实 Key）', /连接正常/.test(r), r.trim())

  // ── 课堂页：真实开始录音 ──
  await page.locator('nav').getByText('课堂').click()
  await page.getByTestId('start-btn').click()
  await page.waitForSelector('[data-testid="conn-dot"].bg-emerald-500', { timeout: 12000 })
  check('真实 WS 鉴权连接成功（识别中·绿点）', true)
  await page.waitForTimeout(6000) // 录 6 秒虚拟音源
  const err = await page.locator('[data-testid="err"]').count()
  check('录制 6 秒无错误提示', err === 0)
  await page.screenshot({ path: 'shots/08-课堂-真实连接.png' })

  // 结束
  await page.getByTestId('stop-btn').click()
  await page.waitForTimeout(800)
  check('正常结束不报错', (await page.locator('[data-testid="err"]').count()) === 0)
} catch (e) {
  check('测试流程无异常', false, e.message)
  await page.screenshot({ path: 'shots/99-真实异常.png' }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n⛔ ${failed.length} 项未通过` : '\n🎉 真实链路验证全部通过')
process.exit(failed.length ? 1 : 0)
