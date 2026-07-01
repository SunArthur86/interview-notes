---
id: note-mt-agent-011
difficulty: L2
category: java
subcategory: Java基础
tags:
- 美团
- 面经
- Python
- 大文件
- 八股
feynman:
  essence: 核心原则不能一次性加载到内存必须用流式或分块处理。
  analogy: 就像用吸管喝超大杯奶茶不能一口闷要一口一口吸。
  first_principle: 内存有限vs文件可能无限大必须有界缓冲区加迭代处理。
  key_points:
  - for line in f逐行迭代
  - read chunk size分块
  - 二进制模式处理无换行符
  - 生成器yield惰性处理
  - mmap内存映射大文件
first_principle:
  essence: 空间有界性原则处理无界数据必须有界缓冲
  derivation: file read全部加载内存溢出逐行分块每次有界数据O1空间
  conclusion: 流式读取是处理大文件唯一正确方式
follow_up:
- readline和readlines区别？
- 如何并行处理大文件多chunk？
- mmap原理和适用场景？
memory_points:
- 核心原则：坚决不用read()或readlines()全量加载，必须采用流式处理防OOM
- 逐行与分块：文本最常按行迭代，无换行大文件或二进制则按固定size分块读取
- 高阶处理：用yield生成器封装可实现惰性求值，完美支持链式管道内存零堆积
- 性能极致：mmap内存映射走内核页缓存，性能近内存，特别适合随机访问大文件
---

# 【美团面经】Python如何读取大文件？

## 一、核心回答

读取大文件的核心原则是**流式处理**——每次只加载有限数据到内存，避免 `read()` 一次性全部读取导致 OOM。主要方案有四种：**逐行迭代** `for line in f`、**分块读取** `read(chunk_size)`、**生成器 yield 惰性处理**、**mmap 内存映射**。其中逐行迭代最常用，mmap 性能最高，生成器最适合链式管道处理。

---

## 二、方案一：逐行迭代（最常用）

文件对象本身是可迭代对象，`for line in f` 每次只读一行到内存，空间复杂度 O(1)。

```python
def read_line_by_line(filepath):
    """逐行读取，内存友好"""
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:             # 逐行迭代，每次一行
            process(line.strip())  # 业务处理

def process(line):
    pass  # 你的处理逻辑
```

> ⚠️ **避免 `readlines()`**：`f.readlines()` 会一次性读取所有行到列表，大文件直接 OOM。

---

## 三、方案二：read(chunk_size) 分块读取

对于**二进制文件**或**无换行符的大文件**（如大JSON、视频），按固定大小分块：

```python
def read_by_chunk(filepath, chunk_size=8192):
    """按固定大小分块读取"""
    with open(filepath, 'rb') as f:    # 二进制模式
        while True:
            chunk = f.read(chunk_size) # 每次读8KB
            if not chunk:              # 读到文件末尾
                break
            process_chunk(chunk)

def process_chunk(chunk):
    pass
```

**chunk_size 选择建议**：

| chunk_size | 适用场景 | 说明 |
|------------|----------|------|
| 4KB~8KB | 通用场景 | 默认缓冲区大小 |
| 64KB~1MB | 大文件吞吐 | 减少系统调用次数 |
| 4MB+ | 超大文件 | 以空间换吞吐 |

---

## 四、方案三：生成器 yield 惰性处理

用生成器封装读取逻辑，实现**惰性求值**——按需产出数据，支持管道式链式处理：

```python
def read_lines_gen(filepath):
    """生成器：惰性逐行产出"""
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            yield line.strip()     # yield 惰性返回

def filter_lines(lines, keyword):
    """过滤管道"""
    for line in lines:
        if keyword in line:
            yield line

# 使用：链式管道处理，内存始终 O(1)
lines = read_lines_gen("huge_file.log")
filtered = filter_lines(lines, "ERROR")

for line in filtered:    # 真正迭代时才执行
    print(line)
```

**生成器优势**：不需要把中间结果存在内存中，整个管道任意时刻只占用一行数据的空间。

---

