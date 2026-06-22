/**
 * Interview Notes — 面试随手记 Project Configuration
 * 
 * 随手记录网上搜索的面试题，快速积累题库。
 * Uses the same interview-framework as ai-interview / java-interview.
 */
'use strict';

const APP_CONFIG = {
  // ===== Branding =====
  appName: '📝 面试随手记',
  appNameShort: '随手记',
  appIcon: '📝',
  appVersion: '1.0',
  appDescription: '面试随手记 — 随时收集网上搜索的面试题，涵盖 Java、AI、算法、系统设计等全方向，支持快速录入、智能搜索、遗忘曲线复习。',
  keywords: '面试题,面经,随手记,Java,AI,算法,系统设计,八股文,大模型,Spring,并发,JVM',

  // ===== Storage =====
  storagePrefix: 'interview-notes',

  // ===== URLs =====
  githubUrl: 'https://sunarthur86.github.io/interview-notes/',
  repoUrl: 'https://github.com/SunArthur86/interview-notes',

  // ===== Theme =====
  themeColor: '#34C759',  // Fresh green
  bgColor: '#f5f5f7',

  // ===== Categories =====
  categories: {
    'all':          { label: '全部', icon: '📚', color: '#34C759', files: null },
    'java':         { label: 'Java', icon: '☕', color: '#f89820', files: ['data/java.json'] },
    'ai':           { label: 'AI/大模型', icon: '🤖', color: '#5856d6', files: ['data/ai.json'] },
    'algorithm':    { label: '算法', icon: '🧮', color: '#ff9500', files: ['data/algorithm.json'] },
    'system-design':{ label: '系统设计', icon: '🏗️', color: '#ff3b30', files: ['data/system-design.json'] },
    'database':     { label: '数据库', icon: '🗄️', color: '#007aff', files: ['data/database.json'] },
    'frontend':     { label: '前端', icon: '🎨', color: '#af52de', files: ['data/frontend.json'] },
    'other':        { label: '其他', icon: '📌', color: '#8e8e93', files: ['data/other.json'] },
  },

  // ===== Subcategory Group Mapping =====
  subcatGroups: {
    'Java核心': ['Java基础', '集合', '并发', 'JVM', 'Spring', 'MyBatis'],
    'AI大模型': ['LLM', 'Agent', 'RAG', 'Prompt', '微调', '推理优化'],
    '算法': ['数组', '链表', '树', '图', 'DP', '贪心', '回溯', '排序'],
    '系统设计': ['高并发', '分布式', '微服务', '缓存', '消息队列', '限流'],
    '数据库': ['MySQL', 'Redis', 'MongoDB', 'ES', 'SQL优化'],
    '前端': ['HTML/CSS', 'JavaScript', 'React', 'Vue', '浏览器', '性能'],
    '其他': ['网络', '操作系统', 'Linux', 'Git', 'Docker', 'K8s', 'HR面'],
  },

  // ===== About Text =====
  aboutText: '面试随手记 v1.0\n随手记录网上搜索的面试题 · 快速积累你的专属题库\n覆盖 Java · AI/大模型 · 算法 · 系统设计 · 数据库 · 前端\n费曼学习法 + 第一性原理 + 遗忘曲线复习',
  aboutTarget: '对标阿里 P7 / 字节 2-2 / 腾讯 T9',
};
