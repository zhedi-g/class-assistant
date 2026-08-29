// D2 关联引擎 + 分析管线验收（本地层）。运行：pnpm test:d2
import { topTerms, matchMaterialToLessons, parseAnalysisJson, mergeHotwords, pagesText } from '../src/lib/analysis'
import type { LessonRecord, MaterialPage } from '../src/lib/db'

const results: { name: string; ok: boolean; detail?: string }[] = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`)
}

const matPages: MaterialPage[] = [
  { label: '第 1 页', text: '第三章 动能定理：合外力对物体做的功等于物体动能的变化。表达式 W = Ek2 - Ek1。' },
  { label: '第 2 页', text: '动能定理应用：多过程问题要分段求功；摩擦生热 Q = f × 相对位移。' },
]

const lessonRelated: LessonRecord = {
  id: 1,
  date: '2026/8/30',
  startTs: Date.now() - 2 * 24 * 3600 * 1000,
  durationSec: 2700,
  segments: [
    { id: 'a1', t: 0, text: '今天我们讲第三章的动能定理，合外力做的功等于物体动能的变化量', marked: false },
    { id: 'a2', t: 5000, text: '多过程问题大家要分段求功，最后再求和，摩擦生热等于摩擦力乘相对位移', marked: true },
    { id: 'a3', t: 9000, text: '这个公式期末考试必考大家记一下', marked: true, matched: '考试' },
  ],
  createdAt: Date.now() - 2 * 24 * 3600 * 1000,
}

const lessonUnrelated: LessonRecord = {
  id: 2,
  date: '2026/8/20',
  startTs: Date.now() - 10 * 24 * 3600 * 1000,
  durationSec: 1800,
  segments: [
    { id: 'b1', t: 0, text: '今天欣赏唐诗宋词，体会意境与修辞手法', marked: false },
    { id: 'b2', t: 4000, text: '这篇课文的作者生平大家了解一下', marked: false },
  ],
  createdAt: Date.now() - 10 * 24 * 3600 * 1000,
}

// ── 术语提取 ──
{
  const terms = topTerms(pagesText(matPages), 20)
  check('资料高频术语提取含「动能定理」', terms.includes('动能定理'), terms.join(','))
  check('术语提取含「合外力」', terms.includes('合外力'), terms.join(','))
}

// ── 关联打分 ──
{
  const cands = matchMaterialToLessons({ pages: matPages }, [lessonRelated, lessonUnrelated])
  check('返回候选 ≤3', cands.length <= 3, `${cands.length} 个`)
  check('相关课排第一', cands[0]?.lessonId === 1, `top1=lesson${cands[0]?.lessonId} score=${cands[0]?.score.toFixed(4)}`)
  check('无关课得分显著更低', cands[1]?.score < cands[0]!.score, `${cands[1]?.score.toFixed(4)}`)
  check('候选带术语重合信息', (cands[0]?.termHits.length ?? 0) >= 1, cands[0]?.termHits.join(','))
}

// ── JSON 解析 ──
{
  const raw1 = '{"outline":["a"],"terms":["b"]}'
  const raw2 = '好的，以下是分析：\n```json\n{"summary":"x"}\n```\n以上。'
  check('裸 JSON 可解析', (parseAnalysisJson(raw1) as { outline?: string[] }).outline?.[0] === 'a')
  check('代码块包裹 JSON 可解析', (parseAnalysisJson(raw2) as { summary?: string }).summary === 'x')
  let threw = false
  try {
    parseAnalysisJson('没有结构的回答')
  } catch {
    threw = true
  }
  check('无 JSON 时抛错', threw)
}

// ── 热词合并 ──
{
  const merged = mergeHotwords('深度求索\n动能定理', ['动能定理', '哈雷彗星', '角动量'])
  check('热词合并去重', merged.includes('哈雷彗星') && merged.includes('角动量') && merged.split('\n').length === 4)
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n⛔ ${failed.length} 项未通过` : '\n🎉 D2 本地层验收全部通过')
process.exit(failed.length ? 1 : 0)
