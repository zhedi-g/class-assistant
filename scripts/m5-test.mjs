// M5 E2E 验收（D3+优化+扫描件修复）：上传 txt/文字版PDF/扫描版PDF/图片 → 解析 → 自动视觉识别 → 分析 → 页级操作 → 术语回写 → 持久化
// 需先启动 mock dev server：VITE_MOCK_ASR=1 pnpm dev:mock（端口 5174）
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL || 'https://localhost:5174'
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

  // ── 上传 4 份资料：文本 / 文字版PDF / 扫描版PDF(无文字层) / 图片 ──
  const f = (p) => fileURLToPath(new URL(p, import.meta.url))
  await page.setInputFiles('[data-testid="mat-input"]', [
    f('../fixtures/sample.txt'),
    f('../fixtures/sample.pdf'),
    f('../fixtures/scan.pdf'),
    f('../fixtures/sample.png'),
  ])
  await page.waitForSelector('[data-testid="material-card"]', { timeout: 8000 })
  await page.waitForTimeout(1000) // 等四个文件都解析完
  const cardCount = await page.getByTestId('material-card').count()
  check('四份资料卡均出现', cardCount === 4, `实际 ${cardCount} 张卡`)

  // ── 文字版 PDF 真实解析（浏览器 pdf.js worker 路径）──
  // 列表按时间倒序：png(0) scan.pdf(1) sample.pdf(2) txt(3)
  await page.getByTestId('material-toggle').nth(2).click()
  await page.waitForTimeout(300)
  await page.getByTestId('material-card').nth(2).locator('summary').first().click()
  await page.waitForTimeout(300)
  const pdfText = (await page.locator('body').textContent()) || ''
  check('文字版 PDF 解析成功（文字层可读）', pdfText.includes('Kinetic Energy Theorem'), '')
  await page.getByTestId('material-toggle').nth(2).click() // 收起
  await page.waitForTimeout(200)

  // ── 扫描版 PDF：自动视觉识别 → 分析（上次用户实测的失败场景）──
  await page.getByTestId('material-toggle').nth(1).click()
  await page.waitForSelector('[data-testid="analyze-btn"]', { timeout: 3000 })
  await page.getByTestId('analyze-btn').click()
  await page.waitForSelector('[data-testid="analysis-result"]', { timeout: 25000 })
  const scanBody = (await page.locator('body').textContent()) || ''
  check('扫描 PDF：分析前自动视觉识别并回填（演示识别）', scanBody.includes('演示识别'), '')
  check('扫描 PDF：联合分析正常完成（不再拒绝/幻觉）', scanBody.includes('提纲') && !scanBody.includes('解析失败'), '')
  await page.screenshot({ path: 'shots/18-扫描PDF-自动识别.png' })

  // ── 页级操作面板（扫描页此时已有识别出的文字）──
  await page.locator('summary').first().click()
  await page.waitForSelector('[data-testid="mat-page"]', { timeout: 3000 })
  await page.getByTestId('mat-page').first().click()
  await page.waitForSelector('[data-testid="page-sheet"]', { timeout: 3000 })
  const sheetText = ((await page.getByTestId('page-sheet').textContent()) || '').includes('演示识别')
  check('页面板显示识别后的真实文字', sheetText)
  await page.getByTestId('act-page-parse').click()
  await page.waitForSelector('[data-testid="page-answer"]', { timeout: 15000 })
  const pAns = (await page.locator('[data-testid="page-answer"]').last().textContent()) || ''
  check('「解析本段」基于识别文字回答', pAns.includes('演示回答'), pAns.slice(0, 22))
  await page.getByTestId('act-page-mark').click()
  await page.waitForSelector('text=已标记为重点段落', { timeout: 3000 })
  check('段落重点标记生效', true)
  await page.screenshot({ path: 'shots/14-页级操作面板.png' })
  await page.getByTestId('page-close').click()
  await page.waitForTimeout(300)

  // ── 术语回写热词 ──
  await page.getByTestId('merge-terms').click()
  await page.waitForSelector('[data-testid="toast"]', { timeout: 3000 })
  const toast = (await page.getByTestId('toast').textContent()) || ''
  check('术语合并提示出现', toast.includes('热词'), toast.trim())

  await page.locator('nav').getByText('设置').click()
  await page.waitForTimeout(300)
  const hw = (await page.locator('textarea').first().inputValue()) || ''
  check('热词已写入设置（动能定理）', hw.includes('动能定理'), hw.slice(0, 40))

  // ── 刷新持久化（分析结果 + 重点标记）──
  // 刷新后打开 scan.pdf 卡（nth(1)：png 在本用例中未分析，scan.pdf 有分析结果+重点标记）
  await page.locator('nav').getByText('资料').click()
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('nav').getByText('资料').click()
  await page.waitForSelector('[data-testid="material-card"]', { timeout: 5000 })
  await page.getByTestId('material-toggle').nth(1).click()
  await page.waitForSelector('[data-testid="analysis-result"]', { timeout: 5000 })
  check('刷新后分析结果仍在（持久化）', ((await page.getByTestId('analysis-result').textContent()) || '').includes('提纲'))
  await page.locator('summary').first().click()
  await page.waitForSelector('[data-testid="mat-page"]', { timeout: 3000 })
  const markedVisible = ((await page.locator('body').textContent()) || '').includes('🚩')
  check('刷新后页面重点标记仍在（持久化）', markedVisible)
} catch (e) {
  check('测试流程无异常', false, e.message)
  await page.screenshot({ path: 'shots/93-异常.png' }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n⛔ ${failed.length} 项未通过` : '\n🎉 M5 验收全部通过')
process.exit(failed.length ? 1 : 0)
