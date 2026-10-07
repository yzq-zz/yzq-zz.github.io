# 13. CategoryInsight 工具：品类知识 RAG 与结构化召回

## 13.1 总：品类知识在工具链里的位置

商品搜索工具负责找"哪个具体商品合适"，品类知识工具负责告诉 Agent"这个品类有哪些常识"。两者不重叠，分工明确：

| 工具 | 回答什么问题 | 给 Agent 提供什么 |
|---|---|---|
| `product_search` | 哪个具体商品合适 | 可购买的商品列表（含价格、库存、配送） |
| `category_insight` | 这个品类怎么选、多少钱合理 | 选购判断依据（爆款、属性、价格区间、避坑点） |

用户问"帮我选一个旅行装备"，Agent 先查品类知识知道"洗漱包、登机箱、颈枕是爆款，主力价位 150-400 元，尼龙材质占 60%"，再调商品搜索找具体商品。品类知识解决的是"用户说大类、Agent 要知道具体该搜什么"这个问题。

## 13.2 知识库定位与文档形态

品类知识不是通用问答，是**品类元知识**，给 Agent 提供选购判断背景。当前每个品类对应一篇 Markdown 文档，文档按固定的章节骨架组织：

```
# <文档标题>            ← 一级标题，整篇文档的主题
## 品类定位              ← 解决"这个品类是干什么的"
## 当前热卖款型          ← 解决"现在流行什么"
## 关键属性与判断口径     ← 解决"看哪些属性、怎么判断"
## 价格区间参考          ← 解决"多少钱算合理"
## 避坑点                ← 解决"有什么坑要避开"
```

每个章节的内容**不依赖**其他章节，可以独立阅读和检索。这种"短而规律"的文档形态，决定了下游的切块和入库策略要按结构来，而不是按通用 token 数来切。

## 13.3 离线入库流程

### 13.3.1 入库粒度：一篇 Markdown = 一个 document_id

每篇 Markdown 文档对应 Qdrant 里的一个 `document_id`（取文件 stem，如 `travel-gear`）。一篇文档会被切成多个 chunk，**每个 chunk 独立生成向量、单独入库**，但都挂在同一个 `document_id` 下。

文档元数据来自 `knowledge/manifest.jsonl`，不是文件里手写：

| 字段 | 含义 |
|---|---|
| `document_id` | 文档唯一标识（对应文件名 stem） |
| `source` | 资料来源说明（给 Agent 引用时用） |
| `source_type` | 来源类型（决定政策类知识能否被当作确定事实） |
| `published_at` / `effective_from` / `effective_to` | 资料的发布时间、生效期、失效期 |
| `region` | 资料适用地域 |
| `version` | 资料版本号 |
| `topic` | 主题（`category` / `policy`，决定时效校验规则） |

每个 chunk 入库时，这些元数据**随 chunk 一起存入**，检索回来时一并返回给 Agent。政策类（`topic=policy`）chunk 还要过 `policy_fact_status` 校验：必须 `source_type=official_snapshot` 且当前时间落在 `effective_from` 到 `effective_to` 之间，才算"可作确定事实"，否则只能当参考。

### 13.3.2 切块策略：按 Markdown 标题递归切

不按 token 数硬切，而是按 Markdown 标题切。理由是品类文档的章节结构就是天然的语义边界——`## 价格区间参考` 这个标题本身就是检索锚点，如果被切走，Embedding 出来的向量会偏。

**步骤**：

1. **第一步：按 `## ` 标题切成大块**
   - 正则 `(?=^##\s+)` 切出多个 section，每个 section 以一个 `## ` 标题行开头
   - 每个 section 就是一个候选 chunk

2. **第二步：判断是否需要往下切**
   - 估算 section 的 token 数（按 UTF-8 字节除以 4）
   - ≤ 512 token → 整个 section 就是一个 chunk，不再细分
   - \> 512 token → 进入第三步

3. **第三步：按 token 滑动窗口切（兜底，极少触发）**
   - 用 `ApproxTokenChunker(chunk_size=512, overlap=50)` 在超长 section 内往下切
   - 块间 token 级重叠 50（约 50 个汉字），跟当前生产切块器保持同一套算法
   - token 估算口径：UTF-8 字节长度除以 4（与生产一致）

4. **第四步：贴标题前缀**
   - 每个 chunk 的 content 前面贴 `【<文档标题> / <## 章节名>】` 作为锚点
   - 写纯文本，不写 Markdown 标题格式，Embedding 模型对纯文本锚点更友好

**为什么是"递归式"**：

