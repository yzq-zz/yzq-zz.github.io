# 13. CategoryInsight 工具：品类知识 RAG 召回

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

### 13.3.2 切块策略：按 Markdown 标题切

不按 token 数硬切，而是按 Markdown 标题切。理由是品类文档的章节结构就是天然的语义边界——`## 价格区间参考` 这个标题本身就是检索锚点，如果被切走，Embedding 出来的向量会偏。

**步骤**：

1. **第一步：按 `## ` 标题切成大块**
   - 正则 `(?=^##\s+)` 切出多个 section，每个 section 以一个 `## ` 标题行开头
   - 每个 section 就是一个候选 chunk

2. **第二步：判断是否需要往下切**
   - 估算 section 的 token 数（按 UTF-8 字节除以 4）
   - ≤ 512 token → 整个 section 就是一个 chunk，不再细分
   - \> 512 token → 进入第三步

3. **第三步：按 token 滑动窗口切**
   - 用 `ApproxTokenChunker(chunk_size=512, overlap=50)` 在超长 section 内往下切
   - 块间 token 级重叠 50（约 50 个汉字）
   - token 估算口径：UTF-8 字节长度除以 4

4. **第四步：贴标题前缀**
   - 每个 chunk 的 content 前面贴 `【<文档标题> / <## 章节名>】` 作为锚点
   - 写纯文本，不写 Markdown 标题格式，Embedding 模型对纯文本锚点更友好

**为什么是"分层"**：

- 第一层是 `## ` 标题切（主结构）
- 第二层是 token 滑动窗口切（只在 section 超 512 token 时触发）
- 两层之间形成"分层"——大块按结构切，小块按 token 切

**为什么是"包含重合"**：

- token 级重叠只在第三步出现，块间重复 50 token（约 50 个汉字）
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

**切块结果**（5 个 `## ` 标题，每个 section 对应一个 chunk）：

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

### 13.5.1 为什么不做 BM25 + 向量融合

通用 RAG 里常见"KNN 向量 + BM25 全文"的引擎层加权融合,品类知识场景下不引入这条,三个理由:

- **词项同义替换多**:用户说"轻",文档里写"自重/轻量/轻便"。这类语义同义是 BM25 弱项、向量强项
- **知识库规模小**:就几篇文档,BM25 的 IDF(逆文档频率)算不出有效区分度,叠加相当于叠两个相同信号
- **不需要"型号名精确匹配"**:BM25 真正擅长的是 SKU 型号、人名这种"query 里出现就必须命中"的场景,品类知识查询不是这个模式

不引入标准 BM25 融合,在线召回采用"纯向量召回 + 后处理"的链路。

### 13.5.2 召回阶段:四步链路

召回请求 `category_insight_tool(question, top_k=3)` 进来后,链路四步走:

```
① 边界规则检查
   ↓
② Qdrant 向量召回:候选数 = min(80, top_k × 8)
   ↓
③ 点名文档补查:query 明确点名某文档/政策地域,缺失时在该文档内向量重查
   ↓
④ 按 document_id 去重:top_k 的单位是"来源数"不是"chunk 数"
   ↓
返回 top_k 条 insight(每条来自不同的 document_id)
```

**候选数和最终返回数是两个预算**。`top_k=3` 时,先召回 24 个候选向量,去重后按"不同 document_id"凑齐 3 个。

**Top-K 的单位是"来源数"(distinct document_id 数),不是 chunk 数**。每条 insight 来自一篇文档,一篇文档只露最相关那一个 chunk,即使它有 5 个 chunk 入库。

### 13.5.3 top_k 的单位:来源数

`top_k=3` 表示返回 3 条来自**不同 document_id** 的 insight。一篇文档只露最相关那一个 chunk,即使它有 5 个 chunk 入库。`top_k` 在工具 prompt / 评测里都按"来源数"语义使用。

### 13.5.4 一个完整的例子:从离线入库到 Agent 拿到回答

**场景**:用户问"旅行三件套怎么选",主 Agent 先调 `category_insight_tool`,再根据知识里的判断口径调 `product_search`。下面走一遍从离线到在线的完整流程。

#### 第一步:离线入库(应用启动时跑一次)

`knowledge/travel-gear.md` 是这样一篇文档:

```markdown
# 旅行装备品类洞察

## 品类定位
旅行装备覆盖收纳(收纳袋、压缩袋、行李箱)、舒适(颈枕、眼罩、睡袋内胆)三大子类。

## 当前热卖款型
- 旅行三件套(收纳袋 + 颈枕 + 眼罩):长途飞行刚需组合...
- 20 寸铝框登机箱:商务与短途首选...
- 桑蚕丝睡袋内胆:酒店青旅与露营场景通用...

## 关键属性与判断口径
- 自重:三件套全套 400g 上下算轻便;双肩包 400g 以内属超轻...
- 耐用性:看框架材质(铝框优于纯 PC)、缝线密度...

## 价格区间参考(人民币)
- 旅行三件套:80-150 元入门,180-260 元主力...
- 20 寸登机箱:500-700 元入门,800-1200 元主力...

## 避坑点
- 标称"皮质"的低价箱包多为 PU 涂层...
- 登机箱尺寸各航司口径不同...
```

启动时 `bootstrap_category_knowledge` 跑起来:

1. 按 `## ` 标题切,得到 5 个 section(对应 5 个章节)
2. 每个 section 都 ≤ 512 token,不触发第三步切块
3. 每个 chunk 的 content 前面贴 `【旅行装备品类洞察 / <章节名>】` 前缀
4. 每个 chunk 单独 Embedding,得到 1024 维向量
5. 5 个 chunk 全部写入 Qdrant 的 `category_kb_collection`,共享 `document_id="travel-gear"`,各自带 `parent_section` 字段

入库后,Qdrant 里 5 条记录大致是这样(简化展示):

```
Qdrant point 1:
  vector: [0.12, -0.34, ...]
  payload:
    content: "【旅行装备品类洞察 / 品类定位】旅行装备覆盖收纳..."
    document_id: "travel-gear"
    chunk_index: 0
    parent_section: "品类定位"
    topic: "category"
    ...

Qdrant point 2:
  vector: [...]
  payload:
    content: "【旅行装备品类洞察 / 当前热卖款型】- 旅行三件套..."
    document_id: "travel-gear"
    parent_section: "当前热卖款型"
    ...

Qdrant point 3-5: 类似,对应"关键属性"/"价格"/"避坑"
```

#### 第二步:用户提问 → 主 Agent 决策

```
[对话界面]
[user] 旅行三件套怎么选
```

主 Agent 看到 Prompt 规则("选购常识问题先查 category_insight,再查 product_search"),判断"旅行三件套怎么选"属于选购常识,**决定先调 `category_insight_tool`**,传:

```
tool_calls: [{name: "category_insight_tool", args: {question: "旅行三件套怎么选", top_k: 3}}]
```

#### 第三步:工具内召回(13.5.2 的四步链路)

```
① 边界规则检查:"旅行三件套怎么选"不是汇率/明价/具体股票等不可回答类 → 继续

② Qdrant 向量召回:
   query 向量 = embedding("旅行三件套怎么选")
   Qdrant 里所有 chunk 按相似度排序,取前 min(80, 3*8) = 24 个
   
   假设这 24 个里:
     - travel-gear / 关键属性与判断口径  ← score 0.72
     - travel-gear / 当前热卖款型        ← 0.58
     - travel-gear / 价格区间参考        ← 0.41
     - travel-gear / 避坑点              ← 0.33
     - travel-gear / 品类定位            ← 0.29
     - digital-accessories / 关键属性    ← 0.24
     - home-living / 当前热卖款型        ← 0.22
     - cross-border-guide / 关税通则     ← 0.21
     - 其他 < 0.20 被拒答门槛筛掉

③ 点名文档补查:query 没明确点名某文档 → 跳过

④ 按 document_id 去重:
   - travel-gear 出现 5 次 → 只留 1 个(关键属性与判断口径, score 0.72)
   - digital-accessories 出现 1 次 → 留
   - home-living 出现 1 次 → 留
   - cross-border-guide 出现 1 次 → 留
   
   凑齐 top_k=3 条,按 score 排序:
     1. travel-gear / 关键属性与判断口径   (0.72)
     2. digital-accessories / 关键属性      (0.24)
     3. cross-border-guide / 关税通则       (0.21)
```

`search_knowledge` 返回的就是这 3 条 SDK 内部结果。

#### 第四步:工具封装成 JSON

代码把 SDK 对象转成 Agent 能吃的 JSON,**没有"提取结构化字段"这一步**:

```json
{
  "insights": [
    {
      "content": "【旅行装备品类洞察 / 关键属性与判断口径】自重:三件套全套 400g 上下算轻便;耐用性:看框架材质(铝框优于纯 PC)、缝线密度;...",
      "source": "travel-gear.md",
      "score": 0.72,
      "metadata": {
        "source_type": "...",
        "effective_from": "2026-08-01",
        "effective_to": "2026-12-31",
        "topic": "category",
        "parent_section": "关键属性与判断口径"
      },
      "policy_fact_status": "not_policy"
    },
    {
      "content": "【数码配件品类洞察 / 关键属性与判断口径】...",
      "source": "digital-accessories.md",
      "score": 0.24,
      "metadata": {...},
      "policy_fact_status": "not_policy"
    },
    {
      "content": "【跨境通则 / 关税】旅行装备属常规税率档,单笔金额压在免税额度内可显著降低到手价...",
      "source": "cross-border-guide.md",
      "score": 0.21,
      "metadata": {
        "source_type": "...",
        "topic": "policy",
        ...
      },
      "policy_fact_status": "non_authoritative_source"
    }
  ]
}
```

