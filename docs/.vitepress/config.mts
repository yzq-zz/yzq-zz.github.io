import { defineConfig } from 'vitepress'

// 注意：如果仓库名不是 <用户名>.github.io，需要把 base 改为 '/<仓库名>/'
export default defineConfig({
  lang: 'zh-CN',
  title: '学习笔记',
  description: 'Java 后端秋招学习笔记',
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '并发编程练习题', link: '/exercises/concurrency.html' }
    ],
    sidebar: [
      {
        text: 'Java知识',
        items: [
          { text: '并发编程练习题', link: '/exercises/concurrency.html' },
          { text: '单例模式', link: '/java/singleton' }
        ]
      }
      // 后续新增笔记分类，在这里加
    ],
    outline: [2, 3]
  }
})
