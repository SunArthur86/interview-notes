#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为 questions/ai/*.md 追加两个段落：## 结构化回答 和 ## 视频脚本。
所有要点均从已有 frontmatter (feynman / memory_points / follow_up) 提炼，不编造。
"""
import os
import re
import sys
import yaml

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'questions', 'ai')
DIR = os.path.abspath(DIR)

# ---------- 难度参数 ----------
DURATION_BY_DIFF = {
    'L1': '2 分钟',
    'L2': '3 分钟',
    'L3': '4 分钟',
    'L4': '5 分钟',
    'L5': '5 分钟',
}
ROWS_BY_DIFF = {
    'L1': 4,
    'L2': 4,
    'L3': 5,
    'L4': 6,
    'L5': 6,
}
# 视频脚本时间锚点（按行数展开）
TIME_ANCHORS = {
    4: ['0:00', '0:20', '0:55', '1:30'],
    5: ['0:00', '0:20', '0:50', '1:30', '2:20'],
    6: ['0:00', '0:20', '0:50', '1:30', '2:20', '3:10'],
}

# 标题候选词：从描述里识别可做 bold 标题的「主题词」
TOPIC_KEYWORDS = [
    'Transformer', 'Attention', 'Self-Attention', 'Multi-Head', 'ViT', 'CLIP',
    'Agent', 'RAG', 'Embedding', 'Softmax', 'FlashAttention', 'Flash Attention',
    'MoE', 'LoRA', 'RLHF', 'DPO', 'PagedAttention', 'KV Cache', 'MHA', 'MQA',
    'GQA', 'ReAct', 'LangChain', 'LangGraph', 'BM25', 'HNSW', 'ANN', 'KNN',
    'BERT', 'GPT', 'LLaMA', 'Llama', 'Qwen', 'CNN', 'RNN', 'LSTM', 'GRU',
    'Quant', 'FP16', 'INT8', 'FP8', 'BF16', 'TopK', 'Top-K', 'Beam',
    'Function Calling', 'JSON Schema', 'SFT', 'PPO', 'PPO',
    'Token', 'Chunk', 'Overlap', 'Prompt', 'Tool', 'Memory',
    'MLP', 'LayerNorm', 'RMSNorm', 'ReLU', 'GELU', 'SwiGLU', 'RoPE',
    'Tensor', 'GPU', 'CUDA', 'triton', 'vLLM', 'TensorRT', 'SGLang',
    'Performer', 'Reformer', 'Linear Attention',
    'Pipeline', 'ZeRO', 'DDP', 'FSDP', 'Megatron',
]


def clean_str(s):
    """规整字符串：去首尾引号、空白。"""
    if not isinstance(s, str):
        return ''
    s = s.strip()
    # 去掉 YAML 字符串引号
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ('"', "'"):
        s = s[1:-1].strip()
    return s


def split_title_desc(text):
    """
    把一个 key_point 切成 (title, desc)。
    优先顺序：
      1) 中英文冒号  -> title : desc
      2) ——/— 破折号 -> title — desc
      3) 无法切分    -> 用关键词识别 / 否则整句作 desc，title 取前 6-10 字
    """
    s = clean_str(text)
    if not s:
        return None

    # 1) 冒号
    for sep in ['：', ':']:
        if sep in s:
            left, right = s.split(sep, 1)
            left = left.strip().strip('「」""\'')
            right = right.strip()
            if left and right:
                return _format_title(left), right

    # 2) 破折号
    for sep in ['——', '—', '--', ' - ']:
        if sep in s:
            left, right = s.split(sep, 1)
            left = left.strip().strip('「」""\'')
            right = right.strip()
            if left and right:
                return _format_title(left), right

    # 3) 无分隔符
    # 3a) 以已知技术词开头
    for kw in TOPIC_KEYWORDS:
        if s.startswith(kw):
            rest = s[len(kw):].lstrip(' ：:，,、-的')
            if rest and len(rest) >= 4:
                return _format_title(kw), rest
            # 整句作为 desc，title 用关键词
            return _format_title(kw), s

    # 3b) 取前 6~10 个字作为 title（保留到第一个逗号/顿号前）
    head = re.split(r'[，,；;。]', s)[0]
    if len(head) <= 14 and len(s) > len(head) + 2:
        return _format_title(head), s
    if len(head) <= 14:
        # head 就是整句的近似——title 取前 6~8 字
        t = head[:8]
        return _format_title(t), s
    # 句子较长：title 前 8 字
    return _format_title(s[:8]), s


def _format_title(t):
    """规整 title：去尾标点，限长 14 字。"""
    t = t.strip().strip(' ：:，,、。.；;-—')
    if len(t) > 16:
        t = t[:16]
    return t


def collect_framework_points(fm):
    """
    收集 3 个 (title, desc) 作为「展开框架」要点。
    数据来源优先级：
      feynman.key_points → memory_points → feynman.essence 拆分
    """
    fy = fm.get('feynman') or {}
    kps = [clean_str(k) for k in (fy.get('key_points') or []) if clean_str(k)]

    # 从 key_points 提取
    pts = []
    seen_titles = set()
    for kp in kps:
        r = split_title_desc(kp)
        if r:
            t, d = r
            if t in seen_titles:
                continue
            seen_titles.add(t)
            pts.append((t, d))
        if len(pts) >= 5:
            break

    # 不足 3 个：从 memory_points 补
    if len(pts) < 3:
        mps = [clean_str(m) for m in (fm.get('memory_points') or []) if clean_str(m)]
        for mp in mps:
            r = split_title_desc(mp)
            if r:
                t, d = r
                if t in seen_titles:
                    continue
                seen_titles.add(t)
                pts.append((t, d))
            if len(pts) >= 4:
                break

    # 仍不足：拆分 essence
    if len(pts) < 2:
        e = clean_str(fy.get('essence'))
        if e:
            # 按标点拆成短语
            chunks = re.split(r'[，,；;。]', e)
            chunks = [c.strip() for c in chunks if len(c.strip()) >= 4]
            for c in chunks:
                t, d = _format_title(c[:8]), c
                if t in seen_titles:
                    continue
                seen_titles.add(t)
                pts.append((t, d))
                if len(pts) >= 3:
                    break

    # 兜底
    while len(pts) < 3:
        pts.append(('核心要点', clean_str(fy.get('essence')) or '见正文'))

    # 返回前 3 个
    return pts[:3]


def build_elevator(fm):
    """30 秒电梯演讲：口语化 1-2 句。融合 essence + analogy。"""
    fy = fm.get('feynman') or {}
    essence = clean_str(fy.get('essence'))
    analogy = clean_str(fy.get('analogy'))

    # 去掉 essence 末尾标点
    if essence:
        essence_core = essence.rstrip('。.；;')
    else:
        essence_core = ''

    # analogy 提取「打比方」前半部分（破折号/冒号前）
    ana_short = ''
    if analogy:
        # 去掉明显的引导词，取核心比喻
        for sep in ['——', '—', '：', ':']:
            if sep in analogy:
                ana_short = analogy.split(sep, 1)[0].strip()
                break
        if not ana_short:
            ana_short = analogy
        # 限长
        if len(ana_short) > 40:
            ana_short = ana_short[:40]

    # 组合：essence 为主，analogy 作为口语化补充
    if essence_core and ana_short:
        # 如果 analogy 已经包含 essence 的关键词，避免重复
        text = f"{essence_core}——{ana_short}。"
    elif essence_core:
        text = f"{essence_core}。"
    else:
        text = ana_short or '见正文详解。'

    # 限长：80~140 字
    if len(text) > 150:
        text = text[:147] + '…'
    return text


def build_closing_hook(fm):
    """收尾：用 follow_up 第一问做追问钩子。"""
    fu = fm.get('follow_up') or []
    if fu and isinstance(fu, list) and len(fu) > 0:
        q = clean_str(fu[0])
        if q:
            # 去掉结尾问号，统一加「您想深入聊：…？」
            q = q.rstrip('？?。.')
            return f"您想深入聊：{q}？"
    # 兜底
    return "以上三点都能配合实战案例展开，您想从哪一段深入？"


def build_structured_answer(fm):
    """构造 ## 结构化回答 段落。"""
    elevator = build_elevator(fm)
    pts = collect_framework_points(fm)
    hook = build_closing_hook(fm)

    lines = []
    lines.append('## 结构化回答\n')
    lines.append(f'**30 秒电梯演讲：** {elevator}\n')
    lines.append('**展开框架：**')
    for i, (t, d) in enumerate(pts, 1):
        lines.append(f"{i}. **{t}** — {d}")
    lines.append('')
    lines.append(f'**收尾：** {hook}\n')
    return '\n'.join(lines) + '\n'


