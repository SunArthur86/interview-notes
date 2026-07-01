---
id: note-mt-agent-007
difficulty: L4
category: ai
subcategory: Agent
tags:
- 美团
- 面经
- 记忆系统
- 短期记忆
- 长期记忆
feynman:
  essence: 短期记忆服务于当前任务的即时决策高频读写容量有限，长期记忆是跨会话的知识沉淀低频写入需置信度验证。
  analogy: 短期记忆等于工作台正在处理的文件，长期记忆等于档案柜验证过的经验。
  first_principle: 记忆系统设计等于容量管理乘以过期策略乘以写入门槛乘以检索效率。
  key_points:
  - 短期记忆当前步骤上下文
  - 长期记忆跨会话知识
  - 短期高频读写过期即弃
  - 长期需置信度判断才写入
first_principle:
  essence: 记忆分层等于不同时间尺度信息管理
  derivation: 所有信息放上下文窗口爆炸，分层短期秒级中期天级长期永久加检索
  conclusion: 记忆系统是Agent持续学习的基础设施
follow_up:
- 长期记忆用什么存储？
- 如何防止错误信息写入长期记忆？
- 遗忘机制怎么设计？
memory_points:
- 核心对比：短期记忆是“工作台”（高频读写、随任务结束过期），而长期记忆是“档案柜”（低频写入、跨会话永久保存）。
- 因为作用不同，所以存储引擎不同：短期用上下文/缓存，而长期依赖向量数据库。
- 生命周期与容量：短期受限于上下文窗口（秒~分级），长期近乎无限（需TTL淘汰）。
- 核心机制：短期记忆需通过“置信度判断”与“高频引用”的检验，才能固化为长期记忆。
---

# 【美团面经】短期记忆和长期记忆有什么区别？

## 一、核心区别一句话定调

> **短期记忆**是 Agent 当前任务执行过程中的"工作台"，服务于即时决策，高频读写、容量有限、任务结束即过期；**长期记忆**是跨会话的"知识档案柜"，低频写入但需要置信度验证，支撑 Agent 的持续学习和个性化。

这不仅仅是时间长短的区别，而是**设计目标、存储引擎、写入门槛、检索方式、过期策略**五个维度的系统性差异。

---

## 二、五大维度对比

| 维度 | 短期记忆（Working Memory） | 长期记忆（Long-Term Memory） |
|------|------|------|
| **生命周期** | 单次会话 / 单个任务 | 跨会话、跨任务，甚至永久 |
| **存储位置** | LLM 上下文窗口 + 内存缓存 | 向量数据库（Milvus/PgVector）+ KV 存储（Redis） |
| **读写频率** | 高频读写（每步都可能更新） | 低频写入（需验证）、按需检索读取 |
| **写入门槛** | 无门槛，实时写入 | **需置信度判断**（confidence ≥ threshold） |
| **容量** | 受限于上下文窗口（4K~128K token） | 几乎无限（受存储限制） |
| **检索方式** | 全量可见（直接在上下文中） | 相似度检索（Top-K）、关键词检索 |
| **过期策略** | 任务结束/窗口满时丢弃 | TTL 衰减 + 重要性评分淘汰 |
| **类比** | 厨师做菜时手边的备料台 | 菜谱笔记，经过验证才记录 |

---

## 三、记忆分层架构图

```
                         ┌──────────────────────────┐
                         │      用户输入 / 工具返回     │
                         └────────────┬─────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────┐
                    │        记忆管理器 MemoryManager     │
                    │   统一调度读写、遗忘、固化、检索      │
                    └──────┬──────────┬──────────┬─────┘
                           │          │          │
              ┌────────────▼──┐  ┌────▼──────┐  ┌▼────────────────┐
              │  短期记忆 STM   │  │ 中期记忆   │  │  长期记忆 LTM     │
              │  (Working)     │  │ (Session)  │  │  (Persistent)   │
              │                │  │             │  │                 │
              │ · 当前对话历史  │  │ · 会话摘要   │  │ · 用户画像       │
              │ · 工具调用结果  │  │ · 任务结论   │  │ · 验证过的知识    │
              │ · 临时变量     │  │ · 近期偏好   │  │ · 成功的执行模式  │
              │                │  │             │  │                 │
              │ 生命周期: 秒~分 │  │ 生命周期:时~天│  │ 生命周期: 永久   │
              │ 引擎: 内存/Redis│  │ 引擎: Redis │  │ 引擎: 向量DB     │
              └───────┬────────┘  └──────┬─────┘  └────┬─────────────┘
                      │                  │              │
                      │   ←─ 固化(Consolidation) ─→    │
                      │    置信度≥0.8 且 被引用≥3次      │
                      │    则从短期提升到长期             │
                      │                                │
                      ▼                                ▼
              ┌────────────────┐           ┌──────────────────┐
              │  上下文组装器    │◄──────────│  检索增强 RAG     │
              │  注入LLM窗口    │  Top-K召回 │  Embedding检索   │
              └────────────────┘           └──────────────────┘
```

