// 主动回答价值判定真实探测：验证"老师抛给学生的问题"不再被跳过、课堂事务仍被跳过。
import { readFileSync } from 'node:fs'

const md = readFileSync(new URL('../../secrets.local.md', import.meta.url), 'utf8')
const key = (md.match(/API Key: `([^`]+\.TdLYk6PO1cY8KiA3)`/) || [])[1]
if (!key) {
  console.log('未找到智谱 Key，跳过')
  process.exit(0)
}

const SYSTEM =
  '你是学生的课堂学习助手。给你的一句话来自课堂实时转写，可能是老师或同学说的话。请先判断是否值得为学生回答：\n' +
  '【值得回答】任何知识类提问，包括：学生提出的问题；老师向学生抛出的问题（如"哪位同学讲讲X""谁能说说X"——老师抛出的问题往往是重点，请针对 X 本身作答）；表述模糊但能提炼出明确知识主题的提问（先在心里提炼主题，再围绕主题作答）。\n' +
  '【跳过】只输出「[跳过]」四个字：课堂事务（点名、交作业、翻书、维持纪律等）、无实质内容的碎句、与学习无关的闲聊、纯程序性话语（如"下面进入正题"）。\n' +
  '【回答要求】中文 2~5 句，可分点；发展趋势/对比类问题用分点概括；不要编造不确定的数字、年份、人名——不确定就用"大致/约"等表述或直接说明。'

async function run(text) {
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'glm-4-flash',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `【最近课堂字幕】同学们，今天我们进入人工智能专题。\n【待判定】${text}` },
      ],
      max_tokens: 600,
      temperature: 0.2,
      stream: false,
    }),
  })
  const j = await res.json()
  return (j.choices?.[0]?.message?.content ?? '').trim()
}

let pass = 0
// 样本 1：用户实测不回答的模糊长问句（老师抛给学生）→ 必须回答
const a1 = await run('现在哪一位同学能给我讲一讲这个时代的大模型AI的发展趋势及方向？')
const ok1 = !a1.includes('[跳过]') && a1.length > 30
console.log(`${ok1 ? '✅' : '❌'} 模糊长问句 → ${a1.slice(0, 80)}`)
if (ok1) pass++

// 样本 2：课堂事务 → 必须跳过
const a2 = await run('课代表下课把作业收一下交到办公室来')
const ok2 = a2.includes('[跳过]')
console.log(`${ok2 ? '✅' : '❌'} 课堂事务 → ${a2.slice(0, 40)}`)
if (ok2) pass++

// 样本 3：老师自答型反问 → 参考（可跳可答，仅打印）
const a3 = await run('这不很简单吗，一看就是动能定理嘛')
console.log(`ℹ️  反问句（不作硬性要求） → ${a3.slice(0, 60)}`)

console.log(pass === 2 ? 'PROBE_PASS' : `PROBE_PARTIAL(${pass}/2)`)
process.exit(pass === 2 ? 0 : 1)
