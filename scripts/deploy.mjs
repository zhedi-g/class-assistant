// 部署脚本：构建 dist 并推送到 gh-pages 分支（Pages 分支模式）。
// 令牌从工作区密钥存档读取，不入库。运行：pnpm deploy
import { readFileSync } from 'node:fs'
import ghpages from 'gh-pages'

const md = readFileSync(new URL('../../secrets.local.md', import.meta.url), 'utf8')
const token = (md.match(/PAT: `(ghp_[^`]+)`/) || [])[1]
if (!token) {
  console.error('未找到 GitHub PAT')
  process.exit(1)
}

console.log('发布 dist → gh-pages 分支…')
ghpages.publish(
  'dist',
  {
    branch: 'gh-pages',
    repo: `https://zhedi-g:${token}@github.com/zhedi-g/class-assistant.git`,
    silent: true,
  },
  (err) => {
    if (err) {
      console.error('部署失败：', err.message)
      process.exit(1)
    }
    console.log('部署完成：https://zhedi-g.github.io/class-assistant/')
  },
)
