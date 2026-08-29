// 震动能力封装：Android Chrome 原生支持；iOS Safari 无 Vibration API，
// 自动降级为屏幕提醒（调用方负责显示横幅）。

export function vibrateSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

/** 需要在用户点击后调用一次，解锁振动权限（粘性激活） */
export function unlockVibration(): void {
  try {
    navigator.vibrate?.(0)
  } catch {}
}

/** 关键词命中提醒：短促三连震 */
export function vibrateAlert(): void {
  try {
    navigator.vibrate?.([200, 80, 200, 80, 200])
  } catch {}
}

/** 轻提示（如检测到课堂提问）：单次短震 */
export function vibrateLight(): void {
  try {
    navigator.vibrate?.(80)
  } catch {}
}
