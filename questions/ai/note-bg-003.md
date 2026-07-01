---
id: note-bg-003
difficulty: L4
category: ai
subcategory: LLM训练
tags:
- 八股总结
- 面经
- 业务基模
- 通用基模
- 模型评估
feynman:
  essence: 业务基模是为特定业务场景定制的模型，通用基模是覆盖广泛通用能力的模型。两者区别在数据分布、能力侧重、评估指标。业务基模的评估必须回归业务指标，而非通用benchmark。
  analogy: 通用基模像"通识教育的本科生"——什么都学一点，知识面广但都不深。业务基模像"定向培养的专业硕士"——在通识基础上，针对某行业/场景深度训练。评估本科生看综合成绩，评估专硕看专业对口就业。
  first_principle: 模型评估的第一性原理是"评估指标必须匹配训练目标"。通用基模的目标是"广泛能力"，用MMLU/HumanEval等通用benchmark。业务基模的目标是"业务KPI"，必须用业务场景的真实指标（转化率、准确率、用户满意度），通用benchmark只能做参考。
  key_points:
  - 业务基模：垂直领域数据 + 业务定制能力 + 业务指标评估
  - 通用基模：开放领域数据 + 通用能力 + benchmark评估
  - 评估三维度：业务指标(核心) + 通用benchmark(参考) + 在线A/B(终极)
  - 业务基模常基于通用基模继续训练（领域适配）
first_principle:
  essence: 模型价值 = 在目标场景的预期表现，而非在通用测试集的分数
  derivation: 通用benchmark（MMLU、C-Eval）衡量的是"通用知识储备"，但业务场景是长尾、具体的。一个MMLU 80分的通用模型，在特定业务（如法律合同审查）可能不如MMLU 60分但专训过法律数据的业务模型。因此业务基模的评估必须回到"业务任务的真实表现"。
  conclusion: 业务基模评估=业务数据集(主) + 通用benchmark(防退化) + 在线实验(最终验证)
follow_up:
- 业务基模训练时如何防止通用能力退化？
- 如何构建业务专属的评估数据集？
- 业务基模上线后如何持续监控效果？
memory_points:
- 通用基模重广度均衡，业务基模重私有领域数据的深度与护城河
- 主流构建路径：通用基模续训(CPT) + 领域SFT，需混入30%通用数据防退化
- 评估看权重：业务指标(60%)为核心，辅以通用benchmark(防退化)与线上AB测试
---

# 【八股总结】业务基模和通用基模有什么区别？业务基模效果如何评估？

## 一、概念定义与对比

### 1.1 通用基模（General Foundation Model）

```
定义：在海量开放领域数据上预训练，追求广泛通用能力的大模型

代表：
- GPT-4、Claude、Gemini（闭源通用）
- LLaMA、Qwen、DeepSeek（开源通用）

数据特征：
- 网页、书籍、论文、代码、多语言
- 数据量大（万亿token）、领域分布广
- 不针对特定业务优化

能力特征：
- 通用问答、写作、推理、代码
- 各方面均衡，但单领域不一定最强
- 适合作为"基座"继续训练
```

### 1.2 业务基模（Business/Domain Foundation Model）

```
定义：为特定业务场景定制训练，在通用能力基础上深度强化领域能力

代表：
- BloombergGPT（金融）
- Med-PaLM（医疗）
- 华为盘古行业模型（矿山/铁路/政务）
- 法律大模型、电商客服大模型

数据特征：
- 行业语料、业务知识库、专家标注
- 领域数据占比高（30-70%）
- 通用数据保底防退化

能力特征：
- 领域知识深度强
- 业务任务（如合同审查、病历分析）专业
- 通用能力可能略弱于同规模通用模型
```

### 1.3 核心区别对比

| 维度 | 通用基模 | 业务基模 |
|------|---------|---------|
| **训练数据** | 开放领域为主 | 领域数据高占比 |
| **能力侧重** | 均衡全面 | 领域深度优先 |
| **评估指标** | 通用benchmark | 业务KPI为主 |
| **迭代节奏** | 慢（训练成本高） | 快（持续领域适配） |
| **用户群体** | 广泛C端 | 特定B端/行业 |
| **典型规模** | 千亿到万亿参数 | 通常基于通用基模继续训 |
| **数据壁垒** | 公开数据为主 | 私有领域数据（护城河） |

