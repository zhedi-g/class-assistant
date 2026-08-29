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

export interface QaPair {
  q: string
  a: string
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
  createdAt: number
}

export const db = new Dexie('class-helper-data') as Dexie & {
  lessons: EntityTable<LessonRecord, 'id'>
}

db.version(1).stores({
  lessons: '++id, date, startTs',
})

// v2：补充 createdAt 索引（记录页按时间倒序查询）
db.version(2).stores({
  lessons: '++id, date, startTs, createdAt',
})
