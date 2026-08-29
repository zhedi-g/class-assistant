// 查词/课中问答底部弹层：点字幕句或「问 AI」按钮唤起，流式回答，历史保存在会话中。
import { useEffect, useRef } from 'react'
import { useSession } from '../store/session'

export interface SheetSeg {
  id: string
  text: string
}

export default function AskSheet({ seg, onClose }: { seg: SheetSeg | null; onClose: () => void }) {
  const msgs = useSession((s) => s.askMsgs)
  const busy = useSession((s) => s.askBusy)
  const aiFix = useSession((s) => s.aiFix)
  const sendAsk = useSession((s) => s.sendAsk)
  const toggleMark = useSession((s) => s.toggleMark)
  const notify = useSession((s) => s.notify)
  const liveSeg = useSession((s) => (seg ? s.segments.find((x) => x.id === seg.id) : undefined))
  const inputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [msgs])

  function send() {
    const q = inputRef.current?.value.trim()
    if (!q || busy) return
    if (inputRef.current) inputRef.current.value = ''
    void sendAsk(q, seg?.text)
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      <div className="flex-1 bg-black/40" onClick={busy ? undefined : onClose} />
      <div
        data-testid="ask-sheet"
        className="flex max-h-[72vh] flex-col rounded-t-3xl border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <p className="text-sm font-semibold">查词 · 课中问答</p>
            {seg && (
              <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400 dark:text-zinc-500">
                选中字幕：{seg.text}
              </p>
            )}
          </div>
          <button
            data-testid="ask-close"
            onClick={onClose}
            disabled={busy}
            className="shrink-0 rounded-lg px-2 py-1 text-xs text-zinc-400 disabled:opacity-40"
          >
            收起
          </button>
        </div>

        {/* 句子操作面板：标记 / 解析 / 回答此问 / 复制 */}
        {seg && (
          <div data-testid="seg-actions" className="flex flex-wrap gap-2 px-4 pt-3">
            <button
              data-testid="act-mark"
              disabled={busy}
              onClick={() => toggleMark(seg.id)}
              className="flex-1 basis-[30%] rounded-xl border border-amber-400/60 px-2 py-2 text-xs font-medium text-amber-600 disabled:opacity-40 dark:border-amber-500/40 dark:text-amber-400"
            >
              🚩 {liveSeg?.marked ? '取消标记' : '标记重点'}
            </button>
            <button
              data-testid="act-parse"
              disabled={busy}
              onClick={() => void sendAsk('请解析这句话在讲什么，涉及哪些知识点或概念，有什么需要注意的', seg.text)}
              className="flex-1 basis-[30%] rounded-xl border border-blue-400/60 px-2 py-2 text-xs font-medium text-blue-600 disabled:opacity-40 dark:border-blue-500/40 dark:text-blue-400"
            >
              📖 解析本句
            </button>
            {liveSeg?.q && (
              <button
                data-testid="act-answer-q"
                disabled={busy}
                onClick={() => void sendAsk(`请回答这句课堂提问：${seg.text}`, seg.text)}
                className="flex-1 basis-[30%] rounded-xl border border-violet-400/60 px-2 py-2 text-xs font-medium text-violet-600 disabled:opacity-40 dark:border-violet-500/40 dark:text-violet-400"
              >
                💡 回答此问
              </button>
            )}
            <button
              data-testid="act-copy"
              onClick={() =>
                navigator.clipboard
                  .writeText(seg.text)
                  .then(() => notify('已复制到剪贴板'))
                  .catch(() => notify('复制失败：浏览器未授权剪贴板'))
              }
              className="flex-1 basis-[30%] rounded-xl border border-zinc-300 px-2 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
            >
              📋 复制原文
            </button>
          </div>
        )}

        {!aiFix && (
          <div data-testid="ask-nokey" className="mx-4 mt-3 rounded-xl border border-amber-400/50 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
            AI 问答需要智谱或 DeepSeek 的 API Key（讯飞的 Key 只用于语音识别）。请到「设置」填写后重试。
          </div>
        )}

        <div ref={bodyRef} data-testid="ask-body" className="min-h-32 flex-1 space-y-3 overflow-y-auto p-4">
          {msgs.length === 0 && (
            <div className="space-y-2 text-xs text-zinc-400 dark:text-zinc-500">
              <p>可以这样问：</p>
              <p>· 「动能定理是什么意思」——查术语</p>
              <p>· 「老师刚才这句在讲什么」——解读选中字幕</p>
              <p>· 「这道题的第三步为什么成立」——结合课堂内容提问</p>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                data-testid={m.role === 'assistant' ? 'ask-answer' : undefined}
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
        </div>

        <div className="pb-safe flex items-center gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
          <input
            ref={inputRef}
            data-testid="ask-input"
            className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
            placeholder="输入问题或要查的词"
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
          />
          <button
            data-testid="ask-send"
            onClick={send}
            disabled={busy}
            className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? '回答中' : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}