**关键设计——三层记忆的流转机制：**

1. **短期→中期**：会话结束时，LLM 生成结构化摘要（summary），丢弃冗余细节
2. **中期→长期**：当某条记忆的**引用次数 ≥ 3** 且 **置信度 ≥ 0.8** 时，触发固化（Consolidation）写入长期记忆
3. **长期→短期**：每轮对话开始，用当前 query 检索长期记忆 Top-K，注入上下文

---

## 四、Python 实现：短期记忆

短期记忆核心是**滑动窗口 + 优先级裁剪**：

```python
from collections import deque
from dataclasses import dataclass, field
from typing import Optional
import time


@dataclass
class MemoryItem:
    """单条记忆项"""
    content: str
    role: str                        # user / assistant / tool
    timestamp: float = field(default_factory=time.time)
    importance: float = 1.0          # 重要性评分 0~1
    token_count: int = 0


class ShortTermMemory:
    """
    短期记忆管理器
    - 滑动窗口控制容量
    - 重要性加权裁剪（不是简单FIFO）
    """

    def __init__(self, max_tokens: int = 4096, max_items: int = 50):
        self.max_tokens = max_tokens
        self.max_items = max_items
        self._buffer: deque[MemoryItem] = deque(maxlen=max_items)
        self._current_tokens = 0

    def add(self, content: str, role: str, importance: float = 1.0):
        """写入短期记忆——无门槛，实时写入"""
        item = MemoryItem(
            content=content,
            role=role,
            importance=importance,
            token_count=len(content) // 4,   # 粗估 token
        )
        self._buffer.append(item)
        self._current_tokens += item.token_count
        self._evict()                        # 超容量时裁剪

    def get_context(self, max_tokens: int = 2048) -> list[dict]:
        """组装上下文——按重要性+时效性排序"""
        now = time.time()
        scored = []
        for item in self._buffer:
            # 综合评分 = 重要性 × 时间衰减因子
            age = now - item.timestamp
            time_decay = max(0.1, 1.0 - age / 3600)     # 1小时半衰期
            score = item.importance * time_decay
            scored.append((score, item))

        scored.sort(key=lambda x: x[0], reverse=True)

        result, used = [], 0
        for score, item in scored:
            if used + item.token_count > max_tokens:
                continue
            result.append({"role": item.role, "content": item.content})
            used += item.token_count
        return result

    def _evict(self):
        """超容量裁剪——淘汰评分最低的"""
        while self._current_tokens > self.max_tokens and len(self._buffer) > 1:
            # 找到评分最低的item移除
            worst = min(self._buffer, key=lambda x: x.importance)
            self._buffer.remove(worst)
            self._current_tokens -= worst.token_count

    def clear(self):
        """任务结束——短期记忆整体丢弃"""
        self._buffer.clear()
        self._current_tokens = 0
```

---

## 五、Python 实现：长期记忆（含置信度判断）

长期记忆核心是**写入门槛（置信度验证）+ 向量检索**：

