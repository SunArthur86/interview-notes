---
id: note-hw-003
difficulty: L3
category: ai
subcategory: 数据工程
tags:
- 华为
- 面经
- 数据湖
- AI基础设施
- 盘古大模型
feynman:
  essence: 数据湖是大模型训练的"原料仓库+预处理工厂"——以原始格式集中存储海量多模态数据，提供统一的访问、清洗、版本管理能力，支撑从原始数据到训练就绪数据集的全链路。
  analogy: 数据湖像一个超大型"中央厨房"——农贸市场各种食材（结构化表、JSON、图片、视频）原样进来存在冷库，按需解冻、清洗、切配、检验，最后做出标准化净菜（训练集）送到餐厅（训练集群）。
  first_principle: 大模型训练的第一性原理是"Data is all you need"——模型能力上限由数据质量决定。数据湖的角色就是把混乱的多源原始数据，转化为"高质量、可追溯、可复现"的训练数据，是连接"数据采集"和"模型训练"的核心枢纽。
  key_points:
  - 数据湖存储原始格式数据（schema-on-read），区别于数据仓库（schema-on-write）
  - 大模型数据湖需要支撑多模态（文本/图片/视频/音频）+ 多格式（parquet/jsonl/webdataset）
  - 核心能力：海量存储、统一元数据、数据版本、数据血缘、质量评估
  - 华为盘古L0/L1分层：L0通用语料 → L1行业语料 → L2领域微调
first_principle:
  essence: 数据湖的本质是"存算分离的原始数据集中地 + 统一治理层"
  derivation: 传统数仓要求先建schema再写入（ETL），无法应对大模型数据的"先有数据后有用途"特性。数据湖以对象存储（OBS/S3）为底座，schema推迟到读取时（schema-on-read），元数据层（Lakehouse/Hive Metastore）提供结构和治理。对大模型而言，还需要在数据湖之上构建"数据预处理pipeline"和"数据质量评估"，形成"数据→信息→知识→训练数据"的转化链路。
  conclusion: 数据湖是大模型数据基础设施的核心，决定了从原始数据到模型能力的转化效率和成本
follow_up:
- 数据湖和数据仓库、Lakehouse有什么区别？
- 如何评估大模型训练数据集的质量？
- 华为盘古大模型的数据分层（L0/L1/L2）具体怎么划分？
memory_points:
- 核心定义：数据湖是集中存原始数据的系统，采用 Schema-on-Read 读取时定义结构。
- 时代演进：相比传统数仓，大模型数据湖转向多模态格式，PB级海量吞吐与随机采样。
- 全链路角色：涵盖采集、原始存储、清洗去重质检，到版本化交付训练集群的完整生命周期。
- 治理重点：大模型数据更关注质量过滤、毒性检测、PII脱敏与训练可复现性。
---

# 【华为面经】AI DC 数据基础设施/数据湖在大模型训练中的角色

## 一、数据湖的基本概念

### 1.1 什么是数据湖

**数据湖（Data Lake）** 是一个集中式存储系统，以**原始格式**保存海量结构化和非结构化数据，支持**schema-on-read**（读取时才定义结构）。

```
传统数据仓库（Schema-on-Write）：
原始数据 → [ETL清洗转换] → 严格Schema表 → SQL查询
                ↑ 提前定义结构，不符合规则的数据被丢弃

数据湖（Schema-on-Read）：
原始数据 → [原样存储] → 需要时按需定义结构读取
                ↑ 先存再算，灵活应对未知的未来用途
```

### 1.2 数据湖在大模型时代的演进

传统数据湖主要处理**结构化业务数据**（CSV、Parquet、关系表）。大模型时代，数据湖的核心变化：

| 维度 | 传统数据湖 | 大模型数据湖 |
|------|-----------|-------------|
| **数据类型** | 结构化为主 | 多模态：文本、图片、视频、音频、代码 |
| **数据量** | TB级 | PB级（GPT-4训练用13万亿token） |
| **数据格式** | Parquet、ORC | JSONL、WebDataset、TFRecord、原始二进制 |
| **访问模式** | 批量SQL查询 | 高吞吐流式读取、随机采样 |
| **核心指标** | 查询延迟 | 数据质量、去重率、毒性过滤 |
| **治理重点** | 数据血缘、权限 | 数据来源、版权、PII脱敏、可复现性 |

