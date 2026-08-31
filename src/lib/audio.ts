// 麦克风采集链：AudioContext 以 16k 采样率创建（浏览器负责重采样），
// AudioWorklet 输出 Float32 → 主线程聚合为 40ms/1280B 的 16bit PCM 帧（base64）。
const WORKLET_SRC = `class PC extends AudioWorkletProcessor{process(i){const c=i[0][0];if(c)this.port.postMessage(c);return true}}registerProcessor('pcm-capture',PC)`

export interface Capture {
  /** 切后台回来后 AudioContext 可能被系统挂起，需要手动恢复 */
  resume(): Promise<void>
  stop(): Promise<void>
}

/** 文件回放源：与麦克风同一条管线（AudioContext 16k + pcm worklet），供基准/课后精转使用 */
export async function startReplay(
  file: File,
  onFrame: (b64: string) => void,
): Promise<Capture> {
  const ctx = new AudioContext({ sampleRate: 16000 })
  const decoded = await ctx.decodeAudioData(await file.arrayBuffer())
  const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
  await ctx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  const src = ctx.createBufferSource()
  src.buffer = decoded
  const node = new AudioWorkletNode(ctx, 'pcm-capture')
  src.connect(node)

  let buf = new Float32Array(640)
  let filled = 0
  let dbgFrames = 0
  let dbgPeak = 0
  let envPeak = 0.05 // 环境峰值包络（衰减式追踪，用于自动增益）
  node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    const input = ev.data
    let off = 0
    // 自动增益：把远场小信号放大到 ASR 可用电平（峰值包络目标 ~0.7）
    const gain = Math.min(0.7 / Math.max(envPeak, 0.02), 30)
    while (off < input.length) {
      const n = Math.min(input.length - off, 640 - filled)
      buf.set(input.subarray(off, off + n), filled)
      filled += n
      off += n
      if (filled === 640) {
        const pcm = new Int16Array(640)
        for (let i = 0; i < 640; i++) {
          const v = Math.max(-1, Math.min(1, buf[i] * gain))
          pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
          const a = Math.abs(buf[i])
          if (a > dbgPeak) dbgPeak = a
          if (a > envPeak) envPeak = a
        }
        envPeak *= 0.999 // 缓慢衰减，适应音量变化
        let out = ''
        for (const b of new Uint8Array(pcm.buffer)) out += String.fromCharCode(b)
        onFrame(btoa(out))
        if (++dbgFrames % 25 === 0) console.log(`[replay] frames=${dbgFrames} peak=${dbgPeak.toFixed(3)} gain=×${gain.toFixed(1)}`)
        dbgPeak = 0
        buf = new Float32Array(640)
        filled = 0
      }
    }
  }
  src.start()

  return {
    resume: async () => {
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    },
    stop: async () => {
      try {
        src.stop()
        node.disconnect()
        src.disconnect()
      } catch {}
      await ctx.close().catch(() => {})
    },
  }
}

export interface Capture {
  /** 切后台回来后 AudioContext 可能被系统挂起，需要手动恢复 */
  resume(): Promise<void>
  stop(): Promise<void>
  /** 原始麦克风流（录音备份用）；回放源无此项 */
  stream?: MediaStream
}

export async function startCapture(
  onFrame: (b64: string) => void,
  onError: (msg: string) => void,
  onLevel?: (level: number, speechPct: number) => void,
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
    // 人声增强链（原生节点，零 JS 成本）：高通去混响拖尾 → 语声 EQ 辅音增强 → 动态压缩 → 增益
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 120
    hp.Q.value = 0.7
    const presence = ctx.createBiquadFilter()
    presence.type = 'peaking'
    presence.frequency.value = 3000
    presence.Q.value = 1
    presence.gain.value = 4
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -35
    comp.knee.value = 20
    comp.ratio.value = 6
    comp.attack.value = 0.005
    comp.release.value = 0.25
    const outGain = ctx.createGain()
    outGain.gain.value = 1.5
    src.connect(hp)
    hp.connect(presence)
    presence.connect(comp)
    comp.connect(outGain)
    outGain.connect(node) // 不连 destination：只采集不出声，避免课堂外放回声

    let buf = new Float32Array(640)
    let filled = 0
    let envPeak = 0.15 // AGC 峰值包络（远场小信号自动放大，目标 ~0.7）
    let meterFrames = 0
    let meterSpeech = 0
    node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
      const input = ev.data
      const gain = Math.min(0.7 / Math.max(envPeak, 0.1), 4)
      let chunkPeak = 0
      let off = 0
      while (off < input.length) {
        const n = Math.min(input.length - off, 640 - filled)
        buf.set(input.subarray(off, off + n), filled)
        filled += n
        off += n
        if (filled === 640) {
          const pcm = new Int16Array(640)
          for (let i = 0; i < 640; i++) {
            const s = Math.max(-1, Math.min(1, buf[i] * gain))
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
            const a = Math.abs(buf[i])
            if (a > chunkPeak) chunkPeak = a
            if (a > envPeak) envPeak = a
          }
          envPeak *= 0.998
          const speech = chunkPeak > 0.05
          meterSpeech += speech ? 1 : 0
          if (onLevel && ++meterFrames % 25 === 0) {
            // 每秒上报一次：峰值电平 + 最近 1 秒语音占比
            onLevel(Math.min(1, chunkPeak * 1.4), Math.round((meterSpeech / 25) * 100))
            meterSpeech = 0
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
      stream,
      resume: async () => {
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
      },
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