```python
import numpy as np
from dataclasses import dataclass
from datetime import datetime


@dataclass
class LongTermMemory:
    """长期记忆条目"""
    id: str
    content: str
    embedding: np.ndarray
    confidence: float                   # 置信度 0~1
    access_count: int = 0              # 被检索引用次数
    created_at: datetime = None
    last_accessed: datetime = None
    importance: float = 0.0            # 综合重要性


class LongTermMemoryStore:
    """
    长期记忆存储——写入需过置信度门槛
    存储引擎：向量数据库（Milvus/PgVector）
    """

    WRITE_CONFIDENCE_THRESHOLD = 0.8    # 写入置信度门槛
    MIN_ACCESS_COUNT = 3                # 最少被引用次数（中期→长期）

    def __init__(self, embed_func):
        self.embed_func = embed_func    # embedding 模型
        self._store: dict[str, LongTermMemory] = {}

    def maybe_write(
        self,
        content: str,
        confidence: float,
        source: str = "llm_output",
    ) -> bool:
        """
        尝试写入长期记忆——必须通过置信度验证
        这是最关键的区别：不是所有信息都能写入
        """
        # ---- 第1道门：置信度检查 ----
        if confidence < self.WRITE_CONFIDENCE_THRESHOLD:
            return False

        # ---- 第2道门：重复检查（避免冗余写入）----
        query_emb = self.embed_func(content)
        if self._is_duplicate(query_emb, threshold=0.92):
            # 已有高度相似记忆，更新引用计数而非新建
            self._update_existing(query_emb)
            return True

        # ---- 第3道门：冲突检测 ----
        conflicting = self._find_conflict(query_emb, content)
        if conflicting:
            # 有冲突，需人工审核或更高置信度才覆盖
            if confidence < 0.95:
                return False
            self._store[conflicting].content = content
            return True

        # ---- 通过所有检查，写入长期记忆 ----
        mem_id = f"mem_{len(self._store)}"
        self._store[mem_id] = LongTermMemory(
            id=mem_id,
            content=content,
            embedding=query_emb,
            confidence=confidence,
            created_at=datetime.now(),
            importance=self._calc_importance(confidence, source),
        )
        return True

    def retrieve(self, query: str, top_k: int = 5) -> list[LongTermMemory]:
        """检索长期记忆——向量相似度 Top-K"""
        query_emb = self.embed_func(query)
        scored = []
        for mem in self._store.values():
            sim = float(np.dot(query_emb, mem.embedding))
            # 综合排序分 = 相似度 × 重要性 × 时间新鲜度
            scored.append((sim * mem.importance, mem))
        scored.sort(key=lambda x: x[0], reverse=True)

        # 更新引用计数
        for _, mem in scored[:top_k]:
            mem.access_count += 1
            mem.last_accessed = datetime.now()
        return [m for _, m in scored[:top_k]]

    def _calc_importance(self, confidence: float, source: str) -> float:
        """重要性 = 置信度 × 来源权重"""
        source_weight = {
            "verified_fact": 1.0,
            "user_confirmed": 0.9,
            "tool_result": 0.8,
            "llm_output": 0.6,
        }.get(source, 0.5)
        return confidence * source_weight

    def _is_duplicate(self, emb, threshold=0.92) -> bool:
        return any(
            np.dot(emb, m.embedding) > threshold
            for m in self._store.values()
        )

    def _find_conflict(self, emb, content):
        """检测语义冲突（相似但内容矛盾）"""
        for mid, mem in self._store.items():
            if np.dot(emb, mem.embedding) > 0.85:
                # 高相似度但置信度差异大 → 可能冲突
                if abs(mem.confidence - 0.8) > 0.2:
                    return mid
        return None

    def _update_existing(self, emb):
        for mem in self._store.values():
            if np.dot(emb, mem.embedding) > 0.92:
                mem.access_count += 1
                break
```

---

## 六、遗忘机制设计

长期记忆不能只进不出，需要**遗忘策略**保持质量：

```python
def forget(self, max_size: int = 10000):
    """遗忘机制——定期清理低价值记忆"""
    if len(self._store) < max_size:
        return

    now = datetime.now()
    to_remove = []
    for mid, mem in self._store.items():
        days_since_access = (now - mem.last_accessed).days

        # 综合遗忘分：越低越容易被遗忘
        forget_score = (
            mem.importance * 0.4        # 重要性权重
            + min(mem.access_count / 10, 1.0) * 0.4  # 访问频率
            + max(0, 1 - days_since_access / 90) * 0.2  # 时间衰减
        )
        if forget_score < 0.2:
            to_remove.append((mid, forget_score))

    # 淘汰遗忘分最低的
    to_remove.sort(key=lambda x: x[1])
    for mid, _ in to_remove[: len(self._store) - max_size]:
        del self._store[mid]
```

**遗忘策略三要素：**

| 策略 | 机制 | 类比 |
|------|------|------|
| **TTL 衰减** | 90天未被访问的记忆自动降权 | 长期不用的文件归档 |
| **重要性淘汰** | 综合评分低于阈值的记忆删除 | 清理低质量笔记 |
| **容量触发** | 超过max_size时淘汰尾部 | 书架满了淘汰旧书 |

---

## 七、面试加分点

1. **提到中期记忆层**：不是简单的短期/长期二分法，中间还有 Session 级摘要层，展示系统性思考
2. **固化机制（Consolidation）**：引用认知科学中的记忆巩固理论，短期记忆需要"睡眠"才能转化为长期记忆——在工程上对应置信度验证+引用次数门槛
3. **置信度来源**：明确说出置信度从哪来——工具返回的事实（高）、LLM 推理结论（中）、用户反馈确认（最高）
4. **冲突处理**：当新记忆与旧记忆矛盾时，不是简单覆盖，而是比较置信度，必要时引入人工审核环节
5. **Embedding + 关键词混合检索**：长期记忆不只靠向量相似度，还结合 BM25 关键词检索，解决向量模型对专有名词不敏感的问题
6. **回答 follow-up**：长期记忆用 PgVector / Milvus 存储；防止错误信息写入靠多道置信度门 + 冲突检测 + 人工审核兜底；遗忘机制用 TTL + 重要性评分综合淘汰

## 记忆要点

- 核心对比：短期记忆是“工作台”（高频读写、随任务结束过期），而长期记忆是“档案柜”（低频写入、跨会话永久保存）。
- 因为作用不同，所以存储引擎不同：短期用上下文/缓存，而长期依赖向量数据库。
- 生命周期与容量：短期受限于上下文窗口（秒~分级），长期近乎无限（需TTL淘汰）。
- 核心机制：短期记忆需通过“置信度判断”与“高频引用”的检验，才能固化为长期记忆。

