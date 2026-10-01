<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useData } from 'vitepress'

const props = defineProps({
  // 用于区分不同代码块的 localStorage key，同一篇笔记里不能重复
  name: { type: String, required: true }
})

const storageKey = `recall-draft-${props.name}`
const mode = ref('view') // view = 看答案, recall = 默写
const host = ref(null)
const { isDark } = useData()

let view = null
let themeCompartment = null
let cmModules = null

// 动态 import：SSR 构建不触碰 DOM，且只有第一次进默写模式才加载编辑器代码
async function loadModules() {
  if (!cmModules) {
    const [cm, javaMod, darkMod, stateMod, langMod, viewMod] = await Promise.all([
      import('codemirror'),
      import('@codemirror/lang-java'),
      import('@codemirror/theme-one-dark'),
      import('@codemirror/state'),
      import('@codemirror/language'),
      import('@codemirror/view')
    ])
    cmModules = {
      ...cm,
      java: javaMod.java,
      oneDark: darkMod.oneDark,
      Compartment: stateMod.Compartment,
      indentUnit: langMod.indentUnit,
      EditorView: viewMod.EditorView
    }
  }
  return cmModules
}

async function ensureEditor() {
  if (view) return
  const m = await loadModules()
  themeCompartment = new m.Compartment()

  const darkTheme = [m.oneDark]
  const boxTheme = m.EditorView.theme({
    '&': {
      fontSize: '14px',
      lineHeight: '1.7',
      border: '1px solid var(--vp-c-divider)',
      borderRadius: '8px',
      minHeight: '300px',
      overflow: 'hidden'
    },
    '&.cm-focused': {
      outline: 'none',
      borderColor: 'var(--vp-c-brand-1)'
    },
    '.cm-content': {
      fontFamily: 'var(--vp-font-family-mono)',
      padding: '12px 0'
    },
    '.cm-scroller': {
      fontFamily: 'var(--vp-font-family-mono)'
    },
    '.cm-gutters': {
      borderRadius: '8px 0 0 8px'
    }
  })

  view = new m.EditorView({
    parent: host.value,
    doc: localStorage.getItem(storageKey) || '',
    extensions: [
      // basicSetup 已含：行号、括号匹配、括号自动闭合、回车智能缩进、
      // Tab/Shift+Tab 缩进、撤销重做、Ctrl+/ 注释、搜索、代码折叠等
      m.basicSetup,
      m.java(),
      m.indentUnit.of('    '),
      boxTheme,
      themeCompartment.of(isDark.value ? darkTheme : []),
      m.EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          localStorage.setItem(storageKey, update.state.doc.toString())
        }
      })
    ]
  })
}

async function toggle() {
  if (mode.value === 'view') {
    mode.value = 'recall'
    await nextTick()
    await ensureEditor()
    view.focus()
  } else {
    mode.value = 'view'
  }
}

// 只清空当前这个默写框的草稿，不影响其他代码块
function clearDraft() {
  if (!view) return
  if (window.confirm('确定清空当前默写框的草稿吗？（只影响这一段代码）')) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length }
    })
    view.focus()
  }
}

// 跟随 VitePress 的深色模式切换编辑器配色
watch(isDark, async (dark) => {
  if (!view) return
  const m = await loadModules()
  view.dispatch({
    effects: themeCompartment.reconfigure(dark ? [m.oneDark] : [])
  })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
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
        {{ mode === 'view' ? '可写一半随时切回查看，草稿自动保留' : '支持自动缩进、括号补全、Tab 缩进、Ctrl+/ 注释' }}
      </span>
    </div>

    <div v-show="mode === 'view'" class="recall-answer">
      <slot />
    </div>

    <div v-show="mode === 'recall'" ref="host" class="recall-host"></div>
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
.recall-host {
  /* CodeMirror 自身管理尺寸，这里只控制宽度 */
  width: 100%;
}
.recall-host :deep(.cm-editor) {
  text-align: left;
}
</style>
