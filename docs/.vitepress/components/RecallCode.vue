<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'

const props = defineProps({
  // 用于区分不同代码块的 localStorage key，同一篇笔记里不能重复
  name: { type: String, required: true }
})

const storageKey = `recall-draft-${props.name}`
const mode = ref('view') // view = 看答案, recall = 默写
const draft = ref('')

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

// 只清空当前这个默写框的草稿，不影响其他代码块
function clearDraft() {
  if (window.confirm('确定清空当前默写框的草稿吗？（只影响这一段代码）')) {
    draft.value = ''
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
      <button v-if="mode === 'recall'" class="recall-btn recall-danger" @click="clearDraft">
        清空
      </button>
      <span class="recall-hint">
        {{ mode === 'view' ? '可写一半随时切回查看，草稿自动保留' : '草稿存在浏览器本地，刷新不丢' }}
      </span>
    </div>

    <div v-show="mode === 'view'" class="recall-answer">
      <slot />
    </div>

    <textarea
      v-show="mode === 'recall'"
      v-model="draft"
      class="recall-textarea"
      spellcheck="false"
      placeholder="在这里默写代码，Tab 可缩进…"
      @keydown="onKeydown"
    ></textarea>
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
</style>
