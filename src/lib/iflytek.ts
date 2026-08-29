// 讯飞语音听写（iat v2）会话层：WebCrypto 鉴权、40ms 帧、60s 断连自动重连、错误分类。
// 协议：首帧 common+business+data(status0) → 中间帧 data(status1) → 尾帧 data(status2)。
// 单连接最长 60s，55s 时主动重建连接并续传最近音频，避免服务器掐断丢字。

export interface AsrHandlers {
  onOpen?: () => void
  onReconnecting?: () => void
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (msg: string, fatal: boolean) => void
}

export interface AsrOptions {
  appId: string
  apiKey: string
  apiSecret: string
  hotwords?: string
}

export interface IAsrSession {
  start(): void
  sendAudio(b64: string): void
  stop(): void
}

const enc = new TextEncoder()

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

function friendlyError(code: number, message: string): { msg: string; fatal: boolean } {
  const map: Record<number, string> = {
    40001: '鉴权失败：APIKey/APISecret 不正确',
    40002: '鉴权失败：签名校验不通过',
    40003: '鉴权失败：时间戳偏差过大，请校准系统时间',
    10105: '服务未开通：请到讯飞控制台领取「语音听写」免费包',
    10106: '请求参数异常',
    10110: '服务资源不足',
    10163: '请求参数非法',
    11200: '当日免费时长已用完',
    11201: '并发路数超限',
    11202: '后端识别异常',
    11203: '音频格式错误：需要 16k/16bit 单声道 PCM',
  }
  const fatal = [40001, 40002, 40003, 10105, 11200].includes(code)
  return { msg: map[code] ?? `错误 ${code}：${message || '未知错误'}`, fatal }
}

export class IatSession implements IAsrSession {
  private ws: WebSocket | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private firstSent = false
  private pending: string[] = []
  private segment = ''
  private myId = 0

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
            vad_eos: 3000,
            ptt: 1,
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
          for (const audio of this.pending) {
            ws.send(JSON.stringify({ data: { status: 1, format: 'audio/L16;rate=16000', encoding: 'raw', audio } }))
          }
          this.pending = []
          this.armWatchdog()
        }

        ws.onmessage = (ev) => {
          if (this.closed || myId !== this.myId) return
          let j: { code?: number; message?: string; data?: { status?: number; result?: { ws?: { cw?: { w?: string }[] }[] } } }
          try {
            j = JSON.parse(String(ev.data))
          } catch {
            return
          }
          if (j.code !== 0 && j.code !== undefined) {
            const { msg, fatal } = friendlyError(j.code, j.message ?? '')
            this.h.onError(msg, fatal)
            if (fatal) this.stop()
            return
          }
          const result = j.data?.result
          if (!result) return
          const text = (result.ws ?? []).map((w) => (w.cw ?? []).map((c) => c.w ?? '').join('')).join('')
          if (text) {
            this.segment += text
            this.h.onInterim(this.segment)
          }
          if (j.data?.status === 2 && this.segment) {
            this.h.onFinal(this.segment)
            this.segment = ''
            this.h.onInterim('')
          }
        }

        ws.onclose = (ev) => {
          if (this.closed || myId !== this.myId) return
          if (ev.code === 1000 && this.segment) {
            // 正常关闭但段未收尾：兜底落段
            this.h.onFinal(this.segment)
            this.segment = ''
          }
          // 非正常关闭（含服务器 60s 掐断）：自动重连续传
          this.h.onReconnecting?.()
          this.connect()
        }
      })
      .catch((e: Error) => {
        this.h.onError(e.message, true)
      })
  }

  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => {
      if (this.closed) return
      this.h.onReconnecting?.()
      this.myId++
      try {
        this.ws?.close()
      } catch {}
      this.connect()
    }, 55_000)
  }

  sendAudio(b64Audio: string): void {
    if (this.closed) return
    this.pending.push(b64Audio)
    if (this.pending.length > 150) this.pending.splice(0, this.pending.length - 150)
    if (this.ws?.readyState === WebSocket.OPEN && this.firstSent) {
      const frames = this.pending.splice(0)
      for (const audio of frames) {
        this.ws.send(JSON.stringify({ data: { status: 1, format: 'audio/L16;rate=16000', encoding: 'raw', audio } }))
      }
    }
  }

  stop(): void {
    if (this.closed) return
    this.closed = true
    if (this.watchdog) clearTimeout(this.watchdog)
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
