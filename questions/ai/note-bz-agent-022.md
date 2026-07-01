---
id: note-bz-agent-022
difficulty: L4
category: ai
subcategory: Agent
tags:
- B站面经
- Memory
- 记忆
- Agent
- 向量库
feynman:
  essence: Agent记忆设计四要素——分类(短期/长期/工作/情景)、写入(何时记/记什么)、检索(如何找到相关)、隔离(用户/会话分离)。核心权衡是"记得住"vs"找得到"。
  analogy: 像人脑记忆系统——工作记忆(眼前的事)、短期记忆(今天的对话)、长期记忆(人生经历)，各有用途且需管理(遗忘)。
  first_principle: LLM上下文有限无法全装，必须外部存储+按需检索。记忆系统本质是"存储-检索"问题，权衡容量、速度、准确率。
  key_points:
  - 四类记忆：短期/长期/工作/情景
  - 写入：重要性判断+去重+压缩
  - 检索：embedding+rerank+过滤
  - 隔离：用户namespace/行级过滤
  - 遗忘：TTL+LRU+重要性衰减
first_principle:
  essence: 记忆是"有限容量下的信息保留与检索"问题。
  derivation: 上下文窗口是硬约束（装不下所有历史）。外部存储无上限但检索有损（不一定找到相关的）。记忆设计=决定什么存(写入策略)、怎么找(检索策略)、何时忘(遗忘策略)。
  conclusion: Agent记忆 = 存储分层（短期上下文+长期向量库） + 智能写入/检索/遗忘策略
follow_up:
- 记忆怎么避免存垃圾？——重要性评分+去重+LLM筛选
- 检索召回率低怎么办？——多路召回+rerank+查询改写
- 多用户怎么隔离？——namespace/user_id过滤+加密
memory_points:
- 四大记忆类型：短期（会话上下文）、长期（跨会话向量库）、工作（暂存区）、情景（轨迹复盘）
- 写入四步策略：重要性打分、向量相似度去重合并、LLM提取压缩、打标签附TTL
- 检索策略：采用多路召回（向量语义+关键词等）结合重排序，精准提取Top-K
---

# Agent Memory 怎么设计？

## 一、记忆的分类

```
┌──────────────────────────────────────────────────┐
│                  Agent记忆分类                      │
├──────────────────────────────────────────────────┤
│                                                    │
│  短期记忆 (Short-term / Working Memory)            │
│  = 当前对话上下文（LLM窗口内）                      │
│  特点：快、LLM直接可见、容量有限（如128K）           │
│  内容：当前对话历史、当前任务状态                    │
│                                                    │
│  长期记忆 (Long-term Memory)                       │
│  = 向量数据库（跨会话持久化）                        │
│  特点：容量大、需检索、有延迟                        │
│  内容：用户偏好、历史事实、学到的知识                │
│                                                    │
│  工作记忆 (Working / Scratchpad)                   │
│  = 当前任务的中间状态                               │
│  特点：任务级、任务结束可清理或归档                  │
│  内容：任务进度、已收集信息、待办                    │
│                                                    │
│  情景记忆 (Episodic Memory)                        │
│  = 历史执行轨迹（"经历"）                           │
│  特点：用于复盘和经验学习（Reflexion）              │
│  内容：过去怎么做的、结果如何                        │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、写入策略（什么时候记、记什么）

```python
class MemoryWriter:
    def should_write(self, content, context):
        """判断是否值得写入长期记忆"""
        
        # 1. 重要性评分（不是所有东西都记）
        importance = self.llm.score_importance(content, context)
        # 例: "用户喜欢简洁风格" → 0.9（重要）
        #     "用户说了句你好" → 0.1（不重要）
        if importance < 0.5:
            return False
        
        # 2. 去重（避免重复存储）
        similar = self.vector_db.search(content, threshold=0.85)
        if similar:
            # 合并而非新建
            self.merge(similar[0], content)
            return False
        
        # 3. 压缩（原始对话太长，提取要点）
        compressed = self.llm.summarize(content)
        # 例: 10轮对话 → "用户在讨论Python项目，偏好异步方案"
        
        # 4. 打标签（便于后续检索过滤）
        metadata = {
            "user_id": context.user_id,
            "type": self.classify(compressed),  # preference/fact/event
            "importance": importance,
            "timestamp": now(),
            "ttl": self.calc_ttl(importance)  # 重要性越高TTL越长
        }
        
        self.vector_db.add(compressed, metadata)
```

## 三、检索策略（怎么找到相关的）

```python
class MemoryRetriever:
    def recall(self, query, user_id, top_k=5):
        """多路召回 + 重排序"""
        
        # === 第1路：语义检索（向量） ===
        semantic_results = self.vector_db.search(
            embedding(query),
            filter={"user_id": user_id},  # 用户隔离
            n_results=top_k * 3
        )
        
        # === 第2路：关键词检索（BM25） ===
        keyword_results = self.bm25.search(
            query, filter={"user_id": user_id}
        )
        
        # === 第3路：时间近因（最近优先） ===
        recent = self.get_recent(user_id, limit=top_k)
        
        # === 融合 + 重排序 ===
        candidates = merge(semantic_results, keyword_results, recent)
        ranked = self.reranker.rerank(query, candidates)
        
        # === 过滤 ===
        valid = [
            m for m in ranked
            if not m.is_expired()           # 未过期
            and m.relevance > 0.3            # 相关性达标
            and m.user_id == user_id         # 用户隔离（双保险）
        ]
        
        return valid[:top_k]