## 二、数据湖在大模型训练全链路中的角色

### 2.1 大模型数据生命周期

```
┌─────────────────────────────────────────────────────────────────┐
│                    数据湖（AI Data Infrastructure）              │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│  │ 1.采集层  │ → │ 2.存储层  │ → │ 3.处理层  │ → │ 4.交付层  │    │
│  │ Ingest   │   │ Storage  │   │ Process  │   │ Serve    │    │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘    │
│       ↓              ↓              ↓              ↓           │
│  爬虫/埋点/Sensor  对象存储      清洗/去重/质检   训练数据集       │
│  API接入          (OBS/S3/HDFS)  标注/增强       版本管理        │
└─────────────────────────────────────────────────────────────────┘
                          ↓
                  ┌───────────────┐
                  │ 5.训练集群     │
                  │ 昇腾NPU/GPU集群│
                  └───────────────┘
```

### 2.2 各层详解

#### 层1：数据采集层（Ingestion）

```python
# 多源数据接入数据湖
sources = {
    "web_crawl":  stream_from_spider("cc-net"),      # Common Crawl网页
    "books":      batch_upload("gutenberg/*.epub"),  # 书籍
    "code":       mirror_from_github("github_dump"), # 代码
    "internal":   export_from_db("huawei_kb"),       # 企业内部知识库
    "multimodal": sync_from_oss("image_dataset"),    # 图片/视频
}

for name, stream in sources.items():
    write_to_lake(
        stream,
        path=f"s3://pangu-lake/raw/{name}/",
        format="jsonl",  # 原样存，不做转换
        partition=["date"],  # 按日期分区
    )
```

#### 层2：存储层（Storage）

大模型数据湖的存储架构：

```
物理层（对象存储 OBS/S3）
├── raw/                    # 原始数据区（Bronze层）
│   ├── web/2026-06/       # 按日期分区
│   ├── books/
│   └── images/
├── processed/              # 清洗后数据（Silver层）
│   ├── deduped/           # 去重后
│   ├── filtered/          # 质量过滤后
│   └── annotated/         # 标注后
└── curated/                # 训练就绪数据（Gold层）
    ├── pretrain_v3.2/     # 预训练集（版本化）
    ├── sft_alignment/
    └── rlhf_prompt/

元数据层（Hive Metastore / Iceberg / Delta Lake）
├── 表结构定义
├── 数据血缘（哪个表从哪个表加工来）
├── 版本快照（可回溯任意历史版本）
└── 统计信息（行数、大小、列分布）
```

#### 层3：处理层（Processing Pipeline）

```python
# 大模型数据预处理pipeline（运行在数据湖之上的Spark/Ray集群）
def pretrain_pipeline(raw_path, version="v3.2"):
    # 1. 语言识别 & 过滤
    lang_ok = filter_language(load(raw_path), langs=["zh", "en"])

    # 2. 质量过滤（perplexity + 启发式规则）
    quality_ok = filter_quality(lang_ok, min_score=0.7)

    # 3. 去重（MinHash LSH，模糊去重 + 精确去重）
    deduped = deduplicate(quality_ok, method="minhash", threshold=0.8)

    # 4. 安全过滤（毒性、PII脱敏）
    safe = filter_toxicity(mask_pii(deduped))

    # 5. Tokenize & 打包
    packaged = tokenize_and_pack(safe, tokenizer=tokenizer)

    # 写入curated区，带版本
    write_to_lake(packaged, f"s3://pangu-lake/curated/pretrain_{version}/")
    # 记录数据血缘：curated/pretrain_v3.2 ← processed/safe ← raw/web
```

#### 层4：交付层（Serving）

```python
# 训练集群从数据湖拉取数据
class DataLoader:
    def __init__(self, lake_path, version="v3.2"):
        # 从元数据层获取该版本所有文件列表
        self.files = lake.list_files(f"curated/pretrain_{version}/")

    def stream(self, batch_size=2048):
        """流式读取，避免一次性加载PB级数据"""
        for shard in shuffle(self.files):  # 跨文件shuffle
            for record in read_shard(shard):
                yield record
                if count % batch_size == 0:
                    yield flush_batch()

# 训练代码
loader = DataLoader("s3://pangu-lake/", version="v3.2")
for batch in loader.stream():
    loss = model.train_step(batch)  # 昇腾NPU集群训练
```

