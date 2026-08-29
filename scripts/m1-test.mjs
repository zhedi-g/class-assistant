// M1 验收测试：手机视口下走通 设置→保存→加密→刷新回读→连接测试 全流程
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
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
})
const page = await ctx.newPage()

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  check('页面打开且标题正确', (await page.title()).includes('课堂学习助手'))
  await page.screenshot({ path: 'shots/01-课堂.png' })

  // ── 设置页填写 ──
  await page.locator('nav').getByText('设置').click()
  await page.waitForTimeout(400)
  await page.getByPlaceholder('讯飞 APPID').fill('test-appid-123')
  await page.getByPlaceholder('讯飞 APIKey').fill('fake-ifly-key')
  await page.getByPlaceholder('讯飞 APISecret').fill('fake-ifly-secret')
  await page.getByPlaceholder('智谱 API Key').fill('fake-zhipu-key')
  await page.getByPlaceholder('DeepSeek API Key').fill('sk-fake-deepseek')
  await page.waitForTimeout(600) // 等待加密写盘
  await page.screenshot({ path: 'shots/02-设置.png' })
  check('五个字段均可输入', true)

  // ── 连接测试：假 Key 应给出友好失败提示 ──
  await page.getByTestId('zhipu-test-btn').click()
  await page.waitForSelector('[data-testid="zhipu-test-result"]', { timeout: 20000 })
  const zMsg = (await page.getByTestId('zhipu-test-result').textContent()) || ''
  check('假 Key 测试返回友好失败提示（非崩溃）', /失败|网络错误/.test(zMsg), zMsg.trim())

  // ── localStorage 不出现明文密钥 ──
  const lsDump = await page.evaluate(() => {
    const out = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      out.push([k, localStorage.getItem(k)])
    }
    return out
  })
  const leaked = lsDump.some(
    ([, v]) => v && (v.includes('fake-zhipu-key') || v.includes('sk-fake-deepseek') || v.includes('fake-ifly-secret')),
  )
  check('localStorage 无任何明文密钥', !leaked)

  // ── IndexedDB 中为密文（enc1. 前缀）──
  const encPrefix = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('class-helper')
        req.onsuccess = () => {
          const db = req.result
          const r = db.transaction('secrets', 'readonly').objectStore('secrets').get('bundle')
          r.onsuccess = () => resolve(r.result ? String(r.result).slice(0, 5) : 'empty')
          r.onerror = () => resolve('err')
        }
        req.onerror = () => resolve('err')
      }),
  )
  check('密钥以 AES-GCM 密文存入 IndexedDB（enc1.）', encPrefix === 'enc1.', `实际前缀: ${encPrefix}`)

  // ── 刷新后解密回读 ──
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('nav').getByText('设置').click()
  await page.waitForTimeout(500)
  const reloaded = await page.getByPlaceholder('智谱 API Key').inputValue()
  check('刷新后密钥解密回读一致', reloaded === 'fake-zhipu-key')
  await page.screenshot({ path: 'shots/03-设置-刷新后.png' })

  // ── 课堂页状态联动 ──
  await page.locator('nav').getByText('课堂').click()
  await page.waitForTimeout(400)
  const bodyText = await page.textContent('body')
  check('课堂页显示讯飞/智谱「已配置」', (bodyText.match(/已配置/g) || []).length >= 2)
  await page.screenshot({ path: 'shots/04-课堂-已配置.png' })
} catch (e) {
  check('测试流程无异常', false, e.message)
  await page.screenshot({ path: 'shots/99-异常.png' }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n⛔ ${failed.length} 项未通过` : '\n🎉 M1 验收全部通过')
process.exit(failed.length ? 1 : 0)
