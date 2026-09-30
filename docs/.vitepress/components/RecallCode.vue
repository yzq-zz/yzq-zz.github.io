<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'

const props = defineProps({
  // 用于区分不同代码块的 localStorage key，同一篇笔记里不能重复
  name: { type: String, required: true }
})

const storageKey = `recall-draft-${props.name}`
const mode = ref('view') // view = 看答案, recall = 默写
const draft = ref('')
const result = ref(null)
const answerEl = ref(null)

onMounted(() => {
  draft.value = localStorage.getItem(storageKey) || ''
})

// 草稿实时存浏览器本地，切答案/刷新/离开页面都不丢
watch(draft, (v) => {
  localStorage.setItem(storageKey, v)
})

function toggle() {
  mode.value = mode.value === 'view' ? 'recall' : 'view'
}

function check() {
  const pre = answerEl.value?.querySelector('pre')
  const answer = (pre?.textContent || '').replace(/\r\n/g, '\n')
  const expected = answer.split('\n').map(s => s.trim()).filter(Boolean)
  const actual = draft.value.replace(/\r\n/g, '\n').split('\n').map(s => s.trim()).filter(Boolean)
  const diffs = []
  const len = Math.max(expected.length, actual.length)
  for (let i = 0; i < len; i++) {
    if (expected[i] !== actual[i]) {
      diffs.push({
        idx: i + 1,
        expected: expected[i] || '（少了这一行）',
        actual: actual[i] || '（多了这一行）'
      })
    }
  }
  result.value = { total: expected.length, ok: diffs.length === 0, diffs }
}

function clearDraft() {
  if (window.confirm('确定清空这篇代码的默写草稿吗？')) {
    draft.value = ''
    result.value = null
    localStorage.removeItem(storageKey)
  }
}

// 支持 Tab 缩进
async function onKeydown(e) {
  if (e.key !== 'Tab') return
  e.preventDefault()
  const el = e.target
  const start = el.selectionStart
  const end = el.selectionEnd
  draft.value = draft.value.slice(0, start) + '    ' + draft.value.slice(end)
  await nextTick()
  el.selectionStart = el.selectionEnd = start + 4
}
</script>

<template>
  <div class="recall-code">
    <div class="recall-toolbar">
      <button class="recall-btn" @click="toggle">
        {{ mode === 'view' ? '默写模式' : '查看答案' }}
      </button>
      <template v-if="mode === 'recall'">
        <button class="recall-btn" @click="check">对答案</button>
        <button class="recall-btn recall-danger" @click="clearDraft">清空</button>
      </template>
      <span class="recall-hint">
        {{ mode === 'view' ? '可写一半随时切回查看，草稿自动保留' : '草稿存在浏览器本地，刷新不丢' }}
      </span>
    </div>

    <div v-show="mode === 'view'" ref="answerEl" class="recall-answer">
      <slot />
    </div>

    <div v-show="mode === 'recall'">
      <textarea
        v-model="draft"
        class="recall-textarea"
        spellcheck="false"
        placeholder="在这里默写代码，Tab 可缩进…"
        @keydown="onKeydown"
      ></textarea>
      <div v-if="result" class="recall-result">
        <p v-if="result.ok" class="recall-ok">
          共 {{ result.total }} 行，全部一致，记住了！
        </p>
        <template v-else>
          <p class="recall-bad">
            共 {{ result.total }} 行，有 {{ result.diffs.length }} 行不一致（按去掉空行、忽略首尾空格对比）：
          </p>
          <ol>
            <li v-for="d in result.diffs" :key="d.idx">
              <b>第 {{ d.idx }} 行</b>
              <div class="recall-line recall-exp">答案：{{ d.expected }}</div>
              <div class="recall-line recall-act">你的：{{ d.actual }}</div>
            </li>
          </ol>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.recall-code {
  margin: 16px 0;
}
.recall-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.recall-btn {
  padding: 2px 14px;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 999px;
  background: transparent;
  color: var(--vp-c-brand-1);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
}
.recall-btn:hover {
  background: var(--vp-c-brand-soft);
}
.recall-danger {
  border-color: var(--vp-c-danger-1);
  color: var(--vp-c-danger-1);
}
.recall-danger:hover {
  background: var(--vp-c-danger-soft);
}
.recall-hint {
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.recall-textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 280px;
  padding: 16px;
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  line-height: 1.7;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-alt);
  border: 1px dashed var(--vp-c-divider);
  border-radius: 8px;
  resize: vertical;
  tab-size: 4;
  outline: none;
}
.recall-textarea:focus {
  border-color: var(--vp-c-brand-1);
}
.recall-result {
  margin-top: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  font-size: 13px;
}
.recall-ok {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.recall-bad {
  color: var(--vp-c-danger-1);
  font-weight: 600;
}
.recall-result ol {
  padding-left: 20px;
  margin: 8px 0 0;
}
.recall-line {
  font-family: var(--vp-font-family-mono);
  white-space: pre-wrap;
  word-break: break-all;
  padding: 2px 8px;
  border-radius: 4px;
}
.recall-exp {
  background: var(--vp-c-danger-soft);
  color: var(--vp-c-danger-1);
}
.recall-act {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  margin-bottom: 6px;
}
</style>
