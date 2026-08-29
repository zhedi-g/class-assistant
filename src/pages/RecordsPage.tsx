import { useEffect, useState } from 'react'
import { db, type LessonRecord } from '../lib/db'
import { askAI } from '../lib/ai'

function fmtOffset(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function RecordsPage() {
  const [records, setRecords] = useState<LessonRecord[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [qaInput, setQaInput] = useState('')
  const [qaBusyId, setQaBusyId] = useState<number | null>(null)
  const [qaStream, setQaStream] = useState('')

  const refresh = () => {
    db.lessons
      .orderBy('createdAt')
      .reverse()
      .toArray()
      .then(setRecords)
      .catch(() => setRecords([]))
  }

  useEffect(refresh, [])

  async function askRecord(r: LessonRecord) {
    const q = qaInput.trim()
    if (!q || qaBusyId !== null || r.id === undefined) return
    setQaBusyId(r.id)
    setQaStream('')
    const context = `【本节课转写】${r.segments.map((s) => s.text).join(' / ').slice(-3500)}`
    let a = ''
    try {
      await askAI({
        question: q,
        context,
        onDelta: (d) => {
          a += d
          setQaStream(a)
        },
      })
      await db.lessons.update(r.id, {
        qas: [...(r.qas ?? []), { q, a, ts: Date.now() }],
      })
      setQaInput('')
      setQaStream('')
      refresh()
    } catch (e) {
      setQaStream('回答失败：' + (e as Error).message)
    } finally {
      setQaBusyId(null)
    }
  }

  async function removeOne(id: number | undefined) {
    if (id === undefined) return
    if (!confirm('删除这条课堂记录？不可恢复。')) return
    await db.lessons.delete(id)
    setOpenId(null)
    refresh()
  }

  async function clearAll() {
    if (!confirm('清空全部课堂记录？不可恢复。')) return
    await db.lessons.clear()
    setOpenId(null)
    refresh()
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">课堂记录</h1>
        {records !== null && records.length > 0 && (
          <button
            data-testid="clear-all-btn"
            onClick={() => void clearAll()}
            className="rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
          >
            清空记录
          </button>
        )}
      </header>

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
          const open = openId === r.id
          return (
            <div
              key={r.id}
              data-testid="record-card"
              className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            >
              <button
                data-testid="record-toggle"
                onClick={() => setOpenId(open ? null : (r.id ?? null))}
                className="w-full p-4 text-left active:bg-zinc-50 dark:active:bg-zinc-800/50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    {r.date}
                    {new Date(r.startTs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {r.segments.length} 条 · {Math.floor(r.durationSec / 60)} 分 {r.durationSec % 60} 秒
                    {marks > 0 && <span className="ml-1 text-amber-500">🚩{marks}</span>}
                    <span className="ml-1 text-zinc-300 dark:text-zinc-600">{open ? '▲' : '▼'}</span>
                  </span>
                </div>
                {!open && r.segments[0] && (
                  <p className="mt-2 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {r.segments[0].marked && '🚩 '}
                    {r.segments[0].text}
                  </p>
                )}
              </button>

              {open && (
                <div className="border-t border-zinc-100 dark:border-zinc-800">
                  <div data-testid="record-detail" className="max-h-72 space-y-2 overflow-y-auto p-4">
                    {r.segments.length === 0 && (
                      <p className="text-center text-xs text-zinc-400">本节课没有识别到内容</p>
                    )}
                    {r.segments.map((seg) => (
                      <p
                        key={seg.id}
                        className={
                          seg.matched
                            ? 'rounded-lg border border-amber-400 bg-amber-50 px-2 py-1.5 text-sm leading-relaxed dark:border-amber-500/50 dark:bg-amber-500/10'
                            : seg.marked
                              ? 'rounded-lg border border-amber-400/60 bg-amber-50 px-2 py-1.5 text-sm leading-relaxed dark:border-amber-500/40 dark:bg-amber-500/10'
                              : 'text-sm leading-relaxed text-zinc-700 dark:text-zinc-300'
                        }
                      >
                        <span className="mr-2 font-mono text-[11px] text-zinc-400">{fmtOffset(seg.t)}</span>
                        {seg.matched && (
                          <span className="mr-1 rounded bg-amber-200/70 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/25 dark:text-amber-300">
                            🔔{seg.matched}
                          </span>
                        )}
                        {seg.marked && !seg.matched && '🚩 '}
                        {seg.text}
                      </p>
                    ))}

                    {/* 课中/课后问答 */}
                    {r.qas && r.qas.length > 0 && (
                      <div data-testid="record-qas" className="space-y-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                        <p className="text-[11px] font-semibold text-zinc-400">问答 {r.qas.length}</p>
                        {r.qas.map((qa, i) => (
                          <div key={i} className="space-y-1">
                            <p className="text-right text-xs text-blue-500">Q：{qa.q}</p>
                            <p className="whitespace-pre-wrap rounded-xl bg-zinc-100 px-2.5 py-1.5 text-xs leading-relaxed dark:bg-zinc-800">
                              A：{qa.a}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 对这节课提问 */}
                    <div className="mt-1 flex items-center gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                      <input
                        data-testid="rec-ask-input"
                        className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-2.5 py-2 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
                        placeholder="对这节课提问，如：这节课的重点是什么"
                        value={openId === r.id ? qaInput : ''}
                        onChange={(e) => setQaInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void askRecord(r)
                        }}
                      />
                      <button
                        data-testid="rec-ask-send"
                        onClick={() => void askRecord(r)}
                        disabled={qaBusyId !== null || !qaInput.trim()}
                        className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                      >
                        {qaBusyId === r.id ? '回答中' : '提问'}
                      </button>
                    </div>
                    {qaBusyId === r.id && qaStream && (
                      <p className="whitespace-pre-wrap rounded-xl bg-blue-50 px-2.5 py-1.5 text-xs leading-relaxed text-zinc-700 dark:bg-blue-500/10 dark:text-zinc-300">
                        {qaStream}
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
                    <button
                      data-testid="delete-one-btn"
                      onClick={() => void removeOne(r.id)}
                      className="rounded-lg px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                    >
                      删除本条
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
    </div>
  )
}
