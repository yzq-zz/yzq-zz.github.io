<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vitepress'

// 锚点评论：在每个 h2/h3 标题旁挂评论入口，面板内嵌在标题下方。
// 存储复用练习题云同步：GitHub notes-data 仓库，按页面一个 JSON 文件；
// Token 复用 localStorage 的 gh_sync_token（练习题页配过即可直接用）。
// 无 Token 也能读（public 仓库），发表时才要求配置。

interface Comment {
  id: string
  anchor: string
  text: string
  author: string
  created_at: string
}

const GH_OWNER = 'yzq-zz'
const GH_REPO = 'notes-data'
const TOKEN_KEY = 'gh_sync_token'
const USER_KEY = 'gh_user_login'
const DELETED_KEY = 'gh_comment_deleted_ids'

const route = useRoute()

let comments: Comment[] = []
let knownSha: string | null = null
let observer: MutationObserver | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null
let pullSeq = 0

// ---------- 浮条（Token 配置）的响应式状态 ----------
const connected = ref(false)
const login = ref('')
const syncMsg = ref('')
const showConfig = ref(false)
const tokenInput = ref('')

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}
function getDeleted(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DELETED_KEY) || '[]'))
  } catch {
    return new Set()
  }
}
function saveDeleted(s: Set<string>) {
  localStorage.setItem(DELETED_KEY, JSON.stringify([...s]))
}

function pagePath() {
  // /agent/cli-vs-mcp → comments/agent__cli-vs-mcp.json
  const p = route.path.replace(/^\/+|\/+$/g, '').replace(/\//g, '__') || 'index'
  return `comments/${p}.json`
}

// ---------- GitHub API ----------
function ghHeaders(extra: Record<string, string> = {}) {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra
  }
  const t = getToken()
  if (t) h['Authorization'] = 'Bearer ' + t
  return h
}

async function fetchRemote(): Promise<{ sha: string | null; comments: Comment[] }> {
  const r = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${pagePath()}`,
    { headers: ghHeaders() }
  )
  if (r.status === 404) return { sha: null, comments: [] }
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const j = await r.json()
  const data = JSON.parse(decodeURIComponent(escape(atob(j.content))))
  return { sha: j.sha, comments: data.comments || [] }
}

async function pullComments() {
  const seq = ++pullSeq
  syncMsg.value = '正在加载评论…'
  try {
    const remote = await fetchRemote()
    if (seq !== pullSeq) return // 已切换页面，丢弃旧结果
    knownSha = remote.sha
    comments = remote.comments
    renderAll()
    syncMsg.value = ''
  } catch (e) {
    if (seq === pullSeq) syncMsg.value = '评论加载失败：' + (e as Error).message
  }
}

// 推送时以远端为基准合并，避免覆盖其他设备的写入
async function pushComments(attempt = 0) {
  const token = getToken()
  if (!token) return
  syncMsg.value = '正在同步评论…'
  try {
    const remote = await fetchRemote()
    const deleted = getDeleted()
    const localById = new Map(comments.map((c) => [c.id, c]))
    const merged = [...remote.comments]
    // 远端没有、本地有的 = 本设备新增
    for (const [id, c] of localById) {
      if (!remote.comments.some((x) => x.id === id)) merged.push(c)
    }
    const finalList = merged
      .filter((c) => !deleted.has(c.id))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))

    const payload = {
      updated_at: new Date().toISOString(),
      comments: finalList
    }
    const r = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${pagePath()}`,
      {
        method: 'PUT',
        headers: ghHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          message: 'comments: 更新页面评论',
          content: btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2)))),
          sha: remote.sha ?? undefined
        })
      }
    )
    if (r.status === 409 && attempt < 2) {
      // 并发冲突，稍后带最新 sha 重试
      pushTimer = setTimeout(() => pushComments(attempt + 1), 2000)
      return
    }
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const j = await r.json()
    knownSha = j.commit?.sha ?? remote.sha
    comments = finalList
    saveDeleted(new Set()) // 删除已落库，清掉待删记录
    renderAll()
    syncMsg.value = '评论已同步'
    setTimeout(() => {
      if (syncMsg.value === '评论已同步') syncMsg.value = ''
    }, 2000)
  } catch (e) {
    syncMsg.value = '评论同步失败：' + (e as Error).message
  }
}