- 第一级是 `## ` 标题切（主结构）
- 第二级是 token 滑动窗口切（兜底，只在超长时触发）
- 两级之间形成"递归"——大块按结构切，小块按 token 切

**为什么是"包含重合"**：

- token 级重叠只在第三步触发，触发概率 < 5%
- 实测 4 篇品类文档所有 `## ` 章节都 ≤ 180 token，目前根本不触发
- 触发时，前一块的尾部 50 token 在下一块开头重复出现，缓解"句子被腰斩"

**边界**：

- 不入库独立的"孤儿标题" chunk（只有 `## ` 行、没有正文的块），把标题行作为下一块的 prefix
- 第一级和第二级是"分层"关系：大块按结构切，小块按 token 切，两层独立

### 13.3.3 一个具体的切块例子

以 `travel-gear.md` 为例，文档结构如下：

```markdown
# 旅行装备品类洞察

## 品类定位
旅行装备覆盖收纳（收纳袋、压缩袋、行李箱）、舒适（颈枕、眼罩、睡袋内胆）...

## 当前热卖款型
- 旅行三件套（收纳袋 + 颈枕 + 眼罩）：长途飞行刚需组合...
- 20 寸铝框登机箱：商务与短途首选...
- 可折叠双肩包（30-40L）：...
- 桑蚕丝睡袋内胆：...
- 速干毛巾多条装：...

## 关键属性与判断口径
- 材质：帆布、棉麻、桑蚕丝可作为天然材料候选...
- 自重：三件套全套 400g 上下算轻便...
- 耐用性（"抗造"）：看框架材质...
- 收纳效率：压缩比与是否可套接...

## 价格区间参考（人民币）
- 旅行三件套：80-150 元入门，180-260 元主力...
- 20 寸登机箱：500-700 元入门，800-1200 元主力...
- 折叠双肩包：80-160 元。
- 睡袋内胆：棉质 100-180 元，桑蚕丝 300-400 元。
- 速干毛巾三条装：60-100 元。

## 避坑点
- 标称"皮质"的低价箱包多为 PU 涂层...
- 登机箱尺寸各航司口径不同...
- 桑蚕丝内胆需干洗或手洗...
- 超轻双肩包普遍牺牲背负系统...
- 关税视角：旅行装备在多数目的国属常规税率档...
```

**切块结果**（5 个 `## ` 标题，每个 section 都 ≤ 512 token，所以不触发段落切）：

| chunk_id | content（节选） | token 数（估算） |
|---|---|---|
| chunk-0 | `【旅行装备品类洞察 / 品类定位】旅行装备覆盖收纳（收纳袋、压缩袋、行李箱）...` | ~120 |
| chunk-1 | `【旅行装备品类洞察 / 当前热卖款型】- 旅行三件套（收纳袋 + 颈枕 + 眼罩）：长途飞行刚需组合...` | ~200 |
| chunk-2 | `【旅行装备品类洞察 / 关键属性与判断口径】- 材质：帆布、棉麻、桑蚕丝...` | ~180 |
| chunk-3 | `【旅行装备品类洞察 / 价格区间参考】- 旅行三件套：80-150 元入门...` | ~120 |
| chunk-4 | `【旅行装备品类洞察 / 避坑点】- 标称"皮质"的低价箱包多为 PU 涂层...` | ~200 |

**向量化和入库**：

每个 chunk 独立调用 Embedding 模型，得到一个固定维度的向量（如 1024 维），然后连同 content 和 metadata 一起写入 Qdrant 的同一个 collection：

```
chunk_content  →  embedding_model.encode(text)  →  vector[1024 dim]
                  ↓
                  写入 Qdrant point：
                  {
                    id: <自动生成>,
                    vector: [0.12, -0.34, 0.56, ...],
                    payload: {
                      content: "<chunk_content 含标题前缀>",
                      document_id: "travel-gear",
                      chunk_index: 0,            // 在本篇文档中的顺序
                      total_chunks: 5,           // 本篇文档共切成几块
                      parent_section: "品类定位",  // 所属 ## 章节名
                      source: "travel-gear.md",
                      source_reference: "...",
                      source_type: "synthetic_evaluation_fixture",
                      published_at: "2026-08-01",
                      effective_from: "2026-08-01",
                      effective_to: "2026-12-31",
                      region: "GLOBAL",
                      version: "2026.08-eval-v1",
                      topic: "category",
                      content_sha256: "...",      // 正文 + 元数据 + 切块规则 的 hash
                      managed_by: "globex_markdown_sync_v1"
                    }
                  }
```

