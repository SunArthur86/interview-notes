---
id: note-bz-agent-027
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 多轮对话
- 连贯性
feynman:
  essence: 多轮连贯性=让Agent"记得之前说过什么、在聊什么"。靠上下文管理(不丢关键信息)+话题追踪(知道聊到哪)+指代消解(他/它指谁)三招保证。
  analogy: 像聊天——连贯就是接得住话，你提"那个电影"我知道指上次聊的，不会突兀跳话题。
  first_principle: 连贯性破坏的原因：上下文丢失(忘了)、话题跳跃(没追踪)、指代不明(他她它)。对症下药即可。
  key_points:
  - 三大原因：上下文丢失/话题跳跃/指代不明
  - 对策：上下文管理+话题追踪+指代消解
  - 主动机制：追问确认+话题切换提示
  - 评估：人工评估+LLM评估连贯性
first_principle:
  essence: 连贯性的本质是"上下文依赖的语义连续性"。
  derivation: 对话中每句话依赖前文（"它"指代什么、"继续"做什么）。一旦上下文断裂，依赖关系丢失，就显得不连贯。保持连贯=维护这些依赖关系。
  conclusion: 多轮连贯 = 维护上下文依赖（指代/话题/任务状态）的完整性
follow_up:
- 怎么检测不连贯？——LLM评估+话题偏离检测+指代未消解检测
- 长对话更容易不连贯吗？——是，上下文越长越易丢信息
- 用户跳话题怎么办？——识别跳转+保留旧话题上下文+自然过渡
memory_points:
- 破坏连贯三主因：早期上下文丢失、突发话题跳跃、多轮指代不明（如“它”指代谁）
- 上下文防丢：LLM实时抽取核心事实存入系统提示词，结合记忆库按需检索历史
- 话题与指代：使用话题追踪器记录并识别跳转，利用LLM执行指代消解还原代词主语
---

# 多轮对话的连贯性如何保持？

## 一、连贯性破坏的三大原因

```
┌──────────────────────────────────────────────┐
│  原因1：上下文丢失                              │
│  ┌────────────────────────────────────────┐  │
│  │ U: 我叫张三                              │  │
│  │ ...(过了20轮)...                        │  │
│  │ U: 你还记得我叫什么吗？                  │  │
│  │ AI: 抱歉，你还没告诉我名字  ← 忘了       │  │
│  └────────────────────────────────────────┘  │
│  对策：长期记忆 + 关键信息持久化                │
├──────────────────────────────────────────────┤
│  原因2：话题跳跃                                │
│  ┌────────────────────────────────────────┐  │
│  │ U: 帮我查下天气                          │  │
│  │ AI: 北京今天25度晴                       │  │
│  │ U: 那Python怎么读文件？  ← 突然跳话题    │  │
│  │ AI: 北京明天...  ← 还在原话题            │  │
│  └────────────────────────────────────────┘  │
│  对策：话题追踪 + 意图识别                      │
├──────────────────────────────────────────────┤
│  原因3：指代不明                                │
│  ┌────────────────────────────────────────┐  │
│  │ U: 我昨天看了《盗梦空间》                 │  │
│  │ U: 它的导演还拍过什么？  ← "它"指谁？     │  │
│  │ AI: 请问"它"指什么？  ← 没消解指代        │  │
│  └────────────────────────────────────────┘  │
│  对策：指代消解（Coreference Resolution）      │
└──────────────────────────────────────────────┘
```

## 二、保持连贯的三大机制

### 机制 1：上下文管理（防丢失）

```python
class CoherentContextManager:
    """保证关键信息不丢失"""
    
    def __init__(self):
        self.key_facts = {}  # 持久化的关键信息
        self.recent_window = []  # 滑动窗口
    
    def extract_key_facts(self, turn):
        """从对话中提取应持久化的关键信息"""
        facts = self.llm.extract(
            f"从以下对话提取关键信息（姓名/偏好/需求/决定）:\n{turn}"
        )
        # 例: {"user_name": "张三", "topic": "Python"}
        self.key_facts.update(facts)
    
    def build_context(self, current_query):
        """组装上下文，保证关键信息在"""
        context = []
        
        # 关键事实始终注入（防丢失）
        if self.key_facts:
            context.append({
                "role": "system",
                "content": f"已知信息: {self.key_facts}"
            })
        
        # 最近对话窗口
        context.extend(self.recent_window[-6:])
        
        # 检索相关历史
        relevant = self.memory.retrieve(current_query, top_k=3)
        context.extend([{"role": "system", 
                        "content": f"[相关历史]{m}"} for m in relevant])
        
        return context
```

### 机制 2：话题追踪（防跳跃）

