// 查词/课中问答底部弹层：点字幕句唤起，AI 流式回答，录音不中断。
import { useEffect, useRef, useState } from 'react'
import { askAI } from '../lib/ai'

export interface SheetSeg {
  id: string
  text: string
}

interface Msg {
  role: 'user' | 'assistant'
  content: string
  meta?: string
}

export default function AskSheet({ seg, onClose }: { seg: SheetSeg | null; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [msgs])

  async function send(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '' }])
    setBusy(true)
    const context = seg ? `【学生点选的字幕句】${seg.text}` : ''
    try {
      await askAI({
        question: q,
        context,
        onDelta: (delta) => {
          setMsgs((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            copy[copy.length - 1] = { ...last, content: last.content + delta }
            return copy
          })
        },
      })
      setMsgs((m) => {
        const copy = [...m]
        const last = copy[copy.length - 1]
        copy[copy.length - 1] = { ...last, meta: '基于本节课最近字幕' }
        return copy
      })
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

        <div className="flex items-center gap-2 border-t border-zinc-100 p-3 pb-safe dark:border-zinc-800">
          <input
            data-testid="ask-input"
            className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
            placeholder="输入问题或要查的词"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send(input)
            }}
          />
          <button
            data-testid="ask-send"
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? '回答中' : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}
