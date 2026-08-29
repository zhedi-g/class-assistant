// 备用同步通道：github.com git 协议被墙时，改走 api.github.com 上传提交。
// 原理：diff 本地 HEAD 与远端 main → 建 blobs → 建 tree → 建 commit → 更新 refs/heads/main
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const md = readFileSync(new URL('../../secrets.local.md', import.meta.url), 'utf8')
const token = (md.match(/PAT: `(ghp_[^`]+)`/) || [])[1]
const API = 'https://api.github.com/repos/zhedi-g/class-assistant'
const H = { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
const b64 = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'base64')

async function api(path, method = 'GET', body) {
  const res = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const j = await res.json().catch(() => ({}))
  return { status: res.status, j }
}

const localHead = execSync('git rev-parse HEAD').toString().trim()
const msg = execSync('git log -1 --pretty=%B').toString().trim()

const { j: ref } = await api('/git/refs/heads/main')
const baseSha = ref.object.sha
if (baseSha === localHead) {
  console.log('远端已是最新')
  process.exit(0)
}
const { j: baseCommit } = await api(`/git/commits/${baseSha}`)
const baseTree = baseCommit.tree.sha

// 远端提交可能由 API 创建（本地无此对象）——找本地“树内容一致”的提交作为 diff 基线
const localLog = execSync('git log --format="%H %T" -30').toString().trim().split('\n').map((l) => l.split(' '))
const localBase = localLog.find(([, t]) => t === baseTree)?.[0]
if (!localBase) throw new Error('远端与本地无共同内容基线，需要全量同步（暂未实现）')

const changed = execSync(`git diff --name-only ${localBase} HEAD`).toString().trim().split('\n').filter(Boolean)
const deleted = new Set(
  execSync(`git diff --name-only --diff-filter=D ${localBase} HEAD`).toString().trim().split('\n').filter(Boolean),
)
console.log(`变更 ${changed.length} 个文件（含删除 ${deleted.size} 个）`)

const treeItems = []
for (const path of changed) {
  if (deleted.has(path)) {
    treeItems.push({ path, mode: '100644', type: 'blob', sha: null })
    continue
  }
  const { j: blob, status } = await api('/git/blobs', 'POST', { content: b64(path), encoding: 'base64' })
  if (status !== 201) throw new Error(`blob 创建失败：${path}`)
  treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
}

const { j: tree, status: treeStatus } = await api('/git/trees', 'POST', { base_tree: baseTree, tree: treeItems })
if (treeStatus !== 201) throw new Error('tree 创建失败')
const { j: commit, status: commitStatus } = await api('/git/commits', 'POST', {
  message: msg,
  tree: tree.sha,
  parents: [baseSha],
})
if (commitStatus !== 201) throw new Error('commit 创建失败')
const { status: patchStatus } = await api('/git/refs/heads/main', 'PATCH', { sha: commit.sha, force: true })
if (patchStatus !== 200) throw new Error('指针更新失败')

console.log(`远端 main 已更新：${baseSha.slice(0, 8)} → ${commit.sha.slice(0, 8)}（本地 ${localHead.slice(0, 8)}）`)
if (commit.sha !== localHead) console.log('（提交者时间戳差异导致 sha 不同，内容树已一致同步）')
