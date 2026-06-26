---
id: note-bz-agent-065
difficulty: L4
category: ai
subcategory: Agent
tags:
  - B站面经
  - LangGraph
  - 企业级
  - 工作流
feynman:
  essence: LangGraph企业级工作流=复杂图结构(多节点/分支/子图/并行)+状态管理+人工节点+检查点+监控。核心是用图建模复杂业务流程。
  analogy: 像设计企业SOP——不是简单的线性流程，而是有审批/并行/回退/子流程的复杂网络，LangGraph就是画这张网的工具。
  first_principle: 企业业务流程天然是复杂的图（有分支/并行/审批/回退）。LangGraph用图结构精确建模，而非硬编码if-else。
  key_points:
    - 复杂图：多节点/条件分支/子图/并行
    - 状态管理：显式State对象
    - 人工节点：审批/确认
    - 子图：模块化复用
    - 生产要素：检查点/监控/错误处理
first_principle:
  essence: 复杂业务=有向图。图结构是最自然的建模方式。
  derivation: '订单流程:下单→支付→(成功)发货/(失败)取消→收货→评价。这是图(分支+顺序)。用LangGraph的Graph建模，比代码if-else清晰且可可视化、可修改。'
  conclusion: LangGraph企业工作流 = 用图精确建模复杂业务（分支/并行/审批/回退）
follow_up:
    - 子图怎么用？——把常用流程封装为子图，主图调用
    - 怎么处理失败？——错误节点+重试+补偿
    - 并行怎么实现？——一个节点fan-out到多个，再fan-in
---

# LangGraph 的核心 Graph 如何设计？如何打造企业级复杂工作流？

## 一、企业级 Graph 的设计要素

```
┌──────────────────────────────────────────────────┐
│          企业级 Graph 设计要素                       │
├──────────────────────────────────────────────────┤
│                                                    │
│  1. 状态设计（State）                               │
│     完整的业务状态建模                               │
│                                                    │
│  2. 节点设计（Node）                                │
│     每个节点单一职责                                 │
│                                                    │
│  3. 条件分支（Conditional Edge）                   │
│     根据状态走不同路径                               │
│                                                    │
│  4. 并行处理（Fan-out/Fan-in）                     │
│     独立任务并发                                     │
│                                                    │
│  5. 子图（Subgraph）                               │
│     复杂流程模块化                                   │
│                                                    │
│  6. 人工节点（Human-in-the-loop）                  │
│     审批/确认                                       │
│                                                    │
│  7. 错误处理                                        │
│     重试/降级/补偿                                   │
│                                                    │
│  8. 检查点                                          │
│     长任务可恢复                                     │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、状态设计

```python
from typing import TypedDict, List, Optional
from enum import Enum

class OrderStatus(Enum):
    PENDING = "pending"
    PAID = "paid"
    SHIPPED = "shipped"
    CANCELLED = "cancelled"

class OrderState(TypedDict):
    # 业务数据
    order_id: str
    items: List[dict]
    total: float
    
    # 流程状态
    status: OrderStatus
    current_step: str
    error: Optional[str]
    
    # 审批
    needs_approval: bool
    approved: Optional[bool]
    approver: Optional[str]
    
    # 执行记录
    history: List[dict]
    retry_count: int
```

## 三、复杂分支设计

```python
def route_payment(state: OrderState) -> str:
    """支付后的路由：根据结果分支"""
    if state["status"] == OrderStatus.PAID:
        if state["total"] > 10000:
            return "high_value_review"  # 大额需审核
        return "ship"                    # 正常发货
    elif state["error"]:
        if state["retry_count"] < 3:
            return "retry_payment"       # 重试
        return "payment_failed"          # 彻底失败
    return "wait_payment"                # 等待支付

# 多条件分支
graph.add_conditional_edges(
    "payment",
    route_payment,
    {
        "high_value_review": "review",
        "ship": "shipping",
        "retry_payment": "payment",
        "payment_failed": "cancel",
        "wait_payment": "wait",
    }
)
```

## 四、并行处理（Fan-out / Fan-in）

```python
# 场景：订单处理，同时查库存+算运费+检查风控
def fan_out(state):
    """分发到多个并行节点"""
    return ["check_inventory", "calculate_shipping", "risk_check"]

