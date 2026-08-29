// M4.2 验收测试：课堂提问自动检测 → 价值过滤 → 主动生成回答 → 可点击横幅 → 问答存档
// Mock 台词第 1 句「深度求索是哪家公司」是提问，第 2~4 句为陈述句（不应触发）
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
  await page.getByTestId('start-btn').click()
  await page.waitForSelector('[data-testid="segment"]', { timeout: 8000 })

  // ── 提问句自动触发：横幅出现 ──
  await page.waitForSelector('[data-testid="ask-notice"]', { timeout: 15000 })
  const banner = (await page.getByTestId('ask-notice').textContent()) || ''
  check('检测到课堂提问并生成回答（横幅）', banner.includes('深度求索') && banner.includes('已生成回答'), banner.trim().slice(0, 34))

  // ── 陈述句不应触发：等全部 4 段说完 ──
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="segment"]').length >= 4, {
    timeout: 20000,
  })
  await page.waitForTimeout(2500) // 等可能的异步判定

  // ── 字幕句带 🤔提问 标签 ──
  const segTagged = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="segment"]')].some((el) => el.textContent?.includes('🤔提问')),
  )
  check('提问句字幕带 🤔提问 标签', segTagged)

  // ── 点横幅查看回答（打开面板后计数：仅提问那 1 对，陈述句未被误答）──
  await page.getByTestId('ask-notice').click()
  await page.waitForSelector('[data-testid="ask-sheet"]', { timeout: 3000 })
  const answerCount = await page.locator('[data-testid="ask-answer"]').count()
  check('仅课堂提问被回答（陈述句零误答）', answerCount === 1, `当前 ${answerCount} 对`)
  const lastAnswer = (await page.locator('[data-testid="ask-answer"]').last().textContent()) || ''
  check('点横幅打开问答面板且回答在列', lastAnswer.includes('演示回答'), lastAnswer.slice(0, 22))
  const userMsg = ((await page.getByTestId('ask-body').textContent()) || '').includes('（课堂提问）深度求索是哪家公司')
  check('问答面板标记「自动捕获」来源', userMsg)
  await page.screenshot({ path: 'shots/14-主动回答面板.png' })
  await page.getByTestId('ask-close').click()
  await page.waitForTimeout(300)

  // ── 设置开关存在 ──
  await page.locator('nav').getByText('设置').click()
  await page.waitForTimeout(300)
  check('设置页有「自动回答课堂提问」开关', await page.getByTestId('proactive-on').isVisible())
  await page.screenshot({ path: 'shots/15-设置-自动回答开关.png' })

  // ── 停止保存：问答（去前缀）进记录 ──
  await page.locator('nav').getByText('课堂').click()
  await page.getByTestId('stop-btn').click()
  await page.waitForSelector('[data-testid="toast"]', { timeout: 5000 })
  await page.locator('nav').getByText('记录').click()
  await page.waitForSelector('[data-testid="record-card"]', { timeout: 5000 })
  await page.getByTestId('record-toggle').first().click()
  await page.waitForSelector('[data-testid="record-qas"]', { timeout: 3000 })
  const qas = (await page.getByTestId('record-qas').textContent()) || ''
  check('记录问答已去除「（课堂提问）」前缀存档', qas.includes('Q：深度求索是哪家公司') && !qas.includes('（课堂提问）'))
  await page.screenshot({ path: 'shots/16-记录-主动问答.png' })
} catch (e) {
  check('测试流程无异常', false, e.message)
  await page.screenshot({ path: 'shots/94-异常.png' }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n⛔ ${failed.length} 项未通过` : '\n🎉 M4.2 验收全部通过')
process.exit(failed.length ? 1 : 0)
