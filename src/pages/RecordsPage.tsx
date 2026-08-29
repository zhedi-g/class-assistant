export default function RecordsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">课堂记录</h1>
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-800">
        <span className="text-3xl">📂</span>
        <p className="text-sm text-zinc-500">还没有课堂记录</p>
        <p className="px-8 text-xs text-zinc-400 dark:text-zinc-600">
          M2 上线后，每节课的转写与标记会按日期出现在这里；M6 起可一键生成笔记与复习包。
        </p>
      </div>
    </div>
  )
}
