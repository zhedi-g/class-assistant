// 课中实时校对引擎：讯飞出句后，用文本大模型（优先 GLM-Flash 免费档）做
// 同音字/错字修正。严格约束：只纠错不改写，超时/失败/疑似幻觉一律保留原文。
import { loadSecrets } from './secretStore'
import { useSettings } from '../store/settings'

export interface Corrector {
  fix(text: string, context: string[], hotwords: string[]): Promise<string | null>
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
      const parts: string[] = []
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
