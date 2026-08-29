// 资料页/段操作面板（M5.2）：点解析出的某页文字弹出，按"读资料学习"场景提供动作。
// 动作：标记重点 / 解析本段 / 精讲这段 / 出题自测 / 回答此问(仅含问句时) / 复制。
// 所有回答流式输出并持久化到资料问答记录。
import { useEffect, useRef, useState } from 'react'
import { db, type MaterialPage, type QaPair } from '../lib/db'
import { addMaterialQa, togglePageMark } from '../lib/material'
import { askAI } from '../lib/ai'
import { detectQuestion } from '../lib/question'
import { useSession } from '../store/session'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  meta?: string
}

export default function PageSheet({
  materialId,
  materialName,
  page,
  onClose,
  onChanged,
}: {
  materialId: number
  materialName: string
  page: MaterialPage
  onClose: () => void
  onChanged: () => void
}) {
  const notify = useSession((s) => s.notify)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [marked, setMarked] = useState(!!page.marked)
  const [qas, setQas] = useState<QaPair[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const isQ = detectQuestion(page.text).question

  useEffect(() => {
    db.materials.get(materialId).then((r) => setQas(r?.qas ?? []))
  }, [materialId])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [msgs])

  const context = `【资料：${materialName} · ${page.label}】${page.text}`

  async function ask(question: string, meta: string) {
    const q = question.trim()
    if (!q || busy) return
    setBusy(true)
    setMsgs((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '' }])
    let a = ''
    try {
      await askAI({
        question: q,
        context,
        onDelta: (d) => {
          a += d
          setMsgs((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            copy[copy.length - 1] = { ...last, content: last.content + d }
            return copy
          })
        },
      })
      await addMaterialQa(materialId, { q, a, ts: Date.now() })
      setQas(await db.materials.get(materialId).then((r) => r?.qas ?? []))
      setMsgs((m) => {
        const copy = [...m]
        const last = copy[copy.length - 1]
        copy[copy.length - 1] = { ...last, meta }
        return copy
      })
      onChanged()
    } catch (e) {
      setMsgs((m) => {
        const copy = [...m]
        const last = copy[copy.length - 1]
        copy[copy.length - 1] = { ...last, content: '回答失败：' + (e as Error).message }
        return copy
      })
    } finally {
      setBusy(false)
    }
  }

  async function toggleMark() {
    const now = await togglePageMark(materialId, page.label)
    if (now === null) return
    setMarked(now)
    onChanged()
    notify(now ? '已标记为重点段落（分析时优先参考）' : '已取消标记')
  }

  function copyText() {
    navigator.clipboard
      .writeText(page.text)
      .then(() => notify('已复制到剪贴板'))
      .catch(() => notify('复制失败：浏览器未授权剪贴板'))
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      <div className="flex-1 bg-black/40" onClick={busy ? undefined : onClose} />
      <div
        data-testid="page-sheet"
        className="flex max-h-[78vh] flex-col rounded-t-3xl border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              📖 {page.label}
              {marked && <span className="ml-2 text-xs text-amber-500">🚩 重点</span>}
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-400 dark:text-zinc-500">{materialName}</p>
          </div>
          <button
            data-testid="page-close"
            onClick={onClose}
            disabled={busy}
            className="shrink-0 rounded-lg px-2 py-1 text-xs text-zinc-400 disabled:opacity-40"
          >
            收起
          </button>
        </div>

        <div className="mx-4 mt-3 max-h-28 overflow-y-auto rounded-xl bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
          {page.text || '（本页暂无文字，可先执行视觉识别）'}
        </div>

        {/* 动作区 */}
        <div data-testid="page-actions" className="flex flex-wrap gap-2 px-4 pt-3">
          <button
            data-testid="act-page-mark"
            disabled={busy}
            onClick={() => void toggleMark()}
            className={`flex-1 basis-[30%] rounded-xl border px-2 py-2 text-xs font-medium disabled:opacity-40 ${
              marked
                ? 'border-amber-500 bg-amber-50 text-amber-600 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-400'
                : 'border-amber-400/60 text-amber-600 dark:border-amber-500/40 dark:text-amber-400'
            }`}
          >
            🚩 {marked ? '取消重点' : '标记重点'}
          </button>
          <button
            data-testid="act-page-parse"
            disabled={busy}
            onClick={() => void ask('请解析这段内容在讲什么，涉及哪些知识点或概念。', '已存入资料问答')}
            className="flex-1 basis-[30%] rounded-xl border border-blue-400/60 px-2 py-2 text-xs font-medium text-blue-600 disabled:opacity-40 dark:border-blue-500/40 dark:text-blue-400"
          >
            📖 解析本段
          </button>
          <button
            data-testid="act-page-teach"
            disabled={busy}
            onClick={() =>
              void ask('请像老师一样详细讲解这段内容：拆解概念、给出例子、指出易错点。', '已存入资料问答')
            }
            className="flex-1 basis-[30%] rounded-xl border border-emerald-400/60 px-2 py-2 text-xs font-medium text-emerald-600 disabled:opacity-40 dark:border-emerald-500/40 dark:text-emerald-400"
          >
            🎓 精讲这段
          </button>
          <button
            data-testid="act-page-quiz"
            disabled={busy}
            onClick={() =>
              void ask('请针对这段内容出 3 道自测题（填空/简答/计算均可），每题后直接给出参考答案。', '已存入资料问答')
            }
            className="flex-1 basis-[30%] rounded-xl border border-sky-400/60 px-2 py-2 text-xs font-medium text-sky-600 disabled:opacity-40 dark:border-sky-500/40 dark:text-sky-400"
          >
            ✍️ 出题自测
          </button>
          {isQ && (
            <button
              data-testid="act-page-answer-q"
              disabled={busy}
              onClick={() => void ask(`请回答这段内容中提出的问题：${page.text}`, '已存入资料问答')}
              className="flex-1 basis-[30%] rounded-xl border border-violet-400/60 px-2 py-2 text-xs font-medium text-violet-600 disabled:opacity-40 dark:border-violet-500/40 dark:text-violet-400"
            >
              💡 回答此问
            </button>
          )}
          <button
            data-testid="act-page-copy"
            onClick={copyText}
            className="flex-1 basis-[30%] rounded-xl border border-zinc-300 px-2 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
          >
            📋 复制原文
          </button>
        </div>

        {/* 对话与历史 */}
        <div ref={bodyRef} data-testid="page-body" className="min-h-24 flex-1 space-y-3 overflow-y-auto p-4">
          {msgs.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                data-testid={m.role === 'assistant' ? 'page-answer' : undefined}
                className={
                  m.role === 'user'
                    ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-3 py-2 text-sm text-white'
                    : 'max-w-[85%] rounded-2xl rounded-bl-sm bg-zinc-100 px-3 py-2 text-sm leading-relaxed dark:bg-zinc-800'
                }
              >
                {m.content || (busy ? <span className="animate-pulse">思考中…</span> : '')}
                {m.meta && <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">{m.meta}</p>}
              </div>
            </div>
          ))}
          {qas.length > 0 && (
            <details className="rounded-xl bg-zinc-50 p-2.5 dark:bg-zinc-800/60">
              <summary className="cursor-pointer text-[11px] text-zinc-400">历史问答 {qas.length} 条（点击展开）</summary>
              <div className="mt-2 space-y-2">
                {qas.map((qa, i) => (
                  <div key={i} className="space-y-0.5">
                    <p className="text-right text-[11px] text-blue-500">Q：{qa.q}</p>
                    <p className="whitespace-pre-wrap rounded-lg bg-zinc-100 px-2 py-1 text-[11px] leading-relaxed dark:bg-zinc-800">
                      A：{qa.a}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="pb-safe flex items-center gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
          <input
            ref={inputRef}
            data-testid="page-ask-input"
            className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
            placeholder="针对本页自由提问"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inputRef.current) {
                void ask(inputRef.current.value, '已存入资料问答')
                inputRef.current.value = ''
              }
            }}
          />
          <button
            data-testid="page-ask-send"
            onClick={() => {
              if (inputRef.current) {
                void ask(inputRef.current.value, '已存入资料问答')
                inputRef.current.value = ''
              }
            }}
            disabled={busy || !inputRef.current?.value.trim()}
            className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
