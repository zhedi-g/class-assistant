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
  theme: 'dark' | 'light'
  setSettings: (patch: Partial<Omit<SettingsState, 'setSettings'>>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      provider: 'zhipu',
      zhipuModel: 'glm-4-flash',
      deepseekModel: 'deepseek-v4-flash',
      iflytekAppId: '',
      theme: 'dark',
      setSettings: (patch) => set(patch),
    }),
    { name: 'class-helper-settings' },
  ),
)
