// 课堂记录页（M6 整合）：清洗视图 / 单课复习包 / 闪卡自测 / Anki 导出 / 跨课冲刺。
import { useEffect, useState } from 'react'
import { db, type LessonRecord, type ReviewPackRecord } from '../lib/db'
import { cleanLesson, CATEGORY_META, REMOVED_CATEGORIES, type SegCategory } from '../lib/clean'
import { generatePackData, toAnkiTxt } from '../lib/review'
import { askAI } from '../lib/ai'
import { useSession } from '../store/session'
import { useSettings } from '../store/settings'

function fmtOffset(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function RecordsPage() {
  const notify = useSession((s) => s.notify)
  const [records, setRecords] = useState<LessonRecord[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [packs, setPacks] = useState<ReviewPackRecord[]>([])
  const [sprintOpen, setSprintOpen] = useState(false)
  const [sprintSel, setSprintSel] = useState<Record<number, boolean>>({})
  const [sprintBusy, setSprintBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = () => {
    db.lessons
      .orderBy('createdAt')
      .reverse()
      .toArray()
      .then(setRecords)
      .catch(() => setRecords([]))
    db.reviewPacks
      .orderBy('createdAt')
      .reverse()
      .toArray()
      .then(setPacks)
      .catch(() => setPacks([]))
  }

  useEffect(refresh, [])

  const latestSprint = packs.find((p) => p.mode === 'sprint')

  async function generateSprint() {
    const ids = Object.entries(sprintSel)
      .filter(([, v]) => v)
      .map(([k]) => Number(k))
    if (ids.length < 1) {
      notify('请至少勾选一节课')
      return
    }
    setSprintBusy(true)
    try {
      const lessons = (records ?? []).filter((r) => ids.includes(r.id ?? -1))
      const data = await generatePackData(lessons, 'sprint')
      await db.reviewPacks.add({ lessonIds: ids, mode: 'sprint', data, createdAt: Date.now() })
      notify('冲刺包已生成')
      refresh()
    } catch (e) {
      notify('生成失败：' + (e as Error).message)
    } finally {
      setSprintBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">课堂记录</h1>
        <div className="flex items-center gap-1">
          <button
            data-testid="sprint-btn"
            onClick={() => setSprintOpen(!sprintOpen)}
            className="rounded-lg px-2 py-1 text-xs text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-500/10"
          >
            🎯 跨课冲刺
          </button>
          {records !== null && records.length > 0 && (
            <button
              data-testid="clear-all-btn"
              onClick={async () => {
                if (!confirm('清空全部课堂记录与复习包？不可恢复。')) return
                await db.lessons.clear()
                await db.reviewPacks.clear()
                setOpenId(null)
                refresh()
              }}
              className="rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              清空记录
            </button>
          )}
        </div>
      </header>

      {/* 跨课冲刺 */}
      {sprintOpen && (
        <div data-testid="sprint-panel" className="space-y-2 rounded-2xl border border-violet-400/50 bg-violet-50/40 p-4 dark:border-violet-500/30 dark:bg-violet-500/5">
          <p className="text-xs font-semibold text-violet-600 dark:text-violet-400">勾选要纳入冲刺的课（可多选）：</p>
          {(records ?? []).map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!!sprintSel[r.id ?? -1]}
                onChange={(e) => setSprintSel((s) => ({ ...s, [r.id ?? -1]: e.target.checked }))}
              />
              {r.date} · {r.segments.length} 条内容
            </label>
          ))}
          <button
            data-testid="sprint-generate"
            onClick={() => void generateSprint()}
            disabled={sprintBusy}
            className="w-full rounded-xl bg-violet-600 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {sprintBusy ? '生成中…' : '生成冲刺包'}
          </button>
        </div>
      )}

      {latestSprint && (
        <div data-testid="sprint-pack" className="rounded-2xl border border-violet-400/50 bg-white p-4 dark:border-violet-500/30 dark:bg-zinc-900">
          <p className="mb-2 text-sm font-semibold text-violet-600 dark:text-violet-400">🎯 冲刺包（{latestSprint.lessonIds.length} 节课合并）</p>
          <PackView data={latestSprint.data} />
          <button
            data-testid="sprint-export"
            onClick={() => download(`冲刺包-${Date.now()}-anki.txt`, toAnkiTxt(latestSprint.data.flashcards))}
            className="mt-3 w-full rounded-xl border border-zinc-300 py-2 text-xs dark:border-zinc-700"
          >
            📤 导出冲刺闪卡（Anki 格式）
          </button>
        </div>
      )}

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
        records.map((r) => (
          <RecordCard
            key={r.id}
            record={r}
            open={openId === r.id}
            pack={packs.find((p) => p.mode === 'single' && p.lessonIds.includes(r.id ?? -1))}
            onToggle={() => setOpenId(openId === r.id ? null : (r.id ?? null))}
            onCloseDetail={() => setOpenId(null)}
            onChanged={refresh}
            notify={notify}
            setBusyId={setBusyId}
            busyId={busyId}
          />
        ))}
    </div>
  )
}

