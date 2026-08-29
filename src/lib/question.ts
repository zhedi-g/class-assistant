// 课堂提问检测器（本地规则层，零成本）：
// 只负责"这句话像不像一个值得看一眼的提问"，价值终判交给大模型。
// 设计取向：宁可放进价值层误判，也不放过真问题；课堂事务类强排除。

const QUESTION_HINTS = [
  '什么', '为什么', '怎么', '怎么样', '如何',
  '谁', '哪',
  '多少', '几时', '何时', '多久', '几',
  '是否', '能否', '可不可以', '要不要', '是不是', '有没有',
  '吗？', '吗?', '呢？', '呢?',
]

/** 课堂事务/非提问场景：出现即整句跳过 */
const CLASSROOM_EXCLUDES = [
  '点名', '签到', '交作业', '收作业', '发作业', '翻到', '翻开', '打开书',
  '把手机', '手机收', '静音', '下课', '上课', '起立', '坐好', '安静',
  '登记', '填表', '扫码', '记一下笔记', '看黑板', '看屏幕', '看大屏幕',
]

export interface DetectResult {
  question: boolean
  /** 不判为提问的原因（用于调试与后续展示） */
  reason?: string
}

export function detectQuestion(text: string): DetectResult {
  const t = text.trim()
  if (t.length < 6) return { question: false, reason: '太短' }
  if (CLASSROOM_EXCLUDES.some((w) => t.includes(w))) return { question: false, reason: '课堂事务' }

  const hasMark = t.includes('？') || t.includes('?')
  const hasHint = QUESTION_HINTS.some((w) => t.includes(w))
  if (!hasMark && !hasHint) return { question: false, reason: '非疑问句' }
  return { question: true }
}

/** 近似去重：与最近几个问题互为包含即视为重复 */
export function isDuplicateQuestion(text: string, recent: string[]): boolean {
  return recent.some((r) => r.includes(text) || text.includes(r))
}
