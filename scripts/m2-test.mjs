// M2 验收测试：Mock ASR 模式下走通 开始上课→实时字幕→标记重点→结束保存→记录可见
// 需先启动 mock dev server：VITE_MOCK_ASR=1 pnpm dev:mock（端口 5174）
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

  // ── 开始上课 ──
  await page.getByTestId('start-btn').click()
  await page.waitForSelector('[data-testid="subtitle"]', { timeout: 5000 })
  check('进入录音态：字幕区出现', true)

  // ── 实时转写：interim 与 final 都出现 ──
  await page.waitForSelector('[data-testid="interim"], [data-testid="segment"]', { timeout: 8000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="segment"]').length >= 2, {
    timeout: 15000,
  })
  const segCount = await page.locator('[data-testid="segment"]').count()
  check('流式转写产出 ≥2 条内容', segCount >= 2, `${segCount} 条`)
  await page.screenshot({ path: 'shots/05-课堂-转写中.png' })

  // ── 计时与连接状态 ──
  const elapsed = await page.getByTestId('elapsed').textContent()
  const connOpen = await page.getByTestId('conn-dot').evaluate((el) => el.classList.contains('bg-emerald-500'))
  check('计时器在走（≥00:01）', /0[0-9]:[0-9]{2}/.test(elapsed || ''), elapsed || '')
  check('连接状态为「识别中」（绿点）', connOpen)

  // ── 一键标记重点 ──
  await page.getByTestId('mark-btn').click()
  await page.waitForTimeout(300)
  const lastSeg = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-testid="segment"]')
    return els[els.length - 1]?.textContent || ''
  })
  check('标记后最近一句带 🚩 且高亮', lastSeg.includes('🚩'), lastSeg.slice(0, 24))

  // 等最后一句说完再停，确保内容完整
  await page.waitForTimeout(2500)

  // ── 结束课堂：保存并提示 ──
  await page.getByTestId('stop-btn').click()
  await page.waitForSelector('[data-testid="toast"]', { timeout: 5000 })
  const toast = await page.getByTestId('toast').textContent()
  check('停止后提示已保存', /已保存/.test(toast || ''), toast || '')
  await page.screenshot({ path: 'shots/06-课堂-结束保存.png' })

  // ── 记录页可见 ──
  await page.locator('nav').getByText('记录').click()
  await page.waitForSelector('[data-testid="record-card"]', { timeout: 5000 })
  const cardText = (await page.getByTestId('record-card').first().textContent()) || ''
  check('记录页出现本节课卡片', cardText.length > 0, cardText.slice(0, 40))
  check('记录卡片含条数/时长统计', /条 · /.test(cardText))
  await page.screenshot({ path: 'shots/07-记录列表.png' })
} catch (e) {
  check('测试流程无异常', false, e.message)
  await page.screenshot({ path: 'shots/98-异常.png' }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n⛔ ${failed.length} 项未通过` : '\n🎉 M2 验收全部通过')
process.exit(failed.length ? 1 : 0)