function schedulePush() {
  if (!getToken()) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(pushComments, 2500)
}

// ---------- 标题 DOM 增强 ----------
function enhanceHeadings() {
  const headings = document.querySelectorAll<HTMLElement>(
    '.vp-doc h2[id], .vp-doc h3[id]'
  )
  headings.forEach((h) => {
    if (h.querySelector('.ac-toggle')) return
    h.classList.add('ac-heading')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ac-toggle'
    btn.title = '评论'
    btn.setAttribute('aria-label', '查看/添加评论')
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 3.5C2 2.67 2.67 2 3.5 2h9c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H6l-3 3v-3h-.5C2.67 12.5 2 11.83 2 11v-7.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg><span class="ac-count"></span>'
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      togglePanel(h)
    })
    h.appendChild(btn)
  })
  refreshBadges()
}

function commentsOf(anchor: string) {
  return comments
    .filter((c) => c.anchor === anchor)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

function refreshBadges() {
  document
    .querySelectorAll<HTMLElement>('.vp-doc h2[id], .vp-doc h3[id]')
    .forEach((h) => {
      const n = commentsOf(h.id).length
      h.classList.toggle('has-comments', n > 0)
      const badge = h.querySelector<HTMLElement>('.ac-count')
      if (badge) badge.textContent = n > 0 ? String(n) : ''
    })
}

function togglePanel(h: HTMLElement) {
  const existing = h.nextElementSibling as HTMLElement | null
  if (existing && existing.classList.contains('ac-panel')) {
    existing.remove()
    return
  }
  // 关闭其他面板
  document.querySelectorAll('.ac-panel').forEach((p) => p.remove())
  const panel = document.createElement('div')
  panel.className = 'ac-panel'
  panel.dataset.anchor = h.id
  h.after(panel)
  renderPanel(panel, h.id)
}

function renderPanel(panel: HTMLElement, anchor: string) {
  const list = commentsOf(anchor)
  const canWrite = !!getToken()
  const me = login.value
  panel.innerHTML =
    '<div class="ac-list">' +
    list
      .map((c) => {
        const mine = c.author === me
        const color = avatarColor(c.author)
        const time = new Date(c.created_at).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
        return (
          '<div class="ac-item" data-id="' + c.id + '">' +
          '<div class="ac-avatar" style="background:' + color + '">' +
          c.author.slice(0, 1).toUpperCase() +
          '</div>' +
          '<div class="ac-body">' +
          '<div class="ac-meta"><span class="ac-author"></span>' +
          (mine ? '<span class="ac-badge-me">我</span>' : '') +
          '<span class="ac-time">' + time + '</span>' +
          '<button type="button" class="ac-del" title="删除评论">删除</button>' +
          '</div>' +
          '<div class="ac-text"></div>' +
          '</div></div>'
        )
      })
      .join('') +
    (list.length === 0 ? '<div class="ac-empty">还没有评论，来说两句吧</div>' : '') +
    '</div>' +
    '<div class="ac-form">' +
    '<textarea class="ac-input" rows="2" placeholder="写下你的评论…（Enter 发送，Shift+Enter 换行）"></textarea>' +
    '<div class="ac-form-bar">' +
    (canWrite
      ? '<span class="ac-hint">以 <b>' + me + '</b> 身份评论</span>'
      : '<span class="ac-hint ac-warn">配置 GitHub Token 后才能发表评论</span>') +
    '<button type="button" class="ac-send" ' +
    (canWrite ? '' : 'disabled') +
    '>发送</button>' +
    '</div></div>'

  // 安全写入用户名和正文（防 XSS）
  panel.querySelectorAll<HTMLElement>('.ac-item').forEach((el, i) => {
    const c = list[i]
    el.querySelector('.ac-author')!.textContent = c.author
    el.querySelector('.ac-text')!.textContent = c.text
    const delBtn = el.querySelector<HTMLButtonElement>('.ac-del')!
    if (c.author === me && canWrite) {
      delBtn.addEventListener('click', () => deleteComment(c.id, anchor))
    } else {
      delBtn.remove()
    }
  })

  const input = panel.querySelector<HTMLTextAreaElement>('.ac-input')!
  const send = panel.querySelector<HTMLButtonElement>('.ac-send')!
  const submit = () => {
    const text = input.value.trim()
    if (!text || !getToken()) {
      if (!getToken()) showConfig.value = true
      return
    }
    addComment(anchor, text)
    renderPanel(panel, anchor)
    const ni = panel.querySelector<HTMLTextAreaElement>('.ac-input')
    ni?.focus()
  }
  send.addEventListener('click', submit)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  })
  input.focus()
}

