// 讯飞协议真连探测：确认账号开通的是「语音听写 iat」还是「实时语音转写 rtasr」，
// 同时验证鉴权算法与连接可用性。本文件不进 git（xfyun.local.json 已 gitignore）。
import { createHmac, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync(new URL('../xfyun.local.json', import.meta.url), 'utf8'))

// 16k/16bit 440Hz 正弦波，1280B/帧（约40ms）
function sineFrames(seconds) {
  const bytesPerFrame = 1280
  const samplesPerFrame = bytesPerFrame / 2
  const frames = []
  let phase = 0
  for (let f = 0; f < (seconds * 1000) / 40; f++) {
    const buf = Buffer.alloc(bytesPerFrame)
    for (let i = 0; i < samplesPerFrame; i++) {
      const v = Math.round(Math.sin(phase) * 8000)
      buf.writeInt16LE(v, i * 2)
      phase += (2 * Math.PI * 440) / 16000
    }
    frames.push(buf)
  }
  return frames
}

function probeWebsocket(url, { label, firstFrame, feedFrames, timeoutMs = 25000 }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url)
    const frames = sineFrames(6)
    let idx = 0
    let gotCode0 = false
    let lastMsg = ''
    let done = false
    const finish = (ok, note) => {
      if (done) return
      done = true
      try { ws.close() } catch {}
      resolve({ ok, note, lastMsg })
    }
    const feed = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      if (idx < frames.length) {
        ws.send(feedFrames ? feedFrames(frames[idx], idx) : frames[idx].toString('base64'))
        idx++
      } else {
        clearInterval(feed)
      }
    }, 40)

    ws.onopen = () => {
      console.log(`  [${label}] 连接+鉴权成功 (onopen)`)
      if (firstFrame) ws.send(firstFrame)
    }
    ws.onmessage = (ev) => {
      const txt = typeof ev.data === 'string' ? ev.data : '(binary)'
      lastMsg = txt.slice(0, 220)
      try {
        const j = JSON.parse(txt)
        if (j.code === 0) gotCode0 = true
        if (j.code !== 0 && j.code !== undefined) {
          console.log(`  [${label}] 业务错误 code=${j.code} message=${j.message || ''}`)
          finish(false, `code=${j.code} ${j.message || ''}`)
        }
      } catch {}
    }
    ws.onerror = () => {}
    ws.onclose = (ev) => {
      clearInterval(feed)
      finish(gotCode0, `close(${ev.code}) ${gotCode0 ? '且收到 code=0 响应' : lastMsg}`)
    }
    setTimeout(() => {
      clearInterval(feed)
      finish(gotCode0, `超时(${timeoutMs}ms) 最后消息: ${lastMsg}`)
    }, timeoutMs)
  })
}

function iatUrl() {
  const date = new Date().toUTCString()
  const origin = `host: iat-api.xfyun.cn\ndate: ${date}\nGET /v2/iat HTTP/1.1`
  const sig = createHmac('sha256', cfg.apiSecret).update(origin).digest('base64')
  const auth = Buffer.from(
    `api_key="${cfg.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sig}"`,
  ).toString('base64')
  return `wss://iat-api.xfyun.cn/v2/iat?authorization=${auth}&date=${encodeURIComponent(date)}&host=iat-api.xfyun.cn`
}

function rtasrUrl() {
  const ts = Math.floor(Date.now() / 1000)
  const md5hex = createHash('md5').update(cfg.apiKey).digest('hex')
  const b64key = Buffer.from(md5hex).toString('base64')
  const signa = createHmac('sha256', b64key).update(String(ts)).digest('base64')
  return `wss://rtasr.xfyun.cn/v1/ws?appid=${cfg.appId}&ts=${ts}&signa=${signa}`
}

console.log('探测 1/2：语音听写 iat (wss://iat-api.xfyun.cn/v2/iat)')
const firstFrame = JSON.stringify({
  common: { app_id: cfg.appId },
  business: { language: 'zh_cn', domain: 'iat', accent: 'mandarin', vad_eos: 3000, ptt: 1 },
  data: { status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' },
})
const iatMsgIdx = { n: 0 }
const iatResult = await probeWebsocket(iatUrl(), {
  label: 'iat',
  firstFrame,
  feedFrames: (buf, i) => JSON.stringify({ data: { status: 1, format: 'audio/L16;rate=16000', encoding: 'raw', audio: buf.toString('base64') } }),
})
console.log(`  iat 结果: ${iatResult.ok ? '✅ 可用' : '❌ 不可用'} — ${iatResult.note}\n`)

if (!iatResult.ok) {
  console.log('探测 2/2：实时语音转写 rtasr (wss://rtasr.xfyun.cn/v1/ws)')
  const rt = await probeWebsocket(rtasrUrl(), { label: 'rtasr', firstFrame: null, feedFrames: null, timeoutMs: 15000 })
  console.log(`  rtasr 结果: ${rt.ok ? '✅ 可用' : '❌ 不可用'} — ${rt.note}\n`)
  console.log(iatResult.ok || rt.ok ? 'PROBE_PASS' : 'PROBE_FAIL')
} else {
  console.log('rtasr 无需探测（iat 已可用）。')
  console.log('PROBE_PASS')
}
process.exit(0)
