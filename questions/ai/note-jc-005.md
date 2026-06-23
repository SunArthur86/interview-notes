---
id: note-jc-005
difficulty: L5
category: ai
subcategory: 强化学习
tags:
- 阶跃星辰
- 字节
- 面经
- MoE
- GSPO
- GRPO
- 混合专家
feynman:
  essence: RL 训练 MoE 的核心问题是"专家负载不均+路由不稳定+训练效率低"。GRPO 直接用在 MoE 上会加剧负载倾斜（优势高时所有 token 都涌向同一专家），导致某些专家过载某些闲置。GSPO（Group Sequence Policy Optimization）的优化：①序列级优势而非 token 级（避免单 token 梯度加剧路由震荡）②显式负载均衡损失（强制专家使用均匀）③重要性采样修正（适应 MoE 的稀疏激活特性）。GSPO 更适配 MoE 因为它从"序列"而非"token"角度优化，减少路由层的梯度噪声。
  analogy: MoE 像多车道收费站（多个专家），GRPO 像"每辆车自己选最快车道"→ 所有车涌向一条车道（负载倾斜）。GSPO 像"按车队整体走哪条道分配"（序列级）+ 强制每条道车流量均衡（负载均衡损失）→ 避免一条道堵死其他空。
  first_principle: MoE 的路由是离散选择（token 选专家），RL 的梯度会反向影响路由。token 级 RL（GRPO）让每个 token 的优势都影响路由，梯度噪声大、易导致路由震荡和负载倾斜。序列级 RL（GSPO）用整条序列一个优势，减少对路由的频繁扰动，更适合 MoE。
  key_points:
  - 'MoE RL 问题: 专家负载不均+路由不稳定+训练效率低'
  - 'GRPO 在 MoE: token级优势加剧路由震荡和负载倾斜'
  - 'GSPO 优化1: 序列级优势(整序列一个A)减少路由梯度噪声'
  - 'GSPO 优化2: 显式负载均衡损失强制专家均匀使用'
  - 'GSPO 优化3: 重要性采样修正适应稀疏激活'
first_principle:
  essence: MoE 的路由是离散的，RL 梯度会扰动路由
  derivation: MoE 路由 = token 选专家(离散) → RL 梯度反传影响路由 → token级RL(GRPO)梯度噪声大 → 路由震荡+负载倾斜 → 序列级RL(GSPO)减少扰动 + 负载均衡约束
  conclusion: MoE 的 RL 不是"换个算法"，而是要专门处理"路由稳定性"和"负载均衡"
follow_up:
- MoE 的负载均衡损失怎么设计？
- GSPO 的序列级优势怎么定义？
- 除了 GSPO，还有哪些 MoE 友好的 RL 方法？
---

# 【阶跃星辰/字节面经】用 RL 训练 MoE 架构容易遇到哪些问题？GSPO 相比 GRPO 做了哪些优化？

## 一、MoE 架构回顾

```
MoE（Mixture of Experts）：
  每个 token 经过路由器（router）选择 top-k 个专家处理
  
  token → router → 选择 [专家1, 专家3] → 加权输出
              ↑
         路由是离散选择（哪个专家）

关键特性：
  - 稀疏激活（每个 token 只用 k 个专家，总参数大但计算量小）
  - 路由可学习（router 是可训练的）
  - 负载均衡是关键（避免某些专家过载某些闲置）
```

## 二、RL 训练 MoE 的四大问题

### 问题1：专家负载不均（最严重）
```
RL 优化会让"表现好的专家"获得更多优势
  → 高优势 token 都涌向某个专家
  → 该专家过载，其他闲置
  → 模型容量浪费 + 训练效率低

例如：GRPO 算出某 token 优势高 → 增大该 token 选某专家的概率
     → 越来越多 token 涌向该专家 → 负载崩溃
```

### 问题2：路由不稳定（震荡）
```
token 级 RL（GRPO）每个 token 都有梯度影响路由
  → 不同 token 的优势信号可能矛盾
  → router 参数反复震荡
  → 同一 token 在不同训练步选不同专家
  → 训练不收敛
```

### 问题3：训练效率低
```
MoE 的稀疏激活让每个 token 只更新 k 个专家的参数
  → RL 梯度只反传到被选中的专家
  → 其他专家这一步没更新
  → 相比 dense 模型，参数更新更稀疏
  → 需要更多步数才能收敛
```