注意几点:

- **没有 `bestsellers / attributes / price_tiers` 这种结构化字段**
- `policy_fact_status` 是工具层加的,SDK 没有
- `cross-border-guide` 那条 `policy_fact_status = non_authoritative_source`,因为 manifest 里 `source_type=synthetic_evaluation_fixture`,不是 official_snapshot

#### 第五步:ToolChunk 塞回主 Agent 对话

AgentScope 框架自动把这段 JSON 作为工具结果塞回主 Agent 的对话历史:

```
[对话历史]
[system] 你是 Globex 跨境电商助手...
[user] 旅行三件套怎么选
[assistant] {tool_calls: [{name: "category_insight_tool", ...}]}
[tool result] {上面那段 JSON}
[assistant 继续]   ← 主 Agent 大模型接着生成
```

#### 第六步:主 Agent 大模型拼回答

主 Agent 接着生成下一条 assistant 消息,**直接读 `insights[].content`**,把要点总结成自然语言,**没有"提取结构化字段"这一步**:

```
旅行三件套选购可以关注三个维度:
 1. 自重 — 三件套全套 400g 上下算轻便(travel-gear.md / 关键属性与判断口径)
 2. 耐用性 — 看框架材质(铝框优于纯 PC)、缝线密度(同上来源)
 3. 关税 — 旅行装备属常规税率档,单笔压在免税额度内更划算
    (cross-border-guide.md,但该资料不是官方快照,具体额度需查官方)

资料来源:travel-gear.md / digital-accessories.md / cross-border-guide.md
```

**这里大模型做的是**:

- 读 3 条 `insights[].content` 的原文
- 提炼出"自重 / 耐用性 / 关税"三个维度
- 把 `source` 拼成"资料来源"行
- 注意到第三条 `policy_fact_status=non_authoritative_source`,主动提示"具体额度需查官方"

**没有任何"提取 bestsellers 列表"或"提炼 attributes 分布"的动作**——那些字段工具根本没返回。

#### 第七步:用户追问,主 Agent 调 product_search

用户在界面上接着问:

```
[user] 那 400g 以下的三件套,具体哪个好
```

主 Agent 判断"具体哪个"需要 SKU,**根据第六段 assistant 消息里的"自重 400g 以下"判断口径**,调 `product_search`:

```
tool_calls: [{name: "product_search", args: {
  constraints: {category: "旅行三件套", weight: "<400g"},
  budget: "<260 元"  ← 来自 travel-gear 价格章节的"180-260 元主力"
}}]
```

`product_search` 返回符合约束的具体 SKU 列表。主 Agent 把 SKU 列表 + 品类知识里的"400g 以下算轻便"组合,给用户最终回答。

#### 整条链路一句话收尾

```
用户提问
  → 主 Agent 判断调 category_insight
    → 工具召回 24 个候选 → 按 document_id 去重留 3 个
      → 工具把 SDK 对象封装成 JSON(无结构化提炼)
        → 框架塞回主 Agent 对话
          → 主 Agent 大模型读 content 拼自然语言回答
            → 用户追问 → 主 Agent 据此调 product_search
              → 最终回答:品类知识 + 商品事实
```

### 13.5.5 资料不足与服务故障分开处理

四种情况返回不同的结构:

| 情况 | 返回行为 |
|---|---|
| 正常召回,top_k 条都有相关结果 | 返回 `insights` 数组 |
| 正常召回,所有分数 < 0.20(拒答门槛) | 返回 `insights=[]`,`unanswerable=true`,带原因 |
| 召回过程异常,本地关键词降级有结果 | 返回 `insights` 数组,带 `retrieval_mode="keyword_fallback"` |
| 召回异常,降级也无结果或未配置 | 返回明确错误 |

**拒答门槛 0.20**:筛掉明显不相关候选。**达到门槛不等于结果可信**,只是"至少有一条勉强相关"。

**关键词降级**只用于 Embedding/向量服务故障时,逻辑不一样:
- 不算向量
- 按 `## ` 标题切段,把 query 的中文 bigram + 英文词项跟段落做词项重合
- 命中的段落直接当 insight 返回,`score` 是词项重合比例,**不能跟向量相似度直接比较**
- 降级可能返回同一文档的多个段落

