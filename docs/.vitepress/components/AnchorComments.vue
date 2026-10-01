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
  quote?: string // 划词评论时选中的原文
  parent_id?: string // 被回复的评论 id；空表示顶层评论
}

const GH_OWNER = 'yzq-zz'
const GH_REPO = 'notes-data'
const TOKEN_KEY = 'gh_sync_token'
const USER_KEY = 'gh_user_login'
const DELETED_KEY = 'gh_comment_deleted_ids'

const route = useRoute()

let comments: Comment[] = []
let knownSha: string | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null
let pullSeq = 0

// ---------- 浮条（Token 配置）的响应式状态 ----------
const connected = ref(false)
const login = ref('')
const syncMsg = ref('')
const showConfig = ref(false)
const tokenInput = ref('')

// ---------- 划词后浮出的「评论」小按钮 ----------
const selPop = ref({ visible: false, x: 0, y: 0, quote: '', anchor: '' })

// 选区不允许出现在这些元素内（编辑器、评论面板自身、浮条等）
const SEL_BLOCKED =
  '.cm-editor, .cm-content, textarea, input, .ac-panel, .ac-toggle, .ac-selpop, .ac-dock, .ac-config, .ac-summary'

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

function closePanel() {
  document.querySelectorAll('.ac-panel').forEach((p) => p.remove())
}

function openPanel(anchor: string, quote?: string) {
  const h = document.getElementById(anchor)
  if (!h) return
  closePanel()
  const panel = document.createElement('div')
  panel.className = 'ac-panel'
  panel.dataset.anchor = anchor
  if (quote) panel.dataset.pendingQuote = quote
  h.after(panel)
  renderPanel(panel, anchor)
  if (quote) h.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function togglePanel(h: HTMLElement) {
  const existing = h.nextElementSibling as HTMLElement | null
  if (existing && existing.classList.contains('ac-panel')) {
    existing.remove()
    return
  }
  openPanel(h.id)
}

// 找一个 DOM 节点归属的最近标题锚点（选区落在哪个章节）
function anchorOfNode(node: Node | null): string | null {
  if (!node) return null
  const headings = [...document.querySelectorAll<HTMLElement>('.vp-doc h2[id], .vp-doc h3[id]')]
  let found: string | null = null
  for (const h of headings) {
    if (h === node || h.contains(node)) return h.id
    if (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) found = h.id
  }
  return found
}

// ---------- 划词评论 ----------
let selCheckTimer: ReturnType<typeof setTimeout> | null = null

function hideSelPop() {
  selPop.value.visible = false
}

// 核心检测：读当前选区，决定是否显示浮动按钮
function checkSelection() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    hideSelPop()
    return
  }
  const text = sel.toString().trim()
  if (text.length < 2) {
    hideSelPop()
    return
  }
  const node = sel.anchorNode
  const el = node instanceof Element ? node : node?.parentElement
  if (!el || !el.closest('.vp-doc') || el.closest(SEL_BLOCKED)) {
    hideSelPop()
    return
  }
  const anchor = anchorOfNode(sel.getRangeAt(0).startContainer)
  if (!anchor) {
    hideSelPop()
    return
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    hideSelPop()
    return
  }
  const x = Math.min(Math.max(rect.left + rect.width / 2 - 44, 8), window.innerWidth - 100)
  const y = rect.top < 52 ? rect.bottom + 8 : rect.top - 38
  selPop.value = { visible: true, x, y, quote: text, anchor }
}

// selectionchange 在拖选/键盘选词时高频触发，防抖到选择停顿后再弹
function scheduleSelCheck() {
  if (selCheckTimer) clearTimeout(selCheckTimer)
  selCheckTimer = setTimeout(checkSelection, 80)
}

function onSelectionEnd() {
  // 鼠标/触摸松手：立即检测一次（不等防抖）
  if (selCheckTimer) clearTimeout(selCheckTimer)
  selCheckTimer = setTimeout(checkSelection, 10)
}

function onSelPopClick() {
  const { quote, anchor } = selPop.value
  hideSelPop()
  window.getSelection()?.removeAllRanges()
  if (!quote || !anchor) return
  openPanel(anchor, quote)
}

// 点击面板外部 / Esc → 关闭面板与划词按钮
function onDocPointerDown(e: PointerEvent) {
  const t = e.target as HTMLElement | null
  if (
    t &&
    (t.closest('.ac-panel') ||
      t.closest('.ac-toggle') ||
      t.closest('.ac-selpop') ||
      t.closest('.ac-dock'))
  ) {
    return
  }
  closePanel()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
    t.blur()
    return
  }
  hideSelPop()
  closePanel()
}

