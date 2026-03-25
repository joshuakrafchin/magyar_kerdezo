export const LEVELS = ['A1', 'A2', 'B1', 'B2'];

export const TOPICS = {
  A1: [
    'greetings and introductions',
    'telling your name and age',
    'family members',
    'numbers and counting',
    'days of the week and months',
    'basic food and drink ordering',
    'colors and clothing',
    'basic directions and places',
    'weather and seasons',
    'telling time',
    'shopping basics',
  ],
  A2: [
    'daily routines and schedules',
    'hobbies and free time',
    'travel and transportation',
    'health and body parts',
    'describing past events (past tense)',
    'future plans and intentions',
    'comparisons and preferences',
    'emotions and feelings',
    'describing people and places',
    'phone conversations',
  ],
  B1: [
    'work and career discussion',
    'education and learning',
    'news and current events',
    'giving and defending opinions',
    'hypothetical situations (conditional)',
    'Hungarian culture and traditions',
    'formal vs informal register',
    'making complaints and requests',
    'storytelling and narration',
    'environment and nature',
  ],
  B2: [
    'abstract discussion and philosophy',
    'debate and persuasion',
    'Hungarian idioms and expressions',
    'humor and nuance',
    'professional and business contexts',
    'literature and arts discussion',
    'politics and society',
    'complex conditional constructions',
    'nuanced opinions and hedging',
    'exam-style formal interview questions',
  ],
};

export const QUESTIONS_PER_LEVEL = {
  A1: 20,
  A2: 15,
  B1: 10,
  B2: 5,
};

export function getLevelIndex(level) {
  return LEVELS.indexOf(level);
}

export function getNextLevel(level) {
  const idx = getLevelIndex(level);
  return idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
}