**入库幂等**：每次启动同步前，先算 `content_sha256 = hash(正文 + 元数据 + "chunker:md_h1_h2:512:50:v3")`。库里已有文档的 hash 一致就跳过，不一致就**先删旧版本再插新版本**（SDK 不支持原子换版）。

**入库后总览**：Qdrant 的 `category_kb_collection` 里现在躺着所有品类文档的所有 chunk。检索时，Embedding 模型把用户问题也转成同样维度的向量，Qdrant 用 cosine 相似度召回 top_k 个最接近的 chunk，返回给 `category_insight_tool`。

## 13.4 工具触发时机

**不用 MCP**。`category_insight` 是 AgentScope 框架下的 `FunctionTool`，注册在 `SearchAgent` 的工具列表里，和 `product_search` 是平级的两个工具，框架原生支持工具调用。

**触发时机由系统 Prompt 控制**，写在 `globex.yml` 里：

```
规则一：简单商品推荐 → 直接调 product_search，不查品类知识
规则二：选购常识问题 → 先查 category_insight，再调 product_search
```

| 用户说 | Agent 行为 |
|---|---|
| "帮我找一个背包" | 直接调 product_search |
| "旅行装备怎么选材质" | 先调 category_insight_tool，拿到材质常识后再调 product_search |
| "背包大概多少钱" | 先调 category_insight_tool 拿到价格区间，再调 product_search |
| "有什么避坑点" | 先调 category_insight_tool 拿到避坑知识，再调 product_search |
| "免税额度多少" | 调 category_insight_tool 拿政策知识 |

## 13.5 在线召回链路

### 13.5.1 召回阶段详解

```
用户问："旅行装备哪些卖得好"
        ↓
embedding 模型把问句转成向量
        ↓
向量数据库做相似度搜索
        ↓
Hybrid Query（KNN 向量 + BM25 全文）：
  - KNN 向量召回：语义泛化兜底
  - BM25 全文匹配：品类词精确匹配
  - 引擎层加权融合（权重 0.7 / 0.3）
  - 返回 Top-K 张卡片
        ↓
按 card_type 分组：
  - bestseller 组：多张爆款卡片
  - attribute 组：多张属性卡片
  - price_range 组：多张价格卡片
        ↓
不需要按 document_id 去重（卡片本身就是完整的）
```

**Top-K 指的是卡片数量，不是 chunk 数量。** 当前 demo 实现里 top_k=80 是 chunk 数量，因为一张文档切成了多个 chunk；生产设计里 top_k 是卡片数量，一张卡片就是一个完整记录。

### 13.5.2 一个具体的召回例子

**用户问："旅行装备哪些卖得好"**

```
embedding 模型把问句转成向量
[0.15, -0.28, 0.61, ...]
        ↓
向量数据库搜索：
  问题向量：[0.15, -0.28, 0.61, ...]
  ↕ 相似度计算
  爆款卡片向量：[0.12, -0.34, 0.56, ...]  相似度 0.94
  价格卡片向量：[0.08, -0.19, 0.33, ...]   相似度 0.71
  其他品类：低相似度被过滤
        ↓
返回相似度最高的 Top-K 张卡片
```

### 13.5.3 提炼层详解

拿到卡片后，按组分别提炼：

| 卡片类型 | 提炼方式 | 输入 | 输出 |
|---|---|---|---|
| `bestseller` | 按 `\|` 分隔字段 | summary: `"洗漱包\|89\|干湿分离"` | `Bestseller(name, typical_price_cny, why_popular)` |
| `attribute` | 按 `:` 拆属性名，按 `/` 拆分布，按 `%` 拆比例 | summary: `"材质：尼龙 60% / 帆布 25%"` | `AttributeDist(name, distribution)` |
| `price_range` | 正则提数字区间，匹配 budget/mid/premium | summary: `"便宜款 60-150 / 中档 150-400"` | `PriceTier(tier, range_cny, notes)` |

实际项目里，提炼步通常调一次小模型做 `summary → 结构化字段` 的转换。规则示意便于看清结构化思路，生产推荐用小模型。

提炼之后，把同组多张卡片合并成一个结构化字段，然后计算整体置信度：

```
整体 confidence = 所有卡片 confidence 的平均值
```

## 13.6 返回结构与 Agent 拿到的内容

### 13.6.1 CategoryInsightOutput 结构

