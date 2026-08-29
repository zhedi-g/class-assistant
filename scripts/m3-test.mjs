// M3 验收测试：关键词命中 → 震动降级(屏幕横幅) → 自动标记 → 记录留痕
// 需先启动 mock dev server：VITE_MOCK_ASR=1 pnpm dev:mock（端口 5174）
// Mock 台词第 4 句「这个公式期末考试必考大家记一下」包含默认词库的「考试」
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'https://localhost:5174'
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
  ignoreHTTPSErrors: true,
})
const page = await ctx.newPage()

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('nav').getByText('课堂').click()

  // 设置页确认默认提醒词库已预置
  await page.locator('nav').getByText('设置').click()
  await page.waitForTimeout(300)
  const words = await page.getByTestId('alert-words').inputValue()
  check('默认提醒词库已预置（含 考试/作业/点名）', words.includes('考试') && words.includes('作业') && words.includes('点名'))
  await page.locator('nav').getByText('课堂').click()

  // 开始录音
  await page.getByTestId('start-btn').click()
  await page.waitForSelector('[data-testid="subtitle"]', { timeout: 5000 })

  // 等待至少 3 段转写完成（约 7s），第 4 句 interim 期会命中「考试」
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="segment"]').length >= 3, {
    timeout: 20000,
  })

  // ── 关键词命中：横幅 + 计数 ──
  await page.waitForSelector('[data-testid="alert-banner"]', { timeout: 10000 })
  const banner = (await page.getByTestId('alert-banner').textContent()) || ''
  check('命中关键词弹出横幅', banner.includes('考试'), banner.trim().slice(0, 30))
  await page.waitForSelector('[data-testid="alert-count"]', { timeout: 3000 })
  check('状态条显示提醒计数', ((await page.getByTestId('alert-count').textContent()) || '').includes('🔔'))

  // ── 命中句自动标记（带 🔔 标签）──
  await page.waitForFunction(
    () => {
      const els = document.querySelectorAll('[data-testid="segment"]')
      const last = els[els.length - 1]
      return last && last.textContent?.includes('必考')
    },
    { timeout: 8000 },
  )
  const lastSeg = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-testid="segment"]')
    return els[els.length - 1]?.textContent || ''
  })
  check('命中句自动标记并带 🔔 考试 标签', lastSeg.includes('🔔考试') && lastSeg.includes('必考'), lastSeg.slice(0, 30))
  await page.screenshot({ path: 'shots/09-课堂-关键词命中.png' })

  // ── 停止保存 ──
  await page.getByTestId('stop-btn').click()
  await page.waitForSelector('[data-testid="toast"]', { timeout: 5000 })
  const toast = (await page.getByTestId('toast').textContent()) || ''
  check('停止保存含提醒次数统计', /🔔\d+ 次提醒/.test(toast), toast.trim())

  // ── 记录详情可见命中标签 ──
  await page.locator('nav').getByText('记录').click()
  await page.waitForSelector('[data-testid="record-card"]', { timeout: 5000 })
  await page.getByTestId('record-toggle').first().click()
  await page.waitForSelector('[data-testid="record-detail"]', { timeout: 3000 })
  const detail = (await page.getByTestId('record-detail').textContent()) || ''
  check('记录详情含 🔔 考试 标记', detail.includes('🔔考试'))
  await page.screenshot({ path: 'shots/10-记录-命中标记.png' })
} catch (e) {
  check('测试流程无异常', false, e.message)
  await page.screenshot({ path: 'shots/97-异常.png' }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n⛔ ${failed.length} 项未通过` : '\n🎉 M3 验收全部通过')
process.exit(failed.length ? 1 : 0)
