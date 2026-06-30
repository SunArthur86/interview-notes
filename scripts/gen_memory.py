#!/usr/bin/env python3
# coding: utf-8
"""
为每道面试题生成「记忆要点」——帮助考生快速记住并回忆核心内容的小抄。
通过 coding plan 额度（Anthropic 协议，GLM-5.2）批量提交，支持断点续传、并发。
用法: gen_memory.py <project> [--batch 10] [--workers 3] [--resume]
环境变量: CP_API_KEY (coding plan key), CP_BASE_URL (默认 https://open.bigmodel.cn/api/anthropic)
"""
import sys, os, re, json, time, argparse, urllib.request, urllib.error
import yaml
from concurrent.futures import ThreadPoolExecutor, as_completed

MODEL = 'GLM-5.2'
BASE_URL = os.environ.get('CP_BASE_URL', 'https://open.bigmodel.cn/api/anthropic')

PROMPT = '''你是资深技术面试辅导专家。请为以下面试题生成「记忆要点」——帮助考生快速记住并回忆这道题核心内容的小抄。

## 记忆要点要求（对每题）
1. **3-5 条精炼要点**，每条控制在 25-50 字
2. 聚焦「最该记住的核心」：核心结论、关键数字/参数、易混对比、一句话定义
3. 用句式便于记忆：因果句（因为…所以…）、对比句（A 而 B…）、口诀式
4. 避免大段复制答案，要提炼压缩，宁可短不要长
5. 适合考前 30 秒扫一眼就能回忆起答题框架

## 输出格式（严格JSON数组，无代码块包裹）
[{"id":"题目id","memory_points":["要点1","要点2","要点3"]}]

## 注意
- 只输出JSON，不要任何解释文字
- 要点数量 3-5 条，按重要性排序'''

def parse_md(path):
    """解析 markdown：frontmatter + 标题(问题) + 正文(答案)"""
    with open(path, encoding='utf-8') as f: raw = f.read()
    parts = raw.split('---\n', 2)
    if len(parts) < 3: return None, None, raw
    try: meta = yaml.safe_load(parts[1]) or {}
    except Exception: meta = {}
    body = parts[2].strip()
    lines = body.split('\n')
    q = lines[0].replace('# ', '').strip() if lines else ''
    ans = '\n'.join(lines[1:]).strip() if len(lines) > 1 else ''
    return meta, q, ans

def load_questions(proj):
    """加载项目下所有题目"""
    qs = []
    for cat in sorted(os.listdir(f'{proj}/questions')):
        d = f'{proj}/questions/{cat}'
        if not os.path.isdir(d): continue
        for f in sorted(os.listdir(d)):
            if not f.endswith('.md'): continue
            meta, q, ans = parse_md(f'{d}/{f}')
            if meta is None: continue
            qs.append({'id': str(meta.get('id', f.replace('.md',''))), 'path': f'{d}/{f}',
                       'meta': meta, 'question': q, 'answer': ans})
    return qs

def build_prompt(batch):
    parts = []
    for i, q in enumerate(batch):
        # 截断过长答案，节省 token
        ans = q['answer'][:2500] if len(q['answer']) > 2500 else q['answer']
        parts.append(f'### 题目 {i+1}（id: {q["id"]}）\n**问题**：{q["question"]}\n\n**当前答案**：\n{ans}')
    return PROMPT + f'\n\n## 题目\n\n' + '\n\n---\n\n'.join(parts)

def call_llm(prompt, max_retries=5):
    """通过 coding plan 的 Anthropic 协议调用 GLM-5.2"""
    data = json.dumps({
        'model': MODEL,
        'max_tokens': 6000,
        'messages': [{'role': 'user', 'content': prompt}],
    }).encode()
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(BASE_URL.rstrip('/') + '/v1/messages',
                data=data, headers={
                    'x-api-key': os.environ['CP_API_KEY'],
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=180) as r:
                resp = json.loads(r.read())
                # Anthropic 协议：content 是数组，取第一个 text block
                blocks = resp.get('content', [])
                for b in blocks:
                    if b.get('type') == 'text':
                        return b.get('text', '')
                return ''
        except urllib.error.HTTPError as e:
            # 429 速率限制：指数退避，等待更久
            if e.code == 429 and attempt < max_retries - 1:
                wait = min(10 * (attempt + 1) + (attempt * 5), 60)
                time.sleep(wait)
                continue
            if attempt < max_retries - 1: time.sleep(5*(attempt+1))
        except Exception:
            if attempt < max_retries - 1: time.sleep(5*(attempt+1))
    return None

def parse_resp(text):
    if not text: return None
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text.strip())
    try: return json.loads(text)
    except Exception:
        s, e = text.find('['), text.rfind(']')
        if s >= 0 and e > s:
            try: return json.loads(text[s:e+1])
            except Exception: pass
    return None