function renderPanel(panel: HTMLElement, anchor: string) {
  const list = commentsOf(anchor)
  const canWrite = !!getToken()
  const me = login.value
  const pendingQuote = panel.dataset.pendingQuote || ''
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
          (c.quote ? '<div class="ac-quote" title="点击定位原文"></div>' : '') +
          '<div class="ac-text"></div>' +
          '</div></div>'
        )
      })
      .join('') +
    (list.length === 0 ? '<div class="ac-empty">还没有评论，来说两句吧</div>' : '') +
    '</div>' +
    '<div class="ac-form">' +
    (pendingQuote
      ? '<div class="ac-pending"><span class="ac-pending-text"></span>' +
        '<button type="button" class="ac-pending-x" title="取消引用原文">×</button></div>'
      : '') +
    '<textarea class="ac-input" rows="2" placeholder="' +
    (pendingQuote
      ? '针对选中的原文写评论…（Enter 发送，Shift+Enter 换行）'
      : '写下你的评论…（Enter 发送，Shift+Enter 换行）') +
    '"></textarea>' +
    '<div class="ac-form-bar">' +
    (canWrite
      ? '<span class="ac-hint">以 <b>' + me + '</b> 身份评论</span>'
      : '<span class="ac-hint ac-warn">配置 GitHub Token 后才能发表评论</span>') +
    '<button type="button" class="ac-send" ' +
    (canWrite ? '' : 'disabled') +
    '>发送</button>' +
    '</div></div>'

  // 安全写入用户名、正文、引用（防 XSS）
  panel.querySelectorAll<HTMLElement>('.ac-item').forEach((el, i) => {
    const c = list[i]
    el.querySelector('.ac-author')!.textContent = c.author
    el.querySelector('.ac-text')!.textContent = c.text
    if (c.quote) {
      const q = el.querySelector<HTMLElement>('.ac-quote')!
      q.textContent = '「' + c.quote + '」'
      q.addEventListener('click', () => {
        const mark = document.querySelector<HTMLElement>('mark.ac-quote-mark[data-cid="' + c.id + '"]')
        if (mark) {
          closePanel()
          mark.scrollIntoView({ block: 'center', behavior: 'smooth' })
          mark.classList.add('ac-flash')
          setTimeout(() => mark.classList.remove('ac-flash'), 1600)
        }
      })
    }
    const delBtn = el.querySelector<HTMLButtonElement>('.ac-del')!
    if (c.author === me && canWrite) {
      delBtn.addEventListener('click', () => deleteComment(c.id))
    } else {
      delBtn.remove()
    }
  })

  if (pendingQuote) {
    panel.querySelector<HTMLElement>('.ac-pending-text')!.textContent = '「' + pendingQuote + '」'
    panel.querySelector<HTMLButtonElement>('.ac-pending-x')!.addEventListener('click', () => {
      delete panel.dataset.pendingQuote
      renderPanel(panel, anchor)
    })
  }

  const input = panel.querySelector<HTMLTextAreaElement>('.ac-input')!
  const send = panel.querySelector<HTMLButtonElement>('.ac-send')!
  const submit = () => {
    const text = input.value.trim()
    if (!text || !getToken()) {
      if (!getToken()) showConfig.value = true
      return
    }
    const quote = panel.dataset.pendingQuote || undefined
    delete panel.dataset.pendingQuote
    addComment(anchor, text, quote)
    const np = document.querySelector<HTMLElement>('.ac-panel[data-anchor="' + anchor + '"]')
    np?.querySelector<HTMLTextAreaElement>('.ac-input')?.focus()
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

function addComment(anchor: string, text: string, quote?: string, parent_id?: string) {
  comments.push({
    id: (crypto.randomUUID?.() || String(Date.now()) + Math.random()),
    anchor,
    text,
    author: login.value || '我',
    created_at: new Date().toISOString(),
    quote,
    parent_id
  })
  schedulePush()
  renderAll()
}

function newId() {
  return crypto.randomUUID?.() || String(Date.now()) + Math.random()
}

function deleteComment(id: string) {
  // 收集要删的 id 集合：目标 + 它的所有后代回复
  const toDelete = new Set<string>()
  const queue = [id]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (toDelete.has(cur)) continue
    toDelete.add(cur)
    for (const c of comments) if (c.parent_id === cur) queue.push(c.id)
  }
  const hasReply = toDelete.size > 1
  if (!confirm(hasReply ? '确定删除这条评论及其 ' + (toDelete.size - 1) + ' 条回复吗？' : '确定删除这条评论吗？')) return
  comments = comments.filter((c) => !toDelete.has(c.id))
  const deleted = getDeleted()
  for (const d of toDelete) deleted.add(d)
  saveDeleted(deleted)
  schedulePush()
  renderAll()
}

