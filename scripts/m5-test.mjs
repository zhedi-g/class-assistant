// M5 E2E 验收：上传资料 → 本地解析 → 预习分析（Mock）→ 结果卡片 → 术语回写热词
// 需先启动 mock dev server：VITE_MOCK_ASR=1 pnpm dev:mock（端口 5174）
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL || 'https://localhost:5174'
const SAMPLE_TXT = new URL('../fixtures/sample.txt', import.meta.url)
mkdirSync('shots', { recursive: true })

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
  ignoreHTTPSErrors: true,
})
const page = await ctx.newPage()

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })

  // ── 导航出现「资料」Tab ──
  await page.locator('nav').getByText('资料').click()
  await page.waitForSelector('[data-testid="upload-btn"]', { timeout: 5000 })
  check('「资料」Tab 可进入，上传按钮可见', true)

  // ── 上传 txt 资料 ──
  await page.setInputFiles('[data-testid="mat-input"]', fileURLToPath(SAMPLE_TXT))
  await page.waitForSelector('[data-testid="material-card"]', { timeout: 8000 })
  const card = (await page.getByTestId('material-toggle').textContent()) || ''
  check('上传后卡片出现且解析就绪', card.includes('1 页'), card.trim().slice(0, 40))

  // ── 展开详情（上传后已自动展开则不重复点）──
  const alreadyOpen = await page
    .locator('[data-testid="analyze-btn"]')
    .isVisible()
    .catch(() => false)
  if (!alreadyOpen) {
    await page.getByTestId('material-toggle').click()
    await page.waitForSelector('[data-testid="analyze-btn"]', { timeout: 3000 })
  }
  check('详情展开，分析入口可见', true)
  await page.getByTestId('analyze-btn').click()
  // 无相关记录时应直接进入分析（预览模式）
  const resultAppear = await page
    .waitForSelector('[data-testid="analysis-result"]', { timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  check('预习模式分析完成（结果卡片出现）', resultAppear)

  // ── 结果卡片内容 ──
  const result = (await page.getByTestId('analysis-result').textContent()) || ''
  check('结果含提纲', result.includes('提纲'))
  check('结果含核心术语', result.includes('核心术语'))
  check('结果含预习行动建议', result.includes('预习'))
  await page.screenshot({ path: 'shots/17-资料-预习包.png' })

  // ── 术语回写热词 ──
  await page.getByTestId('merge-terms').click()
  await page.waitForSelector('[data-testid="toast"]', { timeout: 3000 })
  const toast = (await page.getByTestId('toast').textContent()) || ''
  check('术语合并提示出现', toast.includes('热词'), toast.trim())

  await page.locator('nav').getByText('设置').click()
  await page.waitForTimeout(300)
  const hw = (await page.locator('textarea').first().inputValue()) || ''
  check('热词已写入设置（动能定理）', hw.includes('动能定理'), hw.slice(0, 40))

  // ── 刷新持久化 ──
  await page.locator('nav').getByText('资料').click()
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('nav').getByText('资料').click()
  await page.waitForSelector('[data-testid="material-card"]', { timeout: 5000 })
  await page.getByTestId('material-toggle').click()
  await page.waitForSelector('[data-testid="analysis-result"]', { timeout: 5000 })
  check('刷新后分析结果仍在（持久化）', ((await page.getByTestId('analysis-result').textContent()) || '').includes('提纲'))
} catch (e) {
  check('测试流程无异常', false, e.message)
  await page.screenshot({ path: 'shots/93-异常.png' }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n⛔ ${failed.length} 项未通过` : '\n🎉 M5-D3 验收全部通过')
process.exit(failed.length ? 1 : 0)
