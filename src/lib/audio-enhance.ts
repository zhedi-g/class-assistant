// 音频增强层（清晰计划第 1 层）：
// OfflineAudioContext 原生链（高通 120Hz 去混响拖尾 + 语声 EQ + 动态压缩 + 增益）
// → RNNoise 神经降噪（48k/480 帧级 WASM，同时输出语音概率）
// → 语音概率 VAD 断句（挂起 600ms，最短 300ms）→ 48k→16k 降采样 → iFlytek 40ms 帧。
import createRNNWasmModule from '@jitsi/rnnoise-wasm/dist/rnnoise.js'

let modPromise: Promise<any> | null = null
async function rnnoiseMod(): Promise<any> {
  if (!modPromise) {
    const wasmUrl = (await import('@jitsi/rnnoise-wasm/dist/rnnoise.wasm?url')).default
    modPromise = createRNNWasmModule({ locateFile: () => wasmUrl })
  }
  return modPromise
}

export class RnNoise {
  private mod: any
  private handle: number
  private inPtr: number
  private outPtr: number
  private constructor(mod: any) {
    this.mod = mod
    this.handle = mod._rnnoise_create()
    mod._rnnoise_init(this.handle)
    this.inPtr = mod._malloc(1920)
    this.outPtr = mod._malloc(1920)
  }
  static async create(): Promise<RnNoise> {
    const mod = await rnnoiseMod()
    return new RnNoise(mod)
  }
  /** frame: 480 样本 @48k。返回 { 降噪后音频, 语音概率 0~1 } */
  process(frame: Float32Array): { denoised: Float32Array; prob: number } {
    const heap = new Float32Array(this.mod.HEAPF32.buffer, this.inPtr, 480)
    heap.set(frame)
    const prob = this.mod._rnnoise_process_frame(this.handle, this.outPtr, this.inPtr) as number
    const denoised = new Float32Array(this.mod.HEAPF32.buffer, this.outPtr, 480).slice()
    return { denoised, prob }
  }
  destroy() {
    try {
      this.mod._rnnoise_destroy(this.handle)
      this.mod._free(this.inPtr)
      this.mod._free(this.outPtr)
    } catch {}
  }
}

export interface SpeechSegment {
  startMs: number
  endMs: number
}

export interface EnhanceResult {
  /** 降噪后的 48k 全量样本（用于 16k 降采样） */
  samples48k: Float32Array
  probs: Float32Array
  segments: SpeechSegment[]
}

const FRAME = 480
const FRAME_MS = 10

/** 离线增强：文件 → 解码 → 原生链渲染 → RNNoise → VAD。maxMs 限制分析时长（基准用切片） */
export async function enhanceOffline(file: File, maxMs?: number): Promise<EnhanceResult> {
  const ctx = new AudioContext()
  const decoded = await ctx.decodeAudioData(await file.arrayBuffer())
  await ctx.close()
  const durMs = Math.min(maxMs ?? decoded.duration * 1000, decoded.duration * 1000)

  const oc = new OfflineAudioContext(1, Math.ceil((durMs / 1000) * 48000), 48000)
  const src = oc.createBufferSource()
  src.buffer = decoded
  const hp = oc.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 120
  hp.Q.value = 0.7
  const peak = oc.createBiquadFilter()
  peak.type = 'peaking'
  peak.frequency.value = 3000
  peak.Q.value = 1
  peak.gain.value = 4 // 语声清晰度：辅音增强
  const comp = oc.createDynamicsCompressor()
  comp.threshold.value = -35
  comp.knee.value = 20
  comp.ratio.value = 6
  comp.attack.value = 0.005
  comp.release.value = 0.25
  const gain = oc.createGain()
  gain.gain.value = 1.6 // 远场小信号增益
  src.connect(hp)
  hp.connect(peak)
  peak.connect(comp)
  comp.connect(gain)
  gain.connect(oc.destination)
  src.start(0, 0, durMs / 1000)
  const rendered = await oc.startRendering()
  const data = rendered.getChannelData(0)

  await RnNoise.create
  const rn = await RnNoise.create()
  const frameCount = Math.floor(data.length / FRAME)
  const probs = new Float32Array(frameCount)
  const denoised = new Float32Array(frameCount * FRAME)
  for (let f = 0; f < frameCount; f++) {
    const { denoised: d, prob } = rn.process(data.subarray(f * FRAME, f * FRAME + FRAME))
    denoised.set(d, f * FRAME)
    probs[f] = prob
  }
  rn.destroy()

  // VAD 断句：prob>0.45 视为语音；停顿 600ms 切段；最短段 300ms
  const segments: SpeechSegment[] = []
  let s = -1
  let lastVoice = -1
  for (let f = 0; f < frameCount; f++) {
    const t = f * FRAME_MS
    if (probs[f] > 0.45) {
      if (s < 0) s = Math.max(0, t - 300) // 预滚 300ms，句首字不丢
      lastVoice = t
    } else if (s >= 0 && t - lastVoice > 600) {
      if (t - s >= 300) segments.push({ startMs: s, endMs: lastVoice + 200 })
      s = -1
    }
  }
  if (s >= 0) segments.push({ startMs: s, endMs: frameCount * FRAME_MS })

  return { samples48k: denoised, probs, segments }
}

/** 48k → 16k 简易平均降采样（用于 ASR 帧） */
export function downsampleTo16k(x: Float32Array, from = 48000): Float32Array {
  const k = from / 16000
  const n = Math.floor(x.length / k)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = 0; j < k; j++) s += x[i * k + j]
    out[i] = s / k
  }
  return out
}

/** 16k Float32 → iFlytek 40ms base64 帧（640 样本/1280B） */
export function toIatFrames(x: Float32Array): string[] {
  const frameSamples = 640
  const bytes = new Uint8Array(frameSamples * 2)
  const pcm = new Int16Array(bytes.buffer)
  const frames: string[] = []
  for (let base = 0; base + frameSamples <= x.length; base += frameSamples) {
    for (let i = 0; i < frameSamples; i++) {
      const v = Math.max(-1, Math.min(1, x[base + i]))
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
    }
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    frames.push(btoa(s))
  }
  return frames
}

/** 原始（旧链路）路径：只解码 + 16k 降采样，无任何增强 */
export async function extractRaw16k(file: File, maxMs?: number): Promise<Float32Array> {
  const ctx = new AudioContext()
  const decoded = await ctx.decodeAudioData(await file.arrayBuffer())
  await ctx.close()
  const durMs = Math.min(maxMs ?? decoded.duration * 1000, decoded.duration * 1000)
  const oc = new OfflineAudioContext(1, Math.ceil((durMs / 1000) * 48000), 48000)
  const src = oc.createBufferSource()
  src.buffer = decoded
  src.connect(oc.destination)
  src.start(0, 0, durMs / 1000)
  const rendered = await oc.startRendering()
  return downsampleTo16k(rendered.getChannelData(0))
}
