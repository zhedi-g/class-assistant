// 讯飞语音听写（iat v2）会话层 v2：静默续连、重连锁、12s 音频缓冲、限速补发、
// 动态修正（dwa=wpgs，服务端回头改同音错字）、可恢复错误自愈（10165 等句柄失效）。
// 协议：首帧 common+business+data(status0) → 中间帧 data(status1) → 尾帧 data(status2)。
// 服务端行为：VAD 分段结束（status=2）或连接超时后会回收句柄并断开连接——
// 客户端必须把「code=1000 且刚收完一段」视为正常续连信号，静默重建，不惊动用户。

export interface AsrHandlers {
  /** silent=true 表示服务端正常收尾后的静默续连：不计数、不变状态灯 */
  onReconnecting?: (silent?: boolean, reason?: string) => void
  onOpen?: () => void
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (msg: string, fatal: boolean) => void
}

export interface AsrOptions {
  appId: string
  apiKey: string
  apiSecret: string
  /** 逗号分隔的热词串 */
  hotwords?: string
}

export interface IAsrSession {
  start(): void
  sendAudio(b64: string): void
  stop(): void
}

const enc = new TextEncoder()
const RECONNECT_BACKLOG = 300 // 续传缓冲上限：300 帧 ≈ 12s 音频
const FLUSH_BATCH = 25 // 每跳最多补发 25 帧 ≈ 1s 音频，避免突发被服务端拒绝
const MAX_FAST_FAILURES = 4 // 15 秒内异常断开 ≥4 次视为环境故障，停止并提示
/** 出现即干净重连、不惊动用户的可恢复错误（句柄回收/临时资源不足等） */
const RECOVERABLE_CODES = new Set([10165, 10110, 11201, 11202])
/** 这些关闭码 + 刚收完一段（3s 内）→ 视为服务端正常回收，静默续连 */
const NORMAL_CLOSE_CODES = new Set([1000, 1005, 1006])

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of u8) s += String.fromCharCode(b)
  return btoa(s)
}

export async function buildIatUrl(apiKey: string, apiSecret: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('当前环境不支持加密模块（需 HTTPS 或 localhost）')
  }
  const date = new Date().toUTCString()
  const origin = `host: iat-api.xfyun.cn\ndate: ${date}\nGET /v2/iat HTTP/1.1`
  const key = await crypto.subtle.importKey('raw', enc.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = b64(await crypto.subtle.sign('HMAC', key, enc.encode(origin)))
  const authorization = b64(
    enc.encode(`api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sig}"`),
  )
  return `wss://iat-api.xfyun.cn/v2/iat?authorization=${authorization}&date=${encodeURIComponent(date)}&host=iat-api.xfyun.cn`
}

function friendlyError(code: number, message: string): { msg: string; fatal: boolean; recoverable: boolean } {
  const map: Record<number, string> = {
    40001: '鉴权失败：APIKey/APISecret 不正确',
    40002: '鉴权失败：签名校验不通过',
    40003: '鉴权失败：时间戳偏差过大，请校准系统时间',
    10105: '服务未开通：请到讯飞控制台领取「语音听写」免费包',
    10106: '请求参数异常',
    10163: '请求参数非法',
    10165: '服务端会话句柄已回收',
    11200: '当日免费时长已用完',
    11203: '音频格式错误：需要 16k/16bit 单声道 PCM',
  }
  if (RECOVERABLE_CODES.has(code)) return { msg: `错误 ${code}`, fatal: false, recoverable: true }
  const fatal = [40001, 40002, 40003, 10105, 11200].includes(code)
  return { msg: map[code] ?? `错误 ${code}：${message || '未知错误'}`, fatal, recoverable: false }
}

export class IatSession implements IAsrSession {
  private ws: WebSocket | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private flusher: ReturnType<typeof setInterval> | null = null
  private closed = false
  private firstSent = false
  private pending: string[] = []
  private segment = ''
  private myId = 0
  private reconnecting = false
  private lastEndedNormally = false
  private lastFinalAt = 0
  private abnormalCloses: number[] = []

  constructor(
    private opts: AsrOptions,
    private h: AsrHandlers,
  ) {}

  start(): void {
    this.connect()
  }

