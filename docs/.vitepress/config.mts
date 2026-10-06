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
        text: '操作系统',
        collapsed: false,
        items: [
          { text: '进程 vs 线程', link: '/os/process-vs-thread' }
        ]
      },
      {
        text: 'Agent知识',
        collapsed: false,
        items: [
          { text: 'CLI / MCP 的区别与 Bash 基础', link: '/agent/cli-vs-mcp' }
        ]
      },
      {
        text: 'Agent项目',
        collapsed: false,
        items: [
          { text: '4. 上下文管理策略', link: '/context-management-strategy' },
          { text: '11. 商品搜索工具：生产级检索链路', link: '/agent-project/product-search' },
          { text: '13. CategoryInsight工具：品类知识RAG', link: '/agent-project/category-insight' }
        ]
      }
      // 后续新增笔记分类，在这里加
    ],
    outline: [2, 3]
  }
})
