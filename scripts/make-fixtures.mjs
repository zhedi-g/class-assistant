// 合成测试样本：生成真实可解析的 pptx / pdf / txt，供 D1 解析器验收。
// pptx 用 jszip 按 OOXML 规范拼最小结构；pdf 手写最小合法 PDF（含英文文本，CJK 内嵌字体过于复杂）。
import JSZip from 'jszip'
import { writeFileSync, mkdirSync } from 'node:fs'

mkdirSync('fixtures', { recursive: true })

// ── pptx：3 页，其中第 3 页故意无文本（模拟图片型页）──
const zip = new JSZip()
zip.file(
  '[Content_Types].xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
)
zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`)
zip.file(
  'ppt/presentation.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst>
</p:presentation>`,
)
zip.file(
  'ppt/_rels/presentation.xml.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>`,
)
const slide = (texts) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${texts
    .map(
      (t) =>
        `<p:sp><p:nvSpPr/><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`,
    )
    .join('')}</p:spTree></p:cSld></p:sld>`
zip.file('ppt/slides/slide1.xml', slide(['第三章 动能定理', '合外力做的功等于动能变化']))
zip.file('ppt/slides/slide2.xml', slide(['动能定理应用：多过程问题', 'W = Ek2 - Ek1']))
// 第 3 页：无文本 + 引用一张媒体图（用 1x1 PNG 占位）
zip.file(
  'ppt/slides/slide3.xml',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:pic><p:nvPicPr/><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`,
)
zip.file(
  'ppt/slides/_rels/slide3.xml.rels',
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/img1.png"/>
</Relationships>`,
)
// 1x1 红色 PNG
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
zip.file('ppt/media/img1.png', png)
writeFileSync('fixtures/sample.png', png)
const pptxBuf = await zip.generateAsync({ type: 'nodebuffer' })
writeFileSync('fixtures/sample.pptx', pptxBuf)

// ── pdf：单页英文文本（最小合法 PDF）──
const text = 'Kinetic Energy Theorem: the work done by net force equals the change in kinetic energy.'
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  `<< /Length ${text.length + 40} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]
let pdf = '%PDF-1.4\n'
const offsets = [0]
for (let i = 0; i < objs.length; i++) {
  offsets.push(pdf.length)
  pdf += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`
}
const xrefPos = pdf.length
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
for (let i = 1; i <= objs.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`
writeFileSync('fixtures/sample.pdf', Buffer.from(pdf, 'latin1'))

// ── scan.pdf：无文字层（纯扫描页），验证"渲染成图→视觉识别→分析"全链路 ──
const scanObjs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
  '<< /Length 2 >>\nstream\n\nendstream',
]
let spdf = '%PDF-1.4\n'
const soffsets = [0]
for (let i = 0; i < scanObjs.length; i++) {
  soffsets.push(spdf.length)
  spdf += `${i + 1} 0 obj\n${scanObjs[i]}\nendobj\n`
}
const sxref = spdf.length
spdf += `xref\n0 ${scanObjs.length + 1}\n0000000000 65535 f \n`
for (let i = 1; i <= scanObjs.length; i++) spdf += `${String(soffsets[i]).padStart(10, '0')} 00000 n \n`
spdf += `trailer\n<< /Size ${scanObjs.length + 1} /Root 1 0 R >>\nstartxref\n${sxref}\n%%EOF`
writeFileSync('fixtures/scan.pdf', Buffer.from(spdf, 'latin1'))

// ── txt ──
writeFileSync(
  'fixtures/sample.txt',
  '动能定理：合外力对物体所做的功等于物体动能的变化量。\n\n表达式 W = Ek2 - Ek1，其中 Ek 为动能，W 为总功。\n\n适用范围：惯性参考系下的宏观物体。多过程问题需分段求功再求和。\n\n常见考点：变力做功、摩擦生热、与平抛运动结合。',
)

console.log('fixtures 已生成：sample.pptx（3页含图片页）, sample.pdf（1页英文）, sample.txt（4段）')
