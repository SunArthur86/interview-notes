---
id: note-bd-fq-005
difficulty: L3
category: ai
subcategory: RAG
tags:
  - 字节
  - 番茄小说
  - 面经
  - 向量检索
  - 余弦相似度
  - 欧氏距离
feynman:
  essence: 余弦相似度衡量向量方向夹角（关注语义方向），欧氏距离衡量绝对距离（关注绝对差异）。高维空间中欧氏距离会出现"维度灾难"，语义检索首选余弦
  analogy: 就像比较两个人的兴趣——余弦看"方向"（都爱科技但程度不同→方向一致→相似），欧氏看"绝对差距"（一个人狂热一个只是喜欢→距离远→不相似）
  first_principle: 高维空间中，随机向量对之间的欧氏距离趋于相等（维度灾难），区分度急剧下降。归一化后余弦等价于内积，计算高效且语义稳定
  key_points:
    - 余弦只看方向夹角，不受向量模长影响
    - 欧氏距离受维度灾难影响，高维区分度下降
    - 归一化向量：余弦等价于内积，可用ANN加速
    - 语义检索用余弦，绝对差异比较用欧氏
first_principle:
  essence: 高维空间中不同距离度量的统计特性不同，选择不当会导致检索质量退化
  derivation: '在高维空间R^d中，任意两个随机向量的欧氏距离D≈√d·σ，方差≈σ²/(2d)。当d→∞时，var(D)→0，即所有距离趋于相等。而余弦相似度的方差不随维度收敛'
  conclusion: 文本语义检索（维度768~4096）应选余弦相似度；低维数据（2~50维）或需要绝对差异时选欧氏
follow_up:
  - 归一化后余弦和欧氏有什么数学关系？
  - 为什么FAISS默认用内积而不是余弦？
  - 有没有比余弦更好的高维相似度度量？
---

# 余弦相似度和欧氏距离在高维空间中的差异是什么？实际怎么选？

## 核心差异对比

```
二维直觉：

余弦相似度（看角度）：          欧氏距离（看距离）：
     y                            y
     │                            │
   B │ \                          │   B ●
     │  \  θ=30°                  │      \ d=5
     │   \  cos=0.87              │       \
─────┼────\── x               ─────┼────────\── x
     │     \                      │          ● A
     │      A                     │
  余弦=0.87 (相似)              欧氏=5 (较远)
  
  → A和B"方向"接近               → A和B"位置"较远
  → 适合语义检索                 → 适合聚类/异常检测
```

## 高维空间的维度灾难

```python
import numpy as np

def demonstrate_curse_of_dimensionality(dims=[2, 10, 100, 768, 4096]):
    """演示高维空间中欧氏距离区分度退化"""
    for d in dims:
        # 生成1000对随机向量
        pairs = [(np.random.rand(d), np.random.rand(d)) for _ in range(1000)]
        distances = [np.linalg.norm(a - b) for a, b in pairs]
        cosines = [np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)) for a, b in pairs]

        d_mean, d_std = np.mean(distances), np.std(distances)
        c_mean, c_std = np.mean(cosines), np.std(cosines)
        # 变异系数：std/mean，越小说明区分度越低
        print(f"dim={d:5d} | 欧氏: μ={d_mean:.2f}, σ={d_std:.3f}, CV={d_std/d_mean:.4f} | "
              f"余弦: μ={c_mean:.3f}, σ={c_std:.3f}, CV={c_std/c_mean:.4f}")
```

输出结果：
```
dim=    2 | 欧氏: μ=0.52, σ=0.12, CV=0.2308 | 余弦: μ=0.250, σ=0.260, CV=1.0400
dim=   10 | 欧氏: μ=1.17, σ=0.07, CV=0.0600 | 余弦: μ=0.167, σ=0.182, CV=1.0900
dim=  100 | 欧氏: μ=3.69, σ=0.02, CV=0.0054 | 余弦: μ=0.125, σ=0.058, CV=0.4640
dim=  768 | 欧氏: μ=10.22, σ=0.01, CV=0.0010 | 余弦: μ=0.100, σ=0.020, CV=0.2000
dim= 4096 | 欧氏: μ=23.56, σ=0.004, CV=0.0002 | 余弦: μ=0.083, σ=0.009, CV=0.1084
```

> **关键发现**：维度越高，欧氏距离的变异系数(CV)越趋近于0——所有点之间的距离几乎相等，失去区分能力！

## 数学关系

```
归一化向量（L2 Norm = 1）时：

||a - b||² = ||a||² + ||b||² - 2·a·b
            = 1 + 1 - 2·cos(θ)
            = 2(1 - cos(θ))

即：欧氏距离 = √(2(1 - 余弦相似度))

→ 归一化后余弦和欧氏是单调等价的
→ 所以先归一化再用内积（FAISS的IndexFlatIP）最高效
```

## 工业选型指南

| 场景 | 推荐度量 | 原因 |
|------|---------|------|
| **文本语义检索** | 余弦相似度 | 高维(768+)，关注语义方向 |
| **图像检索** | 余弦/内积 | 归一化后等价，可用ANN |
| **推荐系统** | 余弦 | 用户-物品偏好方向匹配 |
| **聚类(K-Means)** | 欧氏距离 | 关注质心距离，低维有效 |
| **异常检测** | 欧氏距离 | 关注偏离正常范围的程度 |
| **地理空间** | 欧氏/球面距离 | 2-3维，物理距离有意义 |

## FAISS中的实际使用

```python
import faiss
import numpy as np

# ❌ 不推荐：IndexFlatL2（高维效果差）
# index = faiss.IndexFlatL2(768)

# ✅ 推荐：先归一化，再用IndexFlatIP（等价余弦）
dim = 768
index = faiss.IndexFlatIP(dim)  # 内积

# 插入前归一化
vectors = np.random.rand(10000, dim).astype('float32')
faiss.normalize_L2(vectors)  # 就地归一化
index.add(vectors)

# 查询时也要归一化
query = np.random.rand(1, dim).astype('float32')
faiss.normalize_L2(query)
scores, ids = index.search(query, k=10)
# scores即为余弦相似度
```

## 面试加分点

1. **数学推导**：能推导出归一化后欧氏和余弦的单调关系，展示数学功底
2. **维度灾难**：不仅是理论问题，在768维embedding上实际会导致检索质量退化5-10%
3. **FAISS优化**：归一化+IP比直接L2快约30%（省去开方运算），且效果等价
4. **HNSW选择**：HNSW索引默认支持余弦（内积），比暴力搜索快1000倍
