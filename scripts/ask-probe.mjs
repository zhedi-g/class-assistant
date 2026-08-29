// 真实 SSE 流式问答探测：验证浏览器端同款代码路径的服务端可行性（GLM-Flash 流式）。
import { readFileSync } from 'node:fs'

const md = readFileSync(new URL('../../secrets.local.md', import.meta.url), 'utf8')
const key = (md.match(/API Key: `([^`]+\.TdLYk6PO1cY8KiA3)`/) || [])[1]
if (!key) {
  console.log('未找到智谱 Key，跳过')
  process.exit(0)
}

const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: 'glm-4-flash',
    messages: [
      { role: 'system', content: '你是课堂学习助手，回答简洁。' },
      { role: 'user', content: '用一句话解释动能定理' },
    ],
    max_tokens: 200,
    stream: true,
  }),
})
if (!res.ok || !res.body) {
  console.log(`❌ HTTP ${res.status}`)
  process.exit(1)
}

const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
let deltas = 0
let content = ''
let done = false
for (;;) {
  const { done: rd, value } = await reader.read()
  if (rd) break
  buffer += decoder.decode(value, { stream: true })
  const lines = buffer.split('\n')
  buffer = lines.pop() ?? ''
  for (const line of lines) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const p = t.slice(5).trim()
    if (!p || p === '[DONE]') {
      if (p === '[DONE]') done = true
      continue
    }
    try {
      const j = JSON.parse(p)
      const d = j.choices?.[0]?.delta?.content
      if (d) {
        deltas++
        content += d
      }
    } catch {}
  }
}
console.log(`流式分片 ${deltas} 个，全文（${content.length} 字）：${content.slice(0, 60)}`)
console.log(deltas > 1 && content.length > 10 && done ? 'PROBE_PASS' : 'PROBE_FAIL')
process.exit(deltas > 1 && content.length > 10 && done ? 0 : 1)