  private connect(): void {
    const myId = ++this.myId
    buildIatUrl(this.opts.apiKey, this.opts.apiSecret)
      .then((url) => {
        if (this.closed || myId !== this.myId) return
        const ws = new WebSocket(url)
        this.ws = ws

        ws.onopen = () => {
          if (this.closed || myId !== this.myId) return
          this.firstSent = true
          this.h.onOpen?.()
          const business: Record<string, unknown> = {
            language: 'zh_cn',
            domain: 'iat',
            accent: 'mandarin',
            // 停顿 5s 才断段：减少分段次数，也就减少了服务端回收句柄的次数
            vad_eos: 5000,
            ptt: 1,
            // 动态修正：服务端会对同音错字回头改写（pgs=rpl 时替换指定区间）
            dwa: 'wpgs',
          }
          if (this.opts.hotwords) business.hotwords = this.opts.hotwords
          const first = this.pending.shift() ?? ''
          ws.send(
            JSON.stringify({
              common: { app_id: this.opts.appId },
              business,
              data: { status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: first },
            }),
          )
          this.startFlusher()
          this.armWatchdog()
        }

        ws.onmessage = (ev) => {
          if (this.closed || myId !== this.myId) return
          let j: {
            code?: number
            message?: string
            data?: {
              status?: number
              result?: {
                ws?: { cw?: { w?: string }[] }[]
                pgs?: 'apd' | 'rpl'
                rg?: [number, number]
              }
            }
          }
          try {
            j = JSON.parse(String(ev.data))
          } catch {
            return
          }
          if (j.code !== 0 && j.code !== undefined) {
            const { msg, fatal, recoverable } = friendlyError(j.code, j.message ?? '')
            if (fatal) {
              this.h.onError(msg, true)
              this.stop()
              return
            }
            if (recoverable) {
              // 句柄已失效等：当前连接已废，干净重建并丢弃过期积压，不打扰用户
              this.segment = ''
              this.pending = []
              this.h.onReconnecting?.(false, `服务端回收连接(${j.code})已自动重连`)
              this.hardReconnect()
              return
            }
            this.h.onError(msg, false)
            return
          }

          const result = j.data?.result
          if (!result) return
          const text = (result.ws ?? []).map((w) => (w.cw ?? []).map((c) => c.w ?? '').join('')).join('')
          if (result.pgs === 'rpl' && Array.isArray(result.rg) && result.rg.length === 2) {
            // 动态修正：用新文本替换 segment 中 [rg[0], rg[1]) 区间
            const b = Math.max(0, Math.min(result.rg[0], this.segment.length))
            const e = Math.max(b, Math.min(result.rg[1], this.segment.length))
            this.segment = this.segment.slice(0, b) + text + this.segment.slice(e)
          } else if (text) {
            this.segment += text
          }
          if (this.segment) this.h.onInterim(this.segment)

          if (j.data?.status === 2 && this.segment) {
            this.lastEndedNormally = true
            this.lastFinalAt = Date.now()
            this.h.onFinal(this.segment)
            this.segment = ''
            this.h.onInterim('')
          }
        }

        ws.onclose = (ev) => {
          if (this.closed || myId !== this.myId) return
          // 段未收尾就被断开：兜底落段，避免丢最后半句
          if (this.segment) {
            this.h.onFinal(this.segment)
            this.segment = ''
            this.h.onInterim('')
          }

          // 静默续连判定：正常收尾，或刚收完一段 3 秒内被服务端回收
          // （讯飞分段后会回收句柄断开，close code 可能是 1000/1005/1006，均属正常节奏）
          const normalCycle =
            (ev.code === 1000 && this.lastEndedNormally) ||
            (NORMAL_CLOSE_CODES.has(ev.code) && this.lastFinalAt > 0 && Date.now() - this.lastFinalAt < 3000)
          if (normalCycle) {
            this.lastEndedNormally = false
            this.firstSent = false
            this.scheduleReconnect(0, true)
            return
          }

          // 异常断开：限频重连；15s 内连续 4 次则判定环境故障
          const now = Date.now()
          this.abnormalCloses = this.abnormalCloses.filter((t) => now - t < 15_000)
          this.abnormalCloses.push(now)
          if (this.abnormalCloses.length >= MAX_FAST_FAILURES) {
            this.h.onError('网络连接反复中断：请检查网络后重新开始上课', true)
            this.stop()
            return
          }
          this.h.onReconnecting?.(false, `断开(${ev.code})已自动续连`)
          this.firstSent = false
          this.scheduleReconnect(400, false)
        }
      })
      .catch((e: Error) => {
        this.h.onError(e.message, true)
      })
  }

