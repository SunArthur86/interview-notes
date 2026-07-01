---
id: note-bd2-004
difficulty: L3
category: ai
subcategory: Agent
tags:
- 字节
- 面经
- Agent
- Memory
- 记忆管理
feynman:
  essence: Agent的Memory分为短期记忆(上下文窗口)和长期记忆(外部存储)，通过分层架构在有限资源内最大化信息保留
  analogy: 就像人脑——短期记忆是"现在正在想的事"(工作记忆, 容量小但快)，长期记忆是"过去的经历"(海马体→皮层, 容量大但需要检索)
  first_principle: LLM的上下文窗口有限且每轮清空(无状态)，无法跨会话记住信息。Memory系统通过外部存储打破了这一限制
  key_points:
  - '短期记忆: 对话历史，存在上下文窗口中，生命周期=单次会话'
  - '长期记忆: 向量库/数据库存储，跨会话持久化'
  - '工作记忆: 从长期记忆中检索出的当前相关上下文'
  - '实体记忆: 结构化存储关键实体(用户画像、偏好)'
first_principle:
  essence: Memory系统是Agent从"无状态文本生成器"进化为"有状态智能体"的关键组件
  derivation: LLM每次调用是独立的，第N轮不知道第1轮发生了什么(除非都在上下文窗口中)。Memory系统通过外部存储+检索机制，让Agent"记住"跨会话的信息
  conclusion: Memory = 存储层(持久化) + 检索层(相关性匹配) + 管理层(生命周期)
follow_up:
- Memory和RAG有什么区别？
- 如何决定什么信息值得存入长期记忆？
- Memory系统如何处理矛盾或过时的信息？
memory_points:
- 分层架构：短期记忆放上下文窗口，长期记忆靠向量库持久化。
- 向量检索：长期记忆通过Embedding和ANN检索历史交互。
- 实体记忆：用图或KV数据库存储结构化的用户画像与实体关系。
- 压缩策略：上下文满载时用摘要压缩或时间衰减机制清理低价值信息。
---

# Agent的Memory如何进行管理？存在哪些地方？

## Memory 分层架构

```
┌──────────────────────────────────────────────────┐
│                  Agent Memory 架构                 │
│                                                    │
│  ┌──────────────────────────────────────────┐    │
│  │     短期记忆 (Short-Term / Working Memory) │    │
│  │                                          │    │
│  │  存储: LLM上下文窗口 (128K tokens)        │    │
│  │  内容: 当前会话的对话历史                 │    │
│  │  特点: 快速访问，自动遗忘(会话结束清空)    │    │
│  │  技术: 直接放入Prompt                    │    │
│  └──────────────────────────────────────────┘    │
│                      ↕ 检索/写入                   │
│  ┌──────────────────────────────────────────┐    │
│  │     长期记忆 (Long-Term Memory)            │    │
│  │                                          │    │
│  │  存储: 向量库 + 数据库 + KV存储            │    │
│  │  内容: 跨会话的用户画像、历史交互           │    │
│  │  特点: 持久化，需要检索才能使用             │    │
│  │  技术: Embedding + ANN检索               │    │
│  └──────────────────────────────────────────┘    │
│                                                    │
│  ┌──────────────────────────────────────────┐    │
│  │     实体记忆 (Entity Memory)              │    │
│  │                                          │    │
│  │  存储: 图数据库 / KV存储                  │    │
│  │  内容: 用户画像、实体关系、事实             │    │
│  │  特点: 结构化，可精确查询                  │    │
│  │  技术: Knowledge Graph / JSON             │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

## 存储方案对比

| 存储类型 | 技术 | 容量 | 查询方式 | 生命周期 | 适用场景 |
|---------|------|------|---------|---------|---------|
| 上下文窗口 | LLM Context | 小(128K) | 直接读取 | 单会话 | 当前对话 |
| 向量库 | Milvus/Chroma | 大 | 语义检索 | 持久 | 对话历史 |
| KV存储 | Redis | 中 | 精确查询 | TTL可控 | 临时状态 |
| 关系数据库 | PostgreSQL | 大 | SQL查询 | 持久 | 结构化数据 |
| 图数据库 | Neo4j | 大 | 图遍历 | 持久 | 实体关系 |
| 文件系统 | JSON/文件 | 大 | 文件读取 | 持久 | 配置/知识 |

## 代码实现

```python
from datetime import datetime
from typing import Optional
import json

