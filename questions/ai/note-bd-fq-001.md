---
id: note-bd-fq-001
difficulty: L3
category: ai
subcategory: RAG
tags:
- 字节
- 番茄小说
- 面经
- OCR
- 文档解析
- 多模态
feynman:
  essence: OCR输出含噪声，需多层纠错（规则→语言模型→多引擎投票）+ 置信度控制，将结构化解析准确率从85%提升至97%+
  analogy: 就像快递分拣——先粗筛（规则正则过滤明显错误），再精检（BERT上下文修正），最后交叉验证（多引擎投票），置信度低的送人工
  first_principle: OCR错误率取决于图像质量、字体复杂度和领域专业性。单一手段无法消除所有错误类型，需要多层级、多策略的纠错体系
  key_points:
  - 规则层：领域词典+正则统一格式（日期、金额、编号）
  - 语言模型层：BERT/GPT基于上下文预测正确字符
  - 多模型投票：多OCR引擎交叉验证取最优
  - 置信度控制：低于阈值的区域进入人工审核
  - 结构化校验：利用文档布局信息交叉验证
first_principle:
  essence: OCR本质是图像到文本的概率映射，每个字符的输出都有不确定性
  derivation: 假设单字符识别准确率99%，1000字符的文档完美准确率=0.99^1000≈0.004%。不加纠错几乎不可能得到完美结果。引入规则层可修正格式类错误（约20%），BERT纠错可修正语义错误（约10%），多引擎投票降低系统偏差（约5%）
  conclusion: OCR纠错不是单一技术，而是规则+模型+工程的组合策略，核心是"分层纠错+置信度兜底"
follow_up:
- 手写体OCR和印刷体OCR的纠错策略有什么不同？
- 如何量化OCR纠错的效果？有没有自动化评测方案？
- 在RAG场景下，OCR噪声对向量检索的影响有多大？
memory_points:
- 四层纠错体系：规则粗筛(正则) -> 模型精修(语义) -> 多引擎投票 -> 置信度兜底(人工)
- 规则纠错：专治格式与形近字(如巳经变已经)，利用领域词典高效修正
- 模型纠错：BERT解决上下文连贯性，LLM应对复杂版面语义场景
- 系统纠偏：多OCR引擎字符级投票取最优，低置信度区域强制转入人工审核
---

# OCR结果有噪声或错误时，如何做纠错或提升解析质量？

## 问题背景

> 字节番茄小说AI Agent面试高频问题。番茄小说有大量图片形式的小说/文档需要解析，OCR质量直接影响RAG检索和下游Agent的生成质量。

## 纠错体系架构

```
OCR原始输出（含噪声）
  │
  ▼
┌─────────────┐
│  规则纠错层   │  正则+领域词典，修正格式类错误
│  (快速粗筛)   │  → 消除约20%错误
└──────┬──────┘
       ▼
┌─────────────┐
│  模型纠错层   │  BERT/LLM上下文修正
│  (语义精修)   │  → 消除约10%错误
└──────┬──────┘
       ▼
┌─────────────┐
│  多引擎投票   │  交叉验证取最优
│  (系统纠偏)   │  → 消除约5%错误
└──────┬──────┘
       ▼
┌─────────────┐
│  置信度控制   │  低置信区域→人工审核
│  (兜底保障)   │  → 残余2-3%由人工处理
└─────────────┘
```

## 第一层：规则纠错

### 领域词典

```python
import re

# 小说场景的常见OCR错误模式
DOMAIN_RULES = {
    # 日期格式统一
    r'(\d{4})年(\d{1,2})月(\d{1,2})日': r'\1-\2-\3',
    # 常见形近字修正（视觉相似）
    '巳经': '已经', '己经': '已经',
    '未末': '未来', '土也': '地',
    # 标点修正
    '，，': '，', '。。': '。',
    # 数字修正（O→0, l→1, I→1）
    r'(?<=[\d,])([OIl])(?=[\d,])': lambda m: {'O':'0','l':'1','I':'1'}[m.group(1)],
}

def rule_correct(text: str) -> str:
    for pattern, replacement in DOMAIN_RULES.items():
        text = re.sub(pattern, replacement, text)
    return text
```

