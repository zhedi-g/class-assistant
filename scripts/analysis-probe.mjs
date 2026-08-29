// D2 真实 GLM 联合分析探测：合成课堂记录 + 合成资料 → review/preview 双模式。
// 使用与 src/lib/analysis.ts 相同的提示词与双模型回退链（glm-4.6 → glm-4-flash）。
import { readFileSync } from 'node:fs'

const md = readFileSync(new URL('../../secrets.local.md', import.meta.url), 'utf8')
const key = (md.match(/API Key: `([^`]+\.TdLYk6PO1cY8KiA3)`/) || [])[1]
if (!key) {
  console.log('未找到智谱 Key，跳过')
  process.exit(0)
}

const ANTI = '硬性要求：所有结论必须来自给定的材料与转写原文；不要编造材料中未出现的数字、年份、人名、页码；不确定的表述用"大致/疑似"并标注。'

const REVIEW_PROMPT = (matText, lessonText) =>
  '你是学生的学习分析师。下面是一份学习资料和一节课的课堂转写，请联合分析。\n' +
  '只输出一个 JSON 对象（不要代码块、不要解释），结构：\n' +
  '{"outline":["资料提纲要点",…5~8条],"terms":["核心术语",…8~15个],' +
  '"compare":{"inMaterialOnly":["资料有但课堂未细讲",…],"emphasizedInClass":["课堂反复强调但资料简略",…],"differs":["两者表述不同之处",…]},' +
  '"reviewPlan":["复习建议（按优先级，具体可执行）",…3~6条],"examFocus":["预测考点及依据",…3~6条],"summary":"一句话联合结论"}\n' +
  `【资料：第三章动能定理课件】\n${matText}\n【课堂转写 · 2026/8/30】${lessonText}\n` + ANTI

const PREVIEW_PROMPT = (matText) =>
  '你是学生的学习分析师。下面是一份即将学习的新资料（尚未有课堂记录），请生成预习包。\n' +
  '只输出一个 JSON 对象（不要代码块、不要解释），结构：\n' +
  '{"outline":["内容提纲",…5~8条],"terms":["核心术语",…8~15个],' +
  '"listenQuestions":["带着这些问题去听课",…3~5个],"hardPoints":["难点预警",…2~4条],' +
  '"reviewPlan":["预习行动建议",…3~5条],"summary":"一句话概括"}\n' +
  `【资料：下节课预习材料·刚体转动】\n${matText}\n` + ANTI

const matText = `【第 1 页】第三章 动能定理：合外力对物体做的功等于物体动能的变化。表达式 W = Ek2 - Ek1。
【第 2 页】动能定理应用：多过程问题要分段求功；摩擦生热 Q = f × 相对位移。
【第 3 页】典型例题：物体沿粗糙斜面下滑，求到达底端速度。`

const lessonText =
  '今天我们讲第三章的动能定理，合外力做的功等于物体动能的变化量。' +
  '多过程问题大家要分段求功，最后再求和，摩擦生热等于摩擦力乘相对位移。' +
  '斜面模型考试很爱考，注意支持力不做功。这个公式期末考试必考大家记一下。'

async function callJson(prompt) {
  for (const model of ['glm-4.6', 'glm-4-flash']) {
    try {
      const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 3500,
          temperature: 0.2,
          stream: false,
        }),
      })
      if (!res.ok) throw new Error(`${model} HTTP ${res.status}`)
      const j = await res.json()
      const raw = (j.choices?.[0]?.message?.content ?? '').trim()
      const body = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? raw
      const start = body.indexOf('{')
      const end = body.lastIndexOf('}')
      const obj = JSON.parse(body.slice(start, end + 1))
      console.log(`  [实际使用模型] ${model}`)
      return obj
    } catch (e) {
      console.log(`  [${model} 失败] ${e.message}，尝试回退…`)
    }
  }
  throw new Error('所有模型均失败')
}

let pass = 0
console.log('探测 1/2：复习模式（资料×课堂联合分析）')
{
  const r = await callJson(REVIEW_PROMPT(matText, lessonText))
  const outlineOk = Array.isArray(r.outline) && r.outline.length >= 3
  const termsOk = Array.isArray(r.terms) && r.terms.length >= 5
  const compareOk = r.compare && typeof r.compare === 'object'
  const examOk = Array.isArray(r.examFocus) && r.examFocus.length >= 2
  const examMentionsClass = examOk && r.examFocus.join('').includes('课堂')
  console.log(`  outline(${r.outline?.length}) terms(${r.terms?.length}): ${r.terms?.slice(0, 6).join('、')}`)
  console.log(`  课堂强调: ${r.compare?.emphasizedInClass?.slice(0, 2)?.join('；')}`)
  console.log(`  预测考点: ${r.examFocus?.slice(0, 2)?.join('；')}`)
  if (outlineOk) pass++
  if (termsOk) pass++
  if (compareOk) pass++
  if (examOk && examMentionsClass) pass++
  console.log(`  子判定: outline✓${outlineOk} terms✓${termsOk} compare✓${compareOk} examFocus✓${examOk && examMentionsClass}`)
}

console.log('探测 2/2：预习模式（无课堂记录）')
{
  const r = await callJson(PREVIEW_PROMPT('【第 1 页】刚体转动惯量：I = Σ mᵢrᵢ²，转动动能 Ek = ½Iω²。\n【第 2 页】平行轴定理与典型刚体的转动惯量计算。'))
  const lqOk = Array.isArray(r.listenQuestions) && r.listenQuestions.length >= 2
  const hardOk = Array.isArray(r.hardPoints) && r.hardPoints.length >= 1
  console.log(`  听课问题: ${r.listenQuestions?.slice(0, 3)?.join('；')}`)
  console.log(`  难点预警: ${r.hardPoints?.slice(0, 2)?.join('；')}`)
  if (lqOk) pass++
  if (hardOk) pass++
  console.log(`  子判定: listenQuestions✓${lqOk} hardPoints✓${hardOk}`)
}

console.log(pass >= 5 ? 'PROBE_PASS' : `PROBE_PARTIAL(${pass}/6)`)
process.exit(pass >= 5 ? 0 : 1)
