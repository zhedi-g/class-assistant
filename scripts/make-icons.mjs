// 用 Playwright 渲染生成 PWA 图标（192/512，含 maskable 安全区版本）
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('public/icons', { recursive: true })
const sizes = [192, 512]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const size of sizes) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<!doctype html><html><body style="margin:0">
    <div id="icon" style="width:${size}px;height:${size}px;background:linear-gradient(135deg,#1d4ed8,#7c3aed);display:flex;align-items:center;justify-content:center;">
      <div style="color:#fff;font-size:${size * 0.5}px;font-weight:800;font-family:system-ui;">课</div>
    </div>
  </body></html>`)
  const el = page.locator('#icon')
  await el.screenshot({ path: `public/icons/pwa-${size}.png` })
  console.log(`生成 icons/pwa-${size}.png`)
}
await browser.close()
console.log('ICONS_DONE')