# ---------- 视频脚本 ----------

def _pick_titles(pts):
    return [t for t, _ in pts]


def build_video_script(fm, diff, pts):
    """构造 ## 视频脚本 段落。"""
    rows_target = ROWS_BY_DIFF.get(diff, 5)
    times = TIME_ANCHORS.get(rows_target, TIME_ANCHORS[5])
    duration = DURATION_BY_DIFF.get(diff, '3 分钟')

    fy = fm.get('feynman') or {}
    essence = clean_str(fy.get('essence'))
    analogy = clean_str(fy.get('analogy'))

    # 主题（标题）：尝试从正文 H1 提取，回退到 essence 前 12 字
    topic = essence[:18] if essence else '本主题'
    if len(topic) < 6:
        topic = topic + '详解'

    titles = _pick_titles(pts)

    # 行模板： (画面/字幕, 口播台词, 讲解要点)
    # 第 1 行：开场钩子（用 analogy 或 essence）
    # 第 2 行：一句话定义（essence）
    # 第 3 ~ N-2 行：展开要点
    # 倒数第 2 行：实战/对比/易错
    # 最后一行：收尾总结

    scene_rows = []

    # 行 1：开场
    hook_say = analogy if analogy else (essence if essence else '这道题面试常考')
    if len(hook_say) > 45:
        hook_say = hook_say[:43] + '…'
    scene_rows.append((
        f'标题卡：{topic}',
        f'"{hook_say}"',
        '开场钩子',
    ))

    # 行 2：核心定义
    def_say = essence if essence else '我们从第一性原理来看这个问题。'
    if len(def_say) > 60:
        def_say = def_say[:58] + '…'
    scene_rows.append((
        '核心概念图',
        f'"{def_say}"',
        '核心定义',
    ))

    # 中间行：要点拆解（占用 rows_target - 4 行，留出倒数两行）
    mid_count = rows_target - 4
    if mid_count < 0:
        mid_count = 0
    # 用 titles 填充
    used_titles = titles[:mid_count] if titles else []
    # 若要点不足，从剩余 titles 补；若仍不足，用通用占位
    extra_pool = titles[mid_count:] if len(titles) > mid_count else []
    for i in range(mid_count):
        if i < len(used_titles):
            t = used_titles[i]
            # 对应 desc
            desc = pts[i][1] if i < len(pts) else ''
        else:
            t = f'要点 {i+1}'
            desc = ''
        say = f'"{t}：{desc}"' if desc else f'"{t}，这点很关键。"'
        if len(say) > 70:
            say = say[:68] + '…"'
        scene_rows.append((
            f'{t}示意图',
            say,
            f'要点拆解{i+1}',
        ))

    # 倒数第 2 行：实战 / 对比 / 易错点
    cmp_say = '对比一下常见误区和工程实践，看真实场景里怎么取舍。'
    scene_rows.append((
        '对比/实战案例图',
        f'"{cmp_say}"',
        '实战与对比',
    ))

    # 最后一行：收尾
    fu = fm.get('follow_up') or []
    ending_say = '记住三个词：核心定义、关键要点、实战取舍。下期讲进阶追问。'
    if fu:
        first_q = clean_str(fu[0]).rstrip('？?。.')[:30]
        ending_say = f'记住核心要点。下期我们追问：{first_q}？'
    scene_rows.append((
        '总结卡',
        f'"{ending_say}"',
        '收尾与钩子',
    ))

    # 若行数超出（理论不会），截断
    scene_rows = scene_rows[:rows_target]
    # 若行数不足（titles 不足导致 mid_count=0 但 rows_target=6 仍应 6 行），补「延伸要点」
    while len(scene_rows) < rows_target:
        idx = len(scene_rows) - 2  # 插在倒数第二行之前
        if extra_pool:
            t = extra_pool.pop(0)
        else:
            # 用 memory_points 作为补充来源
            mps = [clean_str(m) for m in (fm.get('memory_points') or []) if clean_str(m)]
            mp_idx = len(scene_rows) - 4
            if 0 <= mp_idx < len(mps):
                r = split_title_desc(mps[mp_idx])
                t = r[0] if r else f'延伸要点 {idx}'
            else:
                t = f'延伸要点 {idx}'
        scene_rows.insert(idx, (
            f'{t}补充图',
            f'"{t}，这是进阶要点。"',
            '延伸拆解',
        ))

    # 组装表格
    out = []
    out.append('## 视频脚本\n')
    out.append(f'> 预计时长：{duration} | 由浅入深\n')
    out.append('')
    out.append('| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |')
    out.append('|------|----------|----------|----------|')
    for i, row in enumerate(scene_rows):
        t = times[i] if i < len(times) else f'{i}:00'
        scene, say, point = row
        out.append(f'| {t} | {scene} | {say} | {point} |')
    out.append('')
    return '\n'.join(out)


