// 基准测试页（清晰计划第 0 层）：?bench=1 访问。
// 上传真实课堂音频 → 旧链路 vs 新增强链各跑一遍真实讯飞识别 → 对照报告。
import { useRef, useState } from 'react'
import {
  enhanceOffline,
  extractRaw16k,
  toIatFrames,
  framesFrom16k,
  speechOnly16k,
  transcribeFrames,
  termHits,
  ensureCfg,
  CHEM_TERMS,
} from '../lib/bench'

export default function BenchPage() {
  const [file, setFile] = useState<File | null>(null)
  const [sliceSec, setSliceSec] = useState(180)
  const [status, setStatus] = useState<string | null>(null)
  const [oldText, setOldText] = useState<string | null>(null)
  const [newText, setNewText] = useState<string | null>(null)
  const [meta, setMeta] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function run() {
    if (!file) return
    setOldText(null)
    setNewText(null)
    try {
      const cfg = await ensureCfg()
      const maxMs = sliceSec * 1000

      // 旧链路
      setStatus(`旧链路：解码 + 16k 抽帧（${sliceSec}s）…`)
      const raw = await extractRaw16k(file, maxMs)
      setStatus(`旧链路：真实讯飞识别 ${raw.length / 16000 | 0}s 音频…`)
      const old = await transcribeFrames(framesFrom16k(raw), cfg, (d, t) => setStatus(`旧链路：识别窗口 ${d}/${t}…`))
      setOldText(old.transcript || '（无结果）')

      // 新链路
      setStatus('新链路：解码 + 高通/EQ/压缩/增益 + RNNoise 降噪 + VAD 断句…')
      const { samples48k, segments } = await enhanceOffline(file, maxMs)
      setStatus(`新链路：VAD 切出 ${segments.length} 个语音段，仅送语音段识别…`)
      const speech16k = speechOnly16k(
        samples48k.slice(0, Math.ceil((sliceSec / 1000) * 48000) / 3),
        segments,
      )
      const frames = framesFrom16k(speech16k)
      setStatus(`新链路：真实讯飞识别 ${speech16k.length / 16000 | 0}s 语音段（${frames.length} 帧）…`)
      const nw = await transcribeFrames(frames, cfg, (d, t) => setStatus(`新链路：识别窗口 ${d}/${t}…`))
      setNewText(nw.transcript || '（无结果）')

      const o = termHits(old.transcript)
      const n = termHits(nw.transcript)
      const oTotal = o.reduce((s, x) => s + x.n, 0)
      const nTotal = n.reduce((s, x) => s + x.n, 0)
      setMeta(
        JSON.stringify(
          {
            旧链路: { 字符: old.transcript.length, 术语命中: oTotal, 窗口: old.windowCount, 命中明细: o.slice(0, 8) },
            新链路: { 字符: nw.transcript.length, 术语命中: nTotal, 窗口: nw.windowCount, 语音段: segments.length, 命中明细: n.slice(0, 8) },
            词表: CHEM_TERMS,
          },
          null,
          2,
        ),
      )
      setStatus('完成')
    } catch (e) {
      setStatus('失败：' + (e as Error).message)
    }
  }

  return (
    <div className="min-h-dvh bg-zinc-950 p-5 text-zinc-100">
      <h1 className="text-xl font-bold">转写链路基准测试（旧链路 vs 新增强链）</h1>
      <p className="mt-1 text-xs text-zinc-500">用真实课堂音频对比：裸链路 vs 高通/EQ/压缩/增益 + RNNoise 降噪 + VAD 断句。识别走真实讯飞。</p>

      <input
        ref={fileRef}
        data-testid="bench-input"
        type="file"
        accept=".m4a,.mp3,.wav,.aac,.ogg,.webm"
        className="mt-4 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-2 text-xs"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="mt-3 flex items-center gap-2">
        <select
          data-testid="bench-slice"
          value={sliceSec}
          onChange={(e) => setSliceSec(Number(e.target.value))}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        >
          {[60, 120, 180, 300, 600].map((s) => (
            <option key={s} value={s}>
              取前 {s / 60 < 1 ? s + ' 秒' : s / 60 + ' 分钟'}
            </option>
          ))}
        </select>
        <button
          data-testid="bench-start"
          onClick={() => void run()}
          disabled={!file || (status !== null && status !== '完成' && !status.startsWith('失败'))}
          className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          开始基准测试
        </button>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">识别按 2.7x 实时推送，整段约需音频时长/3 的时间 × 2 条链路，请耐心等待</p>

      {status && <p data-testid="bench-status" className="mt-3 text-xs text-blue-400">{status}</p>}

      {meta && (
        <pre data-testid="bench-stats" className="mt-3 max-h-72 overflow-auto rounded-xl bg-zinc-900 p-3 text-[11px] leading-relaxed text-emerald-400">
          {meta}
        </pre>
      )}

      {oldText !== null && (
        <div className="mt-4 rounded-xl border border-zinc-800 p-3">
          <p className="mb-1 text-xs font-semibold text-zinc-400">旧链路转写</p>
          <p data-testid="bench-old" className="max-h-64 overflow-y-auto text-xs leading-relaxed text-zinc-400">{oldText}</p>
        </div>
      )}
      {newText !== null && (
        <div className="mt-3 rounded-xl border border-emerald-800 p-3">
          <p className="mb-1 text-xs font-semibold text-emerald-400">新增强链路转写</p>
          <p data-testid="bench-new" className="max-h-64 overflow-y-auto text-xs leading-relaxed text-emerald-300">{newText}</p>
        </div>
      )}

      <button onClick={() => (window.location.href = '/class-assistant/')} className="mt-4 text-xs text-zinc-500 underline">
        返回应用
      </button>
    </div>
  )
}
