---
id: note-fl-003
difficulty: L4
category: ai
subcategory: Agent
tags:
- 字节
- 飞连
- 面经
- BadCase
- Prompt优化
feynman:
  essence: 模型不听指令时，按"从便宜到贵"的优先级解：流程约束（最便宜，框架层硬规则）→ 后处理（regex/strip兜底）→ Prompt优化（加few-shot）→ 模型参数（temperature↓）→ 微调（最贵，几千条才值得）。定位必须有端到端 trace，每个改完跑 200 条 bad case 回归集看"修复率 vs 回归率"。
  analogy: 就像小孩不听话——先立规矩（流程约束：不写完作业不能看电视），再纠小错（后处理：擦掉错别字），再讲道理（Prompt优化：举几个好例子），再调状态（模型参数：让 ta 冷静点 temperature↓），最后才请家教（微调：专项训练）。
  first_principle: LLM 输出的不确定性是本质特征。纠正手段的成本和收益呈反比——越便宜的越先试，越贵的越留到最后。所有纠正都要可量化（评测集），否则就是盲目调参。
  key_points:
  - '解决优先级：流程约束 > 后处理 > Prompt > 模型参数 > 微调'
  - '典型 bad case：幻觉式工具调用、省略式作答、格式漂移、中英混杂'
  - '定位必须有端到端 trace（每步 input/output/latency/cost 落表）'
  - '200-500 条 bad case 回归集，每次改完跑"修复率 vs 回归率"'
  - '反思结果要摘要后再写回，不留原始错误文本（否则污染上下文）'
first_principle:
  essence: 不确定性纠正 = 成本递增的层级防御
  derivation: LLM 输出不确定 → 单点纠正不可靠 → 多层防御（流程>后处理>prompt>参数>微调）→ 每层成本递增效果递增 → 按性价比从低到高试 → 每层都需量化评测验证
  conclusion: 模型不听指令不是"调 prompt"一个问题，而是"5 层防御 + 量化评测"的工程体系
follow_up:
- LLM-as-a-Judge 做自动评测有什么偏差？怎么校准？
- 微调（SFT/DPO）什么时候才值得做？数据量门槛是多少？
- 反思（Reflection）写回上下文为什么会污染？怎么避免？
---

# 【字节飞连面经】项目中模型不听指令怎么办？怎么定位？反思会污染上下文吗？

## 一、典型 bad case 四类

| 类型 | 表现 | 例子 |
|------|------|------|
| 幻觉式工具调用 | 工具名拼错 | `get_user_info` → `getUserInfo` |
| 省略式作答 | 跳过工具直接给答案 | ReAct 流程里"我觉得答案是…" |
| 格式漂移 | 要求 JSON 但偶尔加 markdown | ```json ... ``` 包裹 |
| 中英混杂 | 要求纯中文但混英文术语 | "请用 React framework 实现" |

## 二、定位：必须有端到端 trace

```sql
-- 每步的 input/output/latency/cost 全落 agent_steps 表
SELECT step_id, tool_name, input_json, output_json, latency_ms, cost_usd
FROM agent_steps
WHERE trace_id = 'xxx'
ORDER BY ts;
```

**SQL 一查就知道在哪段崩**。没 trace 的项目 bad case 定位基本靠猜——这是大忌。

## 三、解决手段优先级（从便宜到贵）

```
[1] 流程约束（最便宜）
    │  在框架层写硬规则：必须先调工具才能答
    │  模型再不听话也走不通
    ▼
[2] 后处理（次便宜）
    │  JSON 解析失败 → 强制 regex 兜底
    │  格式漂移 → strip code fence
    ▼
[3] Prompt 优化
    │  加 1-3 条 few-shot 比改 system prompt 见效快
    ▼
[4] 模型参数
    │  temperature ↓（0.2）、top_p ↓
    │  稳定输出，但牺牲发散性
    ▼
[5] 微调（最贵）
       bad case 量级到几千条才值得做 SFT/DPO
```

**为什么这个顺序**：越靠前的手段成本越低、迭代越快、风险越小。微调要标数据、训模型、做评测，几周起步，且可能引入新 bad case。

## 四、评测数据：200-500 条 bad case 回归集

- 一份 **200–500 条**的人工标注 bad case 回归集
- 每次改完跑一遍，看两个指标：
  - **修复率**：原来错的现在对了多少
  - **回归率**：原来对的现在错了多少（这个最容易翻车）
- 业务侧再看 north star：工单解决率、人工兜底比例

## 五、反思会不会污染上下文？会

如果把"我刚才错了"原样塞回 context，下一轮模型容易：
- 过度自我怀疑（什么都先道歉）
- 重复道歉循环
- 被错误示例带偏

**处理方式**：
- 反思结果**摘要后再写回**（提炼成"应该先调工具"这种规则），不留原始错误文本
- 或反思放到独立 scratchpad，不进主 context

## 六、加分点

提到 **LLM-as-a-Judge** 做自动评测，并能说出 judge 模型的偏差：
- 偏好长答案（verbosity bias）
- 偏好自己生成的内容（self-preference）
- 位置偏好（A/B 测试时放前面的更易被选）

→ 要用 **swap position + 多 judge 投票** 校准。

## 七、雷区

- ❌ "改了 prompt 感觉好多了" → 没数据 = 没改
- ❌ "一上来就微调" → 成本失控，且可能引入新 bad case
- ❌ "反思直接塞回 context" → 污染

## 八、扩展

- 常见 ReAct bad case：模型把 `Observation:` 当成自己生成的内容继续编 → 用 `stop_sequence` 强制截断
- DPO 训练数据门槛：一般 5k-10k 偏好对才有显著效果，少于这个量不如调 prompt
- 评测体系三层：单元评测（单个工具调用）→ 集成评测（端到端流程）→ 业务评测（north star 指标）
