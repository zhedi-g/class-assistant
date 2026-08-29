import { useEffect, useState } from 'react'
import { loadSecrets, type SecretMap } from '../lib/secretStore'
import { useSettings } from '../store/settings'

const MILESTONES = [
  { id: 'M1', label: '设置与密钥管理', done: true },
  { id: 'M2', label: '实时语音转写（讯飞）', done: false },
  { id: 'M3', label: '关键词震动提醒', done: false },
  { id: 'M4', label: '生词即查 + 课中 AI 问答', done: false },
  { id: 'M5+', label: 'PPT/教材导入 · 课后学习包', done: false },
]

export default function LivePage() {
  const provider = useSettings((s) => s.provider)
  const [secrets, setSecrets] = useState<SecretMap | null>(null)
  useEffect(() => {
    loadSecrets().then(setSecrets)
  }, [])

  const iflyOk = !!secrets?.['iflytek.apiKey'] && !!secrets?.['iflytek.apiSecret']
  const zhipuOk = !!secrets?.['zhipu.apiKey']
  const dsOk = !!secrets?.['deepseek.apiKey']
  const aiOk = provider === 'zhipu' ? zhipuOk : dsOk
  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">课堂学习助手</h1>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{today}</span>
      </header>

      {/* 服务状态 */}
      <section className="grid grid-cols-3 gap-2">
        <StatusChip label="讯飞转写" ok={iflyOk} />
        <StatusChip label="智谱 AI" ok={zhipuOk} />
        <StatusChip label="DeepSeek" ok={dsOk} />
      </section>

      {/* 主操作 */}
      <section className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          disabled
          className="flex h-20 w-20 cursor-not-allowed items-center justify-center rounded-full bg-blue-600 text-white opacity-50"
          aria-label="开始录音（未上线）"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-9 w-9">
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
            <path d="M19 11a7 7 0 0 1-14 0" />
            <path d="M12 18v3" />
          </svg>
        </button>
        <p className="text-sm text-zinc-500">实时转写 · M2 上线</p>
      </section>

      {!aiOk && (
        <p className="rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
          AI 服务尚未配置：去「设置」填入智谱或 DeepSeek 的 API Key 后即可使用答疑功能。
        </p>
      )}

      {/* 里程碑 */}
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
