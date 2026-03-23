/**
 * Simplified SM-2 spaced repetition.
 * Each question has: interval, easeFactor, nextReview, consecutiveCorrect
 */

export function initRepetitionData() {
  return {
    interval: 0,
    easeFactor: 2.5,
    nextReview: 0,
    consecutiveCorrect: 0,
    attempts: 0,
  };
}

export function recordCorrect(rep) {
  const r = { ...rep };
  r.consecutiveCorrect++;
  r.attempts++;
  if (r.consecutiveCorrect === 1) {
    r.interval = 1;
  } else if (r.consecutiveCorrect === 2) {
    r.interval = 3;
  } else {
    r.interval = Math.round(r.interval * r.easeFactor);
  }
  r.easeFactor = Math.max(1.3, r.easeFactor + 0.1);
  r.nextReview = Date.now() + r.interval * 24 * 60 * 60 * 1000;
  return r;
}

export function recordIncorrect(rep) {
  const r = { ...rep };
  r.consecutiveCorrect = 0;
  r.attempts++;
  r.interval = 0;
  r.easeFactor = Math.max(1.3, r.easeFactor - 0.2);
  // Due immediately (will be asked again soon)
  r.nextReview = 0;
  return r;
}

export function isMastered(rep) {
  return rep.consecutiveCorrect >= 3;
}

/**
 * Select next questions from the pool.
 * Priority: 1) due for review, 2) never attempted, 3) lowest easeFactor
 * Filters out mastered questions unless there aren't enough.
 */
export function selectSessionQuestions(questions, count = 10) {
  const now = Date.now();

  const due = [];
  const fresh = [];
  const mastered = [];

  for (const q of questions) {
    const rep = q.repetition || initRepetitionData();
    if (isMastered(rep)) {
      // Only include mastered if their review is due
      if (rep.nextReview <= now) {
        mastered.push(q);
      }
    } else if (rep.attempts === 0) {
      fresh.push(q);
    } else if (rep.nextReview <= now) {
      due.push(q);
    }
  }

  // Sort due by easeFactor ascending (hardest first)
  due.sort((a, b) => (a.repetition?.easeFactor || 2.5) - (b.repetition?.easeFactor || 2.5));

  const selected = [];
  // First: due questions
  for (const q of due) {
    if (selected.length >= count) break;
    selected.push(q);
  }
  // Then: fresh questions
  for (const q of fresh) {
    if (selected.length >= count) break;
    selected.push(q);
  }
  // Then: mastered due for review
  for (const q of mastered) {
    if (selected.length >= count) break;
    selected.push(q);
  }

  // Shuffle the selected questions
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }

  return selected;
}
