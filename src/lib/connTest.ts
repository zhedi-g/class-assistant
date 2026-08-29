// OpenAI 兼容接口连通性测试：直接从浏览器发起，验证 Key 有效性 + 延迟。
import { buildIatUrl } from './iflytek'

export interface TestResult {
  ok: boolean
  ms: number
  msg: string
}

async function pingOpenAI(url: string, key: string, model: string): Promise<TestResult> {
  const t0 = performance.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 8,
        stream: false,
      }),
    })
    const ms = Math.round(performance.now() - t0)
    if (res.ok) return { ok: true, ms, msg: `连接正常 · ${ms}ms · ${model}` }
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      detail = j?.error?.message || j?.message || detail
    } catch {
      /* 保留状态码 */
    }
    return { ok: false, ms, msg: `失败：${detail}` }
  } catch (e) {
    return {
      ok: false,
      ms: Math.round(performance.now() - t0),
      msg: '网络错误：' + (e instanceof Error ? e.message : String(e)),
    }
  }
}

export function testZhipu(key: string, model: string): Promise<TestResult> {
  return pingOpenAI('https://open.bigmodel.cn/api/paas/v4/chat/completions', key, model)
}

export function testDeepseek(key: string, model: string): Promise<TestResult> {
  return pingOpenAI('https://api.deepseek.com/chat/completions', key, model)
}

// 讯飞听写：真建连验证鉴权（首帧+尾帧空音频，收到 code=0 即通过）
export function testIflytek(appId: string, apiKey: string, apiSecret: string): Promise<TestResult> {
  const t0 = performance.now()
  return new Promise<TestResult>((resolve) => {
    let settled = false
    let ws: WebSocket | null = null
    const done = (ok: boolean, msg: string) => {
      if (settled) return
      settled = true
      try {
        ws?.close()
      } catch {}
      resolve({ ok, ms: Math.round(performance.now() - t0), msg })
    }
    buildIatUrl(apiKey, apiSecret)
      .then((url) => {
        ws = new WebSocket(url)
        const timer = setTimeout(() => done(false, '连接超时'), 8000)
        ws.onopen = () => {
          ws!.send(
            JSON.stringify({
              common: { app_id: appId },
              business: { language: 'zh_cn', domain: 'iat', accent: 'mandarin', vad_eos: 2000 },
              data: { status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' },
            }),
          )
          ws!.send(JSON.stringify({ data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' } }))
        }
        ws.onmessage = (ev) => {
          clearTimeout(timer)
          try {
            const j = JSON.parse(String(ev.data)) as { code?: number; message?: string }
            if (j.code === 0) done(true, `连接正常 · ${Math.round(performance.now() - t0)}ms`)
            else done(false, `错误 ${j.code}：${j.message ?? ''}`)
          } catch {
            done(false, '响应解析失败')
          }
        }
        ws.onerror = () => {
          clearTimeout(timer)
          done(false, '连接失败（网络或鉴权）')
        }
        ws.onclose = (ev) => {
          if (!settled) {
            clearTimeout(timer)
            done(false, `连接被关闭（${ev.code}）`)
          }
        }
      })
      .catch(() => done(false, '当前环境不支持加密（需 HTTPS/localhost）'))
  })
}
