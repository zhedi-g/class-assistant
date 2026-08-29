// OpenAI 兼容接口连通性测试：直接从浏览器发起，验证 Key 有效性 + 延迟。
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
