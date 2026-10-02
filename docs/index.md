---
layout: home

hero:
  name: 学习笔记
  text: Java 后端 · 秋招备战
  tagline: 记录学习笔记与练习题，答案保存在浏览器本地
  actions:
    - theme: brand
      text: 并发编程练习题
      link: /exercises/concurrency.html

---

## 笔记分类

### Java知识

- [并发编程练习题](/exercises/concurrency.html) — 基于《Java并发编程的艺术》《Java并发编程实战》的 badcase 练习
- [单例模式](/java/singleton) — 饿汉式 / DCL / 静态内部类 Holder 三种写法与踩坑记录

### Agent知识

- [CLI / MCP 的区别与 Bash 基础](/agent/cli-vs-mcp) — 面试题：两种工具调用形态、Token 经济学、能力边界，以及 Bash 解释器原理

### Agent项目

- [11. 商品搜索工具：生产级检索链路](/agent-project/product-search) — 七层检索漏斗：查询理解、约束分流、BM25 + 向量双路召回与 RRF、粗排精排、实时校验，含 OpenSearch / Milvus 选型与降级设计
