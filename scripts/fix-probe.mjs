// 校对引擎真实效果探测：用带同音错字的样本验证 GLM-Flash 的纠错能力。
// 通过标准：输出包含正确术语（深度求索/动能定理），且不改变句意。
// 读取 xfyun.local.json 同级的智谱 Key（从 secrets.local.md 手动同步，或直接粘贴）。
import { readFileSync } from 'node:fs'

// 智谱 Key 从本地存档解析（简单提取）
const md = readFileSync(new URL('../../secrets.local.md', import.meta.url), 'utf8')
const key = (md.match(/API Key: `([^`]+\.TdLYk6PO1cY8KiA3)`/) || [])[1]
if (!key) {
  console.log('未找到智谱 Key，跳过探测')
  process.exit(0)
}

const SYSTEM =
  '你是课堂语音转写校对器。任务：只修正明显的同音字、错别字和标点。规则：1) 绝不改变原意，不增删内容，不改语序；2) 术语按术语表修正；3) 不确定的地方保持原样；4) 只输出校对后的文本，不要任何解释、引号或前后缀。'

const samples = [
  {
    text: '深度球所是哪加公司，哈利波特的作者是谁',
    hotwords: ['深度求索', '哈利波特'],
    // 「哪加公司」语境歧义，按保守策略应保持原样，只要求修正术语
    expect: ['深度求索'],
  },
  {
    text: '动能量定理说明攻和能的转换关系，这个公式七末考试必考',
    hotwords: ['动能定理', '功', '能', '期末考试'],
    expect: ['动能定理', '功', '期末考试'],
  },
]

let pass = 0
for (const s of samples) {
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'glm-4-flash',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `【术语表】${s.hotwords.join('、')}\n【待校对】${s.text}` },
      ],
      max_tokens: 600,
      temperature: 0.1,
      stream: false,
    }),
  })
  const j = await res.json()
  const out = (j.choices?.[0]?.message?.content ?? '').trim()
  const ok = s.expect.every((w) => out.includes(w))
  console.log(`${ok ? '✅' : '❌'} "${s.text.slice(0, 14)}…" → "${out}"`)
  if (ok) pass++
}
console.log(pass === samples.length ? 'PROBE_PASS' : `PROBE_PARTIAL(${pass}/${samples.length})`)
