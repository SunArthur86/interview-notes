#!/usr/bin/env python3
"""Generate per-category answer JSON chunks in public/answers/<category>.json.
Keeps each file small (~1-3MB) and only loaded when a question from that category is opened."""
import os, re, json, yaml
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QDIR = os.path.join(BASE, 'questions')
OUTDIR = os.path.join(BASE, 'public', 'answers')
os.makedirs(OUTDIR, exist_ok=True)

by_cat = defaultdict(dict)
for root, dirs, files in os.walk(QDIR):
    for f in sorted(files):
        if not f.endswith('.md'): continue
        path = os.path.join(root, f)
        content = open(path, encoding='utf-8').read()
        parts = content.split('---\n', 2)
        if len(parts) < 3: continue
        try:
            fm = yaml.safe_load(parts[1])
        except:
            continue
        if not fm: continue
        qid = str(fm.get('id', f.replace('.md', '')))
        cat = str(fm.get('category', os.path.basename(os.path.dirname(path))))
        body = parts[2]
        lines = body.split('\n')
        answer_start = 0
        first_non_empty = next((i for i, l in enumerate(lines) if l.strip()), -1)
        if first_non_empty >= 0 and lines[first_non_empty].startswith('# '):
            answer_start = first_non_empty + 1
        answer = '\n'.join(lines[answer_start:]).strip()
        by_cat[cat][qid] = answer

for cat, answers in by_cat.items():
    out_path = os.path.join(OUTDIR, f'{cat}.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(answers, f, ensure_ascii=False, separators=(',', ':'))
    print(f"  {cat}.json: {len(answers)} questions, {os.path.getsize(out_path) // 1024}KB")

print(f"\nGenerated {len(by_cat)} category files in public/answers/")