# ---------- 主流程 ----------

def process_file(path, dry_run=False, preview=False):
    with open(path, encoding='utf-8') as f:
        content = f.read()
    if '## 结构化回答' in content:
        return False
    parts = content.split('---\n', 2)
    if len(parts) < 3:
        return False
    try:
        fm = yaml.safe_load(parts[1])
    except Exception:
        return False
    if not isinstance(fm, dict):
        return False
    if 'feynman' not in fm:
        return False

    diff = clean_str(fm.get('difficulty')) or 'L3'
    pts = collect_framework_points(fm)
    structured = build_structured_answer(fm)
    script = build_video_script(fm, diff, pts)

    if preview:
        print(f'\n========== {os.path.basename(path)} [{diff}] ==========')
        print(structured)
        print(script)
        return True

    # 追加到文件末尾（保留已有结尾换行）
    new_content = content
    if not new_content.endswith('\n'):
        new_content += '\n'
    # 额外空行分隔
    new_content += '\n' + structured + '\n' + script

    if not dry_run:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new_content)
    return True


def main():
    dry = '--dry' in sys.argv
    preview = '--preview' in sys.argv
    only = None
    for a in sys.argv[1:]:
        if a.startswith('--only='):
            only = a.split('=', 1)[1]

    files = sorted(f for f in os.listdir(DIR) if f.endswith('.md'))
    if only:
        files = [f for f in files if only in f]

    count = 0
    skipped = 0
    for f in files:
        path = os.path.join(DIR, f)
        try:
            if process_file(path, dry_run=dry, preview=preview):
                count += 1
            else:
                skipped += 1
        except Exception as e:
            print(f'ERROR {f}: {e}', file=sys.stderr)
            skipped += 1
    if not preview:
        print(f'Processed: {count} | Skipped: {skipped} | Total seen: {len(files)}')


if __name__ == '__main__':
    main()
