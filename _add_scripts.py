#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Batch add `## 结构化回答` and `## 视频脚本` sections to non-ai interview question files.

Reads frontmatter (yaml) to extract essence / analogy / key_points / memory_points / follow_up,
then derives the two new sections from these and appends them to the end of the file.
Skips files that already contain `## 结构化回答`.
"""
import os
import re
import sys
import yaml
from pathlib import Path

QUESTIONS_DIR = Path("/Users/sunqingguang/hermes/opt/projects/interview-notes/questions")
EXCLUDE_DIRS = {"ai"}
INCLUDED_DIRS = ["system-design", "java", "database", "frontend", "network", "algorithm", "other"]

# Difficulty -> video script total duration label & number of script rows.
DURATION_MAP = {
    "L1": ("1 分 30 秒", 4),
    "L2": ("2 分钟", 4),
    "L3": ("3 分钟", 5),
    "L4": ("4 分钟", 6),
    "L5": ("4 分钟", 6),
}
DEFAULT_DURATION = ("3 分钟", 5)

# Concrete visual cue candidates per category/subcategory keywords.
VISUAL_HINTS = [
    ("Redis", "Redis Lua 脚本执行截图"),
    ("MySQL", "MySQL EXPLAIN 执行计划截图"),
    ("SQL", "SQL 执行计划截图"),
    ("动态规划", "dp 数组填表过程动画"),
    ("DP", "dp 数组填表过程动画"),
    ("图", "图遍历示意图"),
    ("Tree", "二叉树结构图"),
    ("二叉树", "二叉树结构图"),
    ("排序", "排序算法柱状图动画"),
    ("缓存", "缓存读写策略流程图"),
    ("分布式锁", "分布式锁时序图"),
    ("锁", "加锁/解锁时序图"),
    ("Netty", "Netty Reactor 线程模型图"),
    ("Reactor", "Reactor 线程模型图"),
    ("TCP", "TCP 三次握手图"),
    ("UDP", "UDP 报文结构图"),
    ("HTTP", "HTTP 请求/响应报文结构图"),
    ("HTTPS", "HTTPS 握手流程图"),
    ("网络", "TCP/IP 协议栈分层图"),
    ("BIO", "BIO/NIO/AIO 对比图"),
    ("NIO", "BIO/NIO/AIO 对比图"),
    ("AIO", "BIO/NIO/AIO 对比图"),
    ("IO", "IO 模型对比图"),
    ("GC", "JVM 内存模型与 GC 流程图"),
    ("JVM", "JVM 内存结构图"),
    ("内存", "JVM 内存结构图"),
    ("Spring", "Spring Bean 生命周期图"),
    ("SpringBoot", "SpringBoot 自动配置流程图"),
    ("MyBatis", "MyBatis 执行流程图"),
    ("Kafka", "Kafka 分区与消费者组架构图"),
    ("RabbitMQ", "RabbitMQ 消息流转图"),
    ("MQ", "消息队列架构图"),
    ("消息队列", "消息队列架构图"),
    ("索引", "B+ 树索引结构图"),
    ("B+", "B+ 树索引结构图"),
    ("事务", "事务隔离级别对比表"),
    ("MVCC", "MVCC 版本链图"),
    ("React", "React Fiber 树结构图"),
    ("Fiber", "React Fiber 树结构图"),
    ("Vue", "Vue 响应式依赖追踪图"),
    ("Vue3", "Vue3 响应式依赖追踪图"),
    ("前端", "浏览器渲染流程图"),
    ("TypeScript", "TS 类型推导示意图"),
    ("Webpack", "Webpack 构建流程图"),
    ("Vite", "Vite 模块依赖图"),
    ("浏览器", "浏览器渲染流程图"),
    ("渲染", "浏览器渲染流程图"),
    ("操作系统", "进程/线程状态转换图"),
    ("进程", "进程/线程状态转换图"),
    ("线程", "线程状态转换图"),
    ("Python", "Python GIL 工作机制图"),
    ("GIL", "Python GIL 工作机制图"),
    ("协程", "协程调度时序图"),
    ("asyncio", "asyncio 事件循环图"),
    ("LRU", "LRU 双向链表+HashMap 结构图"),
    ("链表", "链表节点指针图"),
    ("算法", "算法示意图"),
]
DEFAULT_VISUAL = "架构示意图"


def parse_frontmatter(text):
    """Return (fm_dict, body_text, fm_end_index)."""
    if not text.startswith("---"):
        return None, text, 0
    m = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if not m:
        return None, text, 0
    fm_raw = m.group(1)
    try:
        fm = yaml.safe_load(fm_raw) or {}
    except yaml.YAMLError:
        return None, text, 0
    body = text[m.end():]
    return fm, body, m.end()


def get(fm, *keys, default=None):
    cur = fm
    for k in keys:
        if isinstance(cur, dict) and k in cur:
            cur = cur[k]
        else:
            return default
    return cur


def as_list(val):
    if val is None:
        return []
    if isinstance(val, list):
        return [str(x) for x in val if x]
    return [str(val)]


# --- Title extraction ---

# Words we treat as soft "boundaries" inside a sentence when looking for a clean title.
TITLE_BOUNDARY_TOKENS = ["的", "与", "和", "是", "用", "靠", "靠", "通过", "利用",
                         "实现", "解决", "保证", "防止", "避免", "核心", "关键"]


def extract_title(sentence, max_len=10):
    """
    Extract a clean short title from a sentence.
    Strategy:
      1. If sentence has a Chinese/ASCII delimiter, take the left part.
      2. Otherwise scan forward up to max_len, stopping at boundary tokens or
         at the end of an English word / bracket group.
      3. Never cut inside an English letter sequence or inside ().
    """
    s = sentence.strip().lstrip("-•*• ").strip()
    # Strip leading enumeration.
    s = re.sub(r"^[\d一二三四五六七八九十]+[、.．\)）:：]\s*", "", s)
    s = re.sub(r"^[（(][^)）]+[)）]\s*", "", s)
    # Strip wrapping quotes.
    s = s.strip("\"'“”‘’「」『』 ")

    # 1. Delimiter split — prefer the part before the first delimiter, if it's short enough.
    for sep in ["：", ":", "—", "—", "—", "="]:
        if sep in s:
            left = s.split(sep, 1)[0].strip()
            if 2 <= len(left) <= max_len + 2:
                return _clean_title(left, max_len)

    # 2. Walk forward, respecting English words and brackets.
    out = []
    i = 0
    n = len(s)
    while i < n and len(out) < max_len:
        ch = s[i]
        if ch.isascii() and ch.isalpha():
            # Consume the whole English word (including technical tokens like I/O, C++, B+).
            j = i
            while j < n and (s[j].isascii() and (s[j].isalnum() or s[j] in "_-./+")):
                j += 1
            # Trim trailing punctuation from the word.
            word = s[i:j].rstrip("-./+")
            if not word:
                word = s[i:j]
            # If adding the full word would exceed max_len by a lot, stop here.
            if len(out) + len(word) > max_len + 2 and len(out) >= 2:
                break
            out.append(word)
            i = j
            continue
        if ch in "（([":
            # Consume until matching close bracket.
            close = "）)]"["（([".index(ch)]
            j = s.find(close, i)
            if j == -1:
                # Unbalanced; just take rest as part of title but cap.
                rest = s[i : i + (max_len - len(out))]
                out.append(rest)
                i = i + len(rest)
            else:
                grp = s[i : j + 1]
                if len(out) + len(grp) > max_len + 2 and len(out) >= 2:
                    break
                out.append(grp)
                i = j + 1
            continue
        # Chinese / digit / other char.
        # Stop at hard sentence/clause punctuation.
        if ch in "，,。.；;！!？?、":
            break
        out.append(ch)
        i += 1
        # Check boundary tokens at current position to optionally stop.
        tail = "".join(out)
        for tok in TITLE_BOUNDARY_TOKENS:
            if tail.endswith(tok) and len(out) >= 3:
                # Trim the boundary token.
                return _clean_title(tail[: -len(tok)], max_len)
    return _clean_title("".join(out), max_len)


def _clean_title(t, max_len):
    t = t.strip()
    # Strip trailing punctuation/space.
    t = t.rstrip("：:，,、。.；;—- ")
    # Strip weak leading connectors that make poor titles.
    t = re.sub(r"^(因为|所以|如果|那么|由于|只要|只有|为了|通过|利用|使用)\s*", "", t)
    if not t:
        return "核心要点"
    if len(t) > max_len:
        t = t[:max_len]
    return t


def split_point(point):
    """Return (title, desc). If no delimiter, title is a clean prefix & desc is the full sentence."""
    s = point.strip().lstrip("-•*• ").strip()
    for sep in ["：", ":", "—", "—", "—", "="]:
        if sep in s:
            left, _, right = s.partition(sep)
            left = left.strip()
            right = right.strip()
            if 2 <= len(left) <= 14 and right:
                return _clean_title(left, 10), right
    title = extract_title(s, max_len=10)
    # Desc is the full sentence (used for spoken lines).
    return title, s


# ---口语化 rephrasing ---

# Map a terse key_point / memory_point to a more spoken form by prepending a soft lead-in.
SPOKEN_LEADINS = {
    "本质": "本质上是",
    "第一层": "第一层是",
    "第二层": "第二层是",
    "第三层": "第三层是",
    "防": "防的是",
    "因为": "因为",
    "核心": "核心是",
    "关键": "关键是",
    "两大": "两块",
    "三大": "三块",
}


def to_spoken(sentence):
    """Lightly convert a terse sentence to a more spoken form."""
    s = sentence.strip().lstrip("-•*• ").strip()
    s = s.replace("=", "就是").replace("→", "到")
    # If short already, return as is.
    if len(s) <= 22:
        return s
    # If starts with a known leadin, leave it.
    for k, v in SPOKEN_LEADINS.items():
        if s.startswith(k):
            return s
    # No transformation needed otherwise.
    return s


# --- Structured answer builders ---

def build_elevator(fm):
    essence = (get(fm, "feynman", "essence") or "").strip()
    analogy = (get(fm, "feynman", "analogy") or "").strip()
    if not essence:
        # Fallback to memory_points first item.
        mp = as_list(get(fm, "memory_points"))
        if mp:
            essence = mp[0]

    # Simplify written punctuation into spoken form.
    pitch_core = essence.replace("=", "就是")
    # Truncate overly long essence at first hard sentence break.
    for sep in ["。", "；", ";"]:
        idx = pitch_core.find(sep, 35)
        if 0 < idx <= 90:
            pitch_core = pitch_core[: idx + 1]
            break

    pitch = pitch_core.rstrip("。.；;")
    # Add analogy as second spoken sentence if it's lively and not too long.
    if analogy and 8 <= len(analogy) <= 70 and ("像" in analogy or "比如" in analogy or "好比" in analogy):
        pitch += "。打个比方，" + analogy.rstrip("。.")
    return pitch + "。"


def collect_points(fm, want=3):
    """
    Collect `want` (title, desc, full) tuples for the structured answer.
    Prefer memory_points (more spoken, complete), then key_points, then first_principle.
    Each tuple: (title <=10 chars, short desc, full sentence for spoken line).
    """
    key_points = as_list(get(fm, "feynman", "key_points"))
    memory_points = as_list(get(fm, "memory_points"))
    fp_conclusion = get(fm, "first_principle", "conclusion")
    fp_essence = get(fm, "first_principle", "essence")
    essence = get(fm, "feynman", "essence")

    # Use memory_points first (they are full sentences). Dedup with key_points to avoid duplicates.
    used_norm = set()
    chosen = []

    def consider(p):
        if not p:
            return False
        s = p.strip().lstrip("-•*• ").strip()
        norm = re.sub(r"\s+", "", s).lower()
        if not norm or norm in used_norm:
            return False
        used_norm.add(norm)
        chosen.append(s)
        return True

    for p in memory_points:
        if len(chosen) >= want:
            break
        consider(p)
    for p in key_points:
        if len(chosen) >= want:
            break
        consider(p)
    # Pad with first_principle / essence.
    extras = [fp_conclusion, fp_essence, essence]
    for p in extras:
        if len(chosen) >= want:
            break
        consider(p)
    while len(chosen) < want:
        chosen.append("核心要点：理解本质后结合业务场景落地")

    out = []
    for s in chosen[:want]:
        title, desc = split_point(s)
        # If title equals desc (no delimiter), keep full sentence as desc.
        full = s
        # If desc is empty or same as title, fall back to full sentence.
        if not desc or desc == title:
            desc = full
        out.append((title, desc, full))
    return out


def build_closing(fm):
    follow_ups = as_list(get(fm, "follow_up"))
    if follow_ups:
        fu = follow_ups[0].strip().rstrip("？?。.")
        return f"这块我踩过坑——要不要深入聊：{fu}？"
    return "细节怎么落地、踩过哪些坑，您想从哪一头展开？"


def build_structured_answer(fm):
    pitch = build_elevator(fm)
    points = collect_points(fm, want=3)
    closing = build_closing(fm)

    lines = ["## 结构化回答", ""]
    lines.append(f"**30 秒电梯演讲：** {pitch}")
    lines.append("")
    lines.append("**展开框架：**")
    for i, (t, d, _) in enumerate(points, 1):
        lines.append(f"{i}. **{t}** — {d}")
    lines.append("")
    lines.append(f"**收尾：** {closing}")
    return "\n".join(lines)


# --- Video script ---

def pick_visual(subcategory, key_points):
    text = (subcategory or "") + " " + " ".join(key_points)
    for kw, hint in VISUAL_HINTS:
        if kw in text:
            return hint
    return DEFAULT_VISUAL


def parse_duration_seconds(label):
    m = re.search(r"(\d+)\s*分(?!钟)", label)
    s = re.search(r"(\d+)\s*秒", label)
    minutes = int(m.group(1)) if m else 0
    seconds = int(s.group(1)) if s else 0
    if minutes == 0 and seconds == 0:
        m2 = re.search(r"(\d+)\s*分钟", label)
        if m2:
            return int(m2.group(1)) * 60
    return minutes * 60 + seconds


def fmt_time(sec):
    sec = int(sec)
    m, s = divmod(sec, 60)
    return f"{m}:{s:02d}"


def build_video_script(fm):
    difficulty = (get(fm, "difficulty") or "L3").strip()
    duration_label, n_rows = DURATION_MAP.get(difficulty, DEFAULT_DURATION)

    essence = (get(fm, "feynman", "essence") or "").strip()
    key_points = as_list(get(fm, "feynman", "key_points"))
    memory_points = as_list(get(fm, "memory_points"))
    subcategory = (get(fm, "subcategory") or "").strip()
    follow_ups = as_list(get(fm, "follow_up"))

    base_visual = pick_visual(subcategory, key_points)
    visuals_pool = [
        base_visual,
        f"{base_visual}分步演示",
        "关键代码/伪代码片段",
        "对比表格",
        "流程时序图",
        "实战案例截图",
    ]

    # Hook: 1-line essence.
    hook_essence = essence.replace("=", "就是").rstrip("。.")
    if len(hook_essence) > 50:
        # Cut at first comma after 35 chars.
        cut = -1
        for sep in ["，", "、", "。", "；"]:
            idx = hook_essence.find(sep, 35)
            if 0 < idx <= 75:
                cut = idx
                break
        if cut > 0:
            hook_essence = hook_essence[:cut] + "…"
        else:
            hook_essence = hook_essence[:48] + "…"
    hook_topic = subcategory or "这道题"
    hook_spoken = f'"{hook_topic}一句话：{hook_essence}。"'

    # Body rows from memory_points (prefer) + key_points.
    body_pool = []
    seen_norm = set()
    for p in memory_points + key_points:
        s = p.strip().lstrip("-•*• ").strip()
        norm = re.sub(r"\s+", "", s).lower()
        if not s or norm in seen_norm:
            continue
        seen_norm.add(norm)
        body_pool.append(s)

    # Need n_rows - 1 body points + 1 summary row.
    body_needed = max(1, n_rows - 2)
    if len(body_pool) < body_needed:
        # Pad with essence.
        while len(body_pool) < body_needed:
            body_pool.append(essence or "核心要点：理解本质后结合业务落地")
    body_pts = body_pool[:body_needed]

    # Timing.
    total_sec = parse_duration_seconds(duration_label)
    intro_sec = 15
    outro_sec = 10
    body_total = max(20, total_sec - intro_sec - outro_sec)
    body_step = body_total // max(1, len(body_pts))

    rows = [(fmt_time(0), "标题卡", hook_spoken, "开场钩子")]
    t = intro_sec
    for i, raw in enumerate(body_pts):
        title, desc = split_point(raw)
        # For spoken line, prefer full sentence (more natural); fall back to desc.
        spoken_src = raw if (not desc or desc == title or len(desc) < len(raw)) else desc
        spoken = to_spoken(spoken_src.strip())
        spoken = spoken.replace("|", "/")
        if len(spoken) > 60:
            spoken = spoken[:58] + "…"
        spoken = f'"{spoken}"'
        v = visuals_pool[i % len(visuals_pool)]
        rows.append((fmt_time(t), v, spoken, title))
        t += body_step

    # Outro row.
    if follow_ups:
        hook_q = follow_ups[0].strip().rstrip("？?。.")
        outro_spoken = f'"核心抓住这条主线，下期咱们接着聊：{hook_q}。"'
    else:
        outro_spoken = '"核心抓住这条主线，细节按需展开。下期见。"'
    rows.append((fmt_time(max(t, total_sec - outro_sec)), "总结卡", outro_spoken, "收尾"))

    # Render table.
    lines = ["## 视频脚本", "", f"> 预计时长：{duration_label} | 由浅入深", "",
             "| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |",
             "|------|----------|----------|----------|"]
    for tt, v, s, p in rows:
        v = v.replace("|", "/")
        # Escape internal double quotes inside spoken line so the wrapped quotes stay intact.
        # Strip the wrapping quotes, escape inner ones, then re-wrap.
        inner = s
        if inner.startswith('"') and inner.endswith('"'):
            inner = inner[1:-1]
        inner = inner.replace('"', "'").replace("|", "/")
        s = f'"{inner}"'
        p = p.replace("|", "/")
        lines.append(f"| {tt} | {v} | {s} | {p} |")
    return "\n".join(lines)


def process_file(path):
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as e:
        return ("error", f"read failed: {e}")

    if "## 结构化回答" in text:
        return ("skip", "already has 结构化回答")

    fm, body, fm_end = parse_frontmatter(text)
    if fm is None:
        return ("error", "frontmatter parse failed")

    try:
        ans = build_structured_answer(fm)
        script = build_video_script(fm)
    except Exception as e:
        return ("error", f"build failed: {e}")

    new_text = text.rstrip() + "\n\n\n" + ans + "\n\n" + script + "\n"
    try:
        path.write_text(new_text, encoding="utf-8")
    except Exception as e:
        return ("error", f"write failed: {e}")
    return ("ok", f"added ({(get(fm, 'difficulty') or '?')})")


def main():
    files = []
    for d in INCLUDED_DIRS:
        dir_path = QUESTIONS_DIR / d
        if not dir_path.is_dir():
            continue
        files.extend(sorted(dir_path.glob("*.md")))

    counts = {"ok": 0, "skip": 0, "error": 0}
    errors = []
    for p in files:
        status, msg = process_file(p)
        counts[status] += 1
        if status == "error":
            errors.append(f"{p.name}: {msg}")

    print(f"Total files scanned: {len(files)}")
    print(f"  ok:    {counts['ok']}")
    print(f"  skip:  {counts['skip']}")
    print(f"  error: {counts['error']}")
    if errors:
        print("\nErrors:")
        for e in errors:
            print(f"  - {e}")


if __name__ == "__main__":
    main()
