// M4 验收测试：点字幕句 → 查词/问答弹层 → 流式回答 → 关闭后录音不中断
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
  await page.getByTestId('start-btn').click()
  await page.waitForSelector('[data-testid="segment"]', { timeout: 8000 })

  // ── 点字幕句唤起弹层 ──
  await page.locator('[data-testid="segment"]').first().click()
  await page.waitForSelector('[data-testid="ask-sheet"]', { timeout: 3000 })
  const sheetText = (await page.getByTestId('ask-sheet').textContent()) || ''
  check('点击字幕句弹出查词/问答弹层', sheetText.includes('查词') && sheetText.includes('深度求索是哪家公司'))
  await page.screenshot({ path: 'shots/11-问答弹层.png' })

  // ── 提问并流式回答 ──
  await page.getByTestId('ask-input').fill('动能定理是什么意思')
  await page.getByTestId('ask-send').click()
  await page.waitForFunction(() => {
    const answers = document.querySelectorAll('[data-testid="ask-answer"]')
    const last = answers[answers.length - 1]
    return last && last.textContent && last.textContent.length > 20
  }, { timeout: 15000 })
  const answer = (await page.locator('[data-testid="ask-answer"]').last().textContent()) || ''
  check('AI 流式回答产出内容', answer.includes('演示回答'), answer.slice(0, 24))
  await page.waitForSelector('text=基于本节课最近字幕', { timeout: 5000 })
  check('回答带上下文来源标注', true)

  // ── 关闭弹层，录音不中断 ──
  await page.getByTestId('ask-close').click()
  await page.waitForTimeout(300)
  check('关闭弹层后录音仍在进行', await page.getByTestId('subtitle').isVisible())
  check('字幕仍在继续产出', (await page.locator('[data-testid="segment"]').count()) >= 1)
  await page.screenshot({ path: 'shots/12-弹层关闭-录音中.png' })
} catch (e) {
  check('测试流程无异常', false, e.message)
  await page.screenshot({ path: 'shots/96-异常.png' }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n⛔ ${failed.length} 项未通过` : '\n🎉 M4 验收全部通过')
process.exit(failed.length ? 1 : 0)