```

## 四、隔离设计（多用户/多会话）

```
┌──────────────────────────────────────────────┐
│              记忆隔离三层方案                    │
├──────────────────────────────────────────────┤
│                                                │
│  方案1：Namespace隔离（推荐）                    │
│  memory:user_A:preference = "喜欢简洁"          │
│  memory:user_B:preference = "喜欢详细"          │
│  检索时只查自己的namespace                       │
│                                                │
│  方案2：行级过滤（user_id字段）                  │
│  所有记忆存在同一表，每条带user_id               │
│  检索时强制 WHERE user_id = ?                   │
│                                                │
│  方案3：物理隔离（独立DB/Collection）            │
│  每个用户一个独立collection                      │
│  安全性最高但资源开销大                          │
│                                                │
│  补充：共享知识 vs 私有记忆                       │
│  - 产品文档/通用知识：全局共享                    │
│  - 用户偏好/历史：按用户隔离                     │
│  - 通过metadata的scope字段区分                  │
│                                                │
└──────────────────────────────────────────────┘
```

## 五、遗忘机制（什么时候忘）

```python
class ForgettingManager:
    def cleanup(self, user_id):
        """多种遗忘策略组合"""
        
        # 1. TTL过期（时间驱动）
        expired = self.db.query(
            {"user_id": user_id, "ttl < now()})
        self.soft_delete(expired)  # 软删除，保留30天可恢复
        
        # 2. LRU淘汰（容量驱动）
        count = self.db.count({"user_id": user_id})
        if count > MAX_MEMORIES:
            oldest = self.db.query(
                {"user_id": user_id},
                sort="last_accessed", limit=count - MAX_MEMORIES
            )
            self.soft_delete(oldest)
        
        # 3. 重要性衰减（评分驱动）
        for memory in self.db.all(user_id):
            # score = importance × recency × frequency
            days = (now() - memory.last_accessed).days
            memory.score = (
                memory.importance *
                math.exp(-0.1 * days) *  # 时间衰减
                math.log(1 + memory.access_count)  # 频率加权
            )
            if memory.score < 0.1:
                self.soft_delete(memory)
        
        # 4. 主动遗忘（合规驱动）
        # GDPR right to be forgotten
        if user_requested_deletion(user_id):
            self.hard_delete(user_id)
```

## 六、记忆系统架构

```
┌──────────────────────────────────────────────────┐
│                Memory Service                     │
├──────────────────────────────────────────────────┤
│  API层                                            │
│  write() / recall() / forget() / update()        │
├──────────────────────────────────────────────────┤
│  逻辑层                                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │写入决策    │ │检索排序    │ │遗忘管理    │         │
│  │(重要性/去重)│ │(多路/rerank)│ │(TTL/LRU)  │         │
│  └──────────┘ └──────────┘ └──────────┘         │
├──────────────────────────────────────────────────┤
│  存储层                                           │
│  ├── Redis: 短期/热数据（ms级，会话级）            │
│  ├── 向量DB: 长期记忆（Chroma/Milvus/Pinecone）  │
│  ├── 关系DB: 结构化记忆（用户画像/偏好）          │
│  └── 对象存储: 原始文档/对话归档                   │
└──────────────────────────────────────────────────┘
```

## 七、记忆设计的核心权衡

```
┌──────────────┬──────────────┬──────────────────┐
│ 权衡维度      │ 一端           │ 另一端             │
├──────────────┼──────────────┼──────────────────┤
│ 写入门槛      │ 全记（不漏）    │ 严格筛选（不冗余）  │
│ 检索召回      │ 多召回（不漏）  │ 高精度（不噪）      │
│ 遗忘激进度    │ 少忘（保留多）  │ 多忘（省资源）      │
│ 隔离强度      │ 共享（省资源）  │ 隔离（保隐私）      │
└──────────────┴──────────────┴──────────────────┘

经验值：
  - 写入：重要性>0.5才记（宁可漏不可噪）
  - 检索：先多召回(3倍)再rerank到top-k
  - 遗忘：重要记忆永不删，普通记忆TTL 30天
  - 隔离：用户数据强制隔离，通用知识共享
```

## 八、面试加分点

1. **强调"存得下不等于找得到"**：记忆的核心难点不是存储而是检索——召回率和精度
2. **遗忘是 feature 不是 bug**：主动设计遗忘机制，避免记忆膨胀和噪声
3. **提"软删除+保留期"**：误删可恢复，体现工程严谨

## 记忆要点

- 四大记忆类型：短期（会话上下文）、长期（跨会话向量库）、工作（暂存区）、情景（轨迹复盘）
- 写入四步策略：重要性打分、向量相似度去重合并、LLM提取压缩、打标签附TTL
- 检索策略：采用多路召回（向量语义+关键词等）结合重排序，精准提取Top-K

