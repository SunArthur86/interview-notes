---
id: note-tt-agent-006
difficulty: L3
category: ai
subcategory: Memory
tags:
  - 淘天
  - 面经
  - 二面
  - 用户画像
  - 记忆冲突
  - RAG
feynman:
  essence: 用户长期画像和当前会话冲突时，当前会话优先但需保留历史；防止RAG回复僵硬要用"RAG做参考不做约束"，让模型以用户问题为中心组织回答
  analogy: 就像餐厅服务员——熟客档案说"不吃香菜"（长期画像），但今天客人说"给我加香菜"（当前会话），当然听当前的，同时记住"可能口味变了"
  first_principle: 长期画像是统计聚合（低频更新），当前会话是即时意图（高频变化）。信息新鲜度不同，应按时间就近原则优先当前会话
  key_points:
    - 当前会话信息优先于长期画像（时间就近原则）
    - 冲突时触发画像更新流程（异步不阻塞回答）
    - RAG做参考不做约束：检索内容是素材而非模板
    - 防止僵硬：动态Prompt组装+自然语言桥接
first_principle:
  essence: 长期画像本质是历史统计，当前会话是实时信号，二者权重不应均等
  derivation: '长期画像基于过去30天行为统计，当前会话是最近5分钟的意图。在推荐系统中，实时信号权重应为70%，历史画像30%。完全依赖画像会导致"刻舟求剑"'
  conclusion: 冲突处理 = 当前优先 + 异步更新画像 + RAG参考化 + 以用户问题为中心
follow_up:
  - 画像更新频率怎么定？实时更新还是T+1批量更新？
  - 如果当前会话是用户口误或测试，错误更新画像怎么回滚？
  - RAG回复僵硬的具体表现有哪些？如何度量？
---

# 用户长期画像和当前会话信息冲突时，系统怎么处理？如何防止RAG内容导致模型回复僵硬？

## 冲突场景

```
用户长期画像（过去30天聚合）：
  ├── 偏好：简约风格、冷色调
  ├── 预算：500-1000元
  └── 品类偏好：数码 > 家居 > 服装

当前会话（最近3轮）：
  ├── "帮我推荐一件红色卫衣"      ← 偏好冲突（冷色调 vs 红色）
  ├── "预算200左右"              ← 预算冲突（500+ vs 200）
  └── "顺便看看家居摆件"          ← 品类一致
```

## 冲突处理架构

```python
class ConflictResolver:
    def resolve(self, long_term: dict, current_session: dict) -> dict:
        """当前会话优先，长期画像补充"""
        merged = {}

        for key in set(list(long_term.keys()) + list(current_session.keys())):
            if key in current_session and key in long_term:
                # 冲突：当前会话优先
                if self._is_conflict(long_term[key], current_session[key]):
                    merged[key] = current_session[key]
                    # 异步触发画像更新
                    self._queue_profile_update(key, current_session[key])
                else:
                    merged[key] = current_session[key]
            elif key in current_session:
                merged[key] = current_session[key]
            else:
                # 当前会话没提的，用长期画像补充
                merged[key] = long_term[key]

        return merged

    def _is_conflict(self, long_val, current_val):
        """判断是否真正冲突（语义层面）"""
        # 例：冷色调 vs 红色 → 冲突
        #     数码 vs 摆件 → 不冲突（补充关系）
        return semantic_contradiction(long_val, current_val)
```

## 防止RAG回复僵硬

### 问题根源

```
❌ 僵硬的RAG回复：
  用户问："这个手机拍照怎么样？"
  RAG检索到："该手机搭载1亿像素主摄，支持OIS光学防抖，夜景模式..."
  模型回复："该手机搭载1亿像素主摄，支持OIS光学防抖，夜景模式..."
  → 直接复制检索内容，像产品说明书，不像对话
```

### 解决方案

```python
def build_natural_prompt(user_question: str, rag_context: str, user_profile: dict):
    """以用户问题为中心，RAG做参考素材"""

    return f"""你是一个智能导购助手。请根据以下信息回答用户问题。

⚠️ 重要规则：
1. 用自然对话语气回答，不要像产品说明书
2. RAG内容只是参考素材，要用自己的话重新组织
3. 围绕用户的具体问题回答，不要堆砌无关参数
4. 结合用户偏好（{user_profile}）给出个性化建议

用户问题：{user_question}

参考资料（仅供参考，不要照抄）：
{rag_context}

请回答："""
```

### 僵硬度度量

```python
def measure_stiffness(response: str, rag_context: str) -> float:
    """量化回复僵硬度（0=自然, 1=完全照抄）"""
    # 1. N-gram重叠率
    ngram_overlap = calculate_ngram_overlap(response, rag_context, n=4)

    # 2. 句式多样性（句长方差、句式种类）
    sentence_diversity = calculate_sentence_diversity(response)

    # 3. 个性化程度（是否引用了用户画像信息）
    personalization = has_personalization(response)

    stiffness = ngram_overlap * 0.5 + (1 - sentence_diversity) * 0.3 + (1 - personalization) * 0.2
    return stiffness  # 目标 < 0.3
```

## 面试加分点

1. **画像更新策略**：不是每次冲突都立即更新画像，用滑动窗口统计（如最近10次行为中冲突>5次才更新）
2. **RAG的角色定位**：RAG是"知识库"，不是"话术库"——模型应消化知识后用自己的话回答
3. **A/B测试**：对比"纯RAG模式"vs"RAG+个性化Prompt"的回复满意度差异
4. **安全兜底**：当用户当前会话信息明显异常（如预算=0）时，不盲目遵循而是确认
