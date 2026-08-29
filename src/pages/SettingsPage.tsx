import { useEffect, useState, type ReactNode } from 'react'
import { loadSecrets, saveSecrets, type SecretMap } from '../lib/secretStore'
import { useSettings, ZHIPU_MODELS, DEEPSEEK_MODELS, type ProviderId } from '../store/settings'
import { testZhipu, testDeepseek, testIflytek, type TestResult } from '../lib/connTest'

const inputCls =
  'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800'

export default function SettingsPage() {
  const s = useSettings()
  const [secrets, setSecrets] = useState<SecretMap | null>(null)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [zhipuResult, setZhipuResult] = useState<TestResult | null>(null)
  const [dsResult, setDsResult] = useState<TestResult | null>(null)
  const [iflyResult, setIflyResult] = useState<TestResult | null>(null)

  useEffect(() => {
    loadSecrets().then(setSecrets)
  }, [])

  function upd(key: string, value: string) {
    if (!secrets) return
    const next = { ...secrets, [key]: value }
    setSecrets(next)
    saveSecrets(next).then(() => {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    })
  }

  async function runTest(p: string) {
    if (!secrets) return
    setTesting(p)
    let result: TestResult
    if (p === 'zhipu') {
      result = await testZhipu(secrets['zhipu.apiKey'] ?? '', s.zhipuModel)
      setZhipuResult(result)
    } else if (p === 'deepseek') {
      result = await testDeepseek(secrets['deepseek.apiKey'] ?? '', s.deepseekModel)
      setDsResult(result)
    } else {
      result = await testIflytek(s.iflytekAppId, secrets['iflytek.apiKey'] ?? '', secrets['iflytek.apiSecret'] ?? '')
      setIflyResult(result)
    }
    setTesting(null)
  }

  return (
    <div className="relative space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">设置</h1>
        {saved && <span className="text-xs text-emerald-500">✓ 已保存</span>}
      </header>

      {/* 讯飞 */}
      <Card title="语音识别 · 讯飞开放平台" desc="用于课堂实时转写。密钥在控制台「语音听写」服务页获取。">
        <Field label="APPID（非密钥，明文保存）">
          <input
            className={inputCls}
            placeholder="讯飞 APPID"
            value={s.iflytekAppId}
            onChange={(e) => s.setSettings({ iflytekAppId: e.target.value })}
            autoComplete="off"
          />
        </Field>
        <SecretInput
          label="APIKey"
          placeholder="讯飞 APIKey"
          value={secrets?.['iflytek.apiKey'] ?? ''}
          onChange={(v) => upd('iflytek.apiKey', v)}
        />
        <SecretInput
          label="APISecret"
          placeholder="讯飞 APISecret"
          value={secrets?.['iflytek.apiSecret'] ?? ''}
          onChange={(v) => upd('iflytek.apiSecret', v)}
        />
        <div className="flex items-center gap-3">
          <button
            data-testid="ifly-test-btn"
            onClick={() => runTest('iflytek')}
            disabled={testing !== null || !s.iflytekAppId || !secrets?.['iflytek.apiKey'] || !secrets?.['iflytek.apiSecret']}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {testing === 'iflytek' ? '测试中…' : '测试连接'}
          </button>
          {iflyResult && (
            <p data-testid="ifly-test-result" className={`text-xs ${iflyResult.ok ? 'text-emerald-500' : 'text-red-500'}`}>
              {iflyResult.msg}
            </p>
          )}
        </div>
      </Card>

      {/* 热词 */}
      <Card title="识别热词" desc="每行一个词。课程术语提前加入可明显降低错字率；教材导入（M5.5）后此表会自动扩充。">
        <textarea
          className={inputCls + ' min-h-24'}
          placeholder={'深度求索\n动能定理'}
          value={s.hotwords}
          onChange={(e) => s.setSettings({ hotwords: e.target.value })}
        />
      </Card>

      {/* 提醒关键词 */}
      <Card title="提醒关键词" desc="实时转写中命中这些词时，手机会震动、弹横幅并自动标记该句（每行一个词）。">
        <textarea
          data-testid="alert-words"
          className={inputCls + ' min-h-24'}
          placeholder={'考试\n作业\n划重点'}
          value={s.alertWords}
          onChange={(e) => s.setSettings({ alertWords: e.target.value })}
        />
      </Card>

      {/* 智谱 */}
      <Card title="AI 服务 · 智谱 GLM" desc="免费档即可覆盖日常答疑，推荐优先使用。">
        <SecretInput
          label="API Key"
          placeholder="智谱 API Key"
          value={secrets?.['zhipu.apiKey'] ?? ''}
          onChange={(v) => upd('zhipu.apiKey', v)}
        />
        <Field label="模型">
          <select className={inputCls} value={s.zhipuModel} onChange={(e) => s.setSettings({ zhipuModel: e.target.value })}>
            {ZHIPU_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-center gap-3">
          <button
            data-testid="zhipu-test-btn"
            onClick={() => runTest('zhipu')}
            disabled={testing !== null || !secrets?.['zhipu.apiKey']}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {testing === 'zhipu' ? '测试中…' : '测试连接'}
          </button>
          {zhipuResult && (
            <p data-testid="zhipu-test-result" className={`text-xs ${zhipuResult.ok ? 'text-emerald-500' : 'text-red-500'}`}>
              {zhipuResult.msg}
            </p>
          )}
        </div>
      </Card>

      {/* DeepSeek */}
      <Card title="AI 服务 · DeepSeek" desc="备用主力，注意按峰谷时段计费。">
        <SecretInput
          label="API Key"
          placeholder="DeepSeek API Key"
          value={secrets?.['deepseek.apiKey'] ?? ''}
          onChange={(v) => upd('deepseek.apiKey', v)}
        />
        <Field label="模型">
          <select className={inputCls} value={s.deepseekModel} onChange={(e) => s.setSettings({ deepseekModel: e.target.value })}>
            {DEEPSEEK_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-center gap-3">
          <button
            data-testid="ds-test-btn"
            onClick={() => runTest('deepseek')}
            disabled={testing !== null || !secrets?.['deepseek.apiKey']}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {testing === 'deepseek' ? '测试中…' : '测试连接'}
          </button>
          {dsResult && (
            <p data-testid="ds-test-result" className={`text-xs ${dsResult.ok ? 'text-emerald-500' : 'text-red-500'}`}>
              {dsResult.msg}
            </p>
          )}
        </div>
      </Card>

      {/* 通用 */}
      <Card title="通用">
        <Field label="默认 AI 服务">
          <select
            className={inputCls}
            value={s.provider}
            onChange={(e) => s.setSettings({ provider: e.target.value as ProviderId })}
          >
            <option value="zhipu">智谱 GLM（免费档优先）</option>
            <option value="deepseek">DeepSeek</option>
          </select>
        </Field>
        <Field label="自动回答课堂提问">
          <div className="flex gap-2">
            {([true, false] as const).map((v) => (
              <button
                key={String(v)}
                data-testid={v ? 'proactive-on' : 'proactive-off'}
                onClick={() => s.setSettings({ proactive: v })}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
                  s.proactive === v
                    ? 'border-blue-500 text-blue-500'
                    : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'
                }`}
              >
                {v ? '开启' : '关闭'}
              </button>
            ))}
          </div>
        </Field>
        <p className="-mt-1 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-600">
          开启后：转写中检测到值得回答的知识类提问时自动生成回答并提醒（课堂事务与无实质内容的问句自动跳过）。
        </p>
        <Field label="主题">
          <div className="flex gap-2">
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                onClick={() => s.setSettings({ theme: t })}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
                  s.theme === t
                    ? 'border-blue-500 text-blue-500'
                    : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'
                }`}
              >
                {t === 'dark' ? '深色' : '浅色'}
              </button>
            ))}
          </div>
        </Field>
        <button
          data-testid="wipe-all-btn"
          onClick={() => {
            if (!confirm('清除本机全部数据？将删除密钥、配置与所有课堂记录，不可恢复。')) return
            try {
              localStorage.clear()
              indexedDB.deleteDatabase('class-helper')
              indexedDB.deleteDatabase('class-helper-data')
            } finally {
              location.reload()
            }
          }}
          className="w-full rounded-xl border border-red-300 py-2.5 text-sm text-red-500 dark:border-red-500/40"
        >
          清除本机全部数据
        </button>
      </Card>

      <p className="px-1 pb-2 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-600">
        安全说明：所有 Key 使用设备级 AES-GCM 加密后仅存本机浏览器，请求直连服务商，
        不经过任何中间服务器。清除浏览器数据会同时清除密钥，请妥善保管原件。
        课堂学习助手 v0.1.0 · M1
      </p>
    </div>
  )
}

function Card({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold">{title}</h2>
      {desc && <p className="mt-0.5 text-xs text-zinc-500">{desc}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      {children}
    </label>
  )
}

function SecretInput(props: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false)
  return (
    <Field label={props.label + '（加密保存）'}>
      <span className="relative block">
        <input
          className={inputCls + ' pr-14'}
          type={show ? 'text' : 'password'}
          placeholder={props.placeholder}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          {show ? '隐藏' : '显示'}
        </button>
      </span>
    </Field>
  )
}
