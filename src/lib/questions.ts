import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import matter from 'gray-matter';
import type { Question } from './types';

const QUESTIONS_DIR = path.join(process.cwd(), 'questions');

/**
 * 批量获取所有 markdown 文件的最后 git 提交时间。
 * 用一次 `git log` 代替 N 次 subprocess 调用，将 1000+ 文件的构建耗时从 ~20s 降到 <1s。
 * 返回相对路径 → ISO 日期字符串 的映射。
 */
function batchGetCreatedAt(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    // 一次 git log 获取所有提交的日期和改动文件名，按时间从新到旧排列
    const out = execSync(
      'git log --name-only --format=__COMMIT__%cI',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1024 * 1024 * 64 },
    );
    let currentDate = '';
    for (const line of out.split('\n')) {
      if (line.startsWith('__COMMIT__')) {
        currentDate = line.slice(10).trim();
      } else if (line.trim() && currentDate) {
        const rel = line.trim();
        // 只记录第一次遇到（即最新一次提交）的时间
        if (!result[rel]) result[rel] = currentDate;
      }
    }
  } catch {
    // git 不可用，回退到 mtime（在 loadAll 中按需获取）
  }
  return result;
}

function loadAll(): Question[] {
  if (!fs.existsSync(QUESTIONS_DIR)) return [];
  const gitDates = batchGetCreatedAt();
  const out: Question[] = [];
  const catDirs = fs.readdirSync(QUESTIONS_DIR).sort();
  for (const catDir of catDirs) {
    const full = path.join(QUESTIONS_DIR, catDir);
    if (!fs.statSync(full).isDirectory()) continue;
    const files = fs.readdirSync(full).filter((f) => f.endsWith('.md')).sort();
    for (const file of files) {
      const absPath = path.join(full, file);
      const raw = fs.readFileSync(absPath, 'utf-8');
      const { data, content } = matter(raw);
      const lines = content.split('\n');
      let question = '';
      let answerStart = 0;
      const firstNonEmpty = lines.findIndex((l) => l.trim() !== '');
      if (firstNonEmpty >= 0 && lines[firstNonEmpty].startsWith('# ')) {
        question = lines[firstNonEmpty].slice(2).trim();
        answerStart = firstNonEmpty + 1;
      }
      const answer = lines.slice(answerStart).join('\n').trim();
      out.push({
        id: String(data.id || file.replace(/\.md$/, '')),
        question,
        answer,
        difficulty: String(data.difficulty || 'L1'),
        category: String(data.category || catDir),
        categories: Array.isArray(data.categories)
          ? data.categories.map(String)
          : [String(data.category || catDir)],
        subcategory: data.subcategory || undefined,
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        images: Array.isArray(data.images) ? data.images.map(String) : [],
        follow_up: Array.isArray(data.follow_up) ? data.follow_up.map(String) : [],
        feynman: data.feynman || undefined,
        first_principle: data.first_principle || undefined,
        createdAt: gitDates[path.relative(process.cwd(), absPath)]
          || (() => { try { return fs.statSync(absPath).mtime.toISOString(); } catch { return ''; } })(),
      });
    }
  }
  return out;
}

let _cache: Question[] | null = null;

export function getAllQuestions(): Question[] {
  if (_cache) return _cache;
  _cache = loadAll();
  return _cache;
}

export function getQuestionById(id: string): Question | undefined {
  return getAllQuestions().find((q) => q.id === id);
}

export function getAllIds(): string[] {
  return getAllQuestions().map((q) => q.id);
}
