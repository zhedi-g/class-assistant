import { create } from 'zustand'
import { createAsrSession, type IAsrSession } from '../lib/iflytek'
import { startCapture, type Capture } from '../lib/audio'
import { db } from '../lib/db'
import { useSettings } from './settings'
import { loadSecrets } from '../lib/secretStore'

interface SessionState {
  status: 'idle' | 'recording'
  startedAt: number | null
  segments: { id: string; t: number; text: string; marked: boolean }[]
  interim: string
  conn: 'connecting' | 'open' | 'reconnecting'
  reconnects: number
  errMsg: string | null
  behindApp: boolean
  toast: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  mark: () => void
  setBehind: (b: boolean) => void
}

let asr: IAsrSession | null = null
let capture: Capture | null = null
let wakeLock: { release?: () => Promise<void> } | null = null
let pendingMark = false
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string) {
  if (toastTimer) clearTimeout(toastTimer)
  useSession.setState({ toast: msg })
  toastTimer = setTimeout(() => useSession.setState({ toast: null }), 2600)
}

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export const useSession = create<SessionState>()((set, get) => ({
  status: 'idle',
  startedAt: null,
  segments: [],
  interim: '',
  conn: 'connecting',
  reconnects: 0,
  errMsg: null,
  behindApp: false,
  toast: null,

  start: async () => {
    const s = useSettings.getState()
    const secrets = await loadSecrets()
    const appId = s.iflytekAppId
    const apiKey = secrets['iflytek.apiKey'] ?? ''
    const apiSecret = secrets['iflytek.apiSecret'] ?? ''
    if (import.meta.env.VITE_MOCK_ASR !== '1' && (!appId || !apiKey || !apiSecret)) {
      set({ errMsg: '讯飞未配置：请到「设置」填写 APPID / APIKey / APISecret 后再开始' })
      return
    }

    set({
      status: 'recording',
      startedAt: Date.now(),
      segments: [],
      interim: '',
      conn: 'connecting',
      reconnects: 0,
      errMsg: null,
      behindApp: false,
    })
    pendingMark = false

    asr = createAsrSession(
      { appId, apiKey, apiSecret, hotwords: s.hotwords || undefined },
      {
        onOpen: () => set({ conn: 'open' }),
        onReconnecting: () => set((st) => ({ conn: 'reconnecting', reconnects: st.reconnects + 1 })),
        onInterim: (t) => set({ interim: t }),
        onFinal: (t) => {
          const marked = pendingMark
          pendingMark = false
          set((st) => ({
            segments: [
              ...st.segments,
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                t: Date.now() - (st.startedAt ?? Date.now()),
                text: t,
                marked,
              },
            ],
            interim: '',
          }))
        },
        onError: (msg, fatal) => {
          set({ errMsg: msg })
          if (fatal) void get().stop()
        },
      },
    )
    asr.start()

    try {
      capture = await startCapture((b64) => asr?.sendAudio(b64), (msg) => set({ errMsg: msg }))
    } catch {
      await get().stop()
      return
    }

    // 保持亮屏（Web WakeLock，部分环境不支持则忽略）
    try {
      wakeLock =
        (await (
          navigator as {
            wakeLock?: { request: (t: string) => Promise<{ release?: () => Promise<void> }> }
          }
        ).wakeLock?.request('screen')) ?? null
    } catch {
      wakeLock = null
    }
  },

  stop: async () => {
    const st = get()
    if (st.status !== 'recording') return
    asr?.stop()
    asr = null
    await capture?.stop().catch(() => {})
    capture = null
    try {
      await wakeLock?.release?.()
    } catch {}
    wakeLock = null

    const segments = st.segments
    const durationSec = st.startedAt ? Math.round((Date.now() - st.startedAt) / 1000) : 0
    set({ status: 'idle', interim: '', conn: 'connecting' })

    if (segments.length > 0 || durationSec >= 5) {
      const marks = segments.filter((x) => x.marked).length
      await db.lessons.add({
        date: new Date().toLocaleDateString('zh-CN'),
        startTs: st.startedAt ?? Date.now(),
        durationSec,
        segments,
        createdAt: Date.now(),
      })
      showToast(`本节课已保存：${segments.length} 条内容 · ${marks} 个重点 · ${fmtDuration(durationSec)}`)
    }
  },

  mark: () => {
    const st = get()
    if (st.status !== 'recording') return
    if (st.segments.length > 0) {
      const last = st.segments[st.segments.length - 1]
      set({ segments: [...st.segments.slice(0, -1), { ...last, marked: true }] })
      showToast('已标记最近一句为重点')
    } else {
      pendingMark = true
      showToast('下一句将自动标记为重点')
    }
  },

  setBehind: (b) => set({ behindApp: b }),
}))