### 结构化校验

```python
def validate_structure(ocr_result: dict, doc_layout: dict) -> list:
    """利用文档布局信息交叉验证OCR结果"""
    issues = []
    # 检查表格行列一致性
    for table in ocr_result.get('tables', []):
        expected_rows = doc_layout.get(table['id'], {}).get('rows', 0)
        if len(table['cells']) != expected_rows:
            issues.append(f"表格{table['id']}行数不匹配: OCR={len(table['cells'])}, 布局={expected_rows}")
    return issues
```

## 第二层：语言模型纠错

```python
from transformers import pipeline

# 使用BERT做中文纠错
corrector = pipeline('text2text-generation', model='shibing624/macbert4csc-base-chinese')

def model_correct(text: str) -> tuple[str, float]:
    """基于上下文预测最可能的正确字符"""
    result = corrector(text, max_length=512, return_scores=True)
    corrected = result[0]['generated_text']
    # 计算修改置信度
    confidence = 1.0 - edit_distance(text, corrected) / max(len(text), 1)
    return corrected, confidence

# 使用GPT做复杂场景纠错
def llm_correct(text: str, context: str = "") -> str:
    prompt = f"""你是文字纠错专家。以下是OCR识别结果，可能包含形近字、同音字等错误。
请根据上下文修正，只输出修正后的文本，不要解释。

上下文：{context}
OCR原文：{text}
修正结果："""
    # 调用LLM API
    return llm_call(prompt)
```

## 第三层：多引擎投票

```python
from collections import Counter

def multi_engine_vote(text_regions: list, engines: list) -> list:
    """多个OCR引擎识别同一区域，投票取最优"""
    results = []
    for region in text_regions:
        votes = []
        for engine in engines:
            votes.append(engine.recognize(region.image))
        
        # 字符级投票
        corrected = char_level_vote(votes)
        # 整句级：取置信度最高的引擎结果
        best = max(votes, key=lambda v: v.confidence)
        
        if best.confidence > 0.95:
            results.append(best.text)
        else:
            results.append(corrected)  # 字符级投票结果
    return results
```

## 第四层：置信度控制

```python
def confidence_control(ocr_results: list, threshold: float = 0.85) -> dict:
    """置信度低于阈值的区域进入人工审核队列"""
    auto_accepted = []
    human_review = []
    
    for item in ocr_results:
        if item['confidence'] >= threshold:
            auto_accepted.append(item)
        else:
            human_review.append(item)
    
    return {
        'auto': auto_accepted,
        'review': human_review,
        'auto_rate': len(auto_accepted) / len(ocr_results),
    }
```

## 纠错效果量化

| 纠错层级 | 处理错误类型 | 准确率提升 | 耗时 |
|---------|-----------|----------|------|
| 原始OCR | - | 基线85% | - |
| +规则层 | 格式/形近字 | 85%→89% | <10ms |
| +BERT层 | 同音字/上下文 | 89%→93% | ~50ms |
| +多引擎 | 系统偏差 | 93%→96% | ~200ms |
| +人工兜底 | 残余疑难 | 96%→99%+ | 人工 |

## 面试加分点

1. **分层设计思维**：不是靠单一手段，而是"规则快速过滤→模型语义修正→多引擎交叉验证→人工兜底"的分层策略
2. **量化指标**：能说出每层纠错的准确率提升幅度和处理耗时
3. **业务理解**：不同场景（小说/表格/公式）的OCR噪声类型不同，纠错策略需定制化
4. **成本意识**：规则层几乎零成本应优先，模型层按需触发，人工兜底控制比例在2-3%

## 记忆要点

- 四层纠错体系：规则粗筛(正则) -> 模型精修(语义) -> 多引擎投票 -> 置信度兜底(人工)
- 规则纠错：专治格式与形近字(如巳经变已经)，利用领域词典高效修正
- 模型纠错：BERT解决上下文连贯性，LLM应对复杂版面语义场景
- 系统纠偏：多OCR引擎字符级投票取最优，低置信度区域强制转入人工审核

