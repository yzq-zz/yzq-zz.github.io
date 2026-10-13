---
title: 实习总结：广告系统架构总结
date: 2026-10-09
---

# 实习总结：广告系统架构总结

## 广告竞价系统架构

![DSP Auction 架构图](/images/ad-system-architecture.png)

::: details Mermaid 代码（点击展开）
```text
flowchart LR
    User(["用户<br>访问媒体页面"]) -- "1.广告位请求" --> SSP["SSP<br>供给侧平台<br>媒体方"]
    SSP -- "2.包装Bid Request" --> ADX{"ADX<br>广告交易平台<br>请求路由"}
    ADX -- "3.分发Bid Request" --> DSP1["DSP-1<br>广告主A"] & DSP2["DSP-2<br>广告主B"] & DSP3["DSP-3<br>广告主C"]
    DSP1 -- "4.特征查询" --> FC1[("Redis Cluster<br>频次/预算")]
    DSP1 -- "4.作弊识别" --> FD1["规则引擎+ML"]
    FD1 -- "置信度&lt;0.6" --> NB1["NoBid"]
    FD1 -- 通过 --> Bid1["出价模型<br>LightGBM"]
    Bid1 -- "5.Bid Response" --> ADX
    DSP2 -- "4.特征查询" --> FC2[("Redis Cluster")]
    DSP2 -- "4.作弊识别" --> FD2["规则引擎+ML"]
    FD2 -- "置信度&lt;0.6" --> NB2["NoBid"]
    FD2 -- 通过 --> Bid2["出价模型"]
    Bid2 -- "5.Bid Response" --> ADX
    DSP3 -- "4.特征查询" --> FC3[("Redis Cluster")]
    DSP3 -- "4.作弊识别" --> FD3["规则引擎+ML"]
    FD3 -- "置信度&lt;0.6" --> NB3["NoBid"]
    FD3 -- 通过 --> Bid3["出价模型"]
    Bid3 -- "5.Bid Response" --> ADX
    ADX -- "6.第二价格拍卖" --> Auction["Auction<br>价高者得<br>按次价结算"]
    Auction -- "7.原子扣减" --> Deduct["频次+预算<br>Lua脚本"]
    Deduct -- "8.Bid Response" --> SSP
    SSP -- "9.展示广告" --> Ad(["胜出广告展示"])
    Auction -. 异步 .-> Kafka[("Kafka<br>竞价日志")]
    Kafka --> CH[("ClickHouse<br>离线分析")]

    style SSP fill:#16213e,stroke:#7b61ff,stroke-width:3px,color:#D50000
    style ADX fill:#0a0e27,stroke:#00d4ff,stroke-width:3px,color:#D50000
    style DSP1 fill:#16213e,stroke:#7b61ff,stroke-width:2px,color:#D50000
    style DSP2 fill:#16213e,stroke:#7b61ff,stroke-width:2px,color:#D50000
    style DSP3 fill:#16213e,stroke:#7b61ff,stroke-width:2px,color:#D50000
    style FC1 fill:#16213e,stroke:#7b61ff,stroke-width:1px,color:#2962FF
    style FD1 fill:#0a0e27,stroke:#7b61ff,stroke-width:1px,color:#00C853
    style NB1 fill:#0a0e27,stroke:#ff4444,stroke-width:1px,color:#FF6D00
    style Bid1 fill:#0a0e27,stroke:#00d4ff,stroke-width:2px,color:#C8E6C9
    style FC2 fill:#16213e,stroke:#7b61ff,stroke-width:1px,color:#D50000
    style FD2 fill:#0a0e27,stroke:#7b61ff,stroke-width:1px,color:#00C853
    style NB2 fill:#0a0e27,stroke:#ff4444,stroke-width:1px,color:#FF6D00
    style Bid2 fill:#0a0e27,stroke:#00d4ff,stroke-width:2px,color:#FFD600
    style FC3 fill:#16213e,stroke:#7b61ff,stroke-width:1px,color:#BDBCCC
    style FD3 fill:#0a0e27,stroke:#7b61ff,stroke-width:1px,color:#00C853
    style NB3 fill:#0a0e27,stroke:#ff4444,stroke-width:1px,color:#FF6D00
    style Bid3 fill:#0a0e27,stroke:#00d4ff,stroke-width:2px,color:#FFF9C4
    style Auction fill:#0a0e27,stroke:#ff4444,stroke-width:2px,color:#D50000
    style Deduct fill:#16213e,stroke:#7b61ff,stroke-width:2px,color:#BDBCCC
    style Kafka fill:#0a0e27,stroke:#7b61ff,stroke-width:1px,color:#00C853
    style CH fill:#0a0e27,stroke:#7b61ff,stroke-width:1px,color:#BDBCCC
```
:::