function renderAll() {
  refreshBadges()
  applyHighlights()
  renderSummaries()
  const panel = document.querySelector<HTMLElement>('.ac-panel')
  if (panel) renderPanel(panel, panel.dataset.anchor!)
}

// ---------- 划词评论的原文高亮（尽力而为，找不到就降级为只在面板显示引用） ----------
function clearHighlights() {
  document.querySelectorAll<HTMLElement>('mark.ac-quote-mark').forEach((m) => {
    const parent = m.parentNode
    if (parent) {
      parent.replaceChild(document.createTextNode(m.textContent || ''), m)
      parent.normalize()
    }
  })
}

function wrapQuoteInNode(node: Text, quote: string, c: Comment): boolean {
  const idx = node.data.indexOf(quote)
  if (idx < 0) return false
  try {
    const range = document.createRange()
    range.setStart(node, idx)
    range.setEnd(node, idx + quote.length)
    const mark = document.createElement('mark')
    mark.className = 'ac-quote-mark'
    mark.dataset.cid = c.id
    mark.title = '点击查看评论'
    range.surroundContents(mark)
    mark.addEventListener('click', (e) => {
      e.stopPropagation()
      openPanel(c.anchor)
      mark.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return true
  } catch {
    return false // 选区跨越了标签边界，第一版不处理
  }
}

function applyHighlights() {
  clearHighlights()
  const quoted = comments.filter((c) => c.quote && c.quote.length >= 2)
  if (quoted.length === 0) return
  for (const c of quoted) {
    const h = document.getElementById(c.anchor)
    if (!h) continue
    // 作用域：标题之后，到下一个 h2/h3 之前
    const scopeEls: Element[] = []
    let sib: Element | null = h.nextElementSibling
    while (sib && !(sib.tagName === 'H2' || sib.tagName === 'H3')) {
      scopeEls.push(sib)
      sib = sib.nextElementSibling
    }
    outer: for (const scope of scopeEls) {
      if (scope.closest(SEL_BLOCKED)) continue
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const p = n.parentElement
          if (!p) return NodeFilter.FILTER_REJECT
          const tag = p.tagName
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') {
            return NodeFilter.FILTER_REJECT
          }
          if (p.closest('.ac-panel, .ac-toggle, .ac-selpop, .cm-editor, mark.ac-quote-mark')) {
            return NodeFilter.FILTER_REJECT
          }
          return NodeFilter.FILTER_ACCEPT
        }
      })
      const targets: Text[] = []
      let cur = walker.nextNode()
      while (cur) {
        targets.push(cur as Text)
        cur = walker.nextNode()
      }
      for (const t of targets) {
        if (wrapQuoteInNode(t, c.quote!, c)) break outer
      }
    }
  }
}

// ---------- 章节末尾评论汇总 ----------
function clearSummaries() {
  document.querySelectorAll<HTMLElement>('.ac-summary').forEach((el) => el.remove())
}

function buildSummaryEl(h: HTMLElement) {
  const box = document.createElement('div')
  box.className = 'ac-summary'
  box.dataset.anchor = h.id
  renderSummary(box, h.id)
  return box
}

function placeSummary(h: HTMLElement) {
  // 找到该章节最后一个段落/兄弟，作为锚点
  let last: Element = h
  let sib: Element | null = h.nextElementSibling
  while (sib && sib.tagName !== 'H2' && sib.tagName !== 'H3') {
    last = sib
    sib = sib.nextElementSibling
  }
  last.after(buildSummaryEl(h))
}

