// 精校真实效果探测：用用户实测的真实烂转写（分析化学课）验证修复质量。
import { readFileSync } from 'node:fs'

const md = readFileSync(new URL('../../secrets.local.md', import.meta.url), 'utf8')
const key = (md.match(/API Key: `([^`]+\.TdLYk6PO1cY8KiA3)`/) || [])[1]
if (!key) {
  console.log('未找到智谱 Key，跳过')
  process.exit(0)
}

const SYSTEM =
  '你是课堂转写精校器。学生的录音转写文本质量很差：有大量同音错字、漏字、断句错误。' +
  '请结合课程术语表和上下文，把文本修复成通顺、准确、有标点的课堂笔记式文稿。' +
  '规则：1) 只修正错字和断句，绝不增删知识内容、不改变原意；' +
  '2) 术语必须按术语表修正；3) 与学习无关的闲聊段落原样保留；' +
  '4) 不确定的表述保持原样；5) 直接输出修复后的全文，不要任何解释。'

// 真实样本：用户实测分析化学课的烂转写原句
const SAMPLE =
  '那么这个化学分析里面主要分为定分析和重量分析。第一个分析是什么？就是你们上上午滴滴滴管对吧，其实就是的滴六装式。' +
  '我是利用这个化学反应，然后把标标准液放在第一管里，把待测液放在中珠里里然后我那样去反应。' +
  '那它涉及到酸碱滴度、过合滴度、氧化还原滴晶以及沉淀结晶。'
const TERMS = ['分析化学', '滴定分析', '滴定管', '标准溶液', '待测液', '酸碱滴定', '络合滴定', '氧化还原滴定', '沉淀滴定', '重量分析']

const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'glm-4.6',
      thinking: { type: 'disabled' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `【课程术语表】${TERMS.join('、')}\n【待精校转写】\n${SAMPLE}` },
      ],
      max_tokens: 4000,
      temperature: 0.1,
      stream: false,
    }),
})
const j = await res.json()
const out = (j.choices?.[0]?.message?.content ?? '').trim()
console.log('===== 精校输出 =====')
console.log(out)
const must = ['滴定管', '待测液', '酸碱滴定', '络合滴定', '氧化还原滴定', '沉淀滴定']
const bad = ['滴滴滴管', '滴度', '滴晶', '中珠里']
const ok = must.every((w) => out.includes(w)) && !bad.some((w) => out.includes(w))
console.log(ok ? 'PROBE_PASS' : `PROBE_FAIL（缺失：${must.filter((w) => !out.includes(w)).join('、')}；残留错字：${bad.filter((w) => out.includes(w)).join('、')}）`)
process.exit(ok ? 0 : 1)
