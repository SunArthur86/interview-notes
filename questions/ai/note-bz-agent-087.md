---
id: note-bz-agent-087
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 模型管理
- 版本控制
- MLOps
feynman:
  essence: 模型版本管理=追踪(哪个模型/版本/数据/指标)+回滚(出问题切旧版)+A/B测试(灰度对比)+生命周期(训练→评估→上线→监控→迭代)。像Git管代码一样管模型。
  analogy: 像药品管理——批次号(版本)、临床数据(评估)、召回机制(回滚)、上市监控(线上监控)、更新换代(迭代)。
  first_principle: 模型是有生命周期的资产，需要版本管理保证可追溯、可回滚、可对比、可审计。
  key_points:
  - 追踪：模型/数据/Prompt/指标的版本关联
  - 回滚：线上问题快速切回旧版
  - A/B测试：新旧版本灰度对比
  - 生命周期：训练→评估→上线→监控→迭代
first_principle:
  essence: 模型版本管理是MLOps的核心——让模型像软件一样可管理。
  derivation: 模型由(权重+数据+Prompt+配置)组成，每个组件都可能变。不管理版本→不知哪版在线→出问题无法回滚。版本管理=给每个模型状态打标签，可追溯可回滚。
  conclusion: 模型版本管理 = 可追溯(版本关联) + 可回滚(快速切旧) + 可对比(AB测试)
follow_up:
- LLM也需要版本管理吗？——需要(Prompt/配置/微调权重都要管)
- 怎么回滚？——保留旧版权重，流量切回
- A/B测试怎么做？——按用户分流，对比指标
memory_points:
- 管版五大件：权重、Prompt、数据集、系统配置、评估指标，缺一不可
- 核心价值是四可：出问题可回滚、效果差可AB对比、合规可追溯、团队可协同
- 上线严流程：注册绑定评估指标，先灰度放小流量，无异常再蓝绿切换全量
---

# 模型版本管理系统实现要点？

## 一、为什么需要模型版本管理

```
不管理的混乱：
  - "线上用的是哪个版本的模型？" → 没人知道
  - 效果变差了 → 不知是模型问题还是数据问题
  - 想回滚 → 旧版权重已删
  - A/B测试 → 无法对比版本
  - 合规审计 → 无法追溯

管理的价值：
  ✓ 可追溯：知道每个时刻用的什么
  ✓ 可回滚：出问题快速恢复
  ✓ 可对比：A/B测试数据驱动
  ✓ 可审计：满足合规要求
  ✓ 可协作：团队协同迭代
```

## 二、版本管理的核心要素

```
┌──────────────────────────────────────────────────┐
│            模型版本管理要素                          │
├──────────────────────────────────────────────────┤
│                                                    │
│  1. 模型权重版本                                    │
│     基座模型/微调checkpoint的版本                  │
│                                                    │
│  2. Prompt版本                                      │
│     System Prompt/模板的版本                       │
│                                                    │
│  3. 数据版本                                        │
│     训练数据/评估数据/知识库的版本                  │
│                                                    │
│  4. 配置版本                                        │
│     温度/工具定义/参数的版本                       │
│                                                    │
│  5. 评估结果                                        │
│     每个版本的评估指标                             │
│                                                    │
│  6. 上线记录                                        │
│     何时上线/下线/流量比例                         │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 三、版本管理系统设计

```python
class ModelVersionManager:
    """模型版本管理系统"""
    
    def register_version(self, model_config):
        """注册新版本"""
        version = ModelVersion(
            id=generate_id(),
            model_name=model_config["model"],
            prompt_version=model_config["prompt_version"],
            data_version=model_config["data_version"],
            config=model_config["params"],
            created_at=now(),
            created_by=current_user(),
            status="registered",
        )
        
        # 关联评估结果
        version.metrics = self.evaluate(version)
        
        self.registry.save(version)
        return version
    
    def deploy(self, version_id, strategy="canary"):
        """部署版本"""
        version = self.registry.get(version_id)
        
        if strategy == "canary":
            # 灰度发布：先5%流量
            self.router.set_traffic(version_id, percentage=5)
        elif strategy == "blue_green":
            # 蓝绿部署：新版本就绪后切流量
            self.prepare_green(version_id)
            self.switch_traffic(version_id)
        elif strategy == "full":
            # 全量
            self.router.set_traffic(version_id, percentage=100)
        
        # 记录上线
        self.audit_log.record("deploy", version_id, strategy)