def fan_in(state):
    """汇总并行结果"""
    results = state["parallel_results"]
    if all(r["ok"] for r in results):
        return "confirm_order"
    return "handle_issues"

# 构建并行
graph.add_conditional_edges("start", fan_out)  # 分发
graph.add_node("check_inventory", ...)
graph.add_node("calculate_shipping", ...)
graph.add_node("risk_check", ...)
# 三个并行执行完后
graph.add_node("aggregate", aggregate_node)
# 各并行节点都指向aggregate（自动等待全部完成）
```

## 五、子图（Subgraph）模块化

```python
# 把复杂的"退款流程"封装为子图
def build_refund_subgraph():
    refund_graph = StateGraph(RefundState)
    refund_graph.add_node("validate", validate_refund)
    refund_graph.add_node("approve", approve_refund)
    refund_graph.add_node("process", process_refund)
    refund_graph.add_node("notify", notify_customer)
    refund_graph.add_edge("validate", "approve")
    refund_graph.add_edge("approve", "process")
    refund_graph.add_edge("process", "notify")
    return refund_graph.compile()

# 主图中调用子图
refund_subgraph = build_refund_subgraph()

main_graph = StateGraph(OrderState)
main_graph.add_node("refund", refund_subgraph)  # 子图作为节点
# 主图不需要关心退款细节，调用即可
```

## 六、人工审批节点

```python
def approval_node(state):
    """等待人工审批"""
    # 发送审批通知
    send_approval_request(
        to=state["approver"],
        order=state["order_id"],
        amount=state["total"]
    )
    # 节点会暂停（配合interrupt_before）
    return state

# 编译时设置在审批前中断
app = graph.compile(
    interrupt_before=["approval"],
    checkpointer=SqliteSaver("orders.db")
)

# 运行到审批前暂停
app.invoke(initial_state)
# ... 人工在界面审批 ...
# 审批结果写入state，恢复执行
app.update_state(config, {"approved": True})
app.invoke(None, config)  # 继续
```

## 七、错误处理与补偿

```python
def with_error_handling(action):
    """节点的错误处理装饰器"""
    def wrapper(state):
        try:
            return action(state)
        except RetryableError:
            if state["retry_count"] < MAX_RETRIES:
                return {"retry_count": state["retry_count"] + 1}
            return {"error": "重试耗尽", "status": "failed"}
        except CriticalError as e:
            # 触发补偿（如已扣款要退款）
            return {"error": str(e), "needs_compensation": True}
    return wrapper

# 补偿节点
def compensate(state):
    """失败后的补偿操作"""
    if state.get("payment_deducted"):
        refund(state["order_id"])  # 退款
    if state.get("inventory_reserved"):
        release_inventory(state["items"])  # 释放库存
    return {"status": "compensated"}
```

## 八、完整企业级工作流示例

```
订单处理工作流：

         开始
           │
     ┌─────▼─────┐
     │  验证订单  │
     └─────┬─────┘
           │
    ┌──────┼──────┐ fan-out 并行
    ▼      ▼      ▼
  库存    运费    风控
    │      │      │
    └──────┼──────┘ fan-in 汇总
           │
     ┌─────▼─────┐
     │  汇总检查  │
     └─────┬─────┘
      全通过? 
      ├─是→ 支付
      │      ├─成功→ [大额?]→审核→发货
      │      │               └→直接发货
      │      └─失败→ 重试/取消
      └─否→ 处理问题
              │
         ┌────▼────┐
         │  发货    │
         └────┬────┘
              │
         ┌────▼────┐
         │  完成    │
         └─────────┘
```

## 九、面试加分点

1. **图建模业务**：企业流程天然是图（分支/并行/审批），LangGraph 是最自然的建模工具
2. **子图模块化**：复杂流程拆成子图，可复用可维护——体现工程思维
3. **补偿事务**：失败后的补偿是分布式系统的经典问题，能讲到说明有深度