```python
class TopicTracker:
    """追踪当前话题，识别话题切换"""
    
    def __init__(self):
        self.current_topic = None
        self.topic_history = []
    
    def update(self, user_message):
        """识别当前消息的话题"""
        # LLM判断：是新话题还是延续旧话题
        analysis = self.llm.analyze(
            f"当前话题: {self.current_topic}\n"
            f"用户消息: {user_message}\n"
            f"判断: 延续当前话题 / 切换到新话题 / 指代旧话题"
        )
        
        if analysis.is_topic_switch:
            # 记录旧话题，更新新话题
            self.topic_history.append(self.current_topic)
            self.current_topic = analysis.new_topic
        elif analysis.references_old_topic:
            # 指代旧话题，需要恢复上下文
            old = self.find_topic(analysis.referenced_topic)
            return {"type": "resume", "topic": old}
        
        return {"type": "continue", "topic": self.current_topic}
```

### 机制 3：指代消解（防不明）

```python
class CoreferenceResolver:
    """消解"他/她/它/这个/那个"等指代词"""
    
    def resolve(self, user_message, context):
        """把指代词替换为具体指代对象"""
        # 检测是否有未消解的指代
        has_pronoun = self.detect_pronoun(user_message)
        # 例: "它的导演" → 检测到"它"
        
        if not has_pronoun:
            return user_message
        
        # LLM结合上下文消解
        resolved = self.llm.resolve(
            f"对话历史: {context}\n"
            f"用户消息: {user_message}\n"
            f"请消解消息中的指代词（他/它/这个）"
        )
        # 例: "它的导演" → "《盗梦空间》的导演"
        
        return resolved
```

## 三、主动连贯机制

### 追问确认（不确定时）

```python
def handle_ambiguous(user_message, context):
    """不确定用户意图时，主动确认而非猜测"""
    if is_ambiguous(user_message, context):
        return {
            "type": "clarify",
            "response": "你是想问A还是B？"
        }
    # 不确定的"它"宁可问清楚，不要答错
```

### 话题切换提示

```python
def handle_topic_switch(new_topic, old_topic):
    """话题切换时，自然过渡"""
    return f"好的，我们聊{new_topic}。（之前我们在讨论{old_topic}，"
           f"需要的话可以随时回到那个话题）"
```

### 上下文回溯

```python
def handle_reference_to_old(reference, topic_history):
    """用户指代很久以前的话题"""
    # 找到相关历史
    old_context = find_in_history(reference, topic_history)
    # 注入上下文
    return {
        "type": "resume",
        "context": old_context,
        "response": f"你是指之前聊的{old_context.topic}吧？"
    }
```

## 四、连贯性评估

```
┌──────────────────────────────────────────────┐
│              连贯性评估维度                      │
├──────────────────────────────────────────────┤
│                                                │
│  1. 指代正确率                                  │
│     "它/他/这个"被正确理解的次数/总次数          │
│                                                │
│  2. 话题连续性                                  │
│     话题切换是否自然，无突兀跳跃                  │
│                                                │
│  3. 信息一致性                                  │
│     多轮间事实陈述是否矛盾                       │
│                                                │
│  4. 上下文利用率                                │
│     回复是否参考了之前的对话内容                  │
│                                                │
│  5. 任务推进性                                  │
│     多轮对话是否在推进任务（而非原地打转）        │
│                                                │
└──────────────────────────────────────────────┘

评估方法：
  - 人工评估（1-5分连贯性评分）
  - LLM-as-Judge（让强模型评估连贯性）
  - 自动指标（指代消解F1/话题追踪准确率）
```

## 五、常见不连贯场景与修复

| 场景 | 表现 | 修复 |
|------|------|------|
| 忘记用户信息 | "你叫什么？" 反复问 | 关键信息持久化 |
| 话题突兀 | 用户聊天气AI回Python | 话题追踪+意图识别 |
| 指代失败 | "它是什么？" 答非所问 | 指代消解 |
| 自相矛盾 | 前面说A后面说B | 一致性校验 |
| 原地打转 | 反复问同样问题 | 进度追踪+去重 |

## 六、面试加分点

1. **三大原因 + 三大对策**：结构化回答，体现体系
2. **强调"主动确认"**：不确定时追问比猜测更好——宁可慢一点也要连贯
3. **提"话题追踪"**：很多人忽略这点，但它是长对话连贯的关键

## 记忆要点

- 破坏连贯三主因：早期上下文丢失、突发话题跳跃、多轮指代不明（如“它”指代谁）
- 上下文防丢：LLM实时抽取核心事实存入系统提示词，结合记忆库按需检索历史
- 话题与指代：使用话题追踪器记录并识别跳转，利用LLM执行指代消解还原代词主语

