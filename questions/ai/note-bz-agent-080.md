---
id: note-bz-agent-080
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 合规性
- 安全
feynman:
  essence: 保证LLM合规=输入侧(过滤违规请求)+模型侧(对齐训练/RLHF)+输出侧(内容审核/脱敏)+流程侧(审计/可追溯/人工审核)。四层防护。
  analogy: 像食品安全监管——原料检查(输入)、生产工艺(对齐)、出厂检验(输出审核)、溯源体系(审计)。
  first_principle: 合规是法律要求(非可选)。LLM概率性输出有违规风险，需要"预防+检测+纠正+追溯"全链路。
  key_points:
  - 四层：输入过滤/模型对齐/输出审核/流程审计
  - 合规要求：内容安全/隐私保护/可追溯
  - 手段：规则+模型+人工 三道防线
  - 趋势：实时拦截+自动化合规
first_principle:
  essence: 合规=控制LLM输出在法律/伦理/业务规范内。
  derivation: LLM可能生成违规(暴力/歧视/违法)、泄露隐私、不当建议。合规需要：预防(输入过滤+对齐训练)+检测(输出审核)+纠正(拦截/修改)+追溯(审计日志)。
  conclusion: 合规保障 = 四层防护（输入过滤+模型对齐+输出审核+流程审计）
follow_up:
- 合规误杀怎么办？——灰度拦截+人工申诉+持续优化规则
- 不同地区合规差异？——按地区配置合规策略(GDPR/个保法)
- 违规内容怎么判定？——规则+分类模型+人工审核结合
memory_points:
- 合规四层防御：输入过滤防、模型对齐内化、输出审核查、流程审计追
- 输入层拦截：敏感词脱敏+防Prompt注入；模型层靠SFT/RLHF守规矩
- 输出层必审：内容安全分类器拦截违规响应；全链路打日志保证可追溯问责
---

# 如何保证大模型生成内容的合规性？

## 一、合规的四层防护

```
┌──────────────────────────────────────────────────┐
│              合规四层防护                            │
├──────────────────────────────────────────────────┤
│                                                    │
│  Layer 1: 输入过滤（预防）                         │
│    拦截违规请求在进入LLM前                         │
│                                                    │
│  Layer 2: 模型对齐（内化）                         │
│    RLHF/SFT让模型本身不想生成违规内容              │
│                                                    │
│  Layer 3: 输出审核（检测）                         │
│    LLM生成后，审核是否合规                         │
│                                                    │
│  Layer 4: 流程审计（追溯）                         │
│    全链路日志，可追溯可问责                        │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、Layer 1：输入过滤

```python
class InputComplianceFilter:
    """请求进入LLM前的合规过滤"""
    
    def check(self, user_input):
        checks = [
            self.check_illegal_content,    # 违法内容
            self.check_sensitive_words,    # 敏感词
            self.check_personal_info,      # 个人信息(脱敏)
            self.check_injection,          # 注入攻击
            self.check_policy_violation,   # 政策违规
        ]
        
        for check in checks:
            result = check(user_input)
            if result.blocked:
                return Reject(result.reason)
        
        return Allow(result.cleaned_input)

# 违规类型分类
VIOLATION_TYPES = {
    "violence": "暴力/恐怖",
    "sexual": "色情",
    "discrimination": "歧视",
    "illegal": "违法活动",
    "political_sensitive": "政治敏感",
    "privacy": "隐私泄露",
    "misinformation": "虚假信息",
}
```

## 三、Layer 2：模型对齐

```python
# 通过训练让模型本身"守规矩"
alignment_methods = {
    "SFT(监督微调)": {
        "方法": "用合规的问答对训练",
        "效果": "学会合规的回答方式",
    },
    "RLHF(人类反馈强化学习)": {
        "方法": "违规回答给负奖励",
        "效果": "从动机上避免违规",
    },
    "Constitutional AI(宪法AI)": {
        "方法": "给模型一套'宪法'规则自我约束",
        "效果": "模型自我审查",
    },
    "Red Teaming(红队测试)": {
        "方法": "专门攻击找漏洞",
        "效果": "发现并修补弱点",
    },
}
```

## 四、Layer 3：输出审核

```python
class OutputComplianceReview:
    """LLM生成后的合规审核"""
    
    async def review(self, response, context):
        results = {}
        
        # 1. 内容安全分类
        safety = await self.content_filter.moderate(response)
        # 返回: {violence: 0.01, sexual: 0.00, ...}
        if any(v > THRESHOLD for v in safety.values()):
            results["blocked"] = True
            results["reason"] = "内容安全审核未通过"
        
        # 2. 事实核查（防虚假信息）
        if context:
            factuality = await self.fact_check(response, context)
            if factuality.has_error:
                results["warning"] = "可能包含不准确信息"
        
        # 3. 隐私检测
        pii = self.pii_detector.detect(response)
        if pii:
            results["action"] = "redact"  # 脱敏后输出
        
        # 4. 业务合规
        business_violations = self.check_business_rules(response)
        
        return self.decide(results, response)
    
    def decide(self, results, response):
        if results.get("blocked"):
            return self.safe_reject()
        if results.get("action") == "redact":
            return self.redact(response)
        if results.get("warning"):
            return self.add_disclaimer(response)
        return response