function RecordCard({
  record: r,
  open,
  pack,
  onToggle,
  onCloseDetail,
  onChanged,
  notify,
  setBusyId,
  busyId,
}: {
  record: LessonRecord
  open: boolean
  pack: ReviewPackRecord | undefined
  onToggle: () => void
  onCloseDetail: () => void
  onChanged: () => void
  notify: (msg: string) => void
  setBusyId: (v: string | null) => void
  busyId: string | null
}) {
  const marks = r.segments.filter((x) => x.marked).length
  const [showRemoved, setShowRemoved] = useState(false)
  const [askInput, setAskInput] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [askStream, setAskStream] = useState('')

  async function askRecord(target: LessonRecord) {
    const q = askInput.trim()
    if (!q || askBusy || target.id === undefined) return
    setAskBusy(true)
    setAskStream('')
    let a = ''
    try {
      await askAI({
        question: q,
        context: `【本节课转写】${target.segments.map((s) => s.text).join(' / ').slice(-3500)}`,
        onDelta: (d) => {
          a += d
          setAskStream(a)
        },
      })
      await db.lessons.update(target.id, { qas: [...(target.qas ?? []), { q, a, ts: Date.now() }] })
      setAskInput('')
      setAskStream('')
      onChanged()
    } catch (e) {
      setAskStream('回答失败：' + (e as Error).message)
    } finally {
      setAskBusy(false)
    }
  }

  async function clean() {
    if (r.id === undefined) return
    setBusyId(`clean-${r.id}`)
    try {
      const result = await cleanLesson(
        r.segments,
        useSettings.getState().hotwords.split(/\r?\n/).map((t) => t.trim()).filter(Boolean).join(','),
      )
      await db.lessons.update(r.id, { cleaned: { labels: result.labels, todos: result.todos, ts: Date.now() } })
      onChanged()
      notify('清洗完成：已分类打标，可查看与恢复')
    } catch (e) {
      notify((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function generatePack() {
    if (r.id === undefined) return
    setBusyId(`pack-${r.id}`)
    try {
      const data = await generatePackData([r], 'single')
      await db.reviewPacks.add({ lessonIds: [r.id], mode: 'single', data, createdAt: Date.now() })
      onChanged()
      notify('复习包已生成')
    } catch (e) {
      notify('生成失败：' + (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function restoreSeg(segId: string) {
    if (r.id === undefined || !r.cleaned) return
    const labels = { ...r.cleaned.labels }
    delete labels[segId]
    await db.lessons.update(r.id, { cleaned: { ...r.cleaned, labels, ts: Date.now() } })
    onChanged()
    notify('已恢复该句')
  }

  const cleaned = r.cleaned
  const catOf = (segId: string): SegCategory | null => (cleaned?.labels[segId] as SegCategory) ?? null
  const removedCount = cleaned ? r.segments.filter((s) => REMOVED_CATEGORIES.includes(catOf(s.id) ?? 'content')).length : 0
  const todoCount = cleaned?.todos.length ?? 0

  return (
    <div
      data-testid="record-card"
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <button data-testid="record-toggle" onClick={onToggle} className="w-full p-4 text-left active:bg-zinc-50 dark:active:bg-zinc-800/50">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">
            {r.date}
            {new Date(r.startTs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="text-xs text-zinc-400">
            {r.segments.length} 条 · {Math.floor(r.durationSec / 60)} 分 {r.durationSec % 60} 秒
            {marks > 0 && <span className="ml-1 text-amber-500">🚩{marks}</span>}
            {cleaned && <span className="ml-1 text-emerald-500">✓已清洗</span>}
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
          {/* M6 操作行 */}
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            <button
              data-testid="clean-btn"
              onClick={() => void clean()}
              disabled={busyId === `clean-${r.id}`}
              className="flex-1 rounded-xl border border-emerald-400/60 py-2 text-xs font-medium text-emerald-600 disabled:opacity-40 dark:border-emerald-500/40 dark:text-emerald-400"
            >
              {busyId === `clean-${r.id}` ? '清洗中…' : cleaned ? '🧹 重新清洗' : '🧹 清洗转写'}
            </button>
            <button
              data-testid="pack-btn"
              onClick={() => void generatePack()}
              disabled={busyId === `pack-${r.id}`}
              className="flex-1 rounded-xl border border-blue-400/60 py-2 text-xs font-medium text-blue-600 disabled:opacity-40 dark:border-blue-500/40 dark:text-blue-400"
            >
              {busyId === `pack-${r.id}` ? '生成中…' : pack ? '📦 重新生成复习包' : '📦 生成复习包'}
            </button>
          </div>

          {/* 清洗结果 */}
          {cleaned && (
            <div data-testid="clean-stats" className="mx-4 mt-3 space-y-2 rounded-xl bg-zinc-50 p-3 text-xs dark:bg-zinc-800/60">
              <p className="font-semibold text-zinc-600 dark:text-zinc-300">
                清洗结果：
                {(Object.keys(CATEGORY_META) as SegCategory[]).map((c) => {
                  const n = r.segments.filter((s) => catOf(s.id) === c).length
                  return n > 0 ? (
                    <span key={c} className={`ml-2 ${CATEGORY_META[c].cls}`}>
                      {CATEGORY_META[c].label} {n}
                    </span>
                  ) : null
                })}
              </p>
              {todoCount > 0 && (
                <p data-testid="clean-todos" className="text-amber-600 dark:text-amber-400">
                  🔔 提取待办 {todoCount} 条：{cleaned.todos.map((t) => t.text).join('；').slice(0, 60)}
                  {todoCount > 0 && '…'}
                </p>
              )}
              <button
                data-testid="toggle-removed"
                onClick={() => setShowRemoved(!showRemoved)}
                className="text-[11px] text-zinc-400 underline"
              >
                {showRemoved ? '收起被剔除内容' : `查看被剔除内容（${removedCount} 条，可恢复）`}
              </button>
              {showRemoved && (
                <div className="space-y-1">
                  {r.segments
                    .filter((s) => REMOVED_CATEGORIES.includes(catOf(s.id) ?? 'content'))
                    .map((s) => (
                      <p key={s.id} className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                        <span className="truncate line-through">{s.text}</span>
                        <button onClick={() => void restoreSeg(s.id)} data-testid={`restore-${s.id}`} className="shrink-0 underline">
                          恢复
                        </button>
                      </p>
                    ))}
                  {removedCount === 0 && <p className="text-zinc-400">本节课没有被剔除的内容</p>}
                </div>
              )}
            </div>
          )}

          {/* 复习包 */}
          {pack && (
            <div data-testid="pack" className="mx-4 mt-3 rounded-xl border border-blue-400/40 p-3 dark:border-blue-500/30">
              <p className="mb-2 text-xs font-semibold text-blue-500">📦 复习包</p>
              <PackView data={pack.data} />
              <button
                data-testid="export-anki"
                onClick={() => download(`复习包-${r.date}-anki.txt`, toAnkiTxt(pack.data.flashcards))}
                className="mt-3 w-full rounded-xl border border-zinc-300 py-2 text-xs dark:border-zinc-700"
              >
                📤 导出闪卡（Anki 格式 txt）
              </button>
            </div>
          )}

          {/* 转写全文 */}
          <div className="mx-4 mt-3 max-h-60 space-y-2 overflow-y-auto border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {r.segments.map((seg) => {
              const cat = catOf(seg.id)
              const hidden = cat !== null && REMOVED_CATEGORIES.includes(cat) && !showRemoved
              if (hidden) return null
              return (
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
                  {cat && cat !== 'content' && (
                    <span className={`mr-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] dark:bg-zinc-800 ${CATEGORY_META[cat].cls}`}>
                      {CATEGORY_META[cat].label}
                    </span>
                  )}
                  {seg.matched && (
                    <span className="mr-1 rounded bg-amber-200/70 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/25 dark:text-amber-300">
                      🔔{seg.matched}
                    </span>
                  )}
                  {seg.marked && !seg.matched && '🚩 '}
                  {seg.text}
                </p>
              )
            })}
          </div>

          {/* 课中/课后问答 */}
          {r.qas && r.qas.length > 0 && (
            <div data-testid="record-qas" className="mx-4 mt-3 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
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
          <div className="mx-4 mt-3 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <input
                data-testid="rec-ask-input"
                className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-2.5 py-2 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
                placeholder="对这节课提问，如：这节课的重点是什么"
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void askRecord(r)
                }}
              />
              <button
                data-testid="rec-ask-send"
                onClick={() => void askRecord(r)}
                disabled={askBusy || !askInput.trim()}
                className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
              >
                {askBusy ? '回答中' : '提问'}
              </button>
            </div>
            {askBusy && askStream && (
              <p className="whitespace-pre-wrap rounded-xl bg-blue-50 px-2.5 py-1.5 text-xs leading-relaxed dark:bg-blue-500/10">
                {askStream}
              </p>
            )}
          </div>

          <div className="flex justify-end px-4 pb-3">
            <button
              data-testid="delete-one-btn"
              onClick={async () => {
                if (!confirm('删除这条课堂记录？不可恢复。')) return
                await db.lessons.delete(r.id!)
                onCloseDetail()
                onChanged()
              }}
              className="rounded-lg px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              删除本条
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PackView({ data }: { data: ReviewPackRecord['data'] }) {
  const [flip, setFlip] = useState<Record<number, boolean>>({})
  return (
    <div className="space-y-3">
      {data.summary && <p className="rounded-xl bg-zinc-50 px-3 py-2 text-sm leading-relaxed dark:bg-zinc-800/60">{data.summary}</p>}

      {data.notes?.map((n, i) => (
        <div key={i} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">{n.heading}</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed">
            {n.points.map((p, j) => (
              <li key={j}>{p}</li>
            ))}
          </ul>
        </div>
      ))}

      {data.keyPoints && data.keyPoints.length > 0 && (
        <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">🎯 预测考点</p>
          <ul className="space-y-1 text-xs leading-relaxed">
            {data.keyPoints.map((k, i) => (
              <li key={i}>
                🎯 {k.text}
                {k.basis && <span className="ml-1 text-[10px] text-zinc-400">（{k.basis}）</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.knowledgeMap && data.knowledgeMap.length > 0 && (
        <div className="rounded-xl border border-violet-400/40 p-3 dark:border-violet-500/30">
          <p className="mb-1 text-xs font-semibold text-violet-600 dark:text-violet-400">🗺️ 知识地图</p>
          <ol className="list-decimal space-y-0.5 pl-4 text-xs leading-relaxed">
            {data.knowledgeMap.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ol>
        </div>
      )}

      {data.coverage && (
        <div className="rounded-xl border border-zinc-200 p-3 text-xs dark:border-zinc-800">
          <p className="mb-1 font-semibold text-zinc-600 dark:text-zinc-300">📊 课堂覆盖度</p>
          <p className="text-emerald-600 dark:text-emerald-400">🔥 高频覆盖：{data.coverage.high.join('、')}</p>
          <p className="mt-0.5 text-zinc-500">🌙 低频/未覆盖：{data.coverage.low.join('、') || '（无）'}</p>
        </div>
      )}

      {data.flashcards && data.flashcards.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            🃏 闪卡自测（{data.flashcards.length} 张，点击翻面）
          </p>
          <div className="space-y-2">
            {data.flashcards.map((c, i) => (
              <Flashcard key={i} idx={i} card={c} flip={!!flip[i]} onFlip={() => setFlip((f) => ({ ...f, [i]: !f[i] }))} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Flashcard({
  card,
  idx,
  flip,
  onFlip,
}: {
  card: { q: string; a: string }
  idx: number
  flip: boolean
  onFlip: () => void
}) {
  return (
    <button
      data-testid="flashcard"
      onClick={onFlip}
      className="w-full rounded-xl border border-zinc-300 bg-zinc-50 p-3 text-left text-sm active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-800"
    >
      <p className="mb-1 text-[10px] font-semibold text-zinc-400">{flip ? 'A · 答案' : `Q · 第 ${idx + 1} 张`}</p>
      <p className="leading-relaxed">{flip ? card.a : card.q}</p>
      {!flip && <p className="mt-1 text-[10px] text-zinc-400">点击查看答案</p>}
    </button>
  )
}
