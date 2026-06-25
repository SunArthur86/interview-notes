---
id: note-tt-agent-019
difficulty: L3
category: ai
subcategory: 推理优化
tags:
  - 淘天
  - 面经
  - 二面
  - 模型选型
  - 7B
  - 32B
  - 蒸馏
feynman:
  essence: 7B适合高并发低延迟场景（分类/提取/简单对话），32B适合复杂推理（规划/多步推理/创作）。小模型蒸馏部署是用大模型的输出去训练小模型，保留核心能力
  analogy: 就像公司用人——简单事务交给实习生（7B，快但能力有限），复杂决策交给资深专家（32B，慢但准确），实习生跟着专家学就是蒸馏
  first_principle: 模型能力和推理成本是Trade-off。选型本质是在"准确率×延迟×成本"三角中找到最优平衡点
  key_points:
    - 7B优势：速度快、成本低、可本地部署
    - 32B优势：推理能力强、指令遵循好、适合复杂任务
    - 蒸馏流程：32B生成高质量数据→7B学习→接近32B效果
    - 路由策略：动态分配简单/复杂任务到不同模型
first_principle:
  essence: 任务难度分布不均匀，大部分是简单任务，少数是复杂任务
  derivation: 'Agent场景统计：意图分类(40%)→7B足够，信息提取(25%)→7B足够，单步推理(20%)→14B，复杂规划(15%)→32B。全用32B浪费85%场景的成本，全用7B导致15%复杂任务质量不达标'
  conclusion: 模型选型 = 任务难度分布 × 成本约束 × 延迟要求，动态路由是最优解
follow_up:
  - 蒸馏后的小模型在什么任务上会明显不如大模型？
  - 除了蒸馏，还有哪些方法让小模型接近大模型效果？
  - 如何判断一个任务该用7B还是32B？路由模型怎么训？
---

# 7B和32B大模型选型逻辑，什么场景用小模型蒸馏部署？

## 选型决策矩阵

```
                        任务复杂度
                    低 ←─────────→ 高

              ┌──────────┬──────────┬──────────┐
    低延迟    │  ✅ 7B   │  ⚠️ 14B  │  ❌ 32B  │
    高并发    │  分类    │  简单    │  延迟    │
     ↑        │  提取    │  推理    │  不可接  │
     │        │  路由    │          │  受      │
     │        ├──────────┼──────────┼──────────┤
    低延迟    │  ✅ 7B   │  ✅ 14B  │  ⚠️ 32B  │
    低并发    │          │          │  可接受  │
     │        ├──────────┼──────────┼──────────┤
     ↓        │  ✅ 7B   │  ✅ 14B  │  ✅ 32B  │
    高延迟    │  浪费    │          │  最佳    │
    可接受    │          │          │  质量    │
              └──────────┴──────────┴──────────┘
```

## 具体场景选型

| 场景 | 推荐模型 | 原因 | 延迟 | 成本/千次 |
|------|---------|------|------|----------|
| 意图分类 | 7B | 类别有限，7B准确率已>95% | 0.3s | ¥0.5 |
| 实体提取 | 7B | 结构化任务，规则明确 | 0.5s | ¥0.5 |
| 简单对话 | 7B | FAQ类回答 | 0.5s | ¥0.5 |
| 摘要生成 | 14B | 需理解全文但不需要复杂推理 | 1.5s | ¥2 |
| 单步推理 | 14B | 需要一定的逻辑链 | 1.5s | ¥2 |
| 多步规划 | 32B | 需要长链推理和任务拆解 | 3s | ¥8 |
| 复杂创作 | 32B | 需要创意和风格控制 | 4s | ¥8 |
| Function Call | 14B+ | 参数生成需要精确理解 | 1s | ¥2 |

## 蒸馏部署流程

```python
"""
小模型蒸馏：让7B学习32B的能力
"""

# 第一步：用32B模型生成高质量训练数据
def generate_distillation_data(tasks: list):
    """32B教师模型生成高质量输出"""
    training_data = []
    for task in tasks:
        # 用32B生成详细、高质量的回答
        response = call_32b(task['prompt'], temperature=0.3)
        training_data.append({
            'input': task['prompt'],
            'output': response,  # 32B的输出作为标签
            'task_type': task['type'],
        })
    return training_data

# 第二步：用7B学生模型学习
"""
# 使用LoRA微调，保留7B的基础能力
# 训练配置
model_name: Qwen/Qwen2.5-7B-Instruct
lora_r: 64
lora_alpha: 128
learning_rate: 1e-4
num_epochs: 3
train_data: distillation_data.jsonl  # 32B生成的数据

# 训练命令
llamafactory-cli train \
    --model_name_or_path Qwen/Qwen2.5-7B-Instruct \
    --dataset distillation_data \
    --lora_rank 64 \
    --output_dir ./7b-distilled
"""

# 第三步：评估蒸馏效果
def evaluate_distillation(test_set: list):
    """对比原始7B vs 蒸馏7B vs 32B"""
    results = {'original_7b': [], 'distilled_7b': [], 'teacher_32b': []}
    for item in test_set:
        results['original_7b'].append(call_7b(item['input']))
        results['distilled_7b'].append(call_distilled_7b(item['input']))
        results['teacher_32b'].append(call_32b(item['input']))

    # 计算与32B输出的相似度
    for model in results:
        sim = avg_similarity(results[model], results['teacher_32b'])
        print(f"{model}: 与32B相似度 = {sim:.2%}")
```

## 动态模型路由

```python
class DynamicModelRouter:
    """根据任务难度动态选择模型"""
    def __init__(self):
        self.complexity_classifier = load_model('complexity-bert')  # 轻量分类器

    def route(self, user_input: str, context: dict) -> str:
        # 1. 快速分类任务难度
        complexity = self.complexity_classifier.predict(user_input)

        # 2. 根据难度选择模型
        if complexity == 'simple':
            return 'qwen-7b-distilled'
        elif complexity == 'medium':
            return 'qwen-14b'
        else:
            return 'qwen-32b'

        # 3. 兜底：Token预算或并发限制时降级
        if self.current_load > self.threshold:
            return 'qwen-7b-distilled'  # 高负载时统一用小模型
```

## 面试加分点

1. **蒸馏不是万能**：蒸馏后7B在训练分布内的任务接近32B，但分布外（OOD）任务仍差距明显
2. **成本量化**：32B单次推理成本约7B的8-10倍，日均100万次调用可节省¥7500/天
3. **渐进式策略**：先全用32B保证质量 → 统计任务难度分布 → 对简单任务蒸馏7B → 逐步替换
4. **A/B测试**：模型替换必须做A/B测试，监控准确率/满意度/投诉率变化