```python
CategoryInsightOutput(
    category="旅行三件套",               # 品类名称
    components=["洗漱包", "鞋包", "数码线收纳"],  # 典型组件
    bestsellers=[                       # 爆款商品列表
        Bestseller(name="多功能洗漱包", typical_price_cny=89.0, why_popular="干湿分离"),
        Bestseller(name="便携鞋包", typical_price_cny=39.0, why_popular="不占箱"),
        Bestseller(name="数码线收纳包", typical_price_cny=49.0, why_popular="硬壳防压"),
    ],
    attributes=[],                     # 属性分布（quick模式为空，deep模式有值）
    price_tiers=[                      # 价格区间
        PriceTier(tier="budget", range_cny=(60.0, 150.0), notes="便宜款 60-150"),
        PriceTier(tier="mid", range_cny=(150.0, 400.0), notes="中档 150-400"),
        PriceTier(tier="premium", range_cny=(400.0, 1200.0), notes="高端 400+"),
    ],
    confidence=0.78                   # 整体置信度
)
```

### 13.6.2 两档模式对比

| 字段 | quick 模式 | deep 模式 |
|---|---|---|
| `top_k` | 8 张卡片 | 15 张卡片 |
| `attributes` | 空 | 有值（属性分布） |
| `bestsellers` / `price_tiers` | 有值 | 有值 |
| `confidence` | 有值 | 有值 |

deep 模式多拉 7 张卡片，专门跑一轮属性提炼，把材质、容量等属性分布填进去。

### 13.6.3 Agent 实际拿到的内容

子 Agent 跑完三步管线后，回传给主 Agent 的是一个压缩后的字符串：

```
旅行三件套品类常识：
- 典型组件：洗漱包 / 鞋包 / 数码线收纳
- 爆款 5 件：（洗漱包89元、鞋包39元、收纳包49元...）
- 价格档位：便宜款 60-150 / 中档 150-400 / 高端 400+
- 数据置信度 0.78
```

主 Agent 拿到这个压缩后的文本，理解后去调 `product_search` 找具体商品。它看不到 5-15 张原始知识切片，上下文清爽得多。

## 13.7 当前实现 vs 生产设计

| 维度 | 当前实现 | 生产设计 |
|---|---|---|
| 入库内容 | Markdown 切片（碎片段落） | 预提炼的 summary（50-200 字结构化文本） |
| 入库粒度 | 一个文件切成多个 chunk | 一张卡片 = 一条记录 |
| 召回结果 | 多个 chunk | 多张卡片 |
| 去重步骤 | 需要（按 document_id 去重） | 不需要（卡片本身完整） |
| 提炼层 | 无，直接返回切片原文 | 有，三步管线（召回→提炼→摘要） |
| 输出内容 | 原始切片 + score + policy_fact_status | 结构化字段（bestsellers/attributes/price_tiers） |
| 向量引擎 | Qdrant（纯稠密向量） | OpenSearch（KNN + BM25 引擎层融合） |
| BM25 | 无 | 有（引擎层 hybrid query） |

生产设计的核心升级方向有两个：

**方向一：结构化卡片升级。** 把 Markdown 切片换成预结构化的 `CategoryCard`，每张卡片在入库前就把原始爬取数据清洗成 `bestsellers[]`、`attributes[]`、`price_tiers[]` 等结构化字段，Agent 拿到的是提炼好的结论而非原始切片。

**方向二：提炼层升级。** 当前 summary 由规则生成，后续可换成小模型做 `summary → 结构化字段` 的转换，提高字段提取准确率。

两个方向是递进关系，不是二选一。

## 13.8 与商品搜索的协作

| 精挑时关心 | 来自 category_insight 的哪个字段 |
|---|---|
| 套装类商品有没有缺组件 | `components` |
| 候选属性是否符合品类主流 | `attributes` 的 distribution 排前几位 |
| 候选价格是否落在合理档位 | `price_tiers` 的 range_cny |
| 决策置信度 | `confidence`（低于 0.5 时主 loop 应再补 WebSearch） |

品类知识和商品搜索的分工：

- `category_insight` → 回答"这个品类怎么样"
- `product_search` → 回答"哪个具体商品合适"

两者不重叠，品类知识永远不给商品列表，商品搜索永远不解释品类常识。

## 13.9 知识库刷新策略

| 刷新类型 | 频率 | 数据源 |
|---|---|---|
| 爆款卡片 | 每周 | 内部销售榜 + 平台公开榜单 |
| 属性图谱卡片 | 每月 | 商品库属性聚合 |
| 价格区间卡片 | 每月 | 历史成交价分位数 |
| 政策快照卡片 | 按官方公告 | 政府网站抓取 |

刷新流程不在工具运行时，是独立的离线任务。刷新与上线间还需要召回评测（Recall@K / MRR / NDCG）、冷启动 WebSearch 兜底、索引别名切换等工程保障。
