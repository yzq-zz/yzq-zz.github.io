import { defineConfig } from 'vitepress'

// 注意：如果仓库名不是 <用户名>.github.io，需要把 base 改为 '/<仓库名>/'
export default defineConfig({
  lang: 'zh-CN',
  title: '学习笔记',
  description: 'Java 后端秋招学习笔记',
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]],
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '并发编程练习题', link: '/exercises/concurrency.html' }
    ],
    sidebar: [
      {
        text: 'Java知识',
        collapsed: false,
        items: [
          { text: '并发编程练习题', link: '/exercises/concurrency.html' },
          { text: '单例模式', link: '/java/singleton' }
        ]
      },
      {
        text: 'Agent知识',
        collapsed: false,
        items: [
          { text: 'CLI / MCP 的区别与 Bash 基础', link: '/agent/cli-vs-mcp' }
        ]
      }
      // 后续新增笔记分类，在这里加
    ],
    outline: [2, 3]
  }
})
