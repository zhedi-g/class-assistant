// 资料库页（M5）：上传 → 本地解析 → 关联课堂 → AI 联合分析 → 结果卡片 + 术语回写 + 资料 AI 问答。
import { useEffect, useRef, useState } from 'react'
import { db, type LessonRecord, type MaterialRecord, type QaPair } from '../lib/db'
import { detectKind, parseMaterial } from '../lib/material'
import { analyzeMaterial, matchMaterialToLessons, mergeHotwords, pagesText, type MatchCandidate } from '../lib/analysis'
import { ocrImage } from '../lib/ocr'
import { askAI } from '../lib/ai'
import PageSheet from '../components/PageSheet'
import { useSettings } from '../store/settings'
import { useSession } from '../store/session'

const KIND_META: Record<string, { icon: string; label: string }> = {
  pptx: { icon: '📊', label: 'PPT' },
  pdf: { icon: '📄', label: 'PDF' },
  text: { icon: '📝', label: '文本' },
  image: { icon: '🖼️', label: '图片' },
}

type Step = 'idle' | 'matching' | 'analyzing'

/** 并发池：最多 limit 个任务同时跑 */
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let idx = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const item = items[idx++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

export default function MaterialsPage() {
  const notify = useSession((s) => s.notify)
  const [materials, setMaterials] = useState<MaterialRecord[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => {
    db.materials
      .orderBy('createdAt')
      .reverse()
      .toArray()
      .then(setMaterials)
      .catch(() => setMaterials([]))
  }
  useEffect(refresh, [])

  async function handleFiles(list: FileList) {
    // createdAt 按序号递增：批量上传时保证卡片顺序稳定（同一毫秒会导致排序不定）
    for (const [i, file] of Array.from(list).entries()) {
      const kind = detectKind(file.name, file.type)
      if (!kind) {
        notify(`不支持的格式：${file.name}`)
        continue
      }
      setUploading(`解析 ${file.name}…`)
      const id = Number(
        await db.materials.add({
          name: file.name,
          kind,
          size: file.size,
          status: 'parsing',
          pages: [],
          createdAt: Date.now() + i,
        }),
      )
      try {
        const pages = await parseMaterial(file, kind, (done, total, note) =>
          setUploading(`${file.name}：${note ?? `${done}/${total}`}`),
        )
        await db.materials.update(id, { pages, status: 'ready' })
        setOpenId(id)
      } catch (e) {
        await db.materials.update(id, { status: 'failed', statusMsg: (e as Error).message })
        notify(`解析失败：${file.name}`)
      }
    }
    setUploading(null)
    refresh()
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">资料库</h1>
        {materials !== null && materials.length > 0 && (
          <button
            data-testid="clear-materials"
            onClick={async () => {
              if (!confirm('清空全部资料（含分析结果）？不可恢复。')) return
              await db.materials.clear()
              setOpenId(null)
              refresh()
            }}
            className="rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
          >
            清空资料
          </button>
        )}
      </header>

      <input
        ref={fileRef}
        data-testid="mat-input"
        type="file"
        multiple
        accept=".pptx,.pdf,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.bmp"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <button
        data-testid="upload-btn"
        onClick={() => fileRef.current?.click()}
        disabled={uploading !== null}
        className="w-full rounded-2xl border-2 border-dashed border-blue-400/60 bg-blue-50/50 py-5 text-sm font-medium text-blue-600 active:scale-[0.99] disabled:opacity-50 dark:border-blue-500/40 dark:bg-blue-500/5 dark:text-blue-400"
      >
        {uploading ?? '＋ 上传资料（PPT / PDF / 文本 / 图片）'}
      </button>
      <p className="text-center text-[11px] text-zinc-400 dark:text-zinc-600">
        课前传=预习包，课后传=自动关联课堂记录做联合分析；文件只存本机，点分析时才发送文本给 AI
      </p>

      {materials === null && <p className="pt-6 text-center text-sm text-zinc-400">加载中…</p>}

      {materials !== null && materials.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 py-14 text-center dark:border-zinc-800">
          <span className="text-3xl">📚</span>
          <p className="text-sm text-zinc-500">还没有资料</p>
          <p className="px-8 text-xs text-zinc-400 dark:text-zinc-600">
            上传老师的 PPT、讲义、教材章节或板书照片，AI 会自动关联相关课堂记录做联合分析，给出预习或复习建议。
          </p>
        </div>
      )}

      {materials !== null &&
        materials.map((m) => (
          <MaterialCard
            key={m.id}
            record={m}
            open={openId === m.id}
            onToggle={() => setOpenId(openId === m.id ? null : (m.id ?? null))}
            onChanged={refresh}
            notify={notify}
          />
        ))}
    </div>
  )
}

function MaterialCard({
  record: m,
  open,
  onToggle,
  onChanged,
  notify,
}: {
  record: MaterialRecord
  open: boolean
  onToggle: () => void
  onChanged: () => void
  notify: (msg: string) => void
}) {
  const meta = KIND_META[m.kind] ?? { icon: '📄', label: m.kind }
  return (
    <div
      data-testid="material-card"
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <button data-testid="material-toggle" onClick={onToggle} className="w-full p-4 text-left active:bg-zinc-50 dark:active:bg-zinc-800/50">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-lg">{meta.icon}</span>
            <span className="truncate text-sm font-semibold">{m.name}</span>
          </span>
          <span className="shrink-0 text-xs text-zinc-400">
            {m.status === 'ready' && `${m.pages.length} 页`}
            {m.status === 'parsing' && '解析中…'}
            {m.status === 'failed' && '解析失败'}
            <span className="ml-1 text-zinc-300 dark:text-zinc-600">{open ? '▲' : '▼'}</span>
          </span>
        </div>
        {m.analysis && (
          <p className="mt-1.5 text-xs">
            <span className={m.analysis.mode === 'review' ? 'text-emerald-500' : 'text-sky-500'}>
              {m.analysis.mode === 'review' ? '🔁 联合分析' : '🚀 预习包'}
            </span>
            <span className="ml-2 text-zinc-400">{m.analysis.matchNote}</span>
          </p>
        )}
        {m.status === 'failed' && <p className="mt-1 text-xs text-red-500">{m.statusMsg}</p>}
      </button>

      {open && <MaterialDetail record={m} onChanged={onChanged} notify={notify} />}
    </div>
  )
}

function MaterialDetail({
  record: m,
  onChanged,
  notify,
}: {
  record: MaterialRecord
  onChanged: () => void
  notify: (msg: string) => void
}) {
  const [step, setStep] = useState<Step>('idle')
  const [candidates, setCandidates] = useState<MatchCandidate[]>([])
  const [selected, setSelected] = useState<Record<number, boolean>>({})
  const [lessonsCache, setLessonsCache] = useState<Record<number, LessonRecord>>({})
  const [analyzing, setAnalyzing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocrNote, setOcrNote] = useState<string | null>(null)
  const [qaInput, setQaInput] = useState('')
  const [qaStream, setQaStream] = useState('')
  const [qaBusy, setQaBusy] = useState(false)
  const [pageSheet, setPageSheet] = useState<MaterialRecord['pages'][number] | null>(null)
  const setSettings = useSettings((s) => s.setSettings)
  const hotwords = useSettings((s) => s.hotwords)

  const refresh = () => {
    db.materials
      .orderBy('createdAt')
      .reverse()
      .toArray()
      .then((all) => {
        const cur = all.find((x) => x.id === m.id)
        if (cur) Object.assign(m, cur)
        onChanged()
      })
  }

  /** 视觉识别 needOcr 页：并发 3、失败不阻塞、可重试 */
  async function runOcr(pages: MaterialRecord['pages']): Promise<{ ok: number; fail: number }> {
    const limit = Math.min(useSettings.getState().ocrLimit || 20, 50)
    const targets = pages.filter((p) => p.needOcr && p.imageBlobs?.length).slice(0, limit)
    if (!targets.length) return { ok: 0, fail: 0 }
    let done = 0
    let fail = 0
    await runPool(targets, 3, async (p) => {
      try {
        const text = await ocrImage(p.imageBlobs![0])
        p.text = text
        p.needOcr = false
        p.imageBlobs = undefined
      } catch {
        fail++
      }
      done++
      setAnalyzing(`视觉识别图片页 ${done}/${targets.length}…`)
    })
    return { ok: done - fail, fail }
  }

  async function retryOcr() {
    setError(null)
    setAnalyzing('视觉识别图片页…')
    const { ok, fail } = await runOcr(m.pages)
    await db.materials.update(m.id!, { pages: m.pages })
    setAnalyzing(null)
    setOcrNote(`识别完成：成功 ${ok} 页${fail ? `，失败 ${fail} 页（可再次重试）` : ''}`)
    refresh()
  }

  async function runAnalysis(lessonIds: number[], matchNote: string) {
    setStep('analyzing')
    setError(null)
    setAnalyzing('准备分析…')
    try {
      // 图片页先视觉识别（并发 3，失败不阻塞）
      if (m.pages.some((p) => p.needOcr && p.imageBlobs?.length)) {
        setAnalyzing('视觉识别图片页…')
        const { ok, fail } = await runOcr(m.pages)
        await db.materials.update(m.id!, { pages: m.pages })
        if (ok + fail > 0) setOcrNote(`图片页识别：成功 ${ok} 页${fail ? `，失败 ${fail} 页（可重试）` : ''}`)
      }
      // 空内容拒析：识别后仍几乎无文字（纯扫描件识别失败/超上限）→ 不调用 AI，避免幻觉分析
      const totalChars = pagesText(m.pages, 999_999).replace(/\s/g, '').length
      if (totalChars < 20) {
        setError('本资料没有可识别的文字（图片页识别失败或超上限）。请点「重试识别」或在设置中调高页数上限后重试。')
        setStep('idle')
        return
      }
      const lessons = lessonIds.map((id) => lessonsCache[id]).filter(Boolean)
      // ⭐ 标记页注入：学生手动标注的重点在提示词中被优先参考
      const pagesForAi = m.pages.map((p) => (p.marked ? { ...p, label: `⭐${p.label}` } : p))
      const analysis = await analyzeMaterial({ name: m.name, pages: pagesForAi }, lessons, lessonIds.length ? 'review' : 'preview', matchNote, {
        onProgress: (note) => setAnalyzing(note),
        onRaw: (chars) => setAnalyzing(`AI 分析中…已生成 ${chars} 字`),
      })
      await db.materials.update(m.id!, { analysis })
      onChanged()
      notify(analysis.mode === 'review' ? '联合分析完成' : '预习包已生成')
      setStep('idle')
    } catch (e) {
      setError((e as Error).message)
      setStep('idle')
    } finally {
      setAnalyzing(null)
    }
  }

  function reanalyze() {
    if (!confirm('重新分析将覆盖当前结果，继续？')) return
    void (async () => {
      await db.materials.update(m.id!, { analysis: undefined })
      m.analysis = undefined
      onChanged()
      setStep('idle')
      await startMatching()
    })()
  }

  async function startMatching() {
    setError(null)
    setStep('matching')
    const lessons = await db.lessons.toArray()
    const cache: Record<number, LessonRecord> = {}
    for (const l of lessons) if (l.id !== undefined) cache[l.id] = l
    setLessonsCache(cache)
    const cands = matchMaterialToLessons(m, lessons)
    if (!cands.length || cands[0].score < 0.06) {
      await runAnalysis([], '未找到相关课堂记录 · 预习模式')
      return
    }
    setSelected(Object.fromEntries(cands.map((c) => [c.lessonId, true])))
    setCandidates(cands)
  }

  async function mergeTerms() {
    if (!m.analysis?.result.terms?.length) return
    setSettings({ hotwords: mergeHotwords(hotwords, m.analysis.result.terms) })
    notify(`已合并 ${m.analysis.result.terms.length} 个术语进识别热词`)
  }

  /** 资料 AI 问答：带资料全文上下文，流式回答，随资料存档 */
  async function askMaterial(q: string) {
    const question = q.trim()
    if (!question || qaBusy) return
    setQaBusy(true)
    setQaStream('')
    // 纯扫描件：先自动视觉识别，再回答（仍无文字则明确报错）
    if (pagesText(m.pages, 6000).replace(/\s/g, '').length < 50) {
      setQaStream('本资料暂无可识别文字，正在视觉识别…')
      await runOcr(m.pages)
      await db.materials.update(m.id!, { pages: m.pages })
      if (pagesText(m.pages, 6000).replace(/\s/g, '').length < 50) {
        setQaStream('')
        notify('该资料没有可识别的文字（图片页识别失败或超上限）')
        setQaBusy(false)
        return
      }
    }
    let a = ''
    try {
      await askAI({
        question,
        context: `【资料：${m.name}】${pagesText(m.pages, 6000)}`,
        onDelta: (d) => {
          a += d
          setQaStream(a)
        },
      })
      const pair: QaPair = { q: question, a, ts: Date.now() }
      await db.materials.update(m.id!, { qas: [...(m.qas ?? []), pair] })
      m.qas = [...(m.qas ?? []), pair]
      setQaInput('')
      setQaStream('')
      onChanged()
    } catch (e) {
      setQaStream('回答失败：' + (e as Error).message)
    } finally {
      setQaBusy(false)
    }
  }

  return (
    <div className="border-t border-zinc-100 p-4 dark:border-zinc-800">
      {m.status === 'parsing' && <p className="text-xs text-zinc-400">解析中…</p>}
      {m.status === 'failed' && <p className="text-xs text-red-500">{m.statusMsg}</p>}

      {m.analysis && <AnalysisView analysis={m.analysis} onMergeTerms={mergeTerms} />}

      {/* 操作行：开始分析 / 重新分析 / 重试识别 */}
      {step === 'idle' && m.status === 'ready' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!m.analysis && (
            <button
              data-testid="analyze-btn"
              onClick={() => void startMatching()}
              className="min-w-0 flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white"
            >
              开始分析
            </button>
          )}
          {m.analysis && (
            <button
              data-testid="reanalyze-btn"
              onClick={reanalyze}
              className="flex-1 rounded-xl border border-blue-500/60 py-2 text-xs text-blue-500"
            >
              🔄 重新分析
            </button>
          )}
          {m.pages.some((p) => p.needOcr) && (
            <button
              data-testid="retry-ocr"
              onClick={() => void retryOcr()}
              className="flex-1 rounded-xl border border-zinc-300 py-2 text-xs text-zinc-500 dark:border-zinc-700"
            >
              🖼️ 重试识别 {m.pages.filter((p) => p.needOcr).length} 个图片页
            </button>
          )}
        </div>
      )}

      {step === 'matching' && (
        <div data-testid="match-list" className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-zinc-500">发现可能相关的课堂记录，请确认（可多选）：</p>
          {candidates.map((c) => (
            <label key={c.lessonId} className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
              <input
                type="checkbox"
                checked={!!selected[c.lessonId]}
                onChange={(e) => setSelected((s) => ({ ...s, [c.lessonId]: e.target.checked }))}
              />
              <span className="flex-1">
                {c.date} 的课
                <span className="ml-2 text-zinc-400">
                  相似度 {Math.round(c.score * 100)}%
                  {c.termHits.length > 0 && ` · 重合词：${c.termHits.slice(0, 4).join('、')}`}
                </span>
              </span>
            </label>
          ))}
          <div className="flex gap-2">
            <button
              data-testid="analyze-confirm"
              onClick={() => {
                const ids = Object.entries(selected)
                  .filter(([, v]) => v)
                  .map(([k]) => Number(k))
                const top = candidates[0]
                const note = ids.length
                  ? `已关联 ${ids.length} 节课 · 相似度 ${Math.round((candidates.find((c) => c.lessonId === ids[0])?.score ?? 0) * 100)}%`
                  : '未关联课堂记录 · 预习模式'
                void runAnalysis(ids, note)
              }}
              className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white"
            >
              开始联合分析
            </button>
            <button
              data-testid="analyze-preview-only"
              onClick={() => void runAnalysis([], '手动选择 · 预习模式')}
              className="rounded-xl border border-zinc-300 px-3 py-2.5 text-sm text-zinc-500 dark:border-zinc-700"
            >
              仅预习
            </button>
          </div>
          <button onClick={() => setStep('idle')} className="w-full text-center text-xs text-zinc-400">
            取消
          </button>
        </div>
      )}

      {step === 'analyzing' && (
        <p data-testid="analyzing" className="animate-pulse py-2 text-center text-xs text-blue-500">
          {analyzing ?? '分析中…'}
        </p>
      )}
      {ocrNote && <p className="pt-1 text-[11px] text-zinc-400">{ocrNote}</p>}
      {error && <p className="pt-1 text-xs text-red-500">{error}</p>}

      {/* 页面级操作面板 */}
      {pageSheet && m.id !== undefined && (
        <PageSheet
          materialId={m.id}
          materialName={m.name}
          page={pageSheet}
          onClose={() => setPageSheet(null)}
          onChanged={refresh}
        />
      )}

      {/* 资料 AI 问答 */}
      {m.status === 'ready' && m.pages.some((p) => p.text) && (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <p className="mb-2 text-xs font-semibold text-zinc-500">问 AI（自动带整份资料内容）</p>
          {m.qas && m.qas.length > 0 && (
            <div data-testid="mat-qas" className="mb-2 space-y-2">
              {m.qas.map((qa, i) => (
                <div key={i} className="space-y-1">
                  <p className="text-right text-xs text-blue-500">Q：{qa.q}</p>
                  <p className="whitespace-pre-wrap rounded-xl bg-zinc-100 px-2.5 py-1.5 text-xs leading-relaxed dark:bg-zinc-800">
                    A：{qa.a}
                  </p>
                </div>
              ))}
            </div>
          )}
          {qaBusy && qaStream && (
            <p className="mb-2 whitespace-pre-wrap rounded-xl bg-blue-50 px-2.5 py-1.5 text-xs leading-relaxed dark:bg-blue-500/10">
              {qaStream}
            </p>
          )}
          <div className="flex items-center gap-2">
            <input
              data-testid="mat-qa-input"
              className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-2.5 py-2 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
              placeholder="对这份资料提问，如：这份资料的重点是什么"
              value={qaInput}
              onChange={(e) => setQaInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void askMaterial(qaInput)
              }}
            />
            <button
              data-testid="mat-qa-send"
              onClick={() => void askMaterial(qaInput)}
              disabled={qaBusy || !qaInput.trim()}
              className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
            >
              {qaBusy ? '回答中' : '提问'}
            </button>
          </div>
        </div>
      )}

      {/* 逐页文本预览 */}
      {m.status === 'ready' && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-zinc-400">查看解析出的 {m.pages.length} 页文本</summary>
          <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
            {m.pages.map((p) => (
              <button
                key={p.label}
                data-testid="mat-page"
                onClick={() => setPageSheet(p)}
                className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs leading-relaxed active:bg-zinc-100 dark:active:bg-zinc-800 ${
                  p.marked
                    ? 'border border-amber-400/60 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
                    : 'text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/60'
                }`}
              >
                <span className="mr-1.5 font-mono text-[10px] text-zinc-400">{p.marked ? '🚩 ' : ''}{p.label}</span>
                {p.text || (p.needOcr ? '（图片页：分析时将自动视觉识别）' : '（无文字）')}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function AnalysisView({ analysis, onMergeTerms }: { analysis: NonNullable<MaterialRecord['analysis']>; onMergeTerms: () => void }) {
  const r = analysis.result
  return (
    <div data-testid="analysis-result" className="space-y-3">
      <p className="text-xs">
        <span className={`rounded px-1.5 py-0.5 font-semibold ${analysis.mode === 'review' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400'}`}>
          {analysis.mode === 'review' ? '🔁 复习模式 · 联合分析' : '🚀 预习模式'}
        </span>
        <span className="ml-2 text-zinc-400">{analysis.matchNote}</span>
      </p>
      {r.summary && <p className="rounded-xl bg-zinc-50 px-3 py-2 text-sm leading-relaxed dark:bg-zinc-800/60">{r.summary}</p>}

      {r.outline && (
        <Section title="提纲">
          <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed">
            {r.outline.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </Section>
      )}

      {r.terms && (
        <Section title="核心术语">
          <div className="flex flex-wrap gap-1.5">
            {r.terms.map((t) => (
              <span key={t} className="rounded-lg bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                {t}
              </span>
            ))}
          </div>
          <button
            data-testid="merge-terms"
            onClick={onMergeTerms}
            className="mt-2 rounded-lg border border-blue-400/60 px-2.5 py-1 text-xs text-blue-600 dark:border-blue-500/40 dark:text-blue-400"
          >
            ⚡ 将这 {r.terms.length} 个术语加入识别热词
          </button>
        </Section>
      )}

      {analysis.mode === 'review' && r.compare && (
        <Section title="资料 × 课堂对照">
          <CompareBlock title="🧩 资料有、课堂未细讲（自己补）" items={r.compare.inMaterialOnly} />
          <CompareBlock title="🔥 课堂反复强调、资料简略（重点信号）" items={r.compare.emphasizedInClass} gold />
          <CompareBlock title="🔀 两者表述不同" items={r.compare.differs} />
        </Section>
      )}

      {analysis.mode === 'preview' && r.listenQuestions && (
        <Section title="带着这些问题去听课">
          <ul className="space-y-1 text-xs leading-relaxed">
            {r.listenQuestions.map((x, i) => (
              <li key={i}>❓ {x}</li>
            ))}
          </ul>
        </Section>
      )}

      {analysis.mode === 'preview' && r.hardPoints && (
        <Section title="难点预警">
          <ul className="space-y-1 text-xs leading-relaxed">
            {r.hardPoints.map((x, i) => (
              <li key={i}>⚠️ {x}</li>
            ))}
          </ul>
        </Section>
      )}

      {analysis.mode === 'review' && r.examFocus && (
        <Section title="预测考点">
          <ul className="space-y-1 text-xs leading-relaxed">
            {r.examFocus.map((x, i) => (
              <li key={i}>🎯 {x}</li>
            ))}
          </ul>
        </Section>
      )}

      {r.reviewPlan && (
        <Section title={analysis.mode === 'review' ? '复习建议（按优先级）' : '预习行动建议'}>
          <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed">
            {r.reviewPlan.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="mb-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300">{title}</p>
      {children}
    </div>
  )
}

function CompareBlock({ title, items, gold }: { title: string; items?: string[]; gold?: boolean }) {
  if (!items?.length) return null
  return (
    <div className="mb-2 last:mb-0">
      <p className={`mb-1 text-[11px] font-semibold ${gold ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500'}`}>{title}</p>
      <ul className="space-y-0.5 pl-3 text-xs leading-relaxed">
        {items.map((x, i) => (
          <li key={i}>· {x}</li>
        ))}
      </ul>
    </div>
  )
}