function timeText(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 渲染单条评论的 HTML 片段（含回复列表 + 回复输入框）
function renderCommentItem(c: Comment, isReply = false): string {
  const mine = c.author === login.value
  const color = avatarColor(c.author)
  const time = timeText(c.created_at)
  return (
    '<div class="ac-item' + (isReply ? ' ac-reply' : '') + '" data-id="' + c.id + '">' +
    '<div class="ac-avatar" style="background:' + color + '">' +
    c.author.slice(0, 1).toUpperCase() +
    '</div>' +
    '<div class="ac-body">' +
    '<div class="ac-meta">' +
    '<span class="ac-author"></span>' +
    (mine ? '<span class="ac-badge-me">我</span>' : '') +
    '<span class="ac-time">' + time + '</span>' +
    (isReply ? '' : '<button type="button" class="ac-reply-btn" title="回复">回复</button>') +
    (canDelete(c) ? '<button type="button" class="ac-del" title="删除评论">删除</button>' : '') +
    '</div>' +
    (c.quote ? '<div class="ac-quote" title="点击定位原文"></div>' : '') +
    '<div class="ac-text"></div>' +
    '<div class="ac-reply-list"></div>' +
    '<div class="ac-reply-form" hidden>' +
    '<textarea class="ac-input ac-input-mini" rows="1" placeholder="回复 ' + escapeHtml(c.author) + '…（Enter 发送，Esc 取消）"></textarea>' +
    '<div class="ac-reply-form-bar">' +
    '<button type="button" class="ac-reply-cancel">取消</button>' +
    '<button type="button" class="ac-reply-send"' + (getToken() ? '' : ' disabled') + '>发送</button>' +
    '</div></div>' +
    '</div></div>'
  )
}

function escapeHtml(s: string) {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }
  return s.replace(/[&<>"']/g, (ch) => map[ch])
}

function canDelete(c: Comment) {
  return c.author === login.value && !!getToken()
}

function renderSummary(box: HTMLElement, anchor: string) {
  const list = commentsOf(anchor)
  const tops = list.filter((c) => !c.parent_id)
  const repliesOf = (pid: string) => list.filter((c) => c.parent_id === pid)
  const totalReplies = list.length - tops.length
  const me = login.value
  const canWrite = !!getToken()

  box.innerHTML =
    '<div class="ac-summary-head" role="button" tabindex="0">' +
    '<span class="ac-summary-toggle">▸</span>' +
    '<span class="ac-summary-title">💬 本章评论</span>' +
    '<span class="ac-summary-count">' +
    (tops.length === 0
      ? '还没有评论'
      : tops.length + ' 条' + (totalReplies > 0 ? ' · ' + totalReplies + ' 条回复' : '')) +
    '</span>' +
    '</div>' +
    '<div class="ac-summary-list" hidden>' +
    (tops.length === 0
      ? '<div class="ac-empty">在下方说两句，或者选中正文任意段落划词评论</div>'
      : '<div class="ac-list">' +
        tops.map((c) => renderCommentItem(c)).join('') +
        '</div>') +
    '</div>' +
    '<div class="ac-form">' +
    '<textarea class="ac-input" rows="2" placeholder="写下你的评论…（Enter 发送，Shift+Enter 换行）"></textarea>' +
    '<div class="ac-form-bar">' +
    (canWrite
      ? '<span class="ac-hint">以 <b>' + me + '</b> 身份评论</span>'
      : '<span class="ac-hint ac-warn">配置 GitHub Token 后才能发表评论</span>') +
    '<button type="button" class="ac-send"' +
    (canWrite ? '' : ' disabled') +
    '>发送</button>' +
    '</div></div>'

  // 安全填字段
  box.querySelectorAll<HTMLElement>('.ac-item').forEach((el) => {
    const id = el.dataset.id!
    const c = list.find((x) => x.id === id)
    if (!c) return
    el.querySelector('.ac-author')!.textContent = c.author
    el.querySelector('.ac-text')!.textContent = c.text
    if (c.quote) {
      const q = el.querySelector<HTMLElement>('.ac-quote')!
      q.textContent = '「' + c.quote + '」'
      q.addEventListener('click', () => {
        const mark = document.querySelector<HTMLElement>('mark.ac-quote-mark[data-cid="' + c.id + '"]')
        if (mark) {
          mark.scrollIntoView({ block: 'center', behavior: 'smooth' })
          mark.classList.add('ac-flash')
          setTimeout(() => mark.classList.remove('ac-flash'), 1600)
        }
      })
    }
    // 回复列表
    const repList = el.querySelector<HTMLElement>('.ac-reply-list')!
    const reps = repliesOf(id)
    if (reps.length > 0) {
      repList.innerHTML = reps.map((r) => renderCommentItem(r, true)).join('')
      repList.querySelectorAll<HTMLElement>('.ac-reply').forEach((repEl) => {
        const rid = repEl.dataset.id!
        const rc = reps.find((x) => x.id === rid)!
        repEl.querySelector('.ac-author')!.textContent = rc.author
        repEl.querySelector('.ac-text')!.textContent = rc.text
      })
    }
    // 删除按钮
    const delBtn = el.querySelector<HTMLButtonElement>('.ac-del')
    if (delBtn) delBtn.addEventListener('click', () => deleteComment(c.id))
    // 回复按钮
    const replyBtn = el.querySelector<HTMLButtonElement>('.ac-reply-btn')
    const replyForm = el.querySelector<HTMLElement>('.ac-reply-form')
    if (replyBtn && replyForm) {
      replyBtn.addEventListener('click', () => {
        replyForm.hidden = false
        const ta = replyForm.querySelector<HTMLTextAreaElement>('.ac-input-mini')!
        ta.focus()
      })
      const cancel = replyForm.querySelector<HTMLButtonElement>('.ac-reply-cancel')!
      const sendR = replyForm.querySelector<HTMLButtonElement>('.ac-reply-send')!
      const ta = replyForm.querySelector<HTMLTextAreaElement>('.ac-input-mini')!
      cancel.addEventListener('click', () => {
        replyForm.hidden = true
        ta.value = ''
      })
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          cancel.click()
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          sendR.click()
        }
      })
      sendR.addEventListener('click', () => {
        const t = ta.value.trim()
        if (!t) return
        if (!getToken()) {
          showConfig.value = true
          return
        }
        addComment(anchor, t, undefined, c.id)
        ta.value = ''
        replyForm.hidden = true
      })
    }
  })

  // 顶部发评论输入框
  const input = box.querySelector<HTMLTextAreaElement>('.ac-input:not(.ac-input-mini)')!
  const send = box.querySelector<HTMLButtonElement>('.ac-send')!
  const submit = () => {
    const text = input.value.trim()
    if (!text) return
    if (!getToken()) {
      showConfig.value = true
      return
    }
    addComment(anchor, text)
    input.value = ''
    input.focus()
  }
  send.addEventListener('click', submit)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  })

  // 折叠/展开评论列表（输入框始终展开）
  const head = box.querySelector<HTMLElement>('.ac-summary-head')!
  const listBox = box.querySelector<HTMLElement>('.ac-summary-list')!
  const toggle = box.querySelector<HTMLElement>('.ac-summary-toggle')!
  const toggleExpand = () => {
    const expanded = !listBox.hidden
    listBox.hidden = expanded
    toggle.textContent = expanded ? '▸' : '▾'
    head.setAttribute('aria-expanded', String(!expanded))
  }
  head.addEventListener('click', toggleExpand)
  head.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleExpand()
    }
  })
}

