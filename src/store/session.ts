import { create } from 'zustand'
import { createAsrSession, type IAsrSession } from '../lib/iflytek'
import { startCapture, type Capture } from '../lib/audio'
import { createCorrector, type Corrector } from '../lib/correction'
import { askAI } from '../lib/ai'
import { db } from '../lib/db'
import { useSettings } from './settings'
import { loadSecrets } from '../lib/secretStore'
import { unlockVibration, vibrateAlert } from '../lib/vibrate'

export interface AskMsg {
  role: 'user' | 'assistant'
  content: string
  meta?: string
}

interface SessionState {
  status: 'idle' | 'recording'
  startedAt: number | null
  segments: { id: string; t: number; text: string; raw?: string; marked: boolean; matched?: string }[]
  interim: string
  conn: 'connecting' | 'open' | 'reconnecting'
  reconnects: number
  /** 最近一次非静默断开的原因说明 */
  connNote: string | null
  /** AI 实时校对是否已启用 */
  aiFix: boolean
  /** 课中问答记录（弹层历史，下课随记录存库） */
  askMsgs: AskMsg[]
  askBusy: boolean
  /** 本次会话命中的提醒关键词 */
  alertHits: { word: string; t: number }[]
  alertBanner: { word: string } | null
  errMsg: string | null
  behindApp: boolean
  toast: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  mark: () => void
  setBehind: (b: boolean) => void
  sendAsk: (question: string, segText?: string) => Promise<void>
}

let asr: IAsrSession | null = null
let capture: Capture | null = null
let wakeLock: { release?: () => Promise<void> } | null = null
let pendingMark = false
let pendingHitWord: string | null = null
let alertWordsList: string[] = []
let segHitWords = new Set<string>()
let lastAlertAt = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null
let bannerTimer: ReturnType<typeof setTimeout> | null = null

/** 切后台回来后调用：AudioContext 可能被系统挂起，恢复采集 */
export function resumeCapture(): void {
  void capture?.resume()
}

function showToast(msg: string) {
  if (toastTimer) clearTimeout(toastTimer)
  useSession.setState({ toast: msg })
  toastTimer = setTimeout(() => useSession.setState({ toast: null }), 2600)
}

function showBanner(word: string) {
  if (bannerTimer) clearTimeout(bannerTimer)
  useSession.setState({ alertBanner: { word } })
  bannerTimer = setTimeout(() => useSession.setState({ alertBanner: null }), 4500)
}