## 五、方案四：mmap 内存映射（性能最高）

`mmap` 将文件映射到虚拟内存，操作系统按页按需加载，**读写都走内核页缓存**，性能接近内存访问：

```python
import mmap

def read_with_mmap(filepath):
    """mmap 内存映射读取大文件"""
    with open(filepath, 'r+b') as f:           # r+b 读写二进制
        mm = mmap.mmap(f.fileno(), length=0,   # length=0 映射整个文件
                        access=mmap.ACCESS_READ)
        
        # 方式一：按行迭代
        for line in iter(mm.readline, b''):    # b'' 表示结束
            process(line)
        
        # 方式二：随机访问（seek + read）
        mm.seek(1000000)       # 跳到指定位置
        data = mm.read(1024)   # 读取1KB
        
        mm.close()             # 关闭映射
```

**mmap 适用场景**：
- ✅ 需要随机访问大文件特定位置（如索引查询）
- ✅ 多进程共享同一文件的读取（映射共享）
- ✅ 频繁读写同一大文件（减少用户态↔内核态数据拷贝）
- ❌ 不适用：远程网络文件、文件大小动态变化

---

## 六、四种方案性能对比

以读取一个 **5GB 日志文件**为例：

| 方案 | 内存占用 | 读取速度 | 适用场景 |
|------|----------|----------|----------|
| `read()` 全量 | ~5GB（OOM！） | 最快但炸内存 | ❌ 绝对禁止 |
| `for line in f` 逐行 | ~4KB | 较快 | ✅ 文本日志，最推荐 |
| `read(chunk)` 分块 | = chunk_size | 快 | ✅ 二进制、无换行符文件 |
| 生成器 yield | ~4KB | 较快 | ✅ 链式管道处理 |
| `mmap` 映射 | 按需分页 | **最快** | ✅ 随机访问、多进程共享 |

```python
# 性能基准测试示例
import time

def benchmark(filepath):
    # 方案一：逐行
    start = time.time()
    count = 0
    with open(filepath) as f:
        for line in f:
            count += 1
    print(f"逐行迭代: {time.time()-start:.2f}s, {count} 行")

    # 方案四：mmap
    start = time.time()
    count = 0
    with open(filepath, 'rb') as f:
        mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
        for line in iter(mm.readline, b''):
            count += 1
        mm.close()
    print(f"mmap读取: {time.time()-start:.2f}s, {count} 行")
```

---

## 七、readline vs readlines 对比

这是高频追问，务必区分清楚：

| 方法 | 行为 | 内存 | 用法 |
|------|------|------|------|
| `f.readline()` | 每次读**一行**，返回 str | O(1) | `line = f.readline()` |
| `f.readlines()` | 一次性读**全部行**到列表 | O(n) | `lines = f.readlines()` |
| `for line in f` | 迭代器逐行 | O(1) | ✅ 推荐替代 readlines |

```python
# ❌ 错误：大文件会OOM
lines = f.readlines()
for line in lines:
    process(line)

# ✅ 正确：等价效果但O(1)内存
for line in f:
    process(line)
```

---

## 八、面试要点总结

1. **核心原则**：永远不要 `read()` 全量，用流式/分块处理，保证内存 O(1) 或 O(buffer_size)
2. **逐行迭代** `for line in f`：文本文件首选，最简洁高效
3. **分块读取** `read(chunk_size)`：二进制文件或无换行符的场景
4. **生成器 yield**：适合多步骤管道式数据处理，惰性求值
5. **mmap**：随机访问大文件、多进程共享、追求极致性能时的选择
6. **避坑**：永远不要 `readlines()` 大文件，不要 `read()` 不加参数

## 记忆要点

- 核心原则：坚决不用read()或readlines()全量加载，必须采用流式处理防OOM
- 逐行与分块：文本最常按行迭代，无换行大文件或二进制则按固定size分块读取
- 高阶处理：用yield生成器封装可实现惰性求值，完美支持链式管道内存零堆积
- 性能极致：mmap内存映射走内核页缓存，性能近内存，特别适合随机访问大文件