```

## 五、内容审核实现

```python
class ContentModerator:
    """内容审核：规则+模型+人工"""
    
    # 第一道：规则过滤（快，覆盖明确违规）
    RULES = {
        "exact_blacklist": ["明确违规词1", "违规词2"],
        "regex_patterns": [r"手机号模式", r"身份证模式"],
    }
    
    # 第二道：分类模型（准，覆盖模糊case）
    def model_check(self, text):
        # 用专门的分类模型判断
        # 如OpenAI Moderation API / 自训练分类器
        scores = self.moderation_model.predict(text)
        return scores  # {violence: 0.9, sexual: 0.1, ...}
    
    # 第三道：人工审核（金标准）
    async def human_review(self, text):
        # 模型不确定的 → 人工
        if self.uncertain(text):
            return await human_moderator.review(text)
```

## 六、Layer 4：审计追溯

```python
class ComplianceAudit:
    """全链路审计日志"""
    
    def log(self, event):
        """记录每次交互的完整信息"""
        self.db.insert({
            "timestamp": now(),
            "user_id": event.user_id,
            "input": event.input,
            "output": event.output,
            "model": event.model,
            "filtered": event.filtered,        # 是否被过滤
            "filter_reason": event.reason,      # 过滤原因
            "moderation_scores": event.scores,  # 审核分数
            "human_reviewed": event.human,      # 是否人工审核
            "actions_taken": event.actions,     # 采取的措施
        })
    
    def trace(self, incident_id):
        """违规事件追溯"""
        return self.db.query({"id": incident_id})
        # 可追溯到：谁/何时/输入什么/输出什么/为何违规
```

## 七、不同场景的合规要求

```
┌──────────────┬──────────────────────────────────┐
│ 场景          │ 特殊合规要求                        │
├──────────────┼──────────────────────────────────┤
│ 医疗          │ 不能给确诊建议/必须标注"仅供参考"   │
│ 金融          │ 不能保证收益/必须风险提示           │
│ 法律          │ 不能替代律师/必须建议咨询专业人士   │
│ 教育          │ 适合年龄的内容/不输出不当引导       │
│ 政务          │ 政治正确/信息准确                   │
│ 国际化        │ GDPR(欧洲)/CCPA(加州)/个保法(中国) │
└──────────────┴──────────────────────────────────┘
```

## 八、合规的指标

```python
compliance_metrics = {
    "违规拦截率": "被拦截请求/总请求",
    "漏检率": "线上发现的违规/总违规（越低越好）",
    "误杀率": "被错误拦截的正常请求/拦截总数",
    "人工审核量": "需人工审核的请求数",
    "审核延迟": "审核增加的延迟",
    "申诉率": "用户申诉被拦截的次数",
}

# 目标：
#   违规拦截率 > 99%
#   漏检率 < 0.1%
#   误杀率 < 1%
#   审核延迟 < 100ms（自动）/ < 1min（人工）
```

## 九、面试加分点

1. **四层防护**：输入+对齐+输出+审计，体系化
2. **三道防线**：规则(快)+模型(准)+人工(金标准)——分级审核
3. **合规是法律要求**：不是"nice to have"，是"must have"——体现责任意识

## 记忆要点

- 合规四层防御：输入过滤防、模型对齐内化、输出审核查、流程审计追
- 输入层拦截：敏感词脱敏+防Prompt注入；模型层靠SFT/RLHF守规矩
- 输出层必审：内容安全分类器拦截违规响应；全链路打日志保证可追溯问责

