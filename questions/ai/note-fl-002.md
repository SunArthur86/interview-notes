---
id: note-fl-002
difficulty: L4
category: ai
subcategory: Agent
tags:
- 字节
- 飞连
- 面经
- ToolCalling
- FunctionCalling
feynman:
  essence: Tool Calling 的本质是"模型生成结构化意图，服务端解析并执行"。Schema 用 JSON Schema（模型侧）+ Pydantic（服务端侧）双层校验；失败按"参数错→重prompt""权限错→拒""执行错→重试3次"分类；危险工具绝不暴露给 LLM，由服务端二次确认。
  analogy: 就像餐厅点单——客人（LLM）按菜单（Schema）写"宫保鸡丁、不要花生"（结构化意图），服务员（服务端）核对菜单（Pydantic 校验），有毒食材（危险工具）不上菜单，必须经理（二次确认）签字才下单。
  first_principle: LLM 输出有不确定性，但工具执行需要确定性。所以模型只负责"说意图"，服务端负责"解析 + 校验 + 执行 + 审计"。两层分离 = 可控可审计。
  key_points:
  - JSON Schema（模型侧描述）+ Pydantic（服务端解析）双层校验
  - 失败三分类：参数错→重prompt（最多2次）/权限错→拒/执行错→指数退避重试3次
  - 危险工具（deleterive）绝不进 LLM 可见 tool list，走服务端二次确认
  - 永远服务端分发工具，不直接暴露（鉴权统一、版本热更新、审计好做）
  - 判断 Prompt 问题 vs 模型能力问题：换更大模型控制变量 + 看 log_prob
first_principle:
  essence: 工具调用 = LLM 生成意图 + 服务端确定性执行
  derivation: LLM 输出不确定 → 不能让 LLM 直接执行 → 拆成"生成结构化意图"+"服务端解析执行" → 两层中间加校验/重试/审计 → 整体可控
  conclusion: Tool Calling 不是"让模型调工具"，而是"让模型说清楚要调什么工具+什么参数，服务端严格把关后执行"
follow_up:
- MCP（Model Context Protocol）对工具调用标准化带来什么改变？
- 怎么设计工具 Schema 让模型生成准确率最高？
- 并发 tool_call 怎么限流防穿透？
memory_points:
- 双层校验防幻觉：模型侧用JSON Schema写清Description，服务端用Pydantic强制解析参数类型
- 工具失败分类处理：网络错指数退避重试，参数错报错让模型重写，业务拒绝立即透传终止
- 高危工具物理隔离：destructive类操作绝不可见，由LLM提交意图后触发人工二次确认（飞书卡片）
- 分发优于直暴：永远由服务端统一分发工具，因为天然隔离了危险操作且统一了鉴权与限流
---

# 【字节飞连面经】怎么设计 Tool Calling？Schema 怎么定义？防危险工具？

## 一、Schema 定义：双层校验

```python
# 模型侧：JSON Schema（OpenAI function calling 风格）
{
  "name": "get_user_info",
  "description": "查询用户基本信息",   # 模型主要看 description
  "parameters": {
    "type": "object",
    "properties": {
      "user_id": {"type": "string", "description": "用户唯一ID"},
      "fields": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["user_id"]
  }
}

# 服务端侧：Pydantic 真正解析
from pydantic import BaseModel
class GetUserInfoParams(BaseModel):
    user_id: str
    fields: list[str] = []
```

字段名用 `snake_case`，**每个字段都写 description**（模型主要靠它理解意图）。输出 Schema 同样要定义，否则后置流程没法接。

## 二、工具失败：三分类处理

| 错误类型 | 处理策略 |
|---------|---------|
| 网络 / 5xx | 指数退避重试（1s, 2s, 4s） |
| 4xx 参数错 | **把错误信息塞回 prompt 让模型重写一次**，最多 2 次 |
| 业务侧拒绝（权限不足） | 立即终止 + 透传给用户 |

## 三、参数错误兜底

- **服务端默认值**：能给默认值的字段标记 `default`
- **枚举字段强制 fuzzy match**：模型输出"中国"，枚举只有"China"，做映射
- **必填字段缺失**：返回结构化错误让模型补一次，补不出来转人工

## 四、防止危险工具：分级 + 二次确认

```
工具危险分级：
  read-only   → 直接放行
  write       → 日志审计
  destructive → 绝不进 LLM 可见 tool list！
                由 LLM 提交"意图"，服务端拿到意图后
                弹二次确认（飞书卡片）→ 人确认 → 才执行
```

**核心原则**：deleterive 类工具（删数据库、转账）**绝不放进 LLM 可见的 tool list**。加 `allowlist` + 操作审计日志。

## 五、直接暴露 vs 服务端分发：永远服务端分发

理由：
1. **鉴权统一**：每个工具不重复写鉴权逻辑
2. **工具版本热更新**：不需要重新 prompt
3. **危险工具天然隔离**
4. **审计与限流好做**

## 六、判断是 Prompt 问题还是模型能力问题

- **控制变量**：同样 prompt 喂更大模型（豆包 1.6 → 豆包 pro / GPT-5），大模型能做对 → **多半是模型能力**；大模型也错 → **多半是 prompt**
- **看 log_prob**：模型对正确 token 给的概率不低但输出错 → prompt 引导不够；概率本身就低 → 能力问题
- **看 bad case 是否聚集**：80% 集中在某个工具 → 多半是 schema description 写得烂

## 七、加分点

提到 **MCP（Model Context Protocol）**：MCP 把"工具暴露"标准化了，未来工具发现可以走 MCP server，工具生态可以跨厂商复用。

## 八、雷区

- ❌ "我们让模型自己 retry" → 被秒挂，因为没控成本和死循环
- ❌ "危险工具直接放进 tool list 让模型谨慎用" → 安全红线

## 九、扩展

- Anthropic 的 MCP 把工具/资源/prompt 三类能力统一抽象，工具发现可以动态注册
- 高并发场景下 tool_call 要做令牌桶限流，防止 LLM 短时间内并发调用把下游 DB 打穿
- Structured Output（OpenAI 的 `response_format: json_schema`）比纯 function calling 更严格，能强制模型输出合法 JSON

## 记忆要点

- 双层校验防幻觉：模型侧用JSON Schema写清Description，服务端用Pydantic强制解析参数类型
- 工具失败分类处理：网络错指数退避重试，参数错报错让模型重写，业务拒绝立即透传终止
- 高危工具物理隔离：destructive类操作绝不可见，由LLM提交意图后触发人工二次确认（飞书卡片）
- 分发优于直暴：永远由服务端统一分发工具，因为天然隔离了危险操作且统一了鉴权与限流