## 出价链路解析

![出价链路架构图](/images/bidding-chain.png)

::: details Mermaid 代码（点击展开）
```text
flowchart TB
 subgraph SlowLink["慢链路 (离线/近线) - 决定大方向与调控系数"]
    direction TB
        grabber["grabber<br>Flink流作业<br>清洗采集"]
        Upstream["上游业务系统<br>订单/退款/成交"]
        Kafka[("Kafka")]
        piston["piston<br>C++高吞吐消费者<br>按计划维度聚合"]
        Redis[("Redis<br>后验数据快照")]
        swivel["swivel<br>编排引擎/慢链路大脑"]
        propeller["propeller"]
        catapult["catapult<br>算法引擎 MPC"]
        MQ[("MQ 消息队列")]
  end
 subgraph FastLink["快链路 (在线) - 用户请求瞬间完成"]
    direction TB
        ad_engine["ad_engine<br>Go语言编排器<br>不在本地仓库"]
        User(["用户请求"])
        ad_predict["ad_predict<br>预估服务"]
        pidbidding_handler["pidbidding_handler<br>系数查表服务"]
        rerankercpp["rerankercpp<br>重排与出价服务"]
        drilllib["drilllib<br>出价公式库 C++库"]
  end
    Upstream -- 实时事实数据 --> grabber
    grabber -- 写入 --> Kafka
    Kafka -- 消费 --> piston
    piston -- 写入快照 --> Redis
    swivel -. 定时/事件触发 .-> swivel
    Redis -- 读取计划后验数据 --> swivel
    swivel -- 获取模型参数 --> propeller
    swivel -- 打包后验数据 --> catapult
    catapult -- 核心动作: 扣除退款计算真实收益 --> catapult
    catapult -- 返回调控系数 --> swivel
    swivel -- 写回 --> Redis
    swivel -- 异步推送系数更新 --> MQ
    MQ -- 订阅系数更新 --> pidbidding_handler
    User --> ad_engine
    ad_engine -- "1. 获取用户级预估" --> ad_predict
    ad_engine -- "2. 获取计划级系数" --> pidbidding_handler
    ad_predict -- 返回 pCTR/pCVR/GMV/净成交率 --> ad_engine
    pidbidding_handler -. 后台常驻消费者 .-> pidbidding_handler
    pidbidding_handler -- 返回计划系数包<br>不看用户特征 --> ad_engine
    ad_engine -- "3. 合并数据打包请求" --> rerankercpp
    rerankercpp -- 组装上下文 --> rerankercpp
    rerankercpp -- 调用 --> drilllib
    drilllib -- "核心动作: GMV * 净成交率 = 净GMV" --> drilllib
    drilllib -- 返回初步出价 --> rerankercpp
    rerankercpp -- "4. 规则修正<br>预算打折/净成交boost" --> rerankercpp
    rerankercpp -- 返回最终出价 --> ad_engine

     grabber:::offline
     Kafka:::db
     piston:::offline
     Redis:::db
     swivel:::offline
     propeller:::offline
     catapult:::offline
     catapult:::algo
     MQ:::mq
     ad_predict:::online
     pidbidding_handler:::online
     rerankercpp:::online
     drilllib:::online
     drilllib:::algo
    classDef offline fill:#1a202c,stroke:#4a5568,stroke-width:2px,color:#e2e8f0
    classDef online fill:#0a0e27,stroke:#00d4ff,stroke-width:2px,color:#e2e8f0
    classDef algo fill:#450a0a,stroke:#ef4444,stroke-width:2px,color:#fca5a5
    classDef db fill:#16213e,stroke:#7b61ff,stroke-width:2px,color:#e2e8f0
    classDef mq fill:#2d3748,stroke:#ecc94b,stroke-width:2px,color:#ecc94b
```
:::
