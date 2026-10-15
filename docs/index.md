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

### 数据库

- [数据库防超卖：原子 UPDATE + 影响行数](/database/deadlock-prevention) — 一条 `UPDATE ... WHERE stock > 0` 解决并发扣减：当前读 + 行锁 + 影响行数判断

### 学习新知识

- [JDK新特性：ZGC详解](/learning-new/zgc) — 可交互演示：染色指针 / good_color 全局切换 / 惰性修复 / SATB 写屏障 / 3 STW + 2 并发周期
- [虚拟线程调度 · 一步步看懂](/learning-new/virtual-thread-scheduling-text) — 「乘客与座位」模型：Continuation.run() / yield() 时机、StackChunk 冻结、Mount/Unmount、M 个 VT 复用 N 个载体
- [虚拟线程调度 · 可交互演示](/learning-new/virtual-thread-scheduling) — 7 步动图：VT 挂载、I/O 阻塞、栈帧冻结、卸载、复用、解冻恢复

### 操作系统

- [进程 vs 线程](/os/process-vs-thread) — 进程与线程的核心区别，以及为什么进程上下文切换比线程重（页表 / TLB / 缓存失效）

### Agent项目

- [4. 上下文管理策略](/context-management-strategy) — 面试图解：原生 AgentScope 按 token 切会撕开哪些轮次；按轮次保留、工具配对、当前轮不动三道防线
- [11. 商品搜索工具：生产级检索链路](/agent-project/product-search) — 七层检索漏斗：查询理解、约束分流、BM25 + 向量双路召回与 RRF、粗排精排、实时校验，含 OpenSearch / Milvus 选型与降级设计
- [13. CategoryInsight 工具：品类知识 RAG](/agent-project/category-insight) — 在商品搜索之上叠一层品类常识（爆款 / 属性 / 价格区间 / 避坑点），结构化召回给 Agent 当判断依据

### 实习总结

- [1. 广告系统架构总结](/internship/bytedance-summary) — 字节广告系统的核心架构与实习收获