## 二、业务基模的构建路径

### 2.1 路径选择

```
路径A：从零预训练业务基模（少见）
├── 适用：领域极特殊（如DNA序列），通用语料无法覆盖
├── 成本：极高（千亿token训练）
└── 案例：BloombergGPT（金融，从零训）

路径B：基于通用基模继续预训练 + SFT（主流）★
├── 适用：大多数业务场景
├── 成本：中（领域数据续训 + SFT）
└── 案例：盘古行业模型、法律GPT

路径C：仅SFT/LoRA适配（轻量）
├── 适用：领域数据量小、预算有限
├── 成本：低（只微调）
└── 案例：各种行业LoRA
```

### 2.2 路径B的详细流程

```python
def build_business_foundation_model(general_base, domain_data):
    # 阶段1：领域继续预训练（CPT, Continual Pre-Training）
    domain_model = continue_pretrain(
        base=general_base,           # 通用基模
        data=domain_data,            # 行业语料（论文、法规、案例）
        mix_ratio={                  # 混入通用数据防退化
            "domain": 0.7,
            "general": 0.3,          # 30%通用回放
        },
    )

    # 阶段2：领域SFT
    domain_model = finetune_sft(
        model=domain_model,
        data=domain_sft_data,        # 业务指令对
    )

    # 阶段3：领域RLHF（可选）
    if has_preference_data:
        domain_model = rlhf(
            model=domain_model,
            reward_model=domain_rm,
        )

    return domain_model
```

## 三、业务基模的评估体系

### 3.1 评估三维度框架

```
业务基模评估 = 业务指标(核心) + 通用benchmark(防退化) + 在线A/B(终极验证)

┌──────────────────────────────────────────────────────┐
│ 评估维度               │ 权重  │ 说明                 │
├───────────────────────┼──────┼─────────────────────┤
│ 1. 业务任务指标        │ 60%  │ 核心业务能力         │
│ 2. 通用benchmark       │ 15%  │ 确保通用不退化       │
│ 3. 领域专业考试        │ 15%  │ 行业资格水平         │
│ 4. 人工专家评估        │ 10%  │ 主观质量             │
└──────────────────────────────────────────────────────┘
最终验证：线上A/B测试
```

### 3.2 业务任务指标（核心）

```python
# 业务基模的评估必须回到业务场景
# 以"法律合同审查模型"为例

business_eval = {
    # 1. 核心业务任务（最权重）
    "contract_review": {
        "task": "识别合同中的风险条款",
        "metrics": {
            "risk_recall": "风险条款召回率（漏报=法律风险）",
            "risk_precision": "风险条款准确率（误报=效率损失）",
            "suggestion_quality": "修改建议被律师采纳率",
        },
        "dataset": "1000份真实合同 + 律师标注ground truth",
    },

    # 2. 业务相关子任务
    "clause_classification": "条款分类准确率",
    "compliance_check": "合规性检查通过率",
    "obligation_extraction": "权利义务提取F1",

    # 3. 业务KPI（最终落到业务价值）
    "lawyer_efficiency_gain": "律师审查效率提升%",
    "risk_detection_rate": "上线后风险事件减少%",
    "user_satisfaction": "内部用户满意度评分",
}
```

### 3.3 通用benchmark（防退化）

```python
# 业务基模必须跑通用benchmark，确保领域强化没有导致通用退化
general_benchmark = {
    "MMLU": "多任务语言理解（综合知识）",
    "C-Eval": "中文综合评估",
    "GSM8K": "数学推理（业务模型不应丧失基础推理）",
    "HumanEval": "代码能力",
    "BBH": "推理能力",
}

# 评估标准：通用benchmark下降不超过5%
# 如果通用能力大幅退化，说明领域训练过度，需调整mix_ratio
```

### 3.4 领域专业考试

```python
# 行业资格类考试，验证领域专业度
domain_exams = {
    "legal_model": {
        "司法考试真题": "历年司法考试选择题/案例分析",
        "bar_exam": "律师资格考试",
    },
    "medical_model": {
        "执业医师考试": "医师资格考试真题",
        "USMLE": "美国医师执照考试",
    },
    "finance_model": {
        "CPA考试": "注册会计师真题",
        "CFA Level 1/2/3": "金融分析考试",
    },
}
```