## 三、华为盘古大模型的数据分层架构

华为面试中提到的"盘古L0层预训练语料"，是华为盘古大模型的数据分层标准：

```
盘古大模型数据架构
├── L0：通用基座层（General Foundation）
│   ├── 多语言网页语料（Common Crawl、自有爬虫）
│   ├── 书籍、论文、百科
│   ├── 代码（GitHub、内部代码）
│   └── 目标：训练通用大模型，覆盖广泛知识
│
├── L1：行业基础层（Industry Foundation）
│   ├── 金融、政务、制造、矿山、铁路等行业语料
│   ├── 行业术语、专业知识库
│   └── 目标：在L0基础上注入行业知识
│
└── L2：场景微调层（Scenario Fine-tuning）
    ├── 具体业务场景（如矿山巡检、铁路调度）
    ├── 任务专属SFT/RLHF数据
    └── 目标：适配具体业务任务
```

数据湖的核心价值：**让L0/L1/L2的数据可追溯、可复现、可版本化**——任何一层的模型问题都能追溯到对应的数据版本。

## 四、数据湖在大模型训练中的核心价值

### 4.1 可复现性（Reproducibility）

```python
# 数据湖的版本化能力，保证训练实验可复现
experiment_2026_06 = {
    "model": "pangu-38B",
    "data_version": "pretrain_v3.2.1",  # ← 精确到patch版本
    "data_hash": "sha256:abc123...",    # ← 内容指纹
    "data_lineage": "web_v3 ← web_v2 ← raw_2026_05",
}
# 半年后发现问题 → 可精确恢复当时的训练数据 → 重新训练验证
```

### 4.2 数据质量评估闭环

```
训练效果评估
    ↓ (模型在哪些样本上表现差？)
数据质量归因
    ↓ (找出问题数据源)
数据湖重新处理
    ↓ (调整过滤规则、补充数据)
新版本数据集
    ↓
重新训练
```

### 4.3 成本优化

```
数据分层存储策略：
├── Hot（NVMe SSD）：当前训练用的curated数据，高吞吐访问
├── Warm（OBS标准）：近期处理的processed数据，按需读取
└── Cold（OBS归档）：历史raw数据，低成本长期保存
→ 90%的冷数据用归档存储，成本降低10倍
```

## 加分点

1. **了解华为盘古的数据分层**：面试时提到"L0通用→L1行业→L2场景"的三层架构，能拉近距离
2. **知道Lakehouse概念**：数据湖（灵活存储）+ 数据仓库（结构化查询 + ACID事务）的融合，代表技术 Iceberg / Delta Lake / Hudi
3. **理解大模型数据的特殊需求**：去重（MinHash/LSH）、毒性过滤、PII脱敏、版权管理，这些是传统数据湖没有的

## 雷区

- **混淆数据湖和数据仓库**：数据湖存原始数据（schema-on-read），数据仓库存结构化数据（schema-on-write），不是一回事
- **忽视数据质量**：只关注存储容量，忽略"Garbage In Garbage Out"——再大的湖，装满脏水也训不出好模型
- **版权和合规盲区**：大模型数据涉及大量版权内容（书籍、网页、代码），数据湖必须有版权标记和合规审计能力

## 扩展

- **Lakehouse三剑客**：Apache Iceberg（Netflix）、Delta Lake（Databricks）、Apache Hudi（Uber）——都提供ACID事务、时间旅行、Schema演进
- **大模型数据质量评估工具**：CCNet（Meta，网页质量打分）、datasketch（去重）、FairLLM（毒性检测）
- **华为AI DC全栈**：昇腾NPU（算力）+ MindSpore（框架）+ 盘古大模型（模型）+ 数据湖（数据），面试可结合全栈视角谈

## 记忆要点

- 核心定义：数据湖是集中存原始数据的系统，采用 Schema-on-Read 读取时定义结构。
- 时代演进：相比传统数仓，大模型数据湖转向多模态格式，PB级海量吞吐与随机采样。
- 全链路角色：涵盖采集、原始存储、清洗去重质检，到版本化交付训练集群的完整生命周期。
- 治理重点：大模型数据更关注质量过滤、毒性检测、PII脱敏与训练可复现性。