```

## 四、回滚机制

```python
class RollbackManager:
    """快速回滚"""
    
    def rollback(self, reason):
        """紧急回滚到上一稳定版"""
        current = self.router.get_current_version()
        previous = self.registry.get_previous_stable(current)
        
        # 立即切流量
        self.router.set_traffic(previous.id, percentage=100)
        self.router.set_traffic(current.id, percentage=0)
        
        # 告警
        alert(f"已回滚: {current.id} → {previous.id}, 原因: {reason}")
        
        # 记录
        self.audit_log.record("rollback", current.id, reason)
    
    def auto_rollback(self):
        """自动回滚（监控触发）"""
        metrics = self.monitor.get_current_metrics()
        if metrics.error_rate > 10% or metrics.satisfaction < 3.0:
            self.rollback("自动回滚: 指标恶化")
```

## 五、A/B 测试

```python
class ModelABTest:
    """模型版本A/B测试"""
    
    def assign(self, user_id):
        """按用户分流"""
        # 同一用户始终同一版本（避免体验跳变）
        hash_val = hash(user_id) % 100
        if hash_val < 50:
            return self.version_a  # 50%流量
        return self.version_b      # 50%流量
    
    def compare(self):
        """对比两个版本的指标"""
        return {
            "version_a": self.get_metrics(self.version_a),
            "version_b": self.get_metrics(self.version_b),
            "significance": self.t_test(
                self.version_a, self.version_b
            ),
        }
    
    def promote_winner(self):
        """优胜版本全量"""
        comparison = self.compare()
        if comparison["significance"] < 0.05:  # 统计显著
            winner = comparison["better_version"]
            self.deploy(winner, strategy="full")
```

## 六、模型生命周期管理

```
┌──────────────────────────────────────────────────┐
│              模型生命周期                            │
├──────────────────────────────────────────────────┤
│                                                    │
│  开发 → 注册 → 评估 → 灰度 → 全量 → 监控 → 迭代  │
│                                                    │
│  开发: 训练/微调/Prompt优化                        │
│  注册: 版本入库，关联数据/配置                     │
│  评估: 跑测试集，记录指标                         │
│  灰度: 5%→10%→50%流量逐步放量                    │
│  全量: 100%流量                                   │
│  监控: 线上指标持续追踪                           │
│  迭代: 发现问题→开发新版本→循环                   │
│                                                    │
│  任意环节可回滚到上一稳定版                        │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 七、LLM 应用的版本管理特点

```python
# LLM应用版本管理比传统ML更复杂
# 因为不只是模型权重，还有Prompt/工具/配置

llm_app_version = {
    "model": {
        "base": "qwen-72b",
        "finetune": "v1.2",  # 微调版本
    },
    "prompt": {
        "system": "prompt_v3.0",
        "tools": "toolset_v2.1",
    },
    "config": {
        "temperature": 0.6,
        "rag": {
            "index_version": "kb_v5",
            "rerank_model": "bge-large",
        }
    },
    "metrics": {
        "faithfulness": 0.92,
        "satisfaction": 4.3,
    }
}
# 任何一项变化都是新版本，需重新评估
```

## 八、面试加分点

1. **不只管权重**：LLM 应用的版本包括模型+Prompt+数据+配置——全要素管理
2. **灰度+自动回滚**：灰度发布+指标监控自动回滚——保证线上稳定
3. **A/B 测试数据驱动**：版本决策基于数据而非感觉

## 记忆要点

- 管版五大件：权重、Prompt、数据集、系统配置、评估指标，缺一不可
- 核心价值是四可：出问题可回滚、效果差可AB对比、合规可追溯、团队可协同
- 上线严流程：注册绑定评估指标，先灰度放小流量，无异常再蓝绿切换全量

