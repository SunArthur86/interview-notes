---
id: note-ai50-001
difficulty: L3
category: ai
subcategory: RAG
tags:
  - 某厂
  - 面经
  - RAG
  - PDF
  - 文档处理
feynman:
  essence: 把跨页大表格识别出来作为整体单元，不被普通文本切片规则切断
  analogy: '就像印刷厂裁纸——遇到跨页海报必须先拼合再裁剪，不能按A4纸一刀切下去把海报拦腰截断'
  first_principle: '表格的语义完整性取决于行列结构的连续性，任意位置的物理分页都不应破坏这个结构'
  key_points:
    - '基于规则的前置检测: 检测表格边框线和跨页标记'
    - '布局分析模型: 用Table Transformer或PaddleOCR做表格区域识别'
    - '合并策略: 跨页表格的垂直拼接、去重表头、对齐列'
    - '切分豁免: 表格区域不参与常规chunk分片，作为独立chunk保留'
first_principle:
  essence: '表格的语义单元是行列结构，不是文本流中的字符序列'
  derivation: '普通文本按token数切分无损语义，但表格按token切分会破坏行列对应关系，导致模型无法理解表格结构'
  conclusion: 'RAG对表格必须采用"先识别再豁免"的特殊处理，不能混入常规文本切片流水线'
follow_up:
  - '如果表格嵌套在PDF的复杂版式中（多栏布局），怎么处理？'
  - '表格识别准确率不够高时，有没有兜底方案？'
  - '超大表格（100行以上）超出模型上下文窗口怎么办？'
---

# 工业PDF跨页大表格的切片处理策略

## 核心挑战

工业PDF文档经常包含跨页超大表格，如果按常规文本切片规则处理，表格会被从中间切断，模型看到的是残缺数据，完全无法理解。

```
┌─ Page 1 ───────────────────┐  ┌─ Page 2 ───────────────────┐
│ 表头 | 列A | 列B | 列C     │  │ 列D | 列E | 列F           │
│ 行1  | ...  | ...  | ...    │  │ ...  | ...  | ...          │
│ 行2  | ...  | ...  | ...    │  │ ...  | ...  | ...          │
│ 行3  | ...  | ...  | ───切──│──│切───│ ...  | ...          │
│ 行4  | ...  | ...  | ...    │  │ ...  | ...  | ...          │
└─────────────────────────────┘  └─────────────────────────────┘
         ↑ 常规切片会在这里截断 ↑
```

## 完整处理流水线

### 第一步: 表格区域检测

```python
# 方案1: 基于规则 (速度快，适合标准表格)
def detect_table_region(pdf_page):
    """检测水平线、垂直线构成的网格结构"""
    lines = pdf_page.extract_lines()
    h_lines = [l for l in lines if l.horizontal]
    v_lines = [l for l in lines if l.vertical]
    # 水平线和垂直线围成的区域 = 表格区域
    return find_grid_regions(h_lines, v_lines)

# 方案2: 基于模型 (准确率高，适合复杂版式)
# 使用 Microsoft Table Transformer 或 PaddleOCR PP-Structure
from paddleocr import PPStructure
engine = PPStructure(layout=True, table=True)
result = engine(pdf_path)
# result 包含 table 区域的 bbox 和结构化内容
```

### 第二步: 跨页表格合并

```python
def merge_cross_page_tables(tables_by_page):
    """合并跨页表格"""
    merged = []
    i = 0
    while i < len(tables_by_page):
        table = tables_by_page[i]
        # 判断是否在页面底部被截断
        if table.is_at_bottom() and i + 1 < len(tables_by_page):
            next_table = tables_by_page[i + 1]
            # 列数相同 + 紧接页面顶部 = 跨页表格
            if table.col_count == next_table.col_count and next_table.is_at_top():
                # 合并: 垂直拼接，去重表头
                if next_table.first_row_is_header():
                    next_table.remove_header()
                table = table.concat_vertical(next_table)
                i += 1  # 跳过下一页
        merged.append(table)
        i += 1
    return merged
```

### 第三步: 切片豁免策略

```python
def chunk_pdf_with_table_protection(pdf_doc, chunk_size=512):
    chunks = []
    current_chunk = []
    current_size = 0
    
    for element in pdf_doc.elements:  # 按阅读顺序遍历
        if element.type == 'table':
            # 先把当前chunk收尾
            if current_chunk:
                chunks.append('\n'.join(current_chunk))
                current_chunk, current_size = [], 0
            # 表格作为独立chunk，不参与切分
            table_text = element.to_markdown()  # 转成Markdown表格
            chunks.append(table_text)
        else:
            # 普通文本按chunk_size切分
            text = element.text
            if current_size + len(text) > chunk_size:
                chunks.append('\n'.join(current_chunk))
                current_chunk, current_size = [], 0
            current_chunk.append(text)
            current_size += len(text)
    
    if current_chunk:
        chunks.append('\n'.join(current_chunk))
    return chunks
```

### 第四步: 表格序列化为Markdown

```python
# 转成Markdown格式，模型理解效果最好
def table_to_markdown(table):
    """将识别的表格转为Markdown格式"""
    rows = table.rows
    if not rows:
        return ""
    
    header = '| ' + ' | '.join(rows[0].cells) + ' |'
    separator = '| ' + ' | '.join(['---'] * len(rows[0])) + ' |'
    body = ['| ' + ' | '.join(row.cells) + ' |' for row in rows[1:]]
    return '\n'.join([header, separator] + body)
```

## 技术方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| pdfplumber + 规则 | 快速，无需GPU | 复杂版式识别差 | 标准工业PDF |
| PaddleOCR PP-Structure | 中文表格效果好 | 推理较慢 | 中文文档 |
| Table Transformer | 通用性强 | 需要GPU推理 | 英文复杂表格 |
| LLM多模态直接读图 | 无需预处理 | token消耗大，幻觉风险 | 少量复杂表格 |

## 工程实践要点

1. **缓存层**: 表格识别结果缓存到Redis，避免重复解析
2. **人工校验节点**: 关键表格（如规格参数表）设置人工审核
3. **超大表格拆分**: 超过模型窗口的表格按行拆分，每段保留表头
4. **版本管理**: PDF更新时增量处理，只重新解析变更页面