  private scheduleReconnect(delay: number, _silent: boolean): void {
    if (this.reconnecting || this.closed) return
    this.reconnecting = true
    setTimeout(() => {
      this.reconnecting = false
      if (this.closed) return
      this.connect()
    }, delay)
  }

  /** 立即弃掉当前连接并重建（用于句柄失效等自愈场景） */
  private hardReconnect(): void {
    if (this.closed) return
    this.myId++
    this.firstSent = false
    try {
      this.ws?.close()
    } catch {}
    this.scheduleReconnect(0, false)
  }

  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog)
    // 讯飞单连接最长 60s，55s 主动重建（旧连接关闭事件因 myId 已自增而被忽略）
    this.watchdog = setTimeout(() => {
      if (this.closed) return
      this.h.onReconnecting?.(true)
      this.myId++
      this.firstSent = false
      try {
        this.ws?.close()
      } catch {}
      this.connect()
    }, 55_000)
  }

  /** 限速补发：每 40ms 最多 25 帧（1s 音频），重连后平滑追赶，不突发 */
  private startFlusher(): void {
    if (this.flusher) return
    this.flusher = setInterval(() => {
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN || !this.firstSent || this.pending.length === 0) return
      const batch = this.pending.splice(0, FLUSH_BATCH)
      for (const audio of batch) {
        ws.send(JSON.stringify({ data: { status: 1, format: 'audio/L16;rate=16000', encoding: 'raw', audio } }))
      }
    }, 40)
  }

  sendAudio(b64Audio: string): void {
    if (this.closed) return
    this.pending.push(b64Audio)
    if (this.pending.length > RECONNECT_BACKLOG) {
      // 超过 12s 才丢最旧的（正常重连 <1s，不会走到这里）
      this.pending.splice(0, this.pending.length - RECONNECT_BACKLOG)
    }
  }

  stop(): void {
    if (this.closed) return
    this.closed = true
    if (this.watchdog) clearTimeout(this.watchdog)
    if (this.flusher) clearInterval(this.flusher)
    this.flusher = null
    if (this.segment) {
      this.h.onFinal(this.segment)
      this.segment = ''
    }
    const finish = () => {
      this.myId++
      try {
        this.ws?.close()
      } catch {}
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' } }))
      } catch {}
      setTimeout(finish, 300)
    } else {
      finish()
    }
  }
}

// 测试/演示用假会话：不依赖网络与 Key，输出固定课堂文本
export class MockAsrSession implements IAsrSession {
  private timers: ReturnType<typeof setTimeout>[] = []
  private stopped = false

  constructor(private h: AsrHandlers) {}

  start(): void {
    this.h.onOpen?.()
    const lines = [
      '深度求索是哪家公司',
      '今天我们讲第三章的动能定理',
      '哈雷彗星的回归周期大约是七十六年',
      '这个公式期末考试必考大家记一下',
    ]
    let t = 300
    for (const line of lines) {
      this.timers.push(
        setTimeout(() => {
          if (!this.stopped) this.h.onInterim(line.slice(0, Math.ceil(line.length / 2)))
        }, t),
      )
      this.timers.push(
        setTimeout(() => {
          if (this.stopped) return
          this.h.onFinal(line)
          this.h.onInterim('')
        }, t + 1400),
      )
      t += 2600
    }
  }

  sendAudio(): void {}

  stop(): void {
    this.stopped = true
    this.timers.forEach(clearTimeout)
    this.timers = []
  }
}

export function createAsrSession(opts: AsrOptions, h: AsrHandlers): IAsrSession {
  if (import.meta.env.VITE_MOCK_ASR === '1') return new MockAsrSession(h)
  return new IatSession(opts, h)
}
