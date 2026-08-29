// 图片页视觉识别：GLM-4.6V-Flash（免费档）。资料里 needOcr 的页在点"分析"时按需 OCR。
import { loadSecrets } from './secretStore'

const OCR_PROMPT = '识别图中全部文字内容，按原有顺序输出纯文字；没有文字就描述图片内容一句话。不要任何解释。'

export function ocrSupported(): boolean {
  return typeof localStorage !== 'undefined' // 与热词同源：有智谱 Key 即可用
}

async function zhipuKey(): Promise<string | null> {
  const secrets = await loadSecrets()
  return secrets['zhipu.apiKey'] ?? null
}

export async function ocrImage(blob: Blob): Promise<string> {
  if (import.meta.env.VITE_MOCK_ASR === '1') {
    await new Promise((r) => setTimeout(r, 300))
    return '（演示识别）图片页文字示例：动能定理典型例题与解题步骤。'
  }
  const key = await zhipuKey()
  if (!key) throw new Error('视觉识别需要智谱 API Key')
  const b64 = await blobToBase64(blob)
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'glm-4.6v-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: b64 } },
            { type: 'text', text: OCR_PROMPT },
          ],
        },
      ],
      max_tokens: 1500,
      temperature: 0.1,
      stream: false,
    }),
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      detail = j?.error?.message || detail
    } catch {}
    throw new Error(`视觉识别失败：${detail}`)
  }
  const j = await res.json()
  return (j.choices?.[0]?.message?.content ?? '').trim()
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
