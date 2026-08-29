// D1 解析器验收测试：Node 层直接跑 src/lib/material.ts，验证四种格式解析正确。
// 运行：pnpm test:d1（需先 node scripts/make-fixtures.mjs）
import { readFileSync } from 'node:fs'
import { detectKind, parsePptx, parsePdf, parseText, parseImage } from '../src/lib/material'

function toFile(path: string, type: string): File {
  const buf = readFileSync(new URL(`../${path}`, import.meta.url))
  const name = path.split('/').pop()!
  return new File([buf], name, { type })
}

const results: { name: string; ok: boolean; detail?: string }[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`)
}

// ── detectKind ──
check('识别 pptx', detectKind('课件.pptx', '') === 'pptx')
check('识别 pdf', detectKind('讲义.pdf', 'application/pdf') === 'pdf')
check('识别 文本', detectKind('笔记.md', 'text/markdown') === 'text')
check('识别 图片', detectKind('板书.jpg', 'image/jpeg') === 'image')
check('拒绝不支持的格式', detectKind('压缩包.zip', '') === null)

// ── pptx ──
{
  const pages = await parsePptx(toFile('fixtures/sample.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'))
  check('pptx 解析出 3 页', pages.length === 3, `实际 ${pages.length} 页`)
  check('第 1 页含标题文本', pages[0]?.text.includes('动能定理') && pages[0]?.text.includes('第三章'), pages[0]?.text.slice(0, 30))
  check('第 2 页含公式文本', pages[1]?.text.includes('Ek2'), pages[1]?.text.slice(0, 30))
  const imgPage = pages[2]
  check('无文本页标记 needOcr', imgPage?.needOcr === true && (imgPage.text ?? '') === '')
  check('无文本页收集到内嵌图片', (imgPage?.imageBlobs?.length ?? 0) >= 1)
}

// ── pdf ──
{
  const pages = await parsePdf(toFile('fixtures/sample.pdf', 'application/pdf'))
  check('pdf 解析出 1 页', pages.length === 1, `实际 ${pages.length} 页`)
  check('pdf 文字层抽取正确', pages[0]?.text.includes('Kinetic Energy Theorem'), pages[0]?.text.slice(0, 40))
}

// ── 文本 ──
{
  const pages = await parseText(toFile('fixtures/sample.txt', 'text/plain'))
  check('文本分段入库', pages.length >= 1 && pages[0].text.includes('动能定理'), `实际 ${pages.length} 段`)
  const all = pages.map((p) => p.text).join('')
  check('文本内容完整（含考点段）', all.includes('平抛运动'))
}

// ── 图片 ──
{
  const fakePng = new File([new Uint8Array([137, 80, 78, 71])], '板书.png', { type: 'image/png' })
  const pages = await parseImage(fakePng)
  // 仅验证结构约定：needOcr + blob 载体
  check('图片约定 needOcr 页', pages.length === 1 && pages[0].needOcr === true && pages[0].imageBlobs?.length === 1)
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n⛔ ${failed.length} 项未通过` : '\n🎉 D1 解析器验收全部通过')
process.exit(failed.length ? 1 : 0)