### 13.5.6 原始证据的含义

工具负责检索与封装,**不计算最低价、中位价或属性分布**。Agent 拿到 `content` 后,可以解释资料里的价位参考;要算"当前品类商品统计",必须另外准备同币种、同规格、同时间口径的数据,不能在知识库返回的样本上做推断。

`score` 表示检索相似度,**不代表资料可信度**。可信度由 `metadata.source_type` / `effective_from` / `effective_to` 这些字段决定。

## 13.6 返回结构与 Agent 拿到的内容

### 13.6.1 返回字段

每条 insight 是一个 JSON 对象,字段:

| 字段 | 含义 |
|---|---|
| `content` | chunk 原文(含 `【文档 / 章节】` 前缀) |
| `source` | 来源文档名(缺失时回退到 document_id) |
| `score` | 本次检索相似度(辅助参考,不代表资料可信度) |
| `metadata` | 来源类型、时间、地域、版本、主题、所属章节 |
| `policy_fact_status` | 政策类资料能否作确定事实的状态(`not_policy` / `not_effective` / `expired` / `fact_eligible` 等) |

工具返回顶层结构(`ToolChunk` 文本块里的 JSON):

```json
{
  "insights": [
    { ... 1 个 insight ... },
    { ... 1 个 insight ... },
    ...
  ]
}
```

资料不足时:

```json
{
  "insights": [],
  "unanswerable": true,
  "reason": "当前知识库没有足够相关且可验证的资料,不能据此作确定性回答"
}
```

降级返回时顶层多一个 `retrieval_mode: "keyword_fallback"`。

### 13.6.2 Agent 实际拿到的内容

主 Agent 拿到 `insights` 数组后,直接读每条 `content` 字段。例如下面的"自重怎么判断"问题,Agent 拿到的就是这种原始证据:

```
[
  {
    "content": "【旅行装备品类洞察 / 关键属性与判断口径】自重:三件套全套 400g 上下算轻便;双肩包 400g 以内属超轻;登机箱 3.5kg 以内为轻量档。...",
    "source": "travel-gear.md",
    "score": 0.78,
    "metadata": { "parent_section": "关键属性与判断口径", "topic": "category", ... },
    "policy_fact_status": "not_policy"
  },
  ...
]
```

Agent 拿到原始 chunk,**不经过"提炼管线"**,直接基于 `content` + `metadata` 解释给用户。比如上面的 `content`,Agent 可以直接复述"旅行三件套全套 400g 上下算轻便"给用户,并附上 `source=travel-gear.md` 让用户知道出处。

**`not_policy` 只表示这块内容不属于政策类资料,不代表已经被验证为真实市场事实**。如果资料是政策类(`topic=policy`),`policy_fact_status` 会进一步告诉你这块能不能作确定事实。

**没有"结构化字段提炼"**——工具返回的就是原始 chunk 文本 + 元数据,不做 `bestsellers / attributes / price_tiers` 这种结构化字段抽取,也不返回 `CategoryInsightOutput` 之类的复合对象。主 Agent 拿到后自行理解并决定要不要调 `product_search` 找具体商品。

## 13.7 与商品搜索的协作

| 精挑时关心 | 来自 category_insight 的哪个字段 |
|---|---|
| 商品属于哪个品类、有什么选购要点 | `insights[].content` |
| 商品的材质/属性判断是否符合品类主流 | `insights[].content` 对应 `## 关键属性与判断口径` 的 chunk |
| 商品价格是否落在合理区间 | `insights[].content` 对应 `## 价格区间参考` 的 chunk |
| 资料是不是政策类、能不能作确定事实 | `insights[].policy_fact_status` |

品类知识和商品搜索的分工：

- `category_insight` → 回答"这个品类怎么样、有什么选购依据"
- `product_search` → 回答"哪个具体商品合适"

两者不重叠，品类知识永远不给商品列表，商品搜索永远不解释品类常识。

## 13.8 知识库刷新策略

| 文档类型 | 频率 | 数据源 |
|---|---|---|
| 品类文档(旅行装备/家居生活/户外运动/数码配件) | 按需更新 | 行业资讯 + 内部选品复盘 |
| 跨品类通用政策文档(cross-border-guide) | 按官方公告 | 政府网站 / 海关公告 |

刷新流程不在工具运行时,是独立的离线任务。每次启动会跑 `bootstrap_category_knowledge()`,通过 `content_sha256` 对比识别出有变化的文档,**先删旧版本再插新版本**(SDK 不支持原子换版)。中途失败时允许暂时缺失文档,不能继续引用过期知识。
