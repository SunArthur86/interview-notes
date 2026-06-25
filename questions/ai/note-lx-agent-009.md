---
id: note-lx-agent-009
difficulty: L3
category: ai
subcategory: Memory
tags:
  - 联想
  - 面经
  - 一面
  - 用户画像
  - 写作风格
  - 噪声过滤
feynman:
  essence: 获取用户写作风格需要从历史输出中提取统计特征（句长/词汇/标点），同时用滑动窗口+置信度阈值过滤偶然噪声，防止一次异常被学成长期偏好
  analogy: 就像了解朋友的口味——不会因为他偶尔一次吃了辣就认为他爱吃辣（过滤偶然噪声），而是观察他10次点餐中8次选清淡（统计置信度），才更新画像
  first_principle: 风格是统计意义上的稳定模式，不是单次行为。学习风格本质是信号处理——从噪声中提取稳定信号
  key_points:
    - 统计特征提取：句长分布、用词偏好、标点习惯、结构模式
    - 滑动窗口：只看最近N次，丢弃过时风格
    - 置信度阈值：新风格出现频率超阈值才采纳
    - 异常检测：单次偏离不更新画像
first_principle:
  essence: 风格学习的本质是在高噪声环境中提取低频稳定信号
  derivation: '用户每次输出都有随机性（噪声），但其底层风格偏好是稳定的（信号）。单次观察信噪比低，N次观察的平均值信噪比提升√N倍。因此风格更新需要足够样本量'
  conclusion: 风格获取 = 统计特征 + 滑动窗口 + 置信度过滤 + 异常检测
follow_up:
  - 风格特征提取用什么方法？传统统计 vs 深度学习？
  - 用户风格"进化"时（如从口语化变正式），怎么平滑过渡？
  - 多场景下用户风格不同（工作vs私人），怎么区分？
---

# 用户近期写作风格怎么获取，怎么防止把偶然噪声学成长期偏好？

## 风格特征体系

```
用户写作风格的多维度特征：

┌─────────────────────────────────────────┐
│              写作风格画像                 │
├──────────┬──────────────────────────────┤
│ 句法层    │ 平均句长: 15-20字             │
│          │ 长短句比: 3:7                 │
│          │ 复杂句占比: 20%               │
├──────────┼──────────────────────────────┤
│ 词汇层    │ 高频词: "其实"、"我觉得"       │
│          │ 词汇丰富度: TTR=0.65          │
│          │ 专业术语密度: 8%              │
├──────────┼──────────────────────────────┤
│ 标点层    │ 逗号偏好: 高频使用            │
│          │ 省略号频率: 0.5/百字           │
│          │ 感叹号使用: 极少              │
├──────────┼──────────────────────────────┤
│ 结构层    │ 段落长度: 3-5句/段            │
│          │ 逻辑连接词: "首先"、"另外"     │
│          │ 列表偏好: 偶尔使用             │
├──────────┼──────────────────────────────┤
│ 语气层    │ 正式度: 中等偏正式            │
│          │ 主观性: 中等                  │
│          │ 情感倾向: 中性偏积极           │
└──────────┴──────────────────────────────┘
```

## 风格提取流程

```python
class WritingStyleExtractor:
    def __init__(self, window_size=20, confidence_threshold=0.7):
        self.recent_outputs = []        # 滑动窗口
        self.window_size = window_size
        self.confidence_threshold = confidence_threshold
        self.style_profile = {}         # 当前风格画像

    def observe(self, user_output: str):
        """观察用户的一次输出"""
        features = self._extract_features(user_output)
        self.recent_outputs.append(features)
        # 保持滑动窗口大小
        if len(self.recent_outputs) > self.window_size:
            self.recent_outputs.pop(0)

    def _extract_features(self, text: str) -> dict:
        """提取单次输出的风格特征"""
        sentences = split_sentences(text)
        return {
            'avg_sentence_length': np.mean([len(s) for s in sentences]),
            'ttr': len(set(text)) / max(len(text), 1),  # 词汇丰富度
            'comma_ratio': text.count('，') / max(len(text), 1) * 100,
            'ellipsis_count': text.count('...'),
            'exclamation_count': text.count('！'),
            'formality_score': self._estimate_formality(text),
        }

    def update_profile(self):
        """基于滑动窗口更新风格画像"""
        if len(self.recent_outputs) < 5:
            return  # 样本不足，不更新

        # 计算各特征的统计值
        new_profile = {}
        for key in self.recent_outputs[0]:
            values = [o[key] for o in self.recent_outputs]
            mean = np.mean(values)
            std = np.std(values)

            # 置信度检验：变异系数 < 0.3 才认为稳定
            cv = std / max(abs(mean), 0.001)
            if cv < 0.3:
                new_profile[key] = {'value': mean, 'confidence': 1 - cv}
            else:
                new_profile[key] = {'value': mean, 'confidence': 0.3}

        # 渐进式更新：新画像和旧画像加权融合
        for key, new_val in new_profile.items():
            if key in self.style_profile:
                old = self.style_profile[key]['value']
                # 指数加权移动平均
                alpha = 0.3  # 新数据权重
                blended = alpha * new_val['value'] + (1 - alpha) * old
                self.style_profile[key]['value'] = blended
            else:
                self.style_profile[key] = new_val
```

## 噪声过滤机制

```python
def detect_anomaly(self, new_output_features: dict) -> bool:
    """检测单次输出是否为异常噪声"""
    if not self.style_profile:
        return False

    for key, profile_val in self.style_profile.items():
        if key in new_output_features:
            expected = profile_val['value']
            actual = new_output_features[key]
            # 偏离超过3σ视为异常
            if abs(actual - expected) > 3 * max(expected * 0.3, 0.1):
                return True  # 标记为异常，不更新画像
    return False

# 示例：用户平时句长15字，突然写了一篇全是5字短句的消息
# → 偏离3σ → 判定为异常噪声 → 不更新风格画像
```

## 应用：风格化生成

```python
def apply_style(self, generated_text: str) -> str:
    """让Agent的输出符合用户写作风格"""
    profile = self.style_profile
    if not profile:
        return generated_text  # 无画像，不改写

    prompt = f"""请将以下文本改写，使其符合用户的写作风格。

用户风格特征：
- 平均句长：{profile.get('avg_sentence_length', {}).get('value', 15):.0f}字
- 标点习惯：{'多逗号' if profile.get('comma_ratio', {}).get('value', 0) > 2 else '少逗号'}
- 正式度：{profile.get('formality_score', {}).get('value', 0.5):.1f}/1.0
- 感叹号：{'极少' if profile.get('exclamation_count', {}).get('value', 0) < 0.5 else '较多'}

原文：{generated_text}

改写："""
    return llm_call(prompt)
```

## 面试加分点

1. **多场景区分**：用户在工作场景和私人聊天中风格不同，需要按场景维护不同的风格画像
2. **冷启动**：新用户无历史数据时，使用群体平均风格作为初始画像，逐步个性化
3. **隐私安全**：风格画像只存统计特征不存原文，避免敏感信息泄露
4. **评估指标**：用户满意度、改写接受率、"AI写得像我"主观评分
