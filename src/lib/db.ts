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
}

export interface LessonRecord {
  id?: number
  date: string
  startTs: number
  durationSec: number
  segments: Segment[]
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
