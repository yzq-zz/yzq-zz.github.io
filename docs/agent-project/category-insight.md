# 13. CategoryInsight 工具：品类知识 RAG 与结构化召回

## 13.1 总：品类知识在工具链里的位置

商品搜索工具负责找"哪个具体商品合适"，品类知识工具负责告诉 Agent"这个品类有哪些常识"。两者不重叠，分工明确：

| 工具 | 回答什么问题 | 给 Agent 提供什么 |
|---|---|---|
| `product_search` | 哪个具体商品合适 | 可购买的商品列表（含价格、库存、配送） |
| `category_insight` | 这个品类怎么选、多少钱合理 | 选购判断依据（爆款、属性、价格区间、避坑点） |

用户问"帮我选一个旅行装备"，Agent 先查品类知识知道"洗漱包、登机箱、颈枕是爆款，主力价位 150-400 元，尼龙材质占 60%"，再调商品搜索找具体商品。品类知识解决的是"用户说大类、Agent 要知道具体该搜什么"这个问题。

## 13.2 知识库定位与卡片类型

品类知识不是通用问答，是**品类元知识**，给 Agent 提供选购判断背景。每张卡片对应一个品类的一个知识维度：

| 卡片类型 | 内容 | Agent 拿到后干什么 |
|---|---|---|
| `bestseller` | 爆款商品 + 热销原因 + 典型价格 | 知道这个品类当前卖什么、为什么火，用于改写搜索词 |
| `attribute` | 属性分布（如材质 60% 尼龙 / 25% 帆布） | 知道主流属性是什么，用于理解商品属性字段 |
| `price_range` | 入门/主力/高端三档价格区间 | 知道预算划到哪里，用于判断商品贵不贵 |
| `policy` | 政策事实（免税额度、关税税率） | 引用时必须带来源和时效校验，不是所有政策都能直接引用 |

**每个品类有 3 张卡片**（bestseller / attribute / price_range），policy 属于跨品类通用知识，按地区和主题独立建卡。

## 13.3 离线入库流程

### 13.3.1 数据来源分类

| source_type | 来源 | 置信度范围 |
|---|---|---|
| `crawled` | 爬取数据：从平台榜单、电商搜索热词、社媒内容聚合 | 0.70 - 0.85 |
| `manual` | 人工标注：专家判断、品牌官网资料 | 0.85 - 0.95 |
| `official_snapshot` | 官方快照：法规、免税额度、关税税率等政策文件 | 0.95 - 0.99 |

爬取数据置信度最低，因为来源混杂可能有噪声；官方政策快照最高，因为有明确出处和时效。

### 13.3.2 入库流程详解

```
原始数据源（爬取 / 人工 / 官方）
        ↓
① 数据清洗与标注
   - 去重、字段标准化
   - 人工校验 confidence
        ↓
② 生成 summary
   - 用小模型或规则，把原始数据提炼成一段 50-200 字的 summary
   - summary 是针对检索 query 模式（"这个品类怎么选"）重写的
   - 包含品类词、属性词和判断结论，在语义空间更容易被召回
        ↓
③ 存入向量库（OpenSearch / Qdrant）
   text_to_embed = f"{category} {card_type} {summary}"
   例如："旅行装备 爆款 旅行装备热销款：洗漱包89元、登机箱699元等，干湿分离实用设计"
        ↓
   一条记录 = {
     text: "旅行装备 爆款 ...",
     vector: embedding(text),
     metadata: {
       card_id: "travel-gear_bestseller_001",
       category: "旅行装备",
       card_type: "bestseller",
       bestsellers: [...],     // 结构化字段存在 metadata，不参与向量匹配
       confidence: 0.82,
       source_type: "crawled",
       effective_from: "2026-01-01",
       effective_to: "2026-12-31"
     }
   }
```

**核心：向量匹配靠 summary，结构化字段存在 metadata 里。两者不是同一个东西。**

### 13.3.3 一个具体的入库例子

**准备一张结构化卡片（来源：爬取数据）：**

```json
{
  "card_id": "travel-gear_bestseller_001",
  "category": "旅行装备",
  "card_type": "bestseller",
  "bestsellers": [
    {"name": "洗漱包", "typical_price_cny": 89.0, "why_popular": "干湿分离"},
    {"name": "登机箱", "typical_price_cny": 699.0, "why_popular": "铝镁合金框架"}
  ],
  "confidence": 0.82,
  "source_type": "crawled"
}
```

**生成 summary（入库向量用的文本）：**

```
输入：bestsellers 字段
输出（小模型或规则）：
"旅行装备热销款：多功能洗漱包约89元（干湿分离实用设计）、
 20寸登机箱约699元（铝镁合金框架+TSA锁），
 热销原因：干湿分离实用设计、品牌框架保障。"
```

**存入向量数据库：**

```json
{
  "text": "旅行装备 爆款 旅行装备热销款：洗漱包89元、登机箱699元等，干湿分离实用设计",
  "vector": [0.12, -0.34, 0.56, ...],
  "metadata": {
    "card_id": "travel-gear_bestseller_001",
    "card_type": "bestseller",
    "bestsellers": [...],   // 结构化字段
    "confidence": 0.82,
    "source_type": "crawled"
  }
}
```

**入库粒度：一张卡片 = 一条记录 = 一个向量。** 不会把一张卡片切成多个碎片，每张卡片是完整的。这是和当前 demo 实现的核心差异——demo 用 Markdown 切片入库，一张文档切成多个 chunk；生产设计用结构化卡片入库，一张卡片就是一个完整记录。

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
