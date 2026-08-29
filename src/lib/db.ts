import Dexie, { type EntityTable } from 'dexie'

export interface Segment {
  id: string
  /** 距开课的毫秒数 */
  t: number
  text: string
  raw?: string
  marked: boolean
  /** 命中的提醒关键词（M3） */
  matched?: string
  /** 课堂提问句（M4.2 自动检测） */
  q?: boolean
}

/** 资料的一页/一页 PPT 解析结果 */
export interface MaterialPage {
  /** 页码或标签（如 "第3页"/"slide 3"） */
  label: string
  text: string
  /** 需要视觉 OCR 的页（图片型 PPT/扫描 PDF），OCR 后回填 text */
  needOcr?: boolean
  /** 该页内嵌图片的 blob（needOcr 页用） */
  imageBlobs?: Blob[]
  /** 学生手动标记的重点页/段（M5.2，分析时优先参考） */
  marked?: boolean
}

export type MaterialKind = 'pptx' | 'pdf' | 'text' | 'image'

export type MaterialStatus = 'parsing' | 'ready' | 'failed'

/** 分析模式：有关联课堂记录=复习，无=预习 */
export type AnalysisMode = 'preview' | 'review'

export interface MaterialAnalysis {
  mode: AnalysisMode
  /** 关联的课堂记录 id 列表 */
  lessonIds: number[]
  /** 关联说明（如"匹配到 8月30日的课·术语重合78%"） */
  matchNote: string
  /** 结构化结果（LLM JSON） */
  result: {
    outline?: string[]
    terms?: string[]
    listenQuestions?: string[]
    hardPoints?: string[]
    compare?: { inMaterialOnly?: string[]; emphasizedInClass?: string[]; differs?: string[] }
    reviewPlan?: string[]
    examFocus?: string[]
    summary?: string
  }
  createdAt: number
}

export interface QaPair {
  q: string
  a: string
  ts: number
}

export type MaterialRecord = {
  id?: number
  name: string
  kind: MaterialKind
  size: number
  status: MaterialStatus
  statusMsg?: string
  pages: MaterialPage[]
  analysis?: MaterialAnalysis
  /** 资料 AI 问答记录 */
  qas?: QaPair[]
  createdAt: number
}

export interface LessonCleaned {
  /** 段落 id → 分类（只标记不删除，原始段永久保留） */
  labels: Record<string, string>
  /** 从课堂事务中提取的待办 */
  todos: { text: string; ts: number }[]
  ts: number
}

export interface LessonRecord {
  id?: number
  date: string
  startTs: number
  durationSec: number
  segments: Segment[]
  /** 课中/课后的 AI 问答 */
  qas?: QaPair[]
  /** 课后清洗结果（M6） */
  cleaned?: LessonCleaned
  createdAt: number
}

export const db = new Dexie('class-helper-data') as Dexie & {
  lessons: EntityTable<LessonRecord, 'id'>
  materials: EntityTable<MaterialRecord, 'id'>
  reviewPacks: EntityTable<ReviewPackRecord, 'id'>
}

export interface ReviewPackRecord {
  id?: number
  lessonIds: number[]
  mode: 'single' | 'sprint'
  data: {
    notes: { heading: string; points: string[] }[]
    keyPoints: { text: string; basis?: string }[]
    flashcards: { q: string; a: string }[]
    knowledgeMap?: string[]
    coverage?: { high: string[]; low: string[] } | null
    summary: string
  }
  createdAt: number
}

db.version(1).stores({
  lessons: '++id, date, startTs',
})

// v2：补充 createdAt 索引（记录页按时间倒序查询）
db.version(2).stores({
  lessons: '++id, date, startTs, createdAt',
})

// v3：资料库（M5）
db.version(3).stores({
  lessons: '++id, date, startTs, createdAt',
  materials: '++id, createdAt',
})

// v4：复习包（M6）
db.version(4).stores({
  lessons: '++id, date, startTs, createdAt',
  materials: '++id, createdAt',
  reviewPacks: '++id, createdAt',
})
