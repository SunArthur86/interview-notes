#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Preview what would be generated for a small sample without writing."""
import sys
sys.path.insert(0, "/Users/sunqingguang/hermes/opt/projects/interview-notes")
import importlib.util
spec = importlib.util.spec_from_file_location("add_scripts", "/Users/sunqingguang/hermes/opt/projects/interview-notes/_add_scripts.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

from pathlib import Path
SAMPLES = [
    "system-design/note-dd-lt-001.md",  # L4
    "java/note-java-001.md",  # placeholder if exists
    "database/note-bd-agent-007.md",  # L2
    "frontend/note-ms-001.md",  # L3
    "algorithm/note-algo-001.md",  # L3
    "other/note-ai50-014.md",  # L2
    "network/note-netty-001.md",  # L2
]
base = Path("/Users/sunqingguang/hermes/opt/projects/interview-notes/questions")
for rel in SAMPLES:
    p = base / rel
    if not p.exists():
        print(f"--- SKIP (missing) {rel} ---")
        continue
    text = p.read_text(encoding="utf-8")
    fm, body, _ = m.parse_frontmatter(text)
    if fm is None:
        print(f"--- SKIP (no fm) {rel} ---")
        continue
    print(f"\n{'=' * 80}\n=== {rel}  (difficulty={fm.get('difficulty')}, subcategory={fm.get('subcategory')})\n{'=' * 80}")
    print(m.build_structured_answer(fm))
    print()
    print(m.build_video_script(fm))