### 3.5 人工专家评估

```python
# 对于主观性强的任务，必须由领域专家评估
expert_eval_protocol = {
    "evaluators": "5名资深律师/医生/分析师",
    "method": "blind comparison（盲评，不告知哪个是模型的）",
    "dimensions": [
        "准确性（事实错误数）",
        "完整性（是否遗漏要点）",
        "专业性（术语使用、逻辑严密）",
        "可操作性（建议是否可落地）",
    ],
    "scale": "1-5分Likert量表",
    "baseline": "与通用基模对比，与人类专家对比",
}
```

### 3.6 在线A/B测试（终极验证）

```python
# 业务基模最终必须通过线上实验验证
ab_test_design = {
    "control": "现有方案（通用模型 or 人工）",
    "treatment": "业务基模",
    "metrics": [
        "业务转化率",
        "任务完成率",
        "用户满意度",
        "人工介入率",
        "单位成本",
    ],
    "duration": "2-4周",
    "traffic": "10% → 50% → 100% 灰度",
}

# 只有A/B显著正向，才正式全量上线
```

## 四、评估的常见陷阱

### 4.1 陷阱1：用通用benchmark评估业务模型

```
❌ 错误做法：
   "我们的法律模型MMLU考了75分，比GPT-4的86分低，所以不行"

✅ 正确认知：
   - 法律模型的价值在法律任务，不在MMLU
   - MMLU 75分足够（通用能力够用即可）
   - 关键看法律合同审查的准确率
```

### 4.2 陷阱2：评估数据泄漏

```python
# 业务基模训练时用了某合同库
# 评估时又用同一个库测试
# → 分数虚高，上线后效果远差于评估

# 对策：严格的train/test分割
eval_contracts = contracts[
    (contracts.date >= "2026-01-01")  # 评估只用新数据
    & ~contracts.id.isin(training_ids)  # 排除训练集
]
```

### 4.3 陷阱3：忽视分布偏移

```python
# 评估集是"典型合同"，但线上会遇到"非典型合同"
# → 评估分数好，线上翻车

# 对策：评估集必须覆盖边缘场景
eval_set = {
    "typical": 70%,      # 典型合同
    "edge_cases": 20%,   # 边缘（跨国、罕见条款）
    "adversarial": 10%,  # 对抗样本（故意误导）
}
```

## 五、业务基模的持续迭代

```python
# 业务基模不是一次训练完成，而是持续迭代
class BusinessModelIteration:
    def lifecycle(self):
        while True:
            # 1. 收集线上badcase
            badcases = collect_from_production()

            # 2. 分析badcase，定位短板
            weak_areas = analyze_weakness(badcases)

            # 3. 针对性补充数据
            new_data = collect_and_annotate(weak_areas)

            # 4. 增量训练
            model = incremental_train(model, new_data)

            # 5. 全量评估（业务+通用）
            if self.eval(model) > threshold:
                # 6. A/B → 上线
                deploy(model)
```

## 加分点

1. **强调"业务指标优先"**：业务基模的价值在业务表现，通用benchmark只是防退化的下限检查
2. **提到数据壁垒**：业务基模的护城河是私有领域数据，不是模型架构——这是B端模型的核心竞争力
3. **线上A/B作为终极标准**：任何离线评估都不如真实用户验证，体现工程成熟度

## 雷区

- **用通用benchmark定义业务模型好坏**：MMLU分数对法律模型意义有限
- **评估数据泄漏**：训练测试不分，分数虚高
- **忽视通用能力退化**：只看业务指标，模型通用能力崩了（连基础问答都不行）

## 扩展

- **BloombergGPT**：金融领域基模的经典论文，详细讨论了领域vs通用的权衡
- **Med-PaLM/Palmyra**：医疗领域基模，强调领域考试（USMLE）评估
- **Leaderboard效应**：很多模型为了刷benchmark而overfit测试集，真实业务表现差

## 记忆要点

- 通用基模重广度均衡，业务基模重私有领域数据的深度与护城河
- 主流构建路径：通用基模续训(CPT) + 领域SFT，需混入30%通用数据防退化
- 评估看权重：业务指标(60%)为核心，辅以通用benchmark(防退化)与线上AB测试

