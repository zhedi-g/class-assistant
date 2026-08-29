// 关联引擎 + 联合分析管线（M5-D2）。
// 关联：CJK 二元组相似度 + 术语重合 + 时间加权，纯本地零成本；
// 分析：资料全文 × 课堂转写送长上下文模型，强制 JSON 结构化输出（预习/复习两套模板）。
import { loadSecrets } from './secretStore'
import { useSettings } from '../store/settings'
import type { AnalysisMode, LessonRecord, MaterialAnalysis, MaterialPage } from './db'

// ───────────────────────── 本地匹配层 ─────────────────────────

const STOP_WORDS = new Set([
  '的了', '是在', '我们', '你们', '他们', '这个', '那个', '一个', '可以', '就是',
  '以及', '或者', '对于', '通过', '进行', '还有', '但是', '如果', '因为', '所以',
  '这些', '那些', '自己', '已经', '没有', '什么', '怎么', '一下', '大家', '问题',
])

export function pagesText(pages: MaterialPage[], cap = 15000): string {
  return pages
    .map((p) => `【${p.label}】${p.text}`)
    .join('\n')
    .slice(0, cap)
}

/** 高频 CJK 子串 + 英文整词作为术语候选（匹配与热词预填用；正式术语以 LLM 分析为准） */
export function topTerms(text: string, n = 12): string[] {
  const counts = new Map<string, number>()
  const clean = text.replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, ' ')
  for (const seg of clean.split(/\s+/)) {
    if (/^[A-Za-z][A-Za-z0-9+#.-]{1,}$/.test(seg)) {
      counts.set(seg, (counts.get(seg) ?? 0) + 2)
      continue
    }
    for (let len = 2; len <= 4; len++) {
      for (let i = 0; i + len <= seg.length; i++) {
        const w = seg.slice(i, i + len)
        if (STOP_WORDS.has(w)) continue
        counts.set(w, (counts.get(w) ?? 0) + 1)
      }
    }
  }
  return [...counts.entries()]
    .filter(([w, c]) => (w.length >= 3 ? c >= 1 : c >= 2) && !/^[0-9]+$/.test(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w)
}

function bigrams(text: string): Set<string> {
  const t = text.replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, '').slice(0, 6000)
  const s = new Set<string>()
  for (let i = 0; i < t.length - 1; i++) s.add(t.slice(i, i + 2))
  return s
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter || 1)
}

export interface MatchCandidate {
  lessonId: number
  date: string
  startTs: number
  /** 0~1+，已含时间加权 */
  score: number
  termHits: string[]
}

/** 资料 × 全部课堂记录打分，返回 Top N 候选（近 30 天线性加权最多 +20%） */
export function matchMaterialToLessons(
  material: { pages: MaterialPage[] },
  lessons: LessonRecord[],
  topN = 3,
): MatchCandidate[] {
  const matText = pagesText(material.pages, 8000)
  const matBi = bigrams(matText)
  const matTerms = new Set(topTerms(matText, 20))
  const now = Date.now()
  const DAY = 24 * 3600 * 1000

  const cands = lessons.map((l) => {
    const text = l.segments.map((s) => s.text).join(' ').slice(0, 8000)
    const score = jaccard(matBi, bigrams(text))
    const lessonTerms = new Set(topTerms(text, 40))
    const termHits = [...matTerms].filter((t) => lessonTerms.has(t))
    const days = Math.max(0, (now - l.startTs) / DAY)
    const recency = 1 + Math.max(0, 1 - days / 30) * 0.2
    return { lessonId: l.id ?? 0, date: l.date, startTs: l.startTs, score: score * recency, termHits }
  })

  return cands.sort((a, b) => b.score - a.score).slice(0, topN)
}

// ───────────────────────── 分析层 ─────────────────────────

