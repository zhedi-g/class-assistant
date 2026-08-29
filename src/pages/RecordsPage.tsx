import { useEffect, useState } from 'react'
import { db, type LessonRecord } from '../lib/db'

export default function RecordsPage() {
  const [records, setRecords] = useState<LessonRecord[] | null>(null)

  useEffect(() => {
    db.lessons
      .orderBy('createdAt')
      .reverse()
      .toArray()
      .then(setRecords)
      .catch(() => setRecords([]))
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">课堂记录</h1>

      {records === null && <p className="pt-10 text-center text-sm text-zinc-400">加载中…</p>}

      {records !== null && records.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-800">
          <span className="text-3xl">📂</span>
          <p className="text-sm text-zinc-500">还没有课堂记录</p>
          <p className="px-8 text-xs text-zinc-400 dark:text-zinc-600">
            到「课堂」页点「开始上课」，转写内容会自动保存到这里；M6 起可一键生成笔记与复习包。
          </p>
        </div>
      )}

      {records !== null &&
        records.map((r) => {
          const marks = r.segments.filter((x) => x.marked).length
          const highlight = r.segments.find((x) => x.marked) ?? r.segments[0]
          return (
            <div
              key={r.id}
              data-testid="record-card"
              className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {r.date}
                  {new Date(r.startTs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-xs text-zinc-400">
                  {r.segments.length} 条 · {Math.floor(r.durationSec / 60)} 分 {r.durationSec % 60} 秒
                  {marks > 0 && <span className="ml-1 text-amber-500">🚩{marks}</span>}
                </span>
              </div>
              {highlight && (
                <p className="mt-2 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {highlight.marked && '🚩 '}
                  {highlight.text}
                </p>
              )}
            </div>
          )
        })}
    </div>
  )
}
