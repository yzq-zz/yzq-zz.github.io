# AGENTS.md — 给 AI 助手的仓库说明

这是用户的个人笔记网站（VitePress 静态站点），发布在 https://yzq-zz.github.io/

## 你的任务

用户会用自然语言描述笔记内容，你负责：写成 Markdown 笔记 → 加入站点 → 提交推送上线。

## 新增笔记步骤

1. 在 `docs/` 下按分类新建 `.md` 文件（分类目录不存在就创建，如 `docs/并发编程/xxx.md`）
2. 文件名**必须用英文**（中文文件名的 URL 在部分浏览器会 400），中文写在页面标题里
3. 在 `docs/.vitepress/config.mts` 的 `sidebar` 里注册：对应分类下加 `{ text: '笔记标题', link: '/分类目录/文件名' }`
4. 在 `docs/index.md` 正文的"笔记分类"区同步登记：在对应分类小节下加 `- [笔记标题](./分类目录/文件名.html) — 一句话简介`。**这一处不能漏**：VitePress 的"笔记页侧边栏"和"首页预览界面的笔记分类"是两份独立数据源；只改 sidebar 会让首页看不到这篇笔记，只改 index.md 会让笔记页左侧看不到。
5. 推送上线：

```bash
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890
git add -A && git commit -m "add: <笔记标题>" && git push
```

5. 推送后 GitHub Actions 自动部署，约 1 分钟后生效；可用 `gh run list --repo yzq-zz/yzq-zz.github.io --limit 1` 确认部署成功

## 硬性规矩

- **终端操作 GitHub 必须带代理**（上面的 export），否则超时。git push、gh 命令都是
- 独立的 HTML 页面（自包含练习题等）放 `docs/public/`，**并且**在 `docs/` 下建一个带 iframe 的中转 `.md` 页面挂到导航上——直接链接 public 里的 HTML，站内点击会 404（VitePress 客户端路由不认识它），参考 `docs/exercises/concurrency.md` 的做法
- `docs/public/concurrency-exercises.html` 的**源文件**在 `/Users/yzq/Desktop/学习资料/看书/练习题/并发编程练习题.html`，修改题目内容要改源文件后拷贝过来，源文件顶部的「AGENT 出题索引」注释是出题的权威规范，不许删改
- 本地预览：`npm run dev`（需先 `npm install`），预览地址 http://localhost:5173
- 部署验证不要只 curl，CDN 有几分钟延迟；以 `gh run list` 的部署状态为准

## 不要做的事

- 不要改动 `.github/workflows/deploy.yml`（Pages 部署配置，Pages 已设为 workflow 模式）
- 不要动 `docs/public/concurrency-exercises.html` 里的云同步 JS（GitHub 仓库 notes-data 存答案，用户靠它跨设备同步）
- 不要把任何 Token/密钥写进仓库
