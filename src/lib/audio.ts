// 麦克风采集链：AudioContext 以 16k 采样率创建（浏览器负责重采样），
// AudioWorklet 输出 Float32 → 主线程聚合为 40ms/1280B 的 16bit PCM 帧（base64）。
const WORKLET_SRC = `class PC extends AudioWorkletProcessor{process(i){const c=i[0][0];if(c)this.port.postMessage(c);return true}}registerProcessor('pcm-capture',PC)`

export interface Capture {
  stop(): Promise<void>
}

export async function startCapture(
  onFrame: (b64: string) => void,
  onError: (msg: string) => void,
): Promise<Capture> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch {
    onError('无法访问麦克风：请检查浏览器权限与系统录音权限')
    throw new Error('mic-denied')
  }

  const ctx = new AudioContext({ sampleRate: 16000 })
  try {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const src = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'pcm-capture')
    src.connect(node) // 不连 destination：只采集不出声，避免课堂外放回声

    let buf = new Float32Array(640)
    let filled = 0
    node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
      const input = ev.data
      let off = 0
      while (off < input.length) {
        const n = Math.min(input.length - off, 640 - filled)
        buf.set(input.subarray(off, off + n), filled)
        filled += n
        off += n
        if (filled === 640) {
          const pcm = new Int16Array(640)
          for (let i = 0; i < 640; i++) {
            const s = Math.max(-1, Math.min(1, buf[i]))
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
          }
          let out = ''
          for (const b of new Uint8Array(pcm.buffer)) out += String.fromCharCode(b)
          onFrame(btoa(out))
          buf = new Float32Array(640)
          filled = 0
        }
      }
    }

    return {
      stop: async () => {
        try {
          node.disconnect()
          src.disconnect()
        } catch {}
        stream.getTracks().forEach((t) => t.stop())
        await ctx.close().catch(() => {})
      },
    }
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop())
    await ctx.close().catch(() => {})
    onError('音频初始化失败：' + (e instanceof Error ? e.message : String(e)))
    throw e
  }
}