/** 关键词检测：段内去重 + 全局 3s 冷却；命中即震动+横幅 */
function detectKeyword(text: string): string | null {
  if (!alertWordsList.length) return null
  const now = Date.now()
  for (const w of alertWordsList) {
    if (segHitWords.has(w)) continue
    if (text.includes(w) && now - lastAlertAt >= 3000) {
      segHitWords.add(w)
      lastAlertAt = now
      vibrateAlert()
      showBanner(w)
      useSession.setState((st) => ({
        alertHits: [...st.alertHits, { word: w, t: now - (st.startedAt ?? now) }],
      }))
      return w
    }
  }
  return null
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
  connNote: null,
  aiFix: false,
  askMsgs: [],
  askBusy: false,
  alertHits: [],
  alertBanner: null,
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

    // 热词：讯飞要求逗号分隔，把设置页的逐行输入规整化
    const hotwordsList = (s.hotwords ?? '')
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
    const hotwords = hotwordsList.join(',')

    // 提醒关键词：逐行解析（对旧版本 localStorage 缺字段的情况做兜底）
    alertWordsList = (s.alertWords ?? '')
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
    segHitWords = new Set()
    lastAlertAt = 0
    pendingHitWord = null
    unlockVibration() // 借用户点击解锁振动权限

    // AI 实时校对：优先免费 GLM-Flash，未配 Key 则为纯讯飞模式
    let corrector: Corrector | null = null
    if (import.meta.env.VITE_MOCK_ASR !== '1') {
      corrector = await createCorrector()
    }

    set({
      status: 'recording',
      startedAt: Date.now(),
      segments: [],
      interim: '',
      conn: 'connecting',
      reconnects: 0,
      connNote: null,
      aiFix: !!corrector,
      askMsgs: [],
      askBusy: false,
      alertHits: [],
      alertBanner: null,
      errMsg: null,
      behindApp: false,
    })
    pendingMark = false

    asr = createAsrSession(
      { appId, apiKey, apiSecret, hotwords: hotwords || undefined },
      {
        onOpen: () => set({ conn: 'open', connNote: null }),
        onReconnecting: (silent, reason) =>
          set((st) => ({
            conn: silent ? st.conn : 'reconnecting',
            reconnects: silent ? st.reconnects : st.reconnects + 1,
            connNote: silent ? st.connNote : (reason ?? st.connNote),
          })),
        onInterim: (t) => {
          set({ interim: t })
          const hit = detectKeyword(t)
          if (hit) {
            pendingMark = true
            pendingHitWord = hit
          }
        },
        onFinal: (t) => {
          // final 文本先过一遍关键词（可能 interim 阶段没来得及命中）
          const finalHit = detectKeyword(t)
          const hitWord = finalHit ?? pendingHitWord
          const marked = pendingMark || !!hitWord
          pendingMark = false
          pendingHitWord = null
          segHitWords = new Set()
          const segId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          set((st) => ({
            segments: [
              ...st.segments,
              {
                id: segId,
                t: Date.now() - (st.startedAt ?? Date.now()),
                text: t,
                marked,
                matched: hitWord ?? undefined,
              },
            ],
            interim: '',
          }))
          // 异步校对：完成后原位替换字幕，原始文本保留在 raw
          if (corrector) {
            const context = useSession
              .getState()
              .segments.filter((x) => x.id !== segId)
              .slice(-3)
              .map((x) => x.text)
            void corrector.fix(t, context, hotwordsList).then((out) => {
              if (!out) return
              set((st) => ({
                segments: st.segments.map((x) =>
                  x.id === segId ? { ...x, raw: x.raw ?? x.text, text: out } : x,
                ),
              }))
            })
          }
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
      const hits = useSession.getState().alertHits.length
      // 课中问答随记录存档（user/assistant 两两配对）
      const qas: { q: string; a: string; ts: number }[] = []
      let pendQ: string | null = null
      for (const m of st.askMsgs) {
        if (m.role === 'user') pendQ = m.content
        else if (pendQ !== null) {
          qas.push({ q: pendQ, a: m.content, ts: Date.now() })
          pendQ = null
        }
      }
      await db.lessons.add({
        date: new Date().toLocaleDateString('zh-CN'),
        startTs: st.startedAt ?? Date.now(),
        durationSec,
        segments,
        qas: qas.length > 0 ? qas : undefined,
        createdAt: Date.now(),
      })
      showToast(
        `本节课已保存：${segments.length} 条内容 · ${marks} 个重点` +
          (hits ? ` · 🔔${hits} 次提醒` : '') +
          ` · ${fmtDuration(durationSec)}`,
      )
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

  sendAsk: async (question, segText) => {
    const q = question.trim()
    if (!q || get().askBusy) return
    set((st) => ({ askMsgs: [...st.askMsgs, { role: 'user', content: q }, { role: 'assistant', content: '' }], askBusy: true }))
    const st = get()
    const recent = st.segments.slice(-8).map((x) => x.text).join(' / ').slice(-2500)
    const context = [
      segText ? `【学生点选的字幕句】${segText}` : '',
      recent ? `【最近课堂字幕】${recent}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const append = (delta: string) => {
      set((s2) => {
        const copy = [...s2.askMsgs]
        const last = copy[copy.length - 1]
        copy[copy.length - 1] = { ...last, content: last.content + delta }
        return { askMsgs: copy }
      })
    }
    try {
      await askAI({ question: q, context, onDelta: append })
      set((s2) => {
        const copy = [...s2.askMsgs]
        const last = copy[copy.length - 1]
        copy[copy.length - 1] = { ...last, meta: '基于本节课最近字幕' }
        return { askMsgs: copy }
      })
    } catch (e) {
      set((s2) => {
        const copy = [...s2.askMsgs]
        const last = copy[copy.length - 1]
        copy[copy.length - 1] = { ...last, content: '回答失败：' + (e as Error).message }
        return { askMsgs: copy }
      })
    } finally {
      set({ askBusy: false })
    }
  },

  setBehind: (b) => set({ behindApp: b }),
}))
