// D1 基准测试 E2E：真实课堂音频（用户提供）→ 旧链路 vs 新增强链 → 真实讯飞对照
// 需主 https 服务器运行中（5173）
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL || 'https://localhost:5173'
const AUDIO = 'C:/Users/zhedi/Downloads/20260831_092603.m4a'
mkdirSync('shots', { recursive: true })

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`)
}

const browser = await chromium.launch()
const page = await (
  await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, ignoreHTTPSErrors: true })
).newPage()

try {
  // ── 先在设置页填入真实讯飞三件套（本 profile 无历史）──
  const { readFileSync } = await import('node:fs')
  const cfg = JSON.parse(readFileSync(new URL('../xfyun.local.json', import.meta.url), 'utf8'))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('nav').getByText('设置').click()
  await page.getByPlaceholder('讯飞 APPID').fill(cfg.appId)
  await page.getByPlaceholder('讯飞 APIKey').fill(cfg.apiKey)
  await page.getByPlaceholder('讯飞 APISecret').fill(cfg.apiSecret)
  await page.waitForTimeout(600)

  // ── 基准页 ──
  await page.goto(BASE + '/?bench=1', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="bench-input"]', { timeout: 5000 })
  check('基准页可进入', true)

  await page.setInputFiles('[data-testid="bench-input"]', AUDIO)
  await page.waitForTimeout(500)

  // ── 启动双链路基准（3 分钟切片）──
  await page.getByTestId('bench-start').click()
  check('基准测试启动', true)

  // 等待完成（旧链路 ~2.5 分钟 + 新链路含 RNNoise ~2 分钟，上限 8 分钟）
  await page.waitForSelector('[data-testid="bench-stats"]', { timeout: 12 * 60 * 1000 })
  const stats = (await page.getByTestId('bench-stats').textContent()) || ''
  check('双链路基准完成（对照统计产出）', stats.includes('旧链路') && stats.includes('新链路'), '')
  console.log('\n===== 对照统计 =====\n' + stats)

  const oldT = (await page.getByTestId('bench-old').textContent()) || ''
  const newT = (await page.getByTestId('bench-new').textContent()) || ''
  check('旧链路产出转写', oldT.length > 100, `${oldT.length} 字`)
  check('新链路产出转写', newT.length > 100, `${newT.length} 字`)
  console.log('\n===== 旧链路转写（前 200 字）=====\n' + oldT.slice(0, 200))
  console.log('\n===== 新链路转写（前 200 字）=====\n' + newT.slice(0, 200))
  await page.screenshot({ path: 'shots/23-基准对照.png', fullPage: true })
} catch (e) {
  check('测试流程无异常', false, e.message)
  await page.screenshot({ path: 'shots/91-异常.png' }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n⛔ ${failed.length} 项未通过` : '\n🎉 D1 基准跑通')
process.exit(failed.length ? 1 : 0)
