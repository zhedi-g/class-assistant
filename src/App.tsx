import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSettings } from './store/settings'
import { useSession } from './store/session'
import LivePage from './pages/LivePage'
import RecordsPage from './pages/RecordsPage'
import MaterialsPage from './pages/MaterialsPage'
import SettingsPage from './pages/SettingsPage'
import BenchPage from './pages/BenchPage'

type Tab = 'live' | 'records' | 'materials' | 'settings'

export default function App() {
  // 基准测试页：?bench=1 访问（清晰计划第 0 层，独立于主应用）
  const isBench = useMemo(() => new URLSearchParams(window.location.search).has('bench'), [])
  const [tab, setTab] = useState<Tab>('live')
  const theme = useSettings((s) => s.theme)
  const toast = useSession((s) => s.toast)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#09090b' : '#ffffff')
  }, [theme])

  if (isBench) return <BenchPage />

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-28 pt-5">
        {tab === 'live' && <LivePage />}
        {tab === 'records' && <RecordsPage />}
        {tab === 'materials' && <MaterialsPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
      {toast && (
        <div data-testid="toast" className="fixed bottom-20 left-1/2 z-20 -translate-x-1/2 rounded-full bg-zinc-900/90 px-4 py-2 text-sm text-white shadow-lg dark:bg-zinc-100/90 dark:text-zinc-900">
          {toast}
        </div>
      )}
      <BottomNav tab={tab} onChange={setTab} />
    </div>
  )
}

const ICONS: Record<Tab, ReactNode> = {
  live: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v3" />
    </svg>
  ),
  records: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  ),
  materials: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M4 19V6a2 2 0 0 1 2-2h13v13H6a2 2 0 0 0-2 2Zm0 0a2 2 0 0 0 2 2h13v-4" />
      <path d="M9 7h7" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M4 7h9M17 7h3M15 5v4" />
      <path d="M4 17h3M11 17h9M9 15v4" />
    </svg>
  ),
}

function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const items: { id: Tab; label: string }[] = [
    { id: 'live', label: '课堂' },
    { id: 'records', label: '记录' },
    { id: 'materials', label: '资料' },
    { id: 'settings', label: '设置' },
  ]
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-10 flex border-t border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
      {items.map((it) => {
        const active = tab === it.id
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
              active ? 'text-blue-500' : 'text-zinc-400 dark:text-zinc-500'
            }`}
          >
            {ICONS[it.id]}
            {it.label}
          </button>
        )
      })}
    </nav>
  )
}
