---
id: note-jc-012
difficulty: L3
category: ai
subcategory: 分布式训练
tags:
- 阶跃星辰
- 面经
- GPU
- 死锁
- 分布式训练
- NCCL
feynman:
  essence: GPU 死锁指多个 GPU（或 GPU 内多个流）互相等待对方释放资源，导致全部卡住。分布式训练常见死锁原因：①NCCL all-reduce/all-gather 的顺序不一致（部分 GPU 先发后收，其他相反）②负载不均导致某些 GPU 先到同步点干等③异常处理不当（一个 GPU 报错挂起，其他 GPU 在 collective op 处无限等）④流间依赖成环。排查靠 NCCL_DEBUG 看卡在哪个 collective。
  analogy: 像四个人互相传东西必须同时给同时收——如果 A 先给 B 再收 C，但 B 先收 A 再给 C，顺序不一致就互相干等。或者一个人突然手抖（报错），其他三个人拿着东西等他，永远传不下去。
  first_principle: 分布式训练用 collective op（all-reduce 等）同步，这些 op 要求所有 rank 同时参与。任何一个 rank 的顺序错乱、卡住、报错，都会让其他 rank 在 collective 处无限等待 → 死锁。
  key_points:
  - 死锁=多个GPU互相等待对方释放资源，全部卡住
  - '原因1: NCCL collective 顺序不一致（部分先发后收）'
  - '原因2: 负载不均导致同步点干等'
  - '原因3: 异常处理不当（一个挂起其他无限等）'
  - '原因4: CUDA流间依赖成环'
  - '排查: NCCL_DEBUG=INFO 看卡在哪个 collective'
first_principle:
  essence: collective op 要求所有 rank 同步参与，任一 rank 失常导致全局卡死
  derivation: 集合通信需所有rank同时参与 → 某rank顺序错/卡住/报错 → 其他rank在collective处无限等 → 死锁
  conclusion: 分布式训练的死锁本质是"集合通信的全员同步特性"被破坏
follow_up:
- NCCL 的 all-reduce 怎么实现？
- 怎么检测死锁？
- 怎么避免 collective 死锁？
memory_points:
- 核心定义：多进程或流互相等待资源，导致 GPU 利用率掉 0 且不报错卡死
- 首要原因：各 rank 的 NCCL 集合通信调用顺序不一致，导致互相等待
- 其他诱因：负载不均干等、异常处理跳过同步点、单卡内 CUDA 流成环
- 排查手段：NCCL_DEBUG=INFO 查通信卡点，py-spy dump 看死锁堆栈
- 预防机制：保证代码路径一致，设置超时时间，异常时同步退出
---

# 【阶跃星辰面经】GPU 死锁是什么情况

## 一、GPU 死锁的定义

**GPU 死锁**：多个 GPU（或 GPU 内多个 CUDA 流）互相等待对方释放资源/完成操作，导致全部卡住，无法继续执行。

**表现**：训练卡在某一步，GPU 利用率掉到 0，nvidia-smi 显示 GPU 占用但不计算，程序不报错也不退出。

## 二、分布式训练死锁的四大原因

### 原因1：NCCL collective 顺序不一致（最常见）

```
NCCL 集合通信（all-reduce/all-gather/broadcast）要求所有 rank 按相同顺序调用。

死锁场景：
  Rank 0: all-reduce(A) → all-reduce(B)
  Rank 1: all-reduce(B) → all-reduce(A)

  → Rank 0 在 all-reduce(A) 等 Rank 1 参与
  → Rank 1 在 all-reduce(B) 等 Rank 0 参与
  → 互相等，死锁

常见触发：
  - 条件分支导致不同 rank 走不同代码路径
  - 循环次数不一致（某 rank 多/少一次 collective）
```

### 原因2：负载不均导致同步点干等

```
Rank 0 处理 1000 个 batch
Rank 1 处理 100 个 batch

Rank 1 跑完后到 all-reduce 等 Rank 0
Rank 0 还在跑，但 Rank 1 的 NCCL 操作超时

→ 如果没有 timeout 处理，可能死锁
（NCCL 默认 30 分钟 timeout，超时报错而非永久死锁）
```

### 原因3：异常处理不当

