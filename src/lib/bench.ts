// 基准测试（清晰计划第 0 层）：同一份真实课堂音频跑旧链路 vs 新增强链，
// 量化对比：字符数 / 分段数 / 课程术语命中。识别走真实讯飞 iat（帧打包多窗口）。
import { loadSecrets } from './secretStore'
import { buildIatUrl } from './iflytek'
import { enhanceOffline, extractRaw16k, toIatFrames, type SpeechSegment } from './audio-enhance'
import { useSettings } from '../store/settings'

export { toIatFrames }

export const CHEM_TERMS = [
  '分析化学', '化学分析', '仪器分析', '滴定', '络合', '氧化还原', '沉淀', '重量分析',
  '光谱', '质谱', '色谱', '核磁', 'EDTA', '原子吸收', 'ICP', '常量', '微量',
  '标准溶液', '指示剂', '盖吕萨克', '莫尔', '钙离子', '误差', '含量',
]

export interface ChainResult {
  transcript: string
  segments: SpeechSegment[] | null
  windowCount: number
}

const WINDOWS_SEC = 50 // 每窗口 50 秒（iat 单连接 60s 上限内）

async function transcribeWindow(
  frames: string[],
  cfg: { appId: string; apiKey: string; apiSecret: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    let feed: ReturnType<typeof setInterval> | null = null
    void (async () => {
      const url = await buildIatUrl(cfg.apiKey, cfg.apiSecret)
      const ws = new WebSocket(url)
      ws.onopen = () => {
        const first = frames.shift() ?? ''
        ws.send(
          JSON.stringify({
            common: { app_id: cfg.appId },
            business: { language: 'zh_cn', domain: 'iat', accent: 'mandarin', vad_eos: 10000, ptt: 1 },
            data: { status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: first },
          }),
        )
        let i = 0
        feed = setInterval(() => {
          if (i >= frames.length) {
            if (feed) clearInterval(feed)
            ws.send(JSON.stringify({ data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' } }))
            return
          }
          ws.send(JSON.stringify({ data: { status: 1, format: 'audio/L16;rate=16000', encoding: 'raw', audio: frames[i++] } }))
        }, 40) // 40ms/帧 = 实时速率。过快推送（如 15ms）会触发服务端 10165 invalid handle
      }
      ws.onmessage = (ev) => {
        let j: { code?: number; message?: string; data?: { status?: number; result?: { ws?: { cw?: { w?: string }[] }[] } } }
        try {
          j = JSON.parse(String(ev.data))
        } catch {
          return
        }
        if (j.code && j.code !== 0) {
          if (feed) clearInterval(feed)
          reject(new Error(`错误 ${j.code}：${j.message ?? ''}`))
          try {
            ws.close()
          } catch {}
          return
        }
        if (j.data?.result) {
          text += (j.data.result.ws ?? []).map((w) => (w.cw ?? []).map((c) => c.w ?? '').join('')).join('')
        }
      }
      ws.onclose = () => resolve(text)
      ws.onerror = () => {
        if (feed) clearInterval(feed)
        reject(new Error('WS 连接失败'))
      }
    })()
  })
}

export async function transcribeFrames(
  frames: string[],
  cfg: { appId: string; apiKey: string; apiSecret: string },
  onWindow?: (done: number, total: number) => void,
): Promise<ChainResult> {
  const per = Math.ceil((WINDOWS_SEC * 1000) / 40) // 1250 帧/窗口
  const windows: string[][] = []
  for (let i = 0; i < frames.length; i += per) windows.push(frames.slice(i, i + per))
  if (windows.length === 0) windows.push([])
  let transcript = ''
  let n = 0
  for (const w of windows) {
    onWindow?.(++n, windows.length)
    transcript += await transcribeWindow(w, cfg)
  }
  return { transcript, segments: null, windowCount: windows.length }
}

export function termHits(transcript: string): { term: string; n: number }[] {
  return CHEM_TERMS.map((t) => ({ term: t, n: (transcript.match(new RegExp(t, 'g')) ?? []).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
}

export async function ensureCfg(): Promise<{ appId: string; apiKey: string; apiSecret: string }> {
  const secrets = await loadSecrets()
  const s = useSettings.getState()
  const apiKey = secrets['iflytek.apiKey'] ?? ''
  const apiSecret = secrets['iflytek.apiSecret'] ?? ''
  if (!s.iflytekAppId || !apiKey || !apiSecret) throw new Error('请先在设置页填写讯飞三件套')
  return { appId: s.iflytekAppId, apiKey, apiSecret }
}

export function framesFrom16k(x: Float32Array): string[] {
  return toIatFrames(x)
}

/** 新链路：只发送 VAD 切出的语音段 */
export function speechOnly16k(samples16k: Float32Array, segments: SpeechSegment[]): Float32Array {
  const out: number[] = []
  for (const s of segments) {
    const slice = samples16k.slice(Math.floor((s.startMs / 1000) * 16000), Math.ceil((s.endMs / 1000) * 16000))
    for (const v of slice) out.push(v)
  }
  return new Float32Array(out)
}

export { enhanceOffline, extractRaw16k }
