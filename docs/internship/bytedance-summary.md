---
title: 实习总结：广告系统架构总结
date: 2026-10-09
---

# 实习总结：广告系统架构总结

## 广告竞价系统架构

::: details 点击查看简化流程图
![广告流程简化图](/images/ad-flow.png)

```text
flowchart LR
    subgraph B[DSP]
        direction LR
        R[召回]
        C1[粗排]
        F[精排]
        P[调价<br/>pBidPrice]
        R -- 1w --> C1 -- 1k --> F -- 个位数 --> P
    end

    A[广告主] -- 100w --> B
    B --> C[ADX]
    C --> D[SSP / 媒体]
    D --> E[用户]
```
:::

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

![出价链路架构图](/images/bidding-flow.png)

::: details Mermaid 代码（点击展开）
```text
flowchart TB
 subgraph SlowLink["慢链路 (离线/近线) - 决定大方向与调控系数"]
    direction TB
        Upstream["上游业务系统"]
        grabber["grabber<br>Flink流作业"]
        Kafka[("Kafka")]
        piston["piston<br>C++消费者"]
        Redis[("Redis")]
        swivel["swivel<br>编排引擎"]
        propeller["propeller"]
        catapult["catapult<br>算法引擎 MPC"]
        cache[("存储")]
        MQ[("MQ")]
  end
 subgraph FastLink["快链路 (在线)"]
    direction TB
        User(["用户请求"])
        ad_engine["ad_engine"]
        ad_predict["ad_predict<br>预估服务"]
        pidbidding_handler["pidbidding_handler"]
        rerankercpp["rerankercpp"]
        drilllib["drilllib"]
  end
    Upstream --> grabber
    grabber --> Kafka
    Kafka --> piston
    piston --> Redis
    Redis --> swivel
    swivel -. .-> swivel
    swivel --> propeller
    swivel --> catapult
    catapult --> swivel
    swivel --> Redis
    swivel --> cache
    swivel --> MQ
    MQ --> pidbidding_handler
    User --> ad_engine
    ad_engine --> ad_predict
    ad_engine --> pidbidding_handler
    ad_predict --> ad_engine
    pidbidding_handler --> ad_engine
    ad_engine --> rerankercpp
    rerankercpp --> drilllib
    drilllib --> rerankercpp
    rerankercpp --> ad_engine

     Upstream:::offline
     grabber:::offline
     Kafka:::db
     piston:::offline
     Redis:::db
     swivel:::offline
     propeller:::offline
     catapult:::offline
     catapult:::algo
     cache:::db
     MQ:::mq
     User:::online
     ad_engine:::online
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
