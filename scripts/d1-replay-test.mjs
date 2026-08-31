// D1 验收（回放模式）：真实课堂音频 → 已验证的直播识别链路 → 真实讯飞转写
// 需主 https 服务器（5173）运行中
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync(new URL('../xfyun.local.json', import.meta.url), 'utf8'))
const BASE = process.env.BASE_URL || 'https://localhost:5173'
const AUDIO = 'C:/Users/zhedi/Downloads/20260831_092603.m4a'
mkdirSync('shots', { recursive: true })

const browser = await chromium.launch()
const page = await (
  await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, ignoreHTTPSErrors: true })
).newPage()
page.on('console', (msg) => {
  const t = msg.text()
  console.log('[页]', t.slice(0, 160))
})

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.locator('nav').getByText('设置').click()
  await page.getByPlaceholder('讯飞 APPID').fill(cfg.appId)
  await page.getByPlaceholder('讯飞 APIKey').fill(cfg.apiKey)
  await page.getByPlaceholder('讯飞 APISecret').fill(cfg.apiSecret)
  await page.waitForTimeout(600)

  await page.locator('nav').getByText('课堂').click()
  await page.getByTestId('replay-input').setInputFiles(AUDIO)
  await page.waitForSelector('[data-testid="conn-dot"].bg-emerald-500, [data-testid="conn-dot"].bg-amber-500', { timeout: 15000 })

  // 回放 3 分钟，每 15 秒打一次进度
  let lastChars = -1
  for (let i = 1; i <= 12; i++) {
    await page.waitForTimeout(15000)
    const info = await page.evaluate(() => {
      const segs = document.querySelectorAll('[data-testid="segment"]')
      let chars = 0
      segs.forEach((el) => (chars += (el.textContent || '').length))
      const interim = document.querySelector('[data-testid="interim"]')?.textContent?.length ?? 0
      return { segs: segs.length, chars, interim }
    })
    console.log(`第 ${i * 15}s：段数 ${info.segs}，累计字数 ${info.chars}，实时字数 ${info.interim}`)
    if (info.chars >= 40) break
    lastChars = info.chars
  }
  const bodyText = (await page.locator('body').textContent()) || ''
  const sample = bodyText.slice(bodyText.indexOf('正在聆听'), bodyText.indexOf('正在聆听') + 400)
  console.log('===== 转写内容采样 =====')
  console.log(sample)
  await page.screenshot({ path: 'shots/24-回放模式-真实识别.png', fullPage: true })

  // 停止并保存
  await page.getByTestId('stop-btn').click()
  await page.waitForSelector('[data-testid="toast"]', { timeout: 8000 })
  await page.locator('nav').getByText('记录').click()
  await page.waitForSelector('[data-testid="record-card"]', { timeout: 5000 })
  const recText = (await page.getByTestId('record-card').first().textContent()) || ''
  console.log('记录页：' + recText.slice(0, 80))
  console.log(recText.length > 30 ? '\n🎉 D1 回放模式验收通过（真实音频 → 真实转写 → 已存档）' : '\n⛔ 记录内容异常')
  process.exit(recText.length > 30 ? 0 : 1)
} catch (e) {
  console.error('异常：', e.message)
  await page.screenshot({ path: 'shots/90-回放异常.png' }).catch(() => {})
  process.exit(1)
} finally {
  await browser.close()
}