function renderSummaries() {
  clearSummaries()
  document
    .querySelectorAll<HTMLElement>('.vp-doc h2[id], .vp-doc h3[id]')
    .forEach((h) => {
      const list = commentsOf(h.id)
      if (list.length === 0) return // 没评论就不渲染，避免无谓占位
      placeSummary(h)
    })
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
  hideSelPop()
  closePanel()
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

  document.addEventListener('mouseup', onSelectionEnd)
  document.addEventListener('touchend', onSelectionEnd)
  document.addEventListener('selectionchange', scheduleSelCheck)
  window.addEventListener('scroll', hideSelPop, { passive: true, capture: true })
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('keydown', onKeyDown)
})

watch(
  () => route.path,
  () => initPage()
)

onBeforeUnmount(() => {
  if (pushTimer) clearTimeout(pushTimer)
  if (selCheckTimer) clearTimeout(selCheckTimer)
  document.removeEventListener('mouseup', onSelectionEnd)
  document.removeEventListener('touchend', onSelectionEnd)
  document.removeEventListener('selectionchange', scheduleSelCheck)
  window.removeEventListener('scroll', hideSelPop, { capture: true } as EventListenerOptions)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <button
    v-show="selPop.visible"
    type="button"
    class="ac-selpop"
    :style="{ top: selPop.y + 'px', left: selPop.x + 'px' }"
    @mousedown.prevent
    @click="onSelPopClick"
  >
    💬 评论
  </button>
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

/* ===== 划词后浮出的评论按钮 ===== */
.ac-selpop {
  position: fixed;
  z-index: 200;
  transform: translateX(-50%);
  padding: 5px 12px;
  font-size: 12px;
  line-height: 1;
  color: #fff;
  background: #1f2329;
  border: none;
  border-radius: 999px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  animation: ac-pop-in 0.12s ease-out;
}
.ac-selpop:hover {
  background: var(--vp-c-brand-1);
}
@keyframes ac-pop-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

/* ===== 评论里的原文引用条 ===== */
.ac-quote {
  margin-top: 5px;
  padding: 3px 9px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft-down, rgba(128, 128, 128, 0.1));
  border-left: 3px solid var(--vp-c-divider);
  border-radius: 0 5px 5px 0;
  cursor: pointer;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  transition: color 0.15s, border-color 0.15s;
}
.ac-quote:hover {
  color: var(--vp-c-brand-1);
  border-left-color: var(--vp-c-brand-1);
}

/* ===== 待发表的引用条 ===== */
.ac-pending {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 9px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border-radius: 7px;
}
.ac-pending-text {
  flex: 1;
  word-break: break-word;
}
.ac-pending-x {
  flex: none;
  border: none;
  background: transparent;
  color: var(--vp-c-text-3);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.ac-pending-x:hover {
  color: var(--vp-c-text-1);
}

/* ===== 章节末尾评论汇总 ===== */
.vp-doc .ac-summary {
  margin: 20px 0 28px;
  padding: 14px 16px 12px;
  background: var(--vp-c-bg-soft);
  border: 1px dashed var(--vp-c-divider);
  border-radius: 10px;
}
.vp-doc .ac-summary-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -4px 0 10px;
  padding: 4px 0;
  cursor: pointer;
  user-select: none;
  border-radius: 6px;
}
.vp-doc .ac-summary-head:hover {
  color: var(--vp-c-brand-1);
}
.vp-doc .ac-summary-head:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
.vp-doc .ac-summary-toggle {
  font-size: 12px;
  color: var(--vp-c-text-3);
  transition: transform 0.15s;
  width: 12px;
  display: inline-block;
  text-align: center;
}
.vp-doc .ac-summary-list[hidden] {
  display: none;
}
.vp-doc .ac-summary-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.vp-doc .ac-summary-count {
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.vp-doc .ac-summary .ac-list {
  margin-bottom: 10px;
}
.vp-doc .ac-summary .ac-item {
  padding: 6px 0;
}
.vp-doc .ac-summary .ac-reply {
  margin-top: 6px;
  margin-left: 38px;
  padding-left: 10px;
  border-left: 2px solid var(--vp-c-divider);
}
.vp-doc .ac-summary .ac-reply .ac-avatar {
  width: 22px;
  height: 22px;
  font-size: 11px;
}
.vp-doc .ac-summary .ac-reply .ac-text {
  font-size: 13px;
  line-height: 1.6;
}
.vp-doc .ac-summary .ac-reply .ac-meta {
  font-size: 12px;
}
.vp-doc .ac-reply-btn {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--vp-c-text-3);
  font-size: 12px;
  cursor: pointer;
  padding: 0 4px;
}
.vp-doc .ac-reply-btn:hover {
  color: var(--vp-c-brand-1);
}
.vp-doc .ac-reply-form {
  margin-top: 6px;
  margin-left: 38px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.vp-doc .ac-reply-form[hidden] {
  display: none;
}
.vp-doc .ac-input-mini {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 6px 9px;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid var(--vp-c-divider);
  border-radius: 7px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  outline: none;
  font-family: inherit;
}
.vp-doc .ac-input-mini:focus {
  border-color: var(--vp-c-brand-1);
}
.vp-doc .ac-reply-form-bar {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.vp-doc .ac-reply-cancel,
.vp-doc .ac-reply-send {
  padding: 3px 12px;
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--vp-c-divider);
  background: transparent;
  color: var(--vp-c-text-2);
}
.vp-doc .ac-reply-send {
  border: none;
  background: var(--vp-c-brand-1);
  color: #fff;
}
.vp-doc .ac-reply-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ===== 正文里被评论文字的高亮 ===== */
.vp-doc mark.ac-quote-mark {
  background: color-mix(in srgb, var(--vp-c-brand-1) 22%, transparent);
  color: inherit;
  border-radius: 3px;
  padding: 0 2px;
  cursor: pointer;
  transition: background 0.2s;
}
.vp-doc mark.ac-quote-mark:hover {
  background: color-mix(in srgb, var(--vp-c-brand-1) 38%, transparent);
}
.vp-doc mark.ac-quote-mark.ac-flash {
  background: color-mix(in srgb, var(--vp-c-warning-1, #d98a04) 45%, transparent);
}
</style>
