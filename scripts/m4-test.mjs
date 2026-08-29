// M4.1 验收测试：问AI按钮/点句唤起 → 流式回答 → 历史保留 → 下课随记录存档 → 课后对课提问 → 刷新仍在
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

  // ── 显眼的「问 AI」按钮唤起（不依赖点字幕句）──
  await page.getByTestId('ask-fab').click()
  await page.waitForSelector('[data-testid="ask-sheet"]', { timeout: 3000 })
  check('「问 AI」按钮唤起弹层', true)

  // ── 提问 → 流式回答 ──
  await page.getByTestId('ask-input').fill('动能定理是什么意思')
  await page.getByTestId('ask-send').click()
  await page.waitForFunction(() => {
    const answers = document.querySelectorAll('[data-testid="ask-answer"]')
    const last = answers[answers.length - 1]
    return last && last.textContent && last.textContent.length > 20
  }, { timeout: 15000 })
  check('AI 流式回答产出', true)
  await page.waitForSelector('text=基于本节课最近字幕', { timeout: 5000 })
  check('回答带来源标注', true)
  await page.screenshot({ path: 'shots/11-问答弹层.png' })

  // ── 历史：关闭再打开，问答仍在 ──
  await page.getByTestId('ask-close').click()
  await page.waitForTimeout(300)
  await page.getByTestId('ask-fab').click()
  await page.waitForSelector('[data-testid="ask-sheet"]', { timeout: 3000 })
  const bodyAfterReopen = (await page.getByTestId('ask-body').textContent()) || ''
  check('问答历史保留（关了再开还在）', bodyAfterReopen.includes('动能定理是什么意思'))
  await page.getByTestId('ask-close').click()
  await page.waitForTimeout(300)

  // ── 结束课堂：问答随记录存档 ──
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="segment"]').length >= 2, {
    timeout: 15000,
  })
  await page.getByTestId('stop-btn').click()
  await page.waitForSelector('[data-testid="toast"]', { timeout: 5000 })

  // ── 记录详情：问答区 + 对课提问 ──
  await page.locator('nav').getByText('记录').click()
  await page.waitForSelector('[data-testid="record-card"]', { timeout: 5000 })
  await page.getByTestId('record-toggle').first().click()
  await page.waitForSelector('[data-testid="record-qas"]', { timeout: 3000 })
  const qas = (await page.getByTestId('record-qas').textContent()) || ''
  check('记录详情显示问答存档', qas.includes('动能定理是什么意思'), qas.slice(0, 40))

  await page.getByTestId('rec-ask-input').fill('这节课的重点是什么')
  await page.getByTestId('rec-ask-send').click()
  await page.waitForFunction(
    () => document.querySelector('[data-testid="record-qas"]')?.textContent?.includes('这节课的重点是什么'),
    { timeout: 15000 },
  )
  check('课后对课提问并写入记录', true)
  await page.screenshot({ path: 'shots/13-记录问答区.png' })

  // ── 刷新后问答仍在（持久化）──
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('nav').getByText('记录').click()
  await page.waitForSelector('[data-testid="record-card"]', { timeout: 5000 })
  await page.getByTestId('record-toggle').first().click()
  await page.waitForSelector('[data-testid="record-qas"]', { timeout: 3000 })
  const persisted = (await page.getByTestId('record-qas').textContent()) || ''
  check('刷新后问答仍在（持久化）', persisted.includes('这节课的重点是什么'))
} catch (e) {
  check('测试流程无异常', false, e.message)
  await page.screenshot({ path: 'shots/95-异常.png' }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n⛔ ${failed.length} 项未通过` : '\n🎉 M4.1 验收全部通过')
process.exit(failed.length ? 1 : 0)
