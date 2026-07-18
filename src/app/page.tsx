import { getAllQuestions } from '@/lib/questions';
import HomeClient from '@/components/HomeClient';
import type { Question } from '@/lib/types';

export default function Page() {
  // Pass lightweight summaries to the homepage (no full answer text).
  // Answers are lazy-loaded from per-category JSON chunks when a modal
  // or study/review mode is opened.
  const all = getAllQuestions();
  const questions: Question[] = all.map((q) => ({
    ...q,
    answer: q.answer.slice(0, 300),
  }));
  return <HomeClient questions={questions} />;
}
