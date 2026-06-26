---
id: note-bz-agent-021
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - 多Agent
  - 医疗
  - 落地
feynman:
  essence: 医疗多智能体=分诊Agent+专科Agent(多个)+审核Agent+沟通Agent协作。核心是"会诊"思维——多专科Agent各出意见，审核Agent综合，确保安全。
  analogy: 像医院多学科会诊——分诊台(分诊)、各科医生(专科)、主任医师(审核)、护士(沟通)，协作给患者最优方案。
  first_principle: 医疗诊断是高风险多维度任务——单视角易漏诊，需多专科会诊+严格审核。多Agent天然契合"多学科会诊"模式。
  key_points:
    - 架构：分诊→专科(多)→审核→沟通
    - 核心：多专科Agent模拟"会诊"
    - 关键：安全第一（审核Agent+人工兜底）
    - 挑战：幻觉零容忍+数据合规
first_principle:
  essence: 医疗的核心矛盾是"准确性"与"安全性"，多Agent通过多视角交叉验证提升准确性，通过审核Agent保证安全性。
  derivation: '单Agent诊断：一个视角，可能偏颇。多Agent会诊：心内科+神经科+全科各诊断，交叉验证减少漏诊。审核Agent检查药物相互作用/禁忌，保证安全。人工兜底处理高风险。'
  conclusion: 医疗多Agent = 多专科会诊（准确性）+ 审核校验（安全性）+ 人工兜底（高风险）
follow_up:
  - 医疗Agent怎么避免幻觉？——RAG强约束+知识库+审核Agent+不输出不确定内容
  - 数据合规怎么做？——脱敏+本地化部署+审计日志
  - 能替代医生吗？——不能，定位是辅助决策，最终由医生定夺
---

# 医疗辅助诊断多智能体怎么落地？

## 一、医疗场景的特殊性

```
医疗诊断 vs 普通任务：
  ├─ 准确性要求极高：误诊可能致命
  ├─ 幻觉零容忍：不能编造药物/剂量
  ├─ 多维度：症状涉及多个专科
  ├─ 安全约束：药物相互作用/过敏/禁忌
  ├─ 合规严格：数据隐私/可追溯/责任界定
  └─ 需解释性：医生和患者都要能理解

→ 这些特性天然适合多Agent"会诊"模式
```

## 二、医疗多 Agent 架构

```
患者输入症状
       │
       ▼
┌──────────────┐
│ Triage Agent │ ← 分诊：判断挂什么科
│ (分诊台)      │
└──────┬───────┘
       │ 分发到相关专科
       ▼
┌──────────────────────────────────────┐
│         专科Agent群（并行会诊）         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐│
│  │心内科    │ │神经科    │ │全科      ││
│  │Agent    │ │Agent    │ │Agent    ││
│  └────┬────┘ └────┬────┘ └────┬────┘│
│       │           │           │      │
│       └─────RAG───┴───────────┘      │
│       (医学知识库/指南/药品库)         │
└──────────────────┬───────────────────┘
                   │ 各科诊断意见
                   ▼
┌──────────────┐
│ Review Agent │ ← 审核：综合+安全检查
│ (主任医师)    │
│  - 交叉验证   │
│  - 药物相互作用│
│  - 禁忌症检查  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Safety Agent │ ← 高风险拦截
│ (安全官)      │
│  - 不确定→转人工│
└──────┬───────┘
       │
       ▼
┌──────────────┐
│Communicator  │ ← 沟通：生成患者易懂的建议
│Agent(护士)    │
└──────────────┘
```

## 三、各 Agent 职责详解

### 1. Triage Agent（分诊）

```python
class TriageAgent:
    def triage(self, symptoms):
        """根据症状判断需要哪些专科会诊"""
        prompt = f"""
        患者症状: {symptoms}
        
        判断需要咨询哪些专科（可多选）：
        - 心内科：胸痛/心悸/高血压
        - 神经科：头痛/头晕/肢体麻木
        - 呼吸科：咳嗽/气喘
        - 消化科：腹痛/恶心
        - 全科：症状不明确时必选
        
        返回: [专科列表, 紧急程度]
        """
        return self.llm.triage(prompt)
```

### 2. 专科 Agent（会诊）