function addComment(anchor: string, text: string) {
  comments.push({
    id: (crypto.randomUUID?.() || String(Date.now()) + Math.random()),
    anchor,
    text,
    author: login.value || '我',
    created_at: new Date().toISOString()
  })
  refreshBadges()
  schedulePush()
}

function deleteComment(id: string, anchor: string) {
  if (!confirm('确定删除这条评论吗？')) return
  comments = comments.filter((c) => c.id !== id)
  const deleted = getDeleted()
  deleted.add(id)
  saveDeleted(deleted)
  refreshBadges()
  const panel = document.querySelector<HTMLElement>('.ac-panel[data-anchor="' + anchor + '"]')
  if (panel) renderPanel(panel, anchor)
  schedulePush()
}

function renderAll() {
  refreshBadges()
  const panel = document.querySelector<HTMLElement>('.ac-panel')
  if (panel) renderPanel(panel, panel.dataset.anchor!)
}

// ---------- Token 浮条 ----------
function avatarColor(name: string) {
  const colors = ['#4c8bf5', '#34a853', '#fbbc04', '#f25c54', '#9b5de5', '#00b4d8']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return colors[h % colors.length]
}

async function saveToken() {
  const t = tokenInput.value.trim()
  if (!t) return
  localStorage.setItem(TOKEN_KEY, t)
  syncMsg.value = '正在验证 Token…'
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: 'Bearer ' + t,
        Accept: 'application/vnd.github+json'
      }
    })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const u = await r.json()
    login.value = u.login
    localStorage.setItem(USER_KEY, u.login)
    connected.value = true
    showConfig.value = false
    tokenInput.value = ''
    syncMsg.value = ''
    pullComments()
  } catch (e) {
    localStorage.removeItem(TOKEN_KEY)
    syncMsg.value = 'Token 无效：' + (e as Error).message
  }
}

function resetToken() {
  if (!confirm('清除本机保存的 Token？')) return
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  connected.value = false
  login.value = ''
  showConfig.value = true
}

// ---------- 生命周期 ----------
function initPage() {
  document.querySelectorAll('.ac-panel').forEach((p) => p.remove())
  comments = []
  knownSha = null
  enhanceHeadings()
  pullComments()
}

async function fetchLogin(t: string) {
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json' }
    })
    if (r.ok) {
      const u = await r.json()
      login.value = u.login
      localStorage.setItem(USER_KEY, u.login)
      renderAll()
    }
  } catch {
    // 网络问题忽略，发表时作者名退化为「我」
  }
}

onMounted(() => {
  const t = getToken()
  connected.value = !!t
  login.value = localStorage.getItem(USER_KEY) || ''
  if (t && !login.value) fetchLogin(t)
  initPage()

  observer = new MutationObserver(() => enhanceHeadings())
  observer.observe(document.body, { childList: true, subtree: true })
})

watch(
  () => route.path,
  () => initPage()
)

onBeforeUnmount(() => {
  observer?.disconnect()
  if (pushTimer) clearTimeout(pushTimer)
})
</script>

<template>
  <div class="ac-dock">
    <div v-if="syncMsg" class="ac-toast">{{ syncMsg }}</div>
    <div v-if="showConfig" class="ac-config">
      <div class="ac-config-title">配置 GitHub Token</div>
      <div class="ac-config-desc">
        Token 只保存在你本机浏览器，需要对 notes-data 仓库的 Contents 读写权限。
      </div>
      <a
        href="https://github.com/settings/personal-access-tokens/new"
        target="_blank"
        rel="noreferrer"
        class="ac-token-link"
        >去 GitHub 创建 Token ↗</a
      >
      <input
        v-model="tokenInput"
        type="password"
        class="ac-token-input"
        placeholder="粘贴 Token（ghp_ / github_pat_ 开头）"
        @keydown.enter="saveToken"
      />
      <div class="ac-config-actions">
        <button class="ac-btn-primary" @click="saveToken">保存</button>
        <button class="ac-btn-ghost" @click="showConfig = false">取消</button>
      </div>
    </div>
    <button class="ac-dock-btn" @click="connected ? resetToken() : (showConfig = !showConfig)">
      <template v-if="connected">💬 评论已连接 · {{ login }}</template>
      <template v-else>🔑 配置评论 Token</template>
    </button>
  </div>
