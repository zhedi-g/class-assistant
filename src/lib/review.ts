// 复习包/冲刺包生成（M6）：复用分析管线的模型链与防幻觉约束。
import { loadSecrets } from './secretStore'
import { parseAnalysisJson } from './analysis'
import { useSettings } from '../store/settings'
import type { LessonRecord } from './db'

export interface PackCard {
  q: string
  a: string
}

export interface ReviewPackData {
  notes: { heading: string; points: string[] }[]
  keyPoints: { text: string; basis?: string }[]
  flashcards: PackCard[]
  knowledgeMap?: string[]
  coverage?: { high: string[]; low: string[] } | null
  summary: string
}

export interface ReviewPack {
  id?: number
  lessonIds: number[]
  mode: 'single' | 'sprint'
  data: ReviewPackData
  createdAt: number
}

export function toAnkiTxt(cards: PackCard[]): string {
  return cards.map((c) => `${c.q.replace(/[\t\n]/g, ' ')}\t${c.a.replace(/[\t\n]/g, ' ')}`).join('\n')
}

function lessonsContext(lessons: LessonRecord[], perLesson = 2600): string {
  return lessons
    .map((l, i) => {
      // 优先使用精校稿（干净、术语正确）
      const text = (
        l.refined ? `【精校稿】${l.refined}` : l.segments.map((s) => s.text).join(' ')
      ).slice(0, perLesson)
      return `\n【课堂 ${i + 1} · ${l.date}】${text}`
    })
    .join('\n')
    .slice(0, 14_000)
}

const ANTI = '硬性要求：所有结论必须来自给定课堂转写原文；不要编造未出现的数字、年份、人名；标注依据（如：课堂原话/重复次数）。'

function singlePrompt(lessons: LessonRecord[]): string {
  return (
    '你是学生的学习分析师。下面是一节课的课堂转写，请生成复习包。\n' +
    '只输出 JSON（不要代码块不要解释），结构：\n' +
    '{"notes":[{"heading":"小节标题","points":["要点",…]},…3~6组],' +
    '"keyPoints":[{"text":"考点","basis":"依据（课堂原话/强调次数）"},…3~6条],' +
    '"flashcards":[{"q":"问题","a":"简短答案"},…6~12张],' +
    '"summary":"一句话总结"}\n' +
    lessonsContext(lessons) + '\n' + ANTI
  )
}

function sprintPrompt(lessons: LessonRecord[], materialCtx?: string): string {
  return (
    '你是学生的考前冲刺分析师。下面是同一门课多节课的课堂转写' + (materialCtx ? '和课程资料摘要' : '') + '，请生成跨课冲刺包。\n' +
    '只输出 JSON（不要代码块不要解释），结构：\n' +
    '{"knowledgeMap":["这门课的知识地图条目",…5~8条],' +
    '"keyPoints":[{"text":"高频考点（按跨课出现频次排序）","basis":"依据（出现在第几节课/重复次数）"},…5~8条],' +
    '"flashcards":[{"q":"问题","a":"简短答案"},…10~15张（跨课合并去重）],' +
    '"coverage":{"high":["课堂反复覆盖的主题",…],"low":["只提过一次/未覆盖的主题",…]},' +
    '"summary":"一句话冲刺结论"}\n' +
    lessonsContext(lessons) +
    (materialCtx ? `\n【课程资料摘要】${materialCtx.slice(0, 6000)}` : '') +
    '\n' + ANTI
  )
}

async function callJsonChain(prompt: string): Promise<string> {
  const secrets = await loadSecrets()
  const s = useSettings.getState()
  if (secrets['zhipu.apiKey']) {
    for (const model of ['glm-4.6', 'glm-4-flash']) {
      try {
        return await callOnce('https://open.bigmodel.cn/api/paas/v4/chat/completions', secrets['zhipu.apiKey'], model, prompt)
      } catch (e) {
        console.warn(`[${model}] 失败，尝试回退`, e)
      }
    }
    throw new Error('分析模型调用失败')
  }
  if (secrets['deepseek.apiKey']) {
    return callOnce('https://api.deepseek.com/chat/completions', secrets['deepseek.apiKey'], s.deepseekModel || 'deepseek-v4-flash', prompt)
  }
  throw new Error('未配置 AI Key：请到「设置」填写')
}

async function callOnce(url: string, key: string, model: string, prompt: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 180_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 3500,
        temperature: 0.2,
        stream: false,
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        const j = await res.json()
        detail = j?.error?.message || j?.message || detail
      } catch {}
      throw new Error(`${model}: ${detail}`)
    }
    const j = await res.json()
    return (j.choices?.[0]?.message?.content ?? '').trim()
  } finally {
    clearTimeout(timer)
  }
}

export async function generatePackData(lessons: LessonRecord[], mode: 'single' | 'sprint', materialCtx?: string): Promise<ReviewPackData> {
  if (import.meta.env.VITE_MOCK_ASR === '1') {
    await new Promise((r) => setTimeout(r, 800))
    if (mode === 'sprint') {
      return {
        notes: [{ heading: '冲刺知识地图', points: ['演示：动能定理主线', '演示：斜面模型', '演示：多过程问题'] }],
        keyPoints: [
          { text: '动能定理应用', basis: '出现在多节课且标注必考' },
          { text: '摩擦生热计算', basis: '课堂例题两次涉及' },
        ],
        flashcards: [
          { q: '动能定理的表达式？', a: 'W = Ek2 - Ek1' },
          { q: '摩擦生热公式？', a: 'Q = f × 相对位移' },
        ],
        coverage: { high: ['动能定理', '斜面模型'], low: ['变力做功'] },
        summary: '（演示冲刺包）动能定理是本阶段绝对主线，斜面模型是高频载体。',
      }
    }
    return {
      notes: [
        { heading: '核心概念', points: ['演示要点一：合外力做功', '演示要点二：动能变化'] },
        { heading: '典型题型', points: ['演示要点：斜面模型', '演示要点：多过程'] },
      ],
      keyPoints: [{ text: '动能定理（演示考点）', basis: '课堂强调"期末必考"' }],
      flashcards: [{ q: '动能定理的内容？', a: '合外力做的功等于物体动能的变化' }],
      summary: '（演示复习包）本节课围绕动能定理展开，重点是斜面模型。',
    }
  }

  const prompt = mode === 'sprint' ? sprintPrompt(lessons, materialCtx) : singlePrompt(lessons)
  const raw = await callJsonChain(prompt)
  const data = parseAnalysisJson(raw) as unknown as ReviewPackData
  if (!Array.isArray(data.notes) && !Array.isArray(data.flashcards)) throw new Error('复习包结构不完整')
  return data
}