```python
class SpecialistAgent:
    def __init__(self, specialty):
        self.specialty = specialty  # "cardiology"
        self.knowledge_base = load_medical_kb(specialty)  # 专科知识库
    
    def diagnose(self, symptoms, patient_info):
        """基于专科知识库诊断（RAG防幻觉）"""
        # 关键：必须基于知识库，不能编造
        relevant = self.knowledge_base.retrieve(symptoms, top_k=5)
        
        prompt = f"""
        你是{self.specialty}医生。基于以下医学资料诊断：
        
        [检索到的医学资料]
        {relevant}
        
        [患者信息]
        症状: {symptoms}
        既往史: {patient_info.history}
        过敏: {patient_info.allergies}
        
        给出：
        1. 可能的诊断（附置信度）
        2. 建议的检查
        3. 初步治疗方案（必须基于资料，不可编造）
        4. 不确定的地方（诚实标注）
        """
        return self.llm.diagnose(prompt)
```

### 3. Review Agent（审核）

```python
class ReviewAgent:
    def review(self, diagnoses, patient_info):
        """综合多专科意见 + 安全检查"""
        # 1. 综合诊断
        combined = self.synthesize(diagnoses)
        
        # 2. 药物安全检查（关键！）
        for drug in combined.medications:
            # 药物相互作用
            interactions = self.check_interactions(
                drug, patient_info.current_meds)
            if interactions.dangerous:
                combined.add_warning(f"{drug}与当前用药有危险相互作用")
            
            # 过敏检查
            if drug in patient_info.allergies:
                combined.add_warning(f"患者对{drug}过敏！")
            
            # 禁忌症检查
            contraindications = self.check_contraindications(
                drug, patient_info.conditions)
        
        # 3. 置信度评估
        if combined.confidence < 0.7:
            combined.recommend_human = True  # 建议人工
        
        return combined
```

### 4. Safety Agent（安全兜底）

```python
class SafetyAgent:
    """高风险场景必须转人工"""
    RED_FLAGS = [
        "胸痛+呼吸困难",      # 可能心梗
        "剧烈头痛+呕吐",      # 可能脑出血
        "意识模糊",           # 危急
        "儿童高热>39.5",     # 高危
    ]
    
    def check(self, diagnosis):
        for flag in self.RED_FLAGS:
            if flag in diagnosis.symptoms:
                return {
                    "action": "URGENT_HUMAN",
                    "message": "检测到危急症状，请立即就医"
                }
        if diagnosis.uncertain:
            return {"action": "CONSULT_HUMAN", "message": "建议面诊医生"}
        return {"action": "PROCEED"}
```

## 四、防幻觉的关键设计

```
医疗Agent幻觉=灾难，必须多重防护：

第1层：RAG强约束
  - 所有诊断必须基于检索到的医学文献
  - Prompt明确："只能基于提供的资料，不可编造"

第2层：结构化输出
  - 药物/剂量必须从药品库精确匹配，不可生成
  - 用JSON Schema约束输出格式

第3层：交叉验证
  - 多专科Agent意见交叉比对
  - 矛盾处必须标注

第4层：安全审核
  - Review Agent专门查药物相互作用/禁忌
  - Safety Agent拦截高危场景

第5层：人工兜底
  - 低置信度/高危/不确定 → 必须转医生
  - Agent定位是"辅助"，不替代医生
```

## 五、数据合规与隐私

```python
class ComplianceLayer:
    def process(self, patient_data):
        # 1. 脱敏
        anonymized = self.deidentify(patient_data)
        
        # 2. 本地化（敏感数据不出院）
        if patient_data.sensitivity == "HIGH":
            return self.local_agent.diagnose(anonymized)
        
        # 3. 审计日志
        self.audit_log.record({
            "action": "diagnosis",
            "agent": "specialist",
            "data_hash": hash(anonymized),
            "timestamp": now()
        })
        
        return self.diagnose(anonymized)
```

## 六、落地挑战与对策

```
┌──────────────┬─────────────────────┬────────────────────┐
│ 挑战          │ 问题                  │ 对策                │
├──────────────┼─────────────────────┼────────────────────┤
│ 幻觉零容忍    │ 编造药物/剂量可能致命 │ RAG+结构化+多层审核 │
│ 责任界定      │ Agent误诊谁负责？     │ 定位辅助+医生最终定夺│
│ 数据合规      │ 患者隐私保护          │ 脱敏+本地化+审计    │
│ 医学知识更新  │ 指南/药品库需更新     │ 知识库定期更新机制   │
│ 患者信任      │ 患者不信任AI诊断      │ 解释性+医生背书     │
│ 成本          │ 多Agent×RAG很贵      │ 分层模型+缓存       │
└──────────────┴─────────────────────┴────────────────────┘
```

## 七、面试加分点

1. **强调"辅助"定位**：医疗 Agent 是辅助决策，不是替代医生——这个边界很重要
2. **多层防幻觉**：RAG+结构化+交叉验证+安全审核+人工兜底，体现对医疗严肃性的理解
3. **会诊隐喻**：多 Agent = 多学科会诊，这个类比既贴切又能解释架构合理性
