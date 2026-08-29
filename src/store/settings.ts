import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ProviderId = 'zhipu' | 'deepseek'

// 模型预设来自 2026-08-30 实测：智谱 glm-4-flash 调用成功；
// DeepSeek /models 返回 v4-flash / v4-pro / v4-flash-vision-exp。
export const ZHIPU_MODELS = [
  { id: 'glm-4-flash', label: 'GLM-4-Flash · 免费 · 推荐' },
  { id: 'glm-4.6', label: 'GLM-4.6 · 旗舰' },
  { id: 'glm-4.6v-flash', label: 'GLM-4.6V-Flash · 免费 · 视觉' },
]

export const DEEPSEEK_MODELS = [
  { id: 'deepseek-v4-flash', label: 'V4 Flash · 低价 · 推荐' },
  { id: 'deepseek-v4-pro', label: 'V4 Pro · 旗舰' },
]

interface SettingsState {
  provider: ProviderId
  zhipuModel: string
  deepseekModel: string
  iflytekAppId: string
  /** 识别热词，每行一个 */
  hotwords: string
  /** 提醒关键词，每行一个（命中即震动+标记） */
  alertWords: string
  /** 自动检测课堂提问并生成 AI 回答 */
  proactive: boolean
  theme: 'dark' | 'light'
  setSettings: (patch: Partial<Omit<SettingsState, 'setSettings'>>) => void
}

export const DEFAULT_ALERT_WORDS = ['考试', '要考', '必考', '重点', '作业', '交作业', '点名', '签到', '划重点'].join('\n')

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      provider: 'zhipu',
      zhipuModel: 'glm-4-flash',
      deepseekModel: 'deepseek-v4-flash',
      iflytekAppId: '',
      hotwords: '',
      alertWords: DEFAULT_ALERT_WORDS,
      proactive: true,
      theme: 'dark',
      setSettings: (patch) => set(patch),
    }),
    { name: 'class-helper-settings' },
  ),
)
