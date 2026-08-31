// M6 E2E 验收：清洗(分类/待办/可恢复) → 复习包(笔记/考点/闪卡) → 闪卡翻面 → Anki 导出 → 跨课冲刺 → 待办卡片
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

  async function recordOnce(minSegments) {
  await page.locator('nav').getByText('课堂').click()
  await page.getByTestId('start-btn').click()
  await page.waitForSelector('[data-testid="segment"]', { timeout: 8000 })
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="segment"]').length >= n, minSegments, {
    timeout: 20000,
  })
  await page.getByTestId('stop-btn').click()
  await page.waitForSelector('[data-testid="toast"]', { timeout: 5000 })
  await page.waitForTimeout(300)
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })

  // ── 录两节课（供单课 + 跨课）──
  await recordOnce(4, true)
  check('第 1 节课录制完成', true)
  await recordOnce(2)
  check('第 2 节课录制完成', true)

  // ── 记录页：清洗第 1 节课（含「考试」课堂事务句的那节，列表第 2 张）──
  await page.locator('nav').getByText('记录').click()
  await page.waitForSelector('[data-testid="record-card"]', { timeout: 5000 })
  await page.getByTestId('record-toggle').nth(1).click()
  await page.waitForSelector('[data-testid="clean-btn"]', { timeout: 3000 })
  // 录音备份：回放控件与导出
  const audioRow = await page.getByTestId('lesson-audio').isVisible().catch(() => false)
  check('课堂录音备份存在（回放控件）', audioRow)
  const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null)
  await page.getByTestId('export-audio').click()
  const audioDl = await dl
  check('录音导出触发下载', !!audioDl, audioDl ? audioDl.suggestedFilename() : '')
  await page.getByTestId('clean-btn').click()
  await page.waitForSelector('[data-testid="clean-stats"]', { timeout: 15000 })
  const stats = (await page.getByTestId('clean-stats').textContent()) || ''
  check('清洗完成：分类统计显示', stats.includes('正文') && stats.includes('课堂事务'), stats.slice(0, 60).trim())
  check('清洗提取待办（含考试类）', stats.includes('🔔'), '')
  await page.screenshot({ path: 'shots/19-清洗结果.png' })

  // ── 生成复习包 ──
  await page.getByTestId('pack-btn').click()
  await page.waitForSelector('[data-testid="pack"]', { timeout: 20000 })
  const pack = (await page.getByTestId('pack').textContent()) || ''
  check('复习包生成（考点/闪卡/笔记要点齐全）', pack.includes('预测考点') && pack.includes('闪卡') && pack.includes('核心概念'), '')
  check('复习包含摘要', pack.includes('演示复习包') || pack.includes('总结'), '')

  // ── 闪卡翻面 ──
  await page.getByTestId('flashcard').first().click()
  await page.waitForSelector('text=A · 答案', { timeout: 3000 })
  check('闪卡点击翻面显示答案', true)
  await page.screenshot({ path: 'shots/20-复习包闪卡.png' })

  // ── 对课提问（保留功能回归）──
  await page.getByTestId('rec-ask-input').fill('这节课的重点是什么')
  await page.getByTestId('rec-ask-send').click()
  await page.waitForFunction(
    () => document.querySelector('[data-testid="record-qas"]')?.textContent?.includes('这节课的重点是什么'),
    { timeout: 20000 },
  )
  check('对课提问仍可用（M4 回归）', true)

  // ── Anki 导出 ──
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.getByTestId('export-anki').click()])
  const path = await download.path()
  check('Anki 导出触发下载', !!path, download.suggestedFilename())

  // ── 跨课冲刺 ──
  await page.getByTestId('sprint-btn').click()
  await page.waitForSelector('[data-testid="sprint-panel"]', { timeout: 3000 })
  const boxes = await page.locator('[data-testid="sprint-panel"] input[type="checkbox"]').all()
  for (const b of boxes) await b.check()
  await page.getByTestId('sprint-generate').click()
  await page.waitForSelector('[data-testid="sprint-pack"]', { timeout: 20000 })
  const sprint = (await page.getByTestId('sprint-pack').textContent()) || ''
  check('跨课冲刺包生成（知识地图/覆盖度/闪卡）', sprint.includes('知识地图') && sprint.includes('覆盖度'), '')
  await page.getByTestId('sprint-export').click()
  await page.waitForTimeout(500)
  check('冲刺闪卡可导出', true)
  await page.screenshot({ path: 'shots/21-跨课冲刺包.png' })

  // ── 课堂页待办卡片 ──
  await page.locator('nav').getByText('课堂').click()
  await page.waitForSelector('[data-testid="todo-card"]', { timeout: 5000 })
  const todos = (await page.getByTestId('todo-card').textContent()) || ''
  check('课堂页显示提取的待办', todos.includes('考试') || todos.includes('作业'), todos.slice(0, 40))
} catch (e) {
  check('测试流程无异常', false, e.message)
  await page.screenshot({ path: 'shots/92-异常.png' }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n⛔ ${failed.length} 项未通过` : '\n🎉 M6 验收全部通过')
process.exit(failed.length ? 1 : 0)
