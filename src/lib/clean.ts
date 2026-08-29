// 课堂转写清洗层（M6）：本地规则预过滤 → LLM 分类打标（五类）→ 待办提取。
// 铁律：只标记分流不删除——原始段永久保留，界面可查可恢复。
import { loadSecrets } from './secretStore'
import type { Segment } from './db'

export type SegCategory = 'content' | 'qa' | 'admin' | 'chatter' | 'garbage'

export const CATEGORY_META: Record<SegCategory, { label: string; cls: string }> = {
  content: { label: '教学正文', cls: 'text-emerald-500' },
  qa: { label: '师生问答', cls: 'text-sky-500' },
  admin: { label: '课堂事务', cls: 'text-amber-500' },
  chatter: { label: '闲聊杂音', cls: 'text-zinc-400' },
  garbage: { label: '无法识别', cls: 'text-red-400' },
}

export interface CleanResult {
  labels: Record<string, SegCategory>
  todos: { text: string; ts: number }[]
}

/** 本地规则预过滤：碎句/语气词堆积（零成本，先于 LLM） */
export function preLabel(text: string): SegCategory | null {
  const t = text.trim()
  if (t.length < 4) return 'garbage'
  const fillers = (t.match(/呃|嗯|然后|就是说/g) ?? []).length
  if (fillers >= 3) return 'chatter'
  return null
}

const PROMPT = (lines: string[], hotwords?: string) =>
  '你在整理课堂转写。下面是编号的转写片段，请对每段分类：' +
  'content（教学正文）/ qa（学生提问或老师解答）/ admin（课堂事务：作业、考试范围、点名、签到、通知）/ ' +
  'chatter（闲聊玩笑杂音）/ garbage（识别乱码无意义）。\n' +
  '再从 admin 类片段中提取需要学生执行的待办（作业内容、考试范围、截止时间），没有则输出空数组。\n' +
  '只输出 JSON（不要代码块不要解释）：{"labels":{"1":"content","2":"admin",…},"todos":["待办…",…]}。\n' +
  (hotwords ? `课程术语（供参考）：${hotwords}\n` : '') +
  lines.join('\n')

export async function cleanLesson(segments: Segment[], hotwords?: string): Promise<CleanResult> {
  if (import.meta.env.VITE_MOCK_ASR === '1') {
    const labels: Record<string, SegCategory> = {}
    const todos: { text: string; ts: number }[] = []
    for (const s of segments) {
      const pre = preLabel(s.text)
      let c: SegCategory = pre ?? 'content'
      if (!pre && /考试|作业|点名|签到|交/.test(s.text)) {
        c = 'admin'
        todos.push({ text: s.text, ts: s.t })
      } else if (!pre && /？$|吗$|呢$/.test(s.text.trim())) {
        c = 'qa'
      }
      labels[s.id] = c
    }
    return { labels, todos }
  }

  const secrets = await loadSecrets()
  const key = secrets['zhipu.apiKey']
  if (!key) throw new Error('清洗需要智谱 API Key（免费档即可）：请到「设置」填写')
  const segs = segments.slice(0, 120)
  const lines = segs.map((s, i) => `${i + 1}. ${s.text.slice(0, 120)}`)
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'glm-4-flash',
      messages: [{ role: 'user', content: PROMPT(lines, hotwords) }],
      max_tokens: 2500,
      temperature: 0.1,
      stream: false,
    }),
  })
  if (!res.ok) throw new Error(`清洗失败：HTTP ${res.status}`)
  const j = await res.json()
  const raw = (j.choices?.[0]?.message?.content ?? '').trim()
  const body = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? raw
  const parsed = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)) as {
    labels?: Record<string, string>
    todos?: string[]
  }
  const labels: Record<string, SegCategory> = {}
  const valid: SegCategory[] = ['content', 'qa', 'admin', 'chatter', 'garbage']
  segs.forEach((s, i) => {
    const c = parsed.labels?.[String(i + 1)] as SegCategory | undefined
    labels[s.id] = c && valid.includes(c) ? c : 'content' // 分类缺失时保守视为正文
  })
  return {
    labels,
    todos: (parsed.todos ?? []).map((t) => ({ text: String(t).slice(0, 80), ts: Date.now() })),
  }
}

/** 被视为“剔除”的分类（默认折叠，可恢复） */
export const REMOVED_CATEGORIES: SegCategory[] = ['chatter', 'garbage']