```
Rank 0: 某个 batch OOM → 抛异常 → 进入 except 块 → 跳过 all-reduce
Rank 1: 正常 → 到 all-reduce 等 Rank 0

→ Rank 0 已经跳过这步，Rank 1 永远等不到
→ 死锁（如果 Rank 1 没设 timeout）

错误模式：
  try:
      output = model(input)  # Rank0 这里 OOM
      loss = ...
      loss.backward()
      optimizer.step()
  except:
      pass  # Rank0 跳过，但 Rank1 正常执行到 all-reduce
```

### 原因4：CUDA 流间依赖成环

```
单 GPU 内多个 CUDA 流：
  Stream A: 等 Stream B 的 event
  Stream B: 等 Stream A 的 event
  → 互相等，流死锁

触发：手动管理 CUDA 流 + event 时依赖写错。
```

## 三、排查方法

### 方法1：NCCL_DEBUG 看卡在哪
```bash
NCCL_DEBUG=INFO python train.py 2>&1 | tee log.txt
# 看最后输出，卡在哪个 collective（如 all-reduce）
```

### 方法2：py-spy 看堆栈
```bash
py-spy dump --pid <python_pid>
# 看每个 rank 卡在哪行代码
# 如果都卡在 NCCL op → 是 collective 死锁
```

### 方法3：检查是否所有 rank 到达同步点
```python
# 加调试日志
print(f"Rank {rank}: before all-reduce at step {step}")
dist.all_reduce(tensor)
print(f"Rank {rank}: after all-reduce at step {step}")
# 看哪些 rank 没到 "after"
```

### 方法4：nvidia-smi + gdb
```bash
nvidia-smi  # GPU 占用但利用率 0 → 可能死锁
gdb -p <pid> # attach 看堆栈
```

## 四、预防和解决

### 预防1：所有 rank 执行相同代码路径
```python
# ❌ 危险：条件分支导致 collective 不一致
if rank == 0:
    dist.all_reduce(x)  # 只有 rank0 做

# ✅ 所有 rank 都做
if should_reduce:  # 所有 rank 的 should_reduce 必须一致
    dist.all_reduce(x)
```

### 预防2：设置 timeout
```python
import torch.distributed as dist
# 设置 collective 超时（超时报错而非永久卡）
dist.init_process_group('nccl', timeout=timedelta(minutes=5))
```

### 预防3：异常时同步退出
```python
try:
    train_step()
except Exception as e:
    # 所有 rank 一起退出，不让其他 rank 干等
    dist.destroy_process_group()
    raise
```

### 预防4：保证数据均匀分片
```python
# 用 DistributedSampler 保证每个 rank batch 数相同
sampler = DistributedSampler(dataset, drop_last=True)
# drop_last=True 防止最后不完整的 batch 导致 rank 步数不一致
```

## 五、加分点

- 说出 **NCCL collective 要求所有 rank 按相同顺序调用**，顺序不一致就死锁
- 说出 **排查用 NCCL_DEBUG=INFO + py-spy**
- 说出 **预防核心是"所有 rank 代码路径一致"**

## 六、雷区

- ❌ 条件分支里放 collective → 不同 rank 走不同路径导致死锁
- ❌ 不设 timeout → 永久卡死不报错
- ❌ except 块静默吞异常 → 一个 rank 跳过 collective，其他干等

## 七、扩展

- **NCCL（NVIDIA Collective Communications Library）**：GPU 间集合通信库，all-reduce 的底层实现（Ring 或 Tree 算法）
- **gloo**：CPU 的集合通信后端，比 NCCL 慢但更稳
- **Elastic Training（torchrun）**：自动处理 rank 挂掉重启，防止单点故障导致死锁

## 记忆要点

- 核心定义：多进程或流互相等待资源，导致 GPU 利用率掉 0 且不报错卡死
- 首要原因：各 rank 的 NCCL 集合通信调用顺序不一致，导致互相等待
- 其他诱因：负载不均干等、异常处理跳过同步点、单卡内 CUDA 流成环
- 排查手段：NCCL_DEBUG=INFO 查通信卡点，py-spy dump 看死锁堆栈
- 预防机制：保证代码路径一致，设置超时时间，异常时同步退出

