// 资料解析器：pptx / pdf / 文本 / 图片 → 统一的 MaterialPage[]。
// 全部在浏览器本地完成，文件内容不出设备；仅文本在用户点"分析"时送 AI。
import JSZip from 'jszip'
import type { MaterialKind, MaterialPage, QaPair } from './db'
import { db } from './db'

export interface ParseProgress {
  (done: number, total: number, note?: string): void
}

export function detectKind(fileName: string, mime: string): MaterialKind | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  if (ext === 'pptx' || mime.includes('presentationml')) return 'pptx'
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf'
  if (['txt', 'md', 'markdown'].includes(ext) || mime.startsWith('text/')) return 'text'
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext) || mime.startsWith('image/')) return 'image'
  return null
}

/** pptx：本质是 zip。逐 slide 抽 <a:t> 文本；无文本的页标记 needOcr 并收集该页引用的图片 */
export async function parsePptx(file: File, onProgress?: ParseProgress): Promise<MaterialPage[]> {
  // 先转 ArrayBuffer：浏览器 File 与 Node 环境都能被 JSZip 接受
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const slideEntries = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/)?.[1] ?? 0)
      const nb = Number(b.match(/slide(\d+)/)?.[1] ?? 0)
      return na - nb
    })
  const pages: MaterialPage[] = []
  for (let i = 0; i < slideEntries.length; i++) {
    const name = slideEntries[i]
    const xml = await zip.file(name)!.async('string')
    // <a:t> 运行文本；XML 实体还原
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) =>
      m[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'"),
    )
    const text = runs.join(' ').replace(/\s+/g, ' ').trim()

    const page: MaterialPage = { label: `第 ${i + 1} 页`, text }
    if (!text) {
      // 图片型页：找该页关系文件引用的媒体图片
      const num = name.match(/slide(\d+)/)![1]
      const relName = `ppt/slides/_rels/slide${num}.xml.rels`
      const relFile = zip.file(relName)
      if (relFile) {
        const relXml = await relFile.async('string')
        const mediaNames = [...relXml.matchAll(/Target="\.\.\/media\/([^"]+)"/g)].map((m) => `ppt/media/${m[1]}`)
        const blobs: Blob[] = []
        for (const mn of mediaNames.slice(0, 3)) {
          const mf = zip.file(mn)
          if (mf && !mf.dir) blobs.push(await mf.async('blob'))
        }
        if (blobs.length > 0) {
          page.needOcr = true
          page.imageBlobs = blobs
        }
      }
    }
    pages.push(page)
    onProgress?.(i + 1, slideEntries.length, `解析幻灯片 ${i + 1}/${slideEntries.length}`)
  }
  return pages
}

/** pdf：pdf.js 文字层；无文字层的页标记 needOcr（渲染成图由调用方处理，D2 接视觉） */
export async function parsePdf(file: File, onProgress?: ParseProgress): Promise<MaterialPage[]> {
  // 浏览器用主构建；Node（测试环境）没有 DOMMatrix，需用 legacy 构建
  const pdfjs =
    typeof window === 'undefined'
      ? await import('pdfjs-dist/legacy/build/pdf.mjs')
      : await import('pdfjs-dist')
  if (typeof window !== 'undefined') {
    // 浏览器端必须配置 worker 脚本地址（Vite 以资产 URL 引入），否则解析 PDF 报
    // "No GlobalWorkerOptions.workerSrc specified"
    const mod = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')) as { default: string }
    pdfjs.GlobalWorkerOptions.workerSrc = mod.default
  }
  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const pages: MaterialPage[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    const p: MaterialPage = { label: `第 ${i} 页`, text }
    if (!text) p.needOcr = true
    pages.push(p)
    onProgress?.(i, doc.numPages, `解析 PDF ${i}/${doc.numPages}`)
  }
  return pages
}

/** 文本：按空行分段，约每 800 字一"页" */
export async function parseText(file: File): Promise<MaterialPage[]> {
  const raw = await file.text()
  const paras = raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const pages: MaterialPage[] = []
  let buf = ''
  let n = 0
  for (const p of paras) {
    if (buf && (buf + p).length > 800) {
      pages.push({ label: `第 ${++n} 段`, text: buf })
      buf = ''
    }
    buf += (buf ? '\n' : '') + p
  }
  if (buf) pages.push({ label: `第 ${++n} 段`, text: buf })
  return pages
}

/** 图片：整页 needOcr */
export async function parseImage(file: File): Promise<MaterialPage[]> {
  return [{ label: '图片 1', text: '', needOcr: true, imageBlobs: [file] }]
}

export async function parseMaterial(
  file: File,
  kind: MaterialKind,
  onProgress?: ParseProgress,
): Promise<MaterialPage[]> {
  switch (kind) {
    case 'pptx':
      return parsePptx(file, onProgress)
    case 'pdf':
      return parsePdf(file, onProgress)
    case 'text':
      return parseText(file)
    case 'image':
      return parseImage(file)
  }
}

/** 追加资料问答（读改写，避免闭包旧值覆盖） */
export async function addMaterialQa(id: number, pair: QaPair): Promise<void> {
  const rec = await db.materials.get(id)
  if (!rec) return
  await db.materials.update(id, { qas: [...(rec.qas ?? []), pair] })
}

/** 切换某页/段的重点标记，返回新状态；资料不存在返回 null */
export async function togglePageMark(id: number, label: string): Promise<boolean | null> {
  const rec = await db.materials.get(id)
  if (!rec) return null
  const pages = rec.pages.map((p) => (p.label === label ? { ...p, marked: !p.marked } : p))
  await db.materials.update(id, { pages })
  return pages.find((p) => p.label === label)?.marked ?? null
}
