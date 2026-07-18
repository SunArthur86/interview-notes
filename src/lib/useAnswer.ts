'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Question } from './types';

/**
 * Lazy-load answer cache: fetches per-category JSON chunks on demand.
 * Keeps the homepage HTML small by not embedding 20MB of answers.
 */
const answerCache: Record<string, string> = {};
const loadedCategories = new Set<string>();
const loadingPromises: Record<string, Promise<void>> = {};

const basePath = process.env.NODE_ENV === 'production' ? '/interview-notes' : '';

async function loadCategory(category: string): Promise<void> {
  if (loadedCategories.has(category)) return;
  if (loadingPromises[category] !== undefined) return loadingPromises[category];

  loadingPromises[category] = (async () => {
    try {
      const resp = await fetch(`${basePath}/answers/${category}.json`);
      if (resp.ok) {
        const data = await resp.json();
        Object.assign(answerCache, data);
        loadedCategories.add(category);
      }
    } catch {
      // network error — will retry on next access
    }
  })();
  return loadingPromises[category];
}

/**
 * Hook to get a question's full answer lazily.
 * Returns { answer, loading } — answer is undefined while loading.
 */
export function useAnswer(q: Question | undefined): { answer: string | undefined; loading: boolean } {
  const [answer, setAnswer] = useState<string | undefined>(() =>
    q ? answerCache[q.id] : undefined
  );
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!q) return;
    if (answerCache[q.id]) {
      setAnswer(answerCache[q.id]);
      return;
    }
    setLoading(true);
    await loadCategory(q.category);
    if (answerCache[q.id]) {
      setAnswer(answerCache[q.id]);
    }
    setLoading(false);
  }, [q]);

  useEffect(() => {
    load();
  }, [load]);

  return { answer, loading };
}

/**
 * Pre-fetch a category's answers (e.g., when entering study/review mode).
 */
export async function prefetchCategory(category: string): Promise<void> {
  await loadCategory(category);
}

/**
 * Get all answers for a set of questions (for study/review mode).
 * Returns immediately if cached, otherwise fetches.
 */
export function getAnswerSync(id: string): string | undefined {
  return answerCache[id];
}