### 问题4：expert collapse（专家坍缩）
```
某些专家长期不被选中
  → 参数不更新
  → 永远学不好
  → 永远不被选中（死循环）
  → 该专家"死亡"，浪费模型容量
```

## 三、GRPO 直接用在 MoE 上的问题

```
GRPO 的优势 A_i 是 token 级（实际是序列级，但梯度反传到每个 token）
  → 每个 token 的 log π 都被 A_i 加权更新
  → 影响 router 对该 token 的路由决策
  → 三个 MoE 问题都加剧：
     1. 高优势 token 涌向同一专家 → 负载更不均
     2. token 级梯度噪声 → 路由更震荡
     3. 稀疏更新 → 效率更低
```

## 四、GSPO 的三大优化

### 优化1：序列级优势（核心）
```
GRPO：一个序列内所有 token 共享同一个 A_i（序列级优势）
       但梯度反传时每个 token 都贡献
       
GSPO 进一步：
  优势计算和梯度传播都从"序列整体"出发
  减少单 token 对路由的扰动
  → 路由更稳定（一整条序列的优化方向一致）
```

**为什么序列级更适合 MoE**：序列级优化让 router 看到的是"整条序列该走哪些专家"，而非"每个 token 单独抢专家"，减少路由震荡。

### 优化2：显式负载均衡损失
```
GSPO 在 RL 损失中加入负载均衡项：

L_total = L_RL + α · L_balance

L_balance = 专家使用频率的方差/熵
  → 强制各专家被使用频率接近均匀
  → 防止负载倾斜和 expert collapse

具体（类似 Switch Transformer 的辅助损失）：
  L_balance = N · Σ_i (f_i · P_i)
  f_i：专家 i 实际被选中的 token 比例
  P_i：router 给专家 i 的平均概率
  → f_i · P_i 大时惩罚（某专家既被选中概率高又被实际选）
```

### 优化3：重要性采样修正
```
MoE 的稀疏激活让"行为策略"和"目标策略"差异大
  → off-policy 程度更高
  → 需要更准确的重要性采样修正

GSPO 用 token 级重要性权重修正：
  对每个 token 乘 importance weight
  适应 MoE 的稀疏激活特性
```

## 五、GSPO vs GRPO 总结

| 维度 | GRPO | GSPO |
|------|------|------|
| 优势粒度 | 序列级（但梯度 token 级） | **序列级（梯度也平滑）** |
| 负载均衡 | 无 | **显式负载均衡损失** |
| 重要性采样 | 基础 | **token 级修正** |
| MoE 适配 | 差（加剧问题） | **好（专门优化）** |
| Dense 模型 | 主流 | 也可用 |

## 六、其他 MoE-RL 优化思路

```
1. 路由正则化：限制 router 输出分布的熵，防止过于尖锐
2. 专家 dropout：训练时随机让某些专家不可用，强制负载分散
3. capacity factor：硬性限制每个专家处理的 token 数上限
4. expert choice：反过来让专家选 token（而非 token 选专家）
5. 共享专家：保留一个 dense 专家处理通用信息，MoE 专家处理专长
```

## 七、加分点

- 说出 **MoE RL 的核心矛盾是"RL 梯度扰动离散路由"**，这是所有问题的根源
- 说出 **GSPO 的负载均衡损失**借鉴 Switch Transformer 的辅助损失
- 说出 **expert collapse** 是 MoE 训练的经典失败模式

## 八、雷区

- ❌ "GRPO 不能用在 MoE" → 能用，但效果差，需 GSPO 优化
- ❌ "负载均衡只需 RL 处理" → 预训练阶段也要（Switch Transformer 的 aux loss）
- ❌ 混淆 MoE 的"参数稀疏"和"激活稀疏" → 激活稀疏（每 token 只用 k 个专家）是核心

## 九、扩展

- **DeepSeek-V3/R1 的 MoE**：用共享专家 + 路由专家，缓解负载均衡
- **DAPO**（字节）：另一款 GRPO 变体，针对 RLHF 优化（动态采样 + 长度归一化）
- **Mixtral / Qwen-MoE**：开源 MoE 模型，训练细节公开可参考