def apply(q, fix):
    """将记忆要点写入文件的 frontmatter，并追加「## 记忆要点」小节到正文"""
    points = fix.get('memory_points') or fix.get('points') or fix.get('memory')
    if not points or not isinstance(points, list): return False
    # 清洗每条要点
    clean_points = []
    for p in points:
        if isinstance(p, str):
            p = p.strip().strip('"\'').strip()
            if p: clean_points.append(p)
    if not clean_points: return False

    meta = dict(q['meta'])
    meta['memory_points'] = clean_points

    # 重新组装文件：frontmatter + 标题 + 原答案（去除旧记忆要点）+ 记忆要点小节
    body = q['answer']
    # 移除可能已存在的「## 记忆要点」小节，避免重复
    body = re.sub(r'\n*## 记忆要点[\s\S]*?(?=\n## |\Z)', '', body).rstrip()

    memory_section = '\n\n## 记忆要点\n\n' + '\n'.join(f'- {p}' for p in clean_points) + '\n'
    body = body + memory_section

    fm = yaml.dump(meta, allow_unicode=True, default_flow_style=False, sort_keys=False, width=1000)
    with open(q['path'], 'w', encoding='utf-8') as f:
        f.write(f'---\n{fm}---\n\n# {q["question"]}\n\n{body}\n')
    return True

def process_batch(batch, idx):
    resp = call_llm(build_prompt(batch))
    return idx, parse_resp(resp)

def main():
    ap = argparse.ArgumentParser(description='为面试题生成记忆要点（走 coding plan 额度）')
    ap.add_argument('project', help='项目目录路径')
    ap.add_argument('--batch', type=int, default=10, help='每批题目数（默认10）')
    ap.add_argument('--workers', type=int, default=3, help='并发数（默认3）')
    ap.add_argument('--resume', action='store_true', help='断点续传')
    ap.add_argument('--limit', type=int, default=0, help='只处理前N题（测试用）')
    args = ap.parse_args()
    proj = os.path.abspath(args.project)
    print(f'=== 记忆要点生成（GLM-5.2 coding plan）: {proj} ===')

    qs = load_questions(proj)
    if args.limit: qs = qs[:args.limit]
    prog = f'/tmp/{os.path.basename(proj)}_memory.json'
    done = set(json.load(open(prog)) if args.resume and os.path.exists(prog) else [])
    print(f'共 {len(qs)} 题，已完成 {len(done)}，每批 {args.batch}，并发 {args.workers}')

    batches = []
    for s in range(0, len(qs), args.batch):
        b = [q for q in qs[s:s+args.batch] if q['id'] not in done]
        if b: batches.append(b)
    print(f'待处理批次: {len(batches)}')

    stats = {'total': 0, 'changed': 0, 'failed': 0, 'errors': 0}
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(process_batch, b, i): (i, b) for i, b in enumerate(batches)}
        for fut in as_completed(futs):
            i, batch = futs[fut]
            try:
                idx, fixes = fut.result()
            except Exception as e:
                print(f'  [批{i}] 异常: {e}'); stats['failed'] += len(batch); continue
            if not fixes:
                print(f'  [批{i}] ❌解析失败'); stats['failed'] += len(batch); continue
            fmap = {str(f.get('id','')): f for f in fixes}
            for q in batch:
                fix = fmap.get(q['id'])
                if not fix: stats['failed'] += 1; continue
                try:
                    changed = apply(q, fix)
                    done.add(q['id']); stats['total'] += 1
                    if changed: stats['changed'] += 1
                except Exception as e:
                    stats['errors'] += 1
            json.dump(list(done), open(prog, 'w'))
            ok = len([q for q in batch if q['id'] in done])
            print(f'  [批{i}] ✅{ok}/{len(batch)} 累计{len(done)}/{len(qs)} 写入{stats["changed"]}')

    print(f'\n===== 完成: 处理{stats["total"]} 写入{stats["changed"]} 失败{stats["failed"]} 异常{stats["errors"]} =====')

if __name__ == '__main__':
    main()
