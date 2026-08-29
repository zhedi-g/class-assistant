// 课中 AI 问答：OpenAI 兼容 SSE 流式输出。优先免费 GLM-Flash，未配 Key 时报明确错误；
// Mock 模式（VITE_MOCK_ASR=1）输出固定演示回答供 UI 验收。
import { loadSecrets } from './secretStore'
import { useSettings } from '../store/settings'

export interface AskOptions {
  question: string
  /** 附带的课堂上下文（选中句、最近字幕等） */
  context?: string
  onDelta: (delta: string) => void
}

const SYSTEM_PROMPT =
  '你是学生的课堂学习助手。学生正在上课，会基于实时转写内容向你提问。规则：' +
  '1) 回答简洁准确，优先服务"听懂这节课"；' +
  '2) 涉及课堂内容时依据提供的转写上下文回答；' +
  '3) 查术语时给出通俗定义 + 一句话例子；' +
  '4) 全程中文，不要重复问题本身。'

interface ProviderCfg {
  url: string
  key: string
  model: string
}

async function resolveProvider(): Promise<ProviderCfg> {
  const secrets = await loadSecrets()
  const s = useSettings.getState()
  if (secrets['zhipu.apiKey']) {
    return { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', key: secrets['zhipu.apiKey'], model: 'glm-4-flash' }
  }
  if (secrets['deepseek.apiKey']) {
    return { url: 'https://api.deepseek.com/chat/completions', key: secrets['deepseek.apiKey'], model: s.deepseekModel || 'deepseek-v4-flash' }
  }
  throw new Error('未配置 AI Key：请到「设置」填写智谱或 DeepSeek 的 API Key')
}

export async function askAI(opts: AskOptions): Promise<void> {
  if (import.meta.env.VITE_MOCK_ASR === '1') {
    const answer =
      '（演示回答）动能定理的内容是：合外力对物体所做的功等于物体动能的变化量，表达式为 W=ΔEk。' +
      '考试时注意：功的正负决定动能增减，多过程问题要分段算功再求和。'
    for (const chunk of answer.match(/.{1,6}/gs) ?? []) {
      opts.onDelta(chunk)
      await new Promise((r) => setTimeout(r, 120))
    }
    return
  }

  const cfg = await resolveProvider()
  const userContent = opts.context ? `${opts.context}\n\n【学生问题】${opts.question}` : opts.question
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      max_tokens: 800,
      temperature: 0.3,
      stream: true,
    }),
  })
  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      detail = j?.error?.message || j?.message || detail
    } catch {}
    throw new Error(detail)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
        const delta = j.choices?.[0]?.delta?.content
        if (delta) opts.onDelta(delta)
      } catch {}
    }
  }
}
