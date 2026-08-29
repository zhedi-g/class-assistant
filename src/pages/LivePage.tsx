import { useEffect, useRef, useState } from 'react'
import { fmtDuration, resumeCapture, useSession } from '../store/session'
import { loadSecrets, type SecretMap } from '../lib/secretStore'

const MILESTONES = [
  { id: 'M1', label: '设置与密钥管理', done: true },
  { id: 'M2', label: '实时语音转写（讯飞）', done: true },
  { id: 'M3', label: '关键词震动提醒', done: false },
  { id: 'M4', label: '生词即查 + 课中 AI 问答', done: false },
  { id: 'M5+', label: 'PPT/教材导入 · 课后学习包', done: false },
]

export default function LivePage() {
  const s = useSession()
  const recording = s.status === 'recording'
  const [elapsed, setElapsed] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!recording || !s.startedAt) return
    const t = setInterval(() => setElapsed(Math.round((Date.now() - s.startedAt!) / 1000)), 1000)
    return () => clearInterval(t)
  }, [recording, s.startedAt])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [s.segments, s.interim])

  useEffect(() => {
    if (!recording) return
    const onVis = () => {
      useSession.getState().setBehind(document.hidden)
      // 回到前台时 AudioContext 可能被系统挂起，主动恢复采集
      if (!document.hidden) resumeCapture()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [recording])

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">课堂学习助手</h1>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
        </span>
      </header>

      {recording ? <RecordingView s={s} elapsed={elapsed} listRef={listRef} /> : <IdleView />}
    </div>
  )
}

function IdleView() {
  const s = useSession()
  const [secrets, setSecrets] = useState<SecretMap | null>(null)
  useEffect(() => {
    loadSecrets().then(setSecrets)
  }, [])

  const iflyOk = !!secrets?.['iflytek.apiKey'] && !!secrets?.['iflytek.apiSecret']
  const zhipuOk = !!secrets?.['zhipu.apiKey']
  const dsOk = !!secrets?.['deepseek.apiKey']

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-3 gap-2">
        <StatusChip label="讯飞转写" ok={iflyOk} />
        <StatusChip label="智谱 AI" ok={zhipuOk} />
        <StatusChip label="DeepSeek" ok={dsOk} />
      </section>

      {s.errMsg && (
        <p data-testid="err" className="rounded-xl border border-red-300/50 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {s.errMsg}
        </p>
      )}

      <button
        data-testid="start-btn"
        onClick={() => void s.start()}
        className="w-full rounded-2xl bg-blue-600 py-4 text-lg font-semibold text-white shadow-lg shadow-blue-600/20 active:scale-[0.99]"
      >
        开始上课
      </button>
      <p className="text-center text-xs text-zinc-400 dark:text-zinc-600">
        录音期间页面会申请保持亮屏；锁屏或切后台可能导致浏览器暂停采集
      </p>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">开发进度</h2>
        <ul className="mt-3 space-y-2">
          {MILESTONES.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-xs">
              <span className={`w-10 shrink-0 text-center ${m.done ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-600'}`}>
                {m.done ? '✓ ' + m.id : m.id}
              </span>
              <span className={m.done ? 'text-zinc-400 line-through dark:text-zinc-600' : ''}>{m.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function RecordingView({
  s,
  elapsed,
  listRef,
}: {
  s: ReturnType<typeof useSession.getState>
  elapsed: number
  listRef: React.RefObject<HTMLDivElement | null>
}) {
  const connText =
    s.conn === 'open' ? '识别中' : s.conn === 'reconnecting' ? '重连中…' : '连接中…'
  const connColor =
    s.conn === 'open' ? 'bg-emerald-500' : s.conn === 'reconnecting' ? 'bg-amber-500' : 'bg-zinc-400'

  return (
    <div className="space-y-3">
      {s.behindApp && (
        <p className="rounded-xl bg-amber-100 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
          已切到后台：浏览器可能暂停了录音，请回到本页面继续
        </p>
      )}

      <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
        <span className="flex items-center gap-1.5 text-zinc-500">
          <span data-testid="conn-dot" className={`h-2 w-2 rounded-full ${connColor}`} />
          {connText}
        </span>
        <span data-testid="ai-fix" className={s.aiFix ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-600'}>
          {s.aiFix ? 'AI校对 开' : 'AI校对 关'}
        </span>
        <span data-testid="elapsed" className="font-mono text-sm font-semibold">
          {fmtDuration(elapsed)}
        </span>
        {s.reconnects > 0 && <span className="text-amber-500">重连 {s.reconnects} 次</span>}
      </div>
      {s.connNote && <p className="px-1 text-[11px] text-zinc-400 dark:text-zinc-600">{s.connNote}</p>}

      {s.errMsg && (
        <p data-testid="err" className="rounded-xl border border-red-300/50 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {s.errMsg}
        </p>
      )}

      <div
        ref={listRef}
        data-testid="subtitle"
        className="h-[46vh] space-y-2 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {s.segments.map((seg) => (
          <p
            key={seg.id}
            data-testid="segment"
            className={
              seg.marked
                ? 'rounded-lg border border-amber-400/60 bg-amber-50 px-2 py-1.5 text-[15px] leading-relaxed dark:border-amber-500/40 dark:bg-amber-500/10'
                : 'text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300'
            }
          >
            {seg.marked && '🚩 '}
            {seg.text}
          </p>
        ))}
        {s.interim && (
          <p data-testid="interim" className="text-[15px] italic leading-relaxed text-zinc-400 dark:text-zinc-500">
            {s.interim}
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-blue-500 align-middle" />
          </p>
        )}
        {s.segments.length === 0 && !s.interim && (
          <p className="pt-16 text-center text-sm text-zinc-400 dark:text-zinc-600">正在聆听，开口说话即可转写…</p>
        )}
      </div>

      <div className="flex gap-3">
        <button
          data-testid="mark-btn"
          onClick={s.mark}
          className="flex-1 rounded-2xl bg-amber-500 py-3.5 font-semibold text-white active:scale-[0.98]"
        >
          🚩 标记重点
        </button>
        <button
          data-testid="stop-btn"
          onClick={() => void s.stop()}
          className="flex-1 rounded-2xl bg-zinc-800 py-3.5 font-semibold text-white active:scale-[0.98] dark:bg-zinc-700"
        >
          结束课堂
        </button>
      </div>
    </div>
  )
}

function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-zinc-200 bg-white py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}`} />
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-[11px] ${ok ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-600'}`}>
        {ok ? '已配置' : '未配置'}
      </span>
    </div>
  )
}
