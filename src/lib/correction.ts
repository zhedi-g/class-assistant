// 课中实时校对引擎：讯飞出句后，用文本大模型（优先 GLM-Flash 免费档）做
// 同音字/错字修正。严格约束：只纠错不改写，超时/失败/疑似幻觉一律保留原文。
import { loadSecrets } from './secretStore'
import { useSettings } from '../store/settings'

export interface Corrector {
  fix(text: string, context: string[], hotwords: string[]): Promise<string | null>
}

export function parseDict(s: string): [string, string][] {
  return s
    .split(/\r?\n/)
    .map((l) => l.split('='))
    .filter((p) => p.length === 2 && p[0].trim() && p[1].trim())
    .map((p) => [p[0].trim(), p[1].trim()])
}

export function applyDict(text: string, dict: [string, string][]): string {
  let t = text
  for (const [e, c] of dict) t = t.split(e).join(c)
  return t
}

const SYSTEM_PROMPT =
  '你是课堂语音转写校对器。任务：只修正明显的同音字、错别字和标点。规则：' +
  '1) 绝不改变原意，不增删内容，不改语序；' +
  '2) 术语按术语表修正；' +
  '3) 不确定的地方保持原样；' +
  '4) 只输出校对后的文本，不要任何解释、引号或前后缀。'

interface ProviderCfg {
  url: string
  key: string
  model: string
}

const REFINE_SYSTEM =
  '你是课堂转写精校器。学生的录音转写文本质量很差：有大量同音错字、漏字、断句错误。' +
  '请结合课程术语表和上下文，把文本修复成通顺、准确、有标点的课堂笔记式文稿。' +
  '规则：1) 只修正错字和断句，绝不增删知识内容、不改变原意；' +
  '2) 术语必须按术语表修正（如"飞机化科→分析化学""滴度→滴定"）；' +
  '3) 与学习无关的闲聊段落原样保留，不要删除；' +
  '4) 不确定的表述保持原样；5) 直接输出修复后的全文，不要任何解释。'

/** 全文精校：把低质量转写文本修复为干净稿（分块处理，保留原稿可对照） */
export async function refineTranscript(
  raw: string,
  hotwords: string[],
  dict: [string, string][] = [],
): Promise<{ refined: string; chunks: { in: string; out: string }[] }> {
  const secrets = await loadSecrets()
  const s = useSettings.getState()
  let cfg: { url: string; key: string; models: string[] } | null = null
  if (secrets['zhipu.apiKey']) {
    cfg = {
      url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      key: secrets['zhipu.apiKey'],
      models: ['glm-4.6', 'glm-4-flash'],
    }
  } else if (secrets['deepseek.apiKey']) {
    cfg = { url: 'https://api.deepseek.com/chat/completions', key: secrets['deepseek.apiKey'], models: [s.deepseekModel || 'deepseek-v4-flash'] }
  }
  if (!cfg) throw new Error('精校需要智谱或 DeepSeek 的 API Key')

  // 按 ~2200 字切块（在句号/问号边界切，避免拆散句子）
  const text = raw.trim()
  if (!text) return { refined: '', chunks: [] }
  const sentences = text.split(/(?<=[。？！；.?!])/)
  const chunksIn: string[] = []
  let buf = ''
  for (const sent of sentences) {
    if (buf.length + sent.length > 2200 && buf) {
      chunksIn.push(buf)
      buf = ''
    }
    buf += sent
  }
  if (buf) chunksIn.push(buf)

  const termLine = (hotwords.length ? `【课程术语表】${hotwords.join('、')}\n` : '') + (dict.length ? `【纠错词典（必须遵循）】${dict.map(([e, c]) => `${e}→${c}`).join('；')}\n` : '')
  const chunks: { in: string; out: string }[] = []
  let refined = ''
  for (const chunkRaw of chunksIn) {
    // 词典先行本地替换，再送 LLM 精校
    const chunkIn = applyDict(chunkRaw, dict)
    let out = chunkIn
    let lastErr: Error = new Error('精校失败')
    for (const model of cfg.models) {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 120_000)
        const res = await fetch(cfg.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify({
          model,
          thinking: { type: 'disabled' },
          messages: [
            { role: 'system', content: REFINE_SYSTEM },
            { role: 'user', content: termLine + '【待精校转写】\n' + chunkIn },
          ],
          max_tokens: 4000,
          temperature: 0.1,
          stream: false,
        }),
          signal: ctrl.signal,
        })
        clearTimeout(timer)
        if (!res.ok) {
          let detail = `HTTP ${res.status}`
          try {
            const j = await res.json()
            detail = j?.error?.message || j?.message || detail
          } catch {}
          throw new Error(detail)
        }
        const j = await res.json()
        out = (j.choices?.[0]?.message?.content ?? '').trim()
        if (!out) out = chunkIn
        chunks.push({ in: chunkIn, out })
        refined += (refined ? '\n' : '') + out
        lastErr = new Error('ok')
        break
      } catch (e) {
        lastErr = e as Error
      }
    }
    if (lastErr.message !== 'ok') {
      // 该块精校失败：保留原文并注明
      chunks.push({ in: chunkIn, out: chunkIn })
      refined += (refined ? '\n' : '') + chunkIn
    }
  }
  return { refined, chunks }
}

export async function createCorrector(): Promise<Corrector | null> {
  const secrets = await loadSecrets()
  const s = useSettings.getState()
  let cfg: ProviderCfg | null = null
  if (secrets['zhipu.apiKey']) {
    cfg = { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', key: secrets['zhipu.apiKey'], model: 'glm-4-flash' }
  } else if (secrets['deepseek.apiKey']) {
    cfg = { url: 'https://api.deepseek.com/chat/completions', key: secrets['deepseek.apiKey'], model: s.deepseekModel || 'deepseek-v4-flash' }
  }
  if (!cfg) return null

  return {
    async fix(text, context, hotwords) {
      // 纠错词典先行本地替换（零成本、零延迟）
      const dict = parseDict(useSettings.getState().corrections)
      const corrected = applyDict(text, dict)
      text = corrected
      const parts: string[] = []
      if (dict.length) parts.push(`【纠错词典（必须遵循）】${dict.map(([e, c]) => `${e}→${c}`).join('；')}`)
      if (hotwords.length) parts.push(`【术语表】${hotwords.join('、')}`)
      if (context.length) parts.push(`【上文】${context.join(' / ')}`)
      parts.push(`【待校对】${text}`)
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 5000)
        const res = await fetch(cfg.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: parts.join('\n') },
            ],
            max_tokens: 600,
            temperature: 0.1,
            stream: false,
          }),
          signal: ctrl.signal,
        })
        clearTimeout(timer)
        if (!res.ok) return null
        const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
        const out = (j.choices?.[0]?.message?.content ?? '').trim()
        // 防幻觉兜底：输出为空、比原文长出一倍、或完全没变，都视为无效
        if (!out || out === text || out.length > text.length * 2 + 10) return null
        return out
      } catch {
        return null
      }
    },
  }
}
