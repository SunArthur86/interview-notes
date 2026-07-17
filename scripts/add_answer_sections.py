#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为 questions/ai/*.md 追加两个段落：## 结构化回答 和 ## 视频脚本。
所有要点均从已有 frontmatter (feynman / memory_points / follow_up) 提炼，不编造。
用法：
  python3 add_answer_sections.py --preview --only=note-ai50-001   # 预览
  python3 add_answer_sections.py --dry                            # 演练不写
  python3 add_answer_sections.py                                  # 正式执行
"""
import os
import re
import sys
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.abspath(os.path.join(HERE, '..', 'questions', 'ai'))

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
TIME_ANCHORS = {
    4: ['0:00', '0:20', '0:55', '1:30'],
    5: ['0:00', '0:20', '0:50', '1:30', '2:20'],
    6: ['0:00', '0:20', '0:50', '1:30', '2:20', '3:10'],
}

TOPIC_KEYWORDS = [
    'Transformer', 'Attention', 'Self-Attention', 'Multi-Head', 'ViT', 'CLIP',
    'Agent', 'RAG', 'Embedding', 'Softmax', 'FlashAttention', 'Flash Attention',
    'MoE', 'LoRA', 'RLHF', 'DPO', 'PagedAttention', 'KV Cache', 'MHA', 'MQA',
    'Multi-Agent', 'Cross-Encoder', 'Bi-Encoder',
    'GQA', 'ReAct', 'LangChain', 'LangGraph', 'BM25', 'HNSW', 'ANN', 'KNN',
    'BERT', 'GPT', 'LLaMA', 'Llama', 'Qwen', 'CNN', 'RNN', 'LSTM', 'GRU',
    'FP16', 'INT8', 'FP8', 'BF16', 'TopK', 'Top-K',
    'Function Calling', 'JSON Schema', 'SFT', 'PPO',
    'Token', 'Chunk', 'Overlap', 'Prompt', 'Tool', 'Memory',
    'MLP', 'LayerNorm', 'RMSNorm', 'ReLU', 'GELU', 'SwiGLU', 'RoPE',
    'Tensor', 'GPU', 'CUDA', 'vLLM', 'TensorRT', 'SGLang',
    'Performer', 'Reformer', 'Linear Attention',
    'Pipeline', 'ZeRO', 'DDP', 'FSDP', 'Megatron',
]


def clean_str(s):
    if not isinstance(s, str):
        return ''
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ('"', "'"):
        s = s[1:-1].strip()
    return s


def _format_title(t, max_len=14):
    """规整 title：去尾标点；超长则优先在标点/空格/连字符边界截断，绝不截断英文单词中间。
    允许较长标题（14字）以容纳「中文词 + 英文术语」组合。
    """
    t = t.strip().strip(' ：:，,、。.；;')
    if len(t) <= max_len:
        return t
    # 优先在最近的标点/空格/连字符边界截断（保留完整英文词）
    # 先找中英切换边界（语义最强），再退而求其次找连字符/空格
    best = -1
    # 第一优先级：中文字符后紧跟 ASCII 字母数字（中英切换点）
    for i in range(min(max_len, len(t)), 3, -1):
        ch = t[i-1]
        nxt = t[i] if i < len(t) else ''
        if re.match(r'[\u4e00-\u9fff]', ch) and re.match(r'[A-Za-z0-9]', nxt):
            best = i
            break
    # 第二优先级：连字符/空格边界（且其后是英文，避免切断 Bi-Encoder 这种复合词的后半段）
    if best < 0:
        for i in range(min(max_len, len(t)), 3, -1):
            ch = t[i-1]
            if ch in ' -—_' and i < max_len:
                best = i
                break
    if best > 3:
        t = t[:best].rstrip(' -—：:，,、')
    else:
        # 回退：避免在 ASCII 字母数字中间截断
        cut = max_len
        while cut > 4 and re.match(r'[A-Za-z0-9]', t[cut-1]) and cut < len(t) and re.match(r'[A-Za-z0-9]', t[cut]):
            cut -= 1
        t = t[:cut].rstrip(' -—：:，,、')
    return t


def _make_title_from_plain(s):
    """无分隔符的短句：提炼一个简短标题（<=10 字），绝不截断英文单词或留下半截括号。
    策略：
      1) 已知主题词开头 -> 主题词
      2) 中文前缀 + 英文/数字 -> 取中文前缀（2~6 字）
      3) 纯中文 -> <=8 字直接用，否则前 6 字
      4) 英文/缩写开头 -> 取首个标识符 token（到标点/空格/中文/括号），如 'CDC(Change...' -> 'CDC'
    """
    s = s.strip()
    head = re.split(r'[，,；;。：:！？?!]', s)[0].strip()
    if not head:
        head = s
    # 1) 主题词
    for kw in TOPIC_KEYWORDS:
        if head.startswith(kw):
            return kw
    # 2) 中文前缀 + 英文/数字/数值符号：取中文前缀
    #    允许中间有空格（'去掉 Critic' -> '去掉'），允许后跟 ~ + ≈ 等（'显存减少~50%' -> '显存减少'）
    m = re.match(r'^([\u4e00-\u9fff]{2,6})\s*(?=[A-Za-z0-9_=~+≈≥≤<>])', head)
    if m:
        return m.group(1)
    # 3) 纯中文（无 ASCII 字母数字）：取一个 <=6 字的标题
    #    优先在自然分隔词（/、与、和、的、及）处断开，避免切断双字概念词
    if not re.search(r'[A-Za-z0-9]', head):
        # 先在 / 处断
        if '/' in head:
            return head.split('/', 1)[0].strip()[:8]
        # 在自然连接词处断（与/和/及/的）—— 仅当断点在 3~6 字之间
        m_sep = re.match(r'^([\u4e00-\u9fff]{2,5})([与和及]|[的一])', head)
        if m_sep:
            return m_sep.group(1)
        # 直接取前 5 字（避免切断双字词的尾部）
        if len(head) <= 6:
            return head
        return head[:5]
    # 4) 英文/缩写/数字 开头：取首个「概念 token」
    #    概念 token = [A-Za-z] 开头的英文词(允许内部连字符)，
    #                或 [0-9] 开头的数字+单位(允许 4-bit, ~50%, INT8 等)
    #    匹配到中文/空格/其他标点为止
    # 4a) 英文标识符（含连字符复合词），如 Multi-Agent / Cross-Encoder
    m2 = re.match(r'^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)', head)
    if m2:
        tok = m2.group(1)
        if len(tok) <= 14:
            return tok
        cut = 14
        while cut > 4 and re.match(r'[A-Za-z0-9]', tok[cut-1]) and cut < len(tok) and re.match(r'[A-Za-z0-9]', tok[cut]):
            cut -= 1
        return tok[:cut]
    # 4b) 数字开头：取「数字 + 可选单位（-bit/%/b/倍 等）」，如 4-bit / 8b / ~50% / 7B
    m_num = re.match(r'^([0-9]+(?:\.[0-9]+)?(?:[-~][A-Za-z]+|%|B|b|K|M|G|x|倍)?)', head)
    if m_num:
        return m_num.group(1)[:12]
    # 4c) 其他 ASCII 开头（含符号 ~ + 等）
    m3 = re.match(r'^([A-Za-z0-9_=.~+]+)', head)
    if m3:
        return m3.group(1)[:10]
    return head[:6]


def split_title_desc(text):
    """把一个 key_point 切成 (title, desc)。"""
    s = clean_str(text)
    if not s:
        return None
    for sep in ['：', ':']:
        if sep in s:
            left, right = s.split(sep, 1)
            left = left.strip().strip('「」""\'')
            right = right.strip()
            if left and right:
                return _format_title(left), right
    for sep in ['——', '—', '--', ' - ']:
        if sep in s:
            left, right = s.split(sep, 1)
            left = left.strip().strip('「」""\'')
            right = right.strip()
            if left and right:
                return _format_title(left), right
    # 无分隔符：title 用提炼（_make_title_from_plain 已保证不截断/不留半截），desc 用原句
    title = _make_title_from_plain(s)
    # 仅做轻微清理（去尾标点），不再二次截断
    title = title.strip().strip(' ：:，,、。.；;')
    return title, s


def collect_framework_points(fm):
    """收集 3 个 (title, desc) 作为「展开框架」。"""
    fy = fm.get('feynman') or {}
    kps = [clean_str(k) for k in (fy.get('key_points') or []) if clean_str(k)]
    pts = []
    seen = set()
    for kp in kps:
        r = split_title_desc(kp)
        if r:
            t, d = r
            if t in seen:
                continue
            seen.add(t)
            pts.append((t, d))
        if len(pts) >= 5:
            break
    if len(pts) < 3:
        mps = [clean_str(m) for m in (fm.get('memory_points') or []) if clean_str(m)]
        for mp in mps:
            r = split_title_desc(mp)
            if r:
                t, d = r
                if t in seen:
                    continue
                seen.add(t)
                pts.append((t, d))
            if len(pts) >= 4:
                break
    if len(pts) < 2:
        e = clean_str(fy.get('essence'))
        if e:
            chunks = [c.strip() for c in re.split(r'[，,；;。]', e) if len(c.strip()) >= 4]
            for c in chunks:
                t, d = _format_title(c[:8]), c
                if t in seen:
                    continue
                seen.add(t)
                pts.append((t, d))
                if len(pts) >= 3:
                    break
    while len(pts) < 3:
        pts.append(('核心要点', clean_str(fy.get('essence')) or '见正文'))
    return pts[:3]


def _trim_to_sentence(s, max_len):
    """截断到 <= max_len，优先在句子边界（句号/分号/逗号）截断，避免半截话。"""
    if not s or len(s) <= max_len:
        return s or ''
    # 在 max_len 范围内找最后一个句子结束标点
    candidates = []
    for i in range(min(max_len, len(s)), 4, -1):
        if s[i-1] in '。.；;！!?？，,、':
            candidates.append(i)
            if s[i-1] in '。.；;！!?？':
                break  # 句号优先，直接停
    if candidates:
        cut = candidates[0]
        return s[:cut].rstrip('，,、 ')
    # 找不到标点：在 max_len 处截断，加省略号
    return s[:max_len-1].rstrip('，,、 ') + '…'


def build_elevator(fm):
    fy = fm.get('feynman') or {}
    essence = clean_str(fy.get('essence'))
    analogy = clean_str(fy.get('analogy'))
    essence_core = essence.rstrip('。.；;') if essence else ''

    # 电梯演讲目标长度：80~120 字。essence 为主，analogy 为辅。
    # 若 essence 已较长（>60 字），只用 essence（口语化截断到句子边界）。
    if essence_core and len(essence_core) > 60:
        trimmed = _trim_to_sentence(essence_core, 110)
        # 若已在标点处截断，去尾标点后补句号；若是省略号截断，保留省略号不叠句号
        if trimmed.endswith('…'):
            text = trimmed
        else:
            text = trimmed.rstrip('。.；;，,、 ') + '。'
        return text

    # 取 analogy 的核心比喻（破折号/冒号前，或第一句）
    ana_short = ''
    if analogy:
        for sep in ['——', '—', '：', ':']:
            if sep in analogy:
                ana_short = analogy.split(sep, 1)[0].strip()
                break
        if not ana_short:
            # 取第一句（到第一个句号/问号）
            m = re.match(r'^([^。.！?？]+[。.！?？]?)', analogy)
            ana_short = m.group(1).strip() if m else analogy
        ana_short = _trim_to_sentence(ana_short, 30)

    if essence_core and ana_short:
        text = f"{essence_core}——{ana_short}。"
    elif essence_core:
        text = f"{essence_core}。"
    else:
        text = ana_short or '见正文详解。'

    # 最终限长 130，句子边界截断
    if len(text) > 130:
        text = _trim_to_sentence(text, 129) or (text[:127] + '…')
    return text


def build_closing_hook(fm):
    fu = fm.get('follow_up') or []
    if fu and isinstance(fu, list) and len(fu) > 0:
        q = clean_str(fu[0])
        if q:
            q = q.rstrip('？?。.')
            return f"您想深入聊：{q}？"
    return "以上三点都能配合实战案例展开，您想从哪一段深入？"


def build_structured_answer(fm):
    elevator = build_elevator(fm)
    pts = collect_framework_points(fm)
    hook = build_closing_hook(fm)
    lines = ['## 结构化回答\n']
    lines.append(f'**30 秒电梯演讲：** {elevator}\n')
    lines.append('**展开框架：**')
    for i, (t, d) in enumerate(pts, 1):
        lines.append(f"{i}. **{t}** — {d}")
    lines.append('')
    lines.append(f'**收尾：** {hook}\n')
    return '\n'.join(lines) + '\n'


def _safe_short(s, n):
    """截断字符串到 n 字，避免截断 ASCII 单词中间。"""
    if not s:
        return s
    if len(s) <= n:
        return s
    cut = n
    while cut > 4 and re.match(r'[A-Za-z0-9]', s[cut-1]) and cut < len(s) and re.match(r'[A-Za-z0-9]', s[cut]):
        cut -= 1
    return s[:cut].rstrip(' -—：:，,、') + '…'


def _extract_h1_title(body):
    """从正文提取第一个 # 一级标题，作为视频标题卡主题。
    规整：去掉「【xx】」「（xx）」等面经前缀；限长 24 字（安全截断）。
    """
    for line in body.split('\n'):
        line = line.strip()
        if line.startswith('# ') and not line.startswith('## '):
            title = line[2:].strip()
            # 去掉开头的【...】/（...）面经标签
            title = re.sub(r'^[\s]*[【（(][^\】）)]*[\】）)][\s]*', '', title)
            return _safe_short(title, 24)
    return ''


def build_video_script(fm, diff, pts, body=''):
    rows_target = ROWS_BY_DIFF.get(diff, 5)
    times = TIME_ANCHORS.get(rows_target, TIME_ANCHORS[5])
    duration = DURATION_BY_DIFF.get(diff, '3 分钟')
    fy = fm.get('feynman') or {}
    essence = clean_str(fy.get('essence'))
    analogy = clean_str(fy.get('analogy'))

    # 视频标题：优先 H1，其次 essence 前 16 字（安全截断）
    h1 = _extract_h1_title(body)
    if h1:
        topic = h1
    elif essence:
        topic = _safe_short(essence, 18)
    else:
        topic = '本主题详解'

    titles = [t for t, _ in pts]

    scene_rows = []
    hook_say = analogy if analogy else (essence if essence else '这道题面试常考')
    hook_say = _safe_short(hook_say, 45)
    scene_rows.append((f'标题卡：{topic}', f'"{hook_say}"', '开场钩子'))

    def_say = essence if essence else '我们从第一性原理来看这个问题。'
    def_say = _safe_short(def_say, 60)
    scene_rows.append(('核心概念图', f'"{def_say}"', '核心定义'))

    # 中间要点行：尽量把 pts 全部铺开，受总行数约束
    # 固定占用：开场(1) + 定义(1) + 实战(1) + 收尾(1) = 4 行
    fixed = 4
    mid_count = max(1, rows_target - fixed)
    for i in range(mid_count):
        if i < len(pts):
            t, desc = pts[i]
        else:
            # 从 memory_points 补
            mps = [clean_str(m) for m in (fm.get('memory_points') or []) if clean_str(m)]
            mi = i - len(pts)
            if 0 <= mi < len(mps):
                r = split_title_desc(mps[mi])
                t, desc = r if r else (f'要点 {i+1}', mps[mi])
            else:
                t, desc = f'要点 {i+1}', ''
        say = f'"{t}——{desc}"' if desc else f'"{t}，这点很关键。"'
        say = _safe_short(say.rstrip('"') + '"', 70) if len(say) > 72 else say
        scene_rows.append((f'{t}示意图', say, f'要点拆解{i+1}'))

    scene_rows.append(('对比/实战案例图',
                       '"对比一下常见误区和工程实践，看真实场景里怎么取舍。"',
                       '实战与对比'))

    fu = fm.get('follow_up') or []
    ending_say = '记住核心要点：定义、关键机制、实战取舍。下期讲进阶追问。'
    if fu:
        first_q = clean_str(fu[0]).rstrip('？?。.')[:30]
        ending_say = f'记住核心要点。下期我们追问：{first_q}？'
    scene_rows.append(('总结卡', f'"{ending_say}"', '收尾与钩子'))

    scene_rows = scene_rows[:rows_target]
    while len(scene_rows) < rows_target:
        idx = max(1, len(scene_rows) - 2)
        mps = [clean_str(m) for m in (fm.get('memory_points') or []) if clean_str(m)]
        mp_idx = len(scene_rows) - 4
        if 0 <= mp_idx < len(mps):
            r = split_title_desc(mps[mp_idx])
            t = r[0] if r else f'延伸要点 {idx}'
        else:
            t = f'延伸要点 {idx}'
        scene_rows.insert(idx, (f'{t}补充图', f'"{t}，这是进阶要点。"', '延伸拆解'))

    out = ['## 视频脚本\n']
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


def process_file(path, dry_run=False, preview=False):
    with open(path, encoding='utf-8') as f:
        content = f.read()
    parts = content.split('---\n', 2)
    if len(parts) < 3:
        return False
    try:
        fm = yaml.safe_load(parts[1])
    except Exception:
        return False
    if not isinstance(fm, dict) or 'feynman' not in fm:
        return False
    diff = clean_str(fm.get('difficulty')) or 'L3'
    pts = collect_framework_points(fm)
    structured = build_structured_answer(fm)
    body = parts[2] if len(parts) > 2 else ''
    script = build_video_script(fm, diff, pts, body=body)
    if preview:
        print(f'\n========== {os.path.basename(path)} [{diff}] ==========')
        print(structured)
        print(script)
        return True

    # Overwrite mode: if existing ## 结构化回答 (and possibly ## 视频脚本) are
    # already at the end, strip them (and any trailing video script) and regenerate.
    # These sections are always appended at file end, so truncate from the marker.
    marker = '\n## 结构化回答'
    idx = content.find('## 结构化回答')
    if idx != -1:
        # Cut everything from the marker onward; also strip trailing whitespace/newlines
        base = content[:idx].rstrip() + '\n'
    else:
        base = content.rstrip() + '\n'
    new_content = base + '\n' + structured + '\n' + script
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