class AgentMemory:
    """完整的Agent记忆管理系统"""
    
    def __init__(self, user_id: str):
        self.user_id = user_id
        
        # 短期记忆: 当前会话
        self.short_term: list[dict] = []
        
        # 长期记忆: 向量库 (对话历史)
        self.long_term_store = ChromaStore(collection="conversations")
        
        # 实体记忆: 用户画像 (Redis/JSON)
        self.entity_store = RedisStore(namespace=f"user:{user_id}")
        
        # 摘要记忆: 定期压缩的历史
        self.summary_store = KVStore(namespace=f"summary:{user_id}")
    
    # ===== 短期记忆管理 =====
    
    def add_to_short_term(self, role: str, content: str):
        """添加到短期记忆"""
        self.short_term.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat()
        })
        
        # 检查是否需要压缩
        if self._estimate_tokens() > 80000:  # 80K阈值
            self._compress_short_term()
    
    def _compress_short_term(self):
        """压缩短期记忆"""
        # 保留最近10轮
        recent = self.short_term[-20:]
        old = self.short_term[:-20]
        
        if old:
            # 生成摘要
            summary = self._generate_summary(old)
            self.summary_store.set("latest_summary", summary)
            
            # 同时存入长期记忆
            for msg in old:
                self._store_long_term(msg)
        
        self.short_term = [{"role": "system", "content": f"历史摘要: {summary}"}] + recent
    
    # ===== 长期记忆管理 =====
    
    def _store_long_term(self, message: dict):
        """存入长期向量记忆"""
        self.long_term_store.add(
            documents=[message["content"]],
            metadatas=[{
                "user_id": self.user_id,
                "role": message["role"],
                "timestamp": message["timestamp"]
            }],
            ids=[f"msg_{hash(message['content'])}"]
        )
    
    def retrieve_long_term(self, query: str, top_k: int = 5) -> list:
        """从长期记忆检索相关内容"""
        results = self.long_term_store.query(
            query_texts=[query],
            n_results=top_k,
            where={"user_id": self.user_id}
        )
        return results
    
    # ===== 实体记忆管理 =====
    
    def update_entity(self, entity_type: str, key: str, value: str):
        """更新实体记忆(用户画像)"""
        entities = self.entity_store.get_json("entities") or {}
        if entity_type not in entities:
            entities[entity_type] = {}
        entities[entity_type][key] = {
            "value": value,
            "updated_at": datetime.now().isoformat()
        }
        self.entity_store.set_json("entities", entities)
    
    def get_entity(self, entity_type: str, key: str) -> Optional[str]:
        """获取实体记忆"""
        entities = self.entity_store.get_json("entities") or {}
        return entities.get(entity_type, {}).get(key, {}).get("value")
    
    # ===== 上下文构建 =====
    
    def build_context(self, current_query: str) -> str:
        """构建喂给LLM的完整上下文"""
        parts = []
        
        # 1. 实体记忆 (最稳定)
        entities = self.entity_store.get_json("entities") or {}
        if entities:
            parts.append(f"【用户画像】: {json.dumps(entities, ensure_ascii=False)}")
        
        # 2. 历史摘要
        summary = self.summary_store.get("latest_summary")
        if summary:
            parts.append(f"【历史摘要】: {summary}")
        
        # 3. 检索长期记忆中与当前query相关的内容
        relevant = self.retrieve_long_term(current_query, top_k=3)
        if relevant:
            parts.append(f"【相关历史】: {format_results(relevant)}")
        
        # 4. 短期记忆 (最近对话)
        recent = self.short_term[-20:]
        if recent:
            parts.append(f"【最近对话】: {format_messages(recent)}")
        
        return '\n\n'.join(parts)
    
    # ===== 实体自动提取 =====
    
    def _extract_entities(self, message: str):
        """自动从对话中提取实体更新画像"""
        entities_prompt = f"""
从以下用户消息中提取关键信息:
消息: "{message}"

提取格式:
- 姓名/称呼: 
- 偏好/喜好: 
- 职业: 
- 约束/要求: 
(如果没有则留空)
"""
        result = llm.generate(entities_prompt)
        parsed = parse_entities(result)
        
        for entity_type, value in parsed.items():
            if value:
                self.update_entity(entity_type, "latest", value)
```

## Memory vs RAG 的区别

| 维度 | Memory | RAG |
|------|--------|-----|
| 数据来源 | Agent自身的交互历史 | 外部知识库 |
| 更新方式 | 实时写入 | 批量导入 |
| 检索目的 | "之前说过什么" | "知识库里有什么" |
| 生命周期 | 随交互动态更新 | 相对静态 |
| 隐私性 | 用户私有 | 共享知识 |
| 存储结构 | 时序+语义 | 纯语义 |

## 工程实践要点

1. **记忆淘汰策略**: 不是所有信息都值得记住，需要信息价值评估
2. **隐私保护**: 敏感信息加密存储，支持用户"忘记我"
3. **一致性**: 多个记忆层之间的信息不能矛盾
4. **性能**: 长期记忆检索延迟应 < 100ms，用缓存优化
5. **可观测性**: 记忆读写日志可追踪，便于调试

## 记忆要点

- 分层架构：短期记忆放上下文窗口，长期记忆靠向量库持久化。
- 向量检索：长期记忆通过Embedding和ANN检索历史交互。
- 实体记忆：用图或KV数据库存储结构化的用户画像与实体关系。
- 压缩策略：上下文满载时用摘要压缩或时间衰减机制清理低价值信息。

