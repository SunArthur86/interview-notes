import type { Algorithm } from './types';

export interface CategoryConfig {
  label: string;
  icon: string;
  color: string;
}

export const APP_CONFIG = {
  appName: '面试随手记',
  appNameShort: '随手记',
  appIcon: '📝',
  appVersion: '2.0',
  storagePrefix: 'interview-notes',
  githubUrl: 'https://sunarthur86.github.io/interview-notes/',
  repoUrl: 'https://github.com/SunArthur86/interview-notes',
  themeColor: '#34C759',
  categories: {
    'all': { label: '全部', icon: '📚', color: '#34C759' },
    'java': { label: 'Java', icon: '☕', color: '#f89820' },
    'ai': { label: 'AI/大模型', icon: '🤖', color: '#5856d6' },
    'algorithm': { label: '算法', icon: '🧮', color: '#ff9500' },
    'system-design': { label: '系统设计', icon: '🏗️', color: '#ff3b30' },
    'database': { label: '数据库', icon: '🗄️', color: '#007aff' },
    'frontend': { label: '前端', icon: '🎨', color: '#af52de' },
    'other': { label: '其他', icon: '📌', color: '#8e8e93' },
  } as Record<string, CategoryConfig>,
  subcatGroups: {
    'Java核心': ['Java基础', '集合', '集合框架', '并发', '并发编程', 'JVM', 'Spring', 'MyBatis'],
    'AI大模型': ['LLM', 'Agent', 'RAG', 'Prompt', '微调', '推理优化'],
    '算法': ['数组', '链表', '树', '图', 'DP', '贪心', '回溯', '排序', '设计'],
    '系统设计': ['高并发', '分布式', '分布式锁', '微服务', '缓存', '消息队列', '限流', '实时计算', 'Feed流'],
    '数据库': ['MySQL', 'Redis', 'MongoDB', 'ES', 'SQL优化', 'Kafka'],
    '前端': ['HTML/CSS', 'JavaScript', 'React', 'Vue', '浏览器', '性能'],
    '其他': ['网络', '操作系统', 'Linux', 'Git', 'Docker', 'K8s', 'HR面', 'Python'],
  } as Record<string, string[]>,
  aboutText: '面试随手记 — 随手记录网上搜索的面试题，涵盖 Java、AI、算法、系统设计等全方向。每题含费曼学习法 + 第一性原理 + 遗忘曲线复习。',
} as const;

export const SUBCAT_REVERSE: Record<string, string> = {};
Object.entries(APP_CONFIG.subcatGroups).forEach(([g, subs]) => {
  subs.forEach((s) => {
    SUBCAT_REVERSE[s] = g;
  });
});

export function getSubcatGroup(sub: string | undefined): string {
  return (sub && SUBCAT_REVERSE[sub]) || '其他';
}

export const ALGO_LABELS: Record<Algorithm, string> = {
  sm2: 'SM-2 智能间隔',
  leitner: 'Leitner 卡盒',
  ebbinghaus: '艾宾浩斯曲线',
};
