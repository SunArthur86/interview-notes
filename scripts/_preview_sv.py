#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Preview generated sections without writing to disk."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "add_sv",
    "/Users/sunqingguang/hermes/opt/projects/interview-notes/scripts/add_structured_answer_and_video.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

SAMPLES = [
    "system-design/note-dd-lt-001.md",
    "java/note-java-001.md",
    "database/note-bd-agent-007.md",
    "frontend/note-ms-001.md",
    "algorithm/note-algo-001.md",
    "other/note-ai50-014.md",
    "network/note-netty-001.md",
]
base = Path("/Users/sunqingguang/hermes/opt/projects/interview-notes/questions")
for rel in SAMPLES:
    p = base / rel
    if not p.exists():
        print(f"--- SKIP (missing) {rel} ---")
        continue
    text = p.read_text(encoding="utf-8")
    fm, _ = m.parse_frontmatter(text)
    if fm is None:
        print(f"--- SKIP (no fm) {rel} ---")
        continue
    print(f"\n{'=' * 80}\n=== {rel}  (difficulty={fm.get('difficulty')}, subcategory={fm.get('subcategory')})\n{'=' * 80}")
    print(m.build_structured_answer(fm))
    print()
    print(m.build_video_script(fm))
