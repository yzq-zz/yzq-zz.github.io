<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'

// 增强右侧「本页目录」：问题（h2）常显，子要点（h3）默认折叠，可点击箭头开合
// VitePress 原生大纲没有折叠能力，这里通过 DOM 增强实现（结构幂等，路由切换后自动重建）

let observer: MutationObserver | null = null

const CHEVRON_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
  '<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>'

function enhance(aside: HTMLElement) {
  // VitePress 1.6 大纲结构：ul.VPDocOutlineItem.root > li（问题）> ul.VPDocOutlineItem.nested（子要点）
  const topItems = aside.querySelectorAll<HTMLElement>(
    'ul.VPDocOutlineItem.root > li'
  )

  topItems.forEach((item) => {
    const childList = item.querySelector(':scope > ul.VPDocOutlineItem')
    if (!childList) return

    if (!item.classList.contains('is-collapsible')) {
      item.classList.add('is-collapsible', 'is-collapsed')

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'outline-toggle'
      btn.setAttribute('aria-label', '展开小节')
      btn.setAttribute('aria-expanded', 'false')
      btn.innerHTML = CHEVRON_SVG
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const collapsed = item.classList.toggle('is-collapsed')
        btn.setAttribute('aria-expanded', String(!collapsed))
        btn.setAttribute('aria-label', collapsed ? '展开小节' : '收起小节')
        // 用户手动开合后以用户为准，自动展开逻辑不再覆盖；路由切换 DOM 重建后自然复位
        item.dataset.manual = '1'
      })
      item.appendChild(btn)
    }

    // 当前滚动位置所在的子要点被高亮时，自动展开它所属的问题（用户未手动干预时）
    if (!item.dataset.manual) {
      const hasActiveChild = !!item.querySelector(
        ':scope > ul a.outline-link.active'
      )
      item.classList.toggle('is-collapsed', !hasActiveChild)
    }
  })
}

function sync() {
  // 注意：.VPDocAsideOutline 本身就是 <nav>，大纲内容就绪的标志是内部出现 root 列表
  const aside = document.querySelector<HTMLElement>('.VPDocAsideOutline')
  if (aside && aside.querySelector('ul.VPDocOutlineItem.root')) enhance(aside)
}

onMounted(() => {
  // 生产环境 hydration 时大纲数据（lean.js）可能晚于本组件到达，
  // 直接依赖 MutationObserver 即可——它的回调本身就是微任务批处理，无需再用 rAF 合流
  sync()
  observer = new MutationObserver(sync)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  })
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <span hidden />
</template>