export function parseAnalysisJson(raw: string): Record<string, unknown> {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fence ? fence[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('模型未返回 JSON 结构')
  return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>
}

const ANTI_HALLUCINATION =
  '硬性要求：所有结论必须来自给定的材料与转写原文；不要编造材料中未出现的数字、年份、人名、页码；不确定的表述用"大致/疑似"并标注。'

function reviewPrompt(matName: string, matText: string, lessonParts: string[]): string {
  return (
    '你是学生的学习分析师。下面是一份学习资料和若干节课的课堂转写，请联合分析。\n' +
    '只输出一个 JSON 对象（不要代码块、不要解释），结构：\n' +
    '{"outline":["资料提纲要点",…5~8条],"terms":["核心术语",…8~15个],' +
    '"compare":{"inMaterialOnly":["资料有但课堂未细讲",…],"emphasizedInClass":["课堂反复强调但资料简略",…],"differs":["两者表述不同之处",…]},' +
    '"reviewPlan":["复习建议（按优先级，具体可执行）",…3~6条],"examFocus":["预测考点及依据（如：课堂重复3次）",…3~6条],"summary":"一句话联合结论"}\n' +
    `【资料：${matName}】\n${matText}\n` +
    lessonParts.join('\n') +
    '\n' +
    ANTI_HALLUCINATION
  )
}

function previewPrompt(matName: string, matText: string): string {
  return (
    '你是学生的学习分析师。下面是一份即将学习的新资料（尚未有课堂记录），请生成预习包。\n' +
    '只输出一个 JSON 对象（不要代码块、不要解释），结构：\n' +
    '{"outline":["内容提纲",…5~8条],"terms":["核心术语",…8~15个],' +
    '"listenQuestions":["带着这些问题去听课",…3~5个],"hardPoints":["难点预警（预测哪里会听不懂）",…2~4条],' +
    '"reviewPlan":["预习行动建议（具体可执行）",…3~5条],"summary":"一句话概括这份资料讲什么"}\n' +
    `【资料：${matName}】\n${matText}\n` +
    ANTI_HALLUCINATION
  )
}

interface ProviderCfg {
  url: string
  key: string
  models: string[]
}

async function resolveProvider(): Promise<ProviderCfg> {
  const secrets = await loadSecrets()
  const s = useSettings.getState()
  if (secrets['zhipu.apiKey']) {
    // 长上下文优先旗舰，失败回退免费档
    return { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', key: secrets['zhipu.apiKey'], models: ['glm-4.6', 'glm-4-flash'] }
  }
  if (secrets['deepseek.apiKey']) {
    return { url: 'https://api.deepseek.com/chat/completions', key: secrets['deepseek.apiKey'], models: [s.deepseekModel || 'deepseek-v4-flash'] }
  }
  throw new Error('未配置 AI Key：请到「设置」填写智谱或 DeepSeek 的 API Key')
}

async function callJson(url: string, key: string, model: string, prompt: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 120_000)
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

/**
 * 联合分析：mode=review 时 lessons 为关联的课堂记录（≥1），mode=preview 时为空数组。
 * 结果由调用方写回 db.materials。
 */
export async function analyzeMaterial(
  material: { name: string; pages: MaterialPage[] },
  lessons: LessonRecord[],
  mode: AnalysisMode,
  matchNote: string,
): Promise<MaterialAnalysis> {
  const cfg = await resolveProvider()
  const matText = pagesText(material.pages, 12_000)
  const lessonParts = lessons.map((l, i) => {
    const text = l.segments.map((s) => s.text).join(' ').slice(0, 3500)
    return `\n【课堂转写 ${i + 1} · ${l.date}】${text}`
  })
  const prompt =
    mode === 'review' && lessonParts.length
      ? reviewPrompt(material.name, matText, lessonParts)
      : previewPrompt(material.name, matText)

  let lastErr: Error = new Error('分析失败')
  for (const model of cfg.models) {
    try {
      const raw = await callJson(cfg.url, cfg.key, model, prompt)
      const result = parseAnalysisJson(raw) as MaterialAnalysis['result']
      if (!result.outline && !result.summary) throw new Error('结果结构不完整')
      return {
        mode,
        lessonIds: lessons.map((l) => l.id ?? 0),
        matchNote,
        result,
        createdAt: Date.now(),
      }
    } catch (e) {
      lastErr = e as Error
    }
  }
  throw lastErr
}

/** 从分析结果提取术语，合并进识别热词（去重，返回新热词串） */
export function mergeHotwords(existing: string, newTerms: string[] | undefined): string {
  if (!newTerms?.length) return existing
  const cur = existing
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
  const merged = [...new Set([...cur, ...newTerms])]
  return merged.join('\n')
}