</template>

<style>
/* ===== 标题上的评论入口 ===== */
.vp-doc .ac-heading {
  position: relative;
}
.vp-doc .ac-toggle {
  display: none;
  align-items: center;
  gap: 3px;
  margin-left: 8px;
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-3);
  border-radius: 6px;
  cursor: pointer;
  vertical-align: middle;
  font-size: 12px;
  line-height: 1;
  transition: color 0.2s, background 0.2s;
}
.vp-doc h2:hover .ac-toggle,
.vp-doc h3:hover .ac-toggle,
.vp-doc .has-comments .ac-toggle {
  display: inline-flex;
}
.vp-doc .ac-toggle:hover {
  background: var(--vp-c-bg-soft-down, rgba(128, 128, 128, 0.12));
  color: var(--vp-c-text-1);
}
.vp-doc .has-comments .ac-toggle {
  color: var(--vp-c-brand-1);
}
.vp-doc .ac-count:not(:empty) {
  font-weight: 600;
}

/* ===== 评论面板（飞书风） ===== */
.ac-panel {
  margin: 6px 0 20px;
  padding: 12px 14px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
}
.ac-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ac-empty {
  font-size: 13px;
  color: var(--vp-c-text-3);
  padding: 2px 0 6px;
}
.ac-item {
  display: flex;
  gap: 10px;
}
.ac-avatar {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ac-body {
  flex: 1;
  min-width: 0;
}
.ac-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ac-author {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.ac-badge-me {
  font-size: 10px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
.ac-time {
  font-size: 11px;
  color: var(--vp-c-text-3);
}
.ac-del {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--vp-c-text-3);
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.ac-item:hover .ac-del {
  opacity: 1;
}
.ac-del:hover {
  color: var(--vp-c-danger-1, #e35d5b);
}
.ac-text {
  margin-top: 2px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--vp-c-text-1);
  white-space: pre-wrap;
  word-break: break-word;
}
.ac-form {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ac-input {
  width: 100%;
  resize: vertical;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.6;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
  transition: border-color 0.2s;
}
.ac-input:focus {
  border-color: var(--vp-c-brand-1);
}
.ac-form-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ac-hint {
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.ac-warn {
  color: var(--vp-c-warning-1, #d98a04);
}
.ac-send {
  padding: 5px 16px;
  font-size: 13px;
  border: none;
  border-radius: 7px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white, #fff);
  cursor: pointer;
  transition: opacity 0.2s;
}
.ac-send:hover {
  opacity: 0.85;
}
.ac-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ===== 右下角 Token 浮条 ===== */
.ac-dock {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.ac-toast {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  box-shadow: var(--vp-shadow-2);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--vp-c-text-2);
  max-width: 300px;
}
.ac-config {
  width: 280px;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  box-shadow: var(--vp-shadow-3);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ac-config-title {
  font-size: 14px;
  font-weight: 600;
}
.ac-config-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}
.ac-token-link {
  font-size: 12px;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.ac-token-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  font-size: 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 7px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  outline: none;
}
.ac-token-input:focus {
  border-color: var(--vp-c-brand-1);
}
.ac-config-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.ac-btn-primary,
.ac-btn-ghost {
  padding: 5px 14px;
  font-size: 12px;
  border-radius: 7px;
  cursor: pointer;
}
.ac-btn-primary {
  border: none;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white, #fff);
}
.ac-btn-ghost {
  border: 1px solid var(--vp-c-divider);
  background: transparent;
  color: var(--vp-c-text-2);
}
.ac-dock-btn {
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-text-1);
  box-shadow: var(--vp-shadow-2);
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.ac-dock-btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--vp-shadow-3);
}
@media (max-width: 640px) {
  .ac-dock {
    right: 12px;
    bottom: 12px;
  }
  .ac-dock-btn {
    font-size: 12px;
    padding: 7px 12px;
  }
}
</style>
