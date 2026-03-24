const STORAGE_KEY = 'magyar_kerdezo_state';

const DEFAULT_INTERVIEW_TOPICS = [
  'Famous Hungarians (e.g. Liszt, Rubik, Semmelweis, Bartók, Puskás)',
  'Children — do you have any, do you want any, ages',
  'Pets — do you have any, what kind',
  'Interests and hobbies',
  'Why you want to live in Hungary',
  'How long you have lived in Hungary',
  'Your favorite Hungarian food and drink',
  'Your daily routine',
  'Your neighborhood and city',
  'Hungarian holidays and traditions you know',
  'How you learned Hungarian',
  'Your family and relationships',
  'Your job or studies',
  'Travel within Hungary',
];

const defaultState = {
  aboutMeEssay: '',
  // Keep personalDetails for backward compat migration
  personalDetails: {
    name: '', age: '', job: '', city: '', family: '', hobbies: '', other: ''
  },
  interviewTopics: [...DEFAULT_INTERVIEW_TOPICS],
  currentLevel: 'A1',
  questions: [],
  flashcards: [],
  session: {
    currentIndex: 0,
    correct: 0,
    incorrect: 0,
    bestStreak: 0,
    currentStreak: 0,
    questionsAnswered: 0,
    sessionSize: 10,
    mistakes: []
  },
  settings: {
    autoSpeak: true,
    speechRate: 0.85
  }
};

let state = null;
const listeners = [];

export { DEFAULT_INTERVIEW_TOPICS };

export function getState() {
  if (!state) {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        state = JSON.parse(saved);
        state = deepMerge(defaultState, state);
        // Migrate old personalDetails to essay if no essay exists
        if (!state.aboutMeEssay && state.personalDetails) {
          const pd = state.personalDetails;
          const parts = [];
          if (pd.name) parts.push(`My name is ${pd.name}.`);
          if (pd.age) parts.push(`I am ${pd.age} years old.`);
          if (pd.job) parts.push(`I work as a ${pd.job}.`);
          if (pd.city) parts.push(`I live in ${pd.city}.`);
          if (pd.family) parts.push(`Family: ${pd.family}.`);
          if (pd.hobbies) parts.push(`Hobbies: ${pd.hobbies}.`);
          if (pd.other) parts.push(pd.other);
          if (parts.length > 0) {
            state.aboutMeEssay = parts.join(' ');
          }
        }
        // Ensure interviewTopics exists
        if (!state.interviewTopics || state.interviewTopics.length === 0) {
          state.interviewTopics = [...DEFAULT_INTERVIEW_TOPICS];
        }
      } catch {
        state = structuredClone(defaultState);
      }
    } else {
      state = structuredClone(defaultState);
    }
  }
  return state;
}

export function setState(patch) {
  state = { ...getState(), ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  listeners.forEach(fn => fn(state));
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function resetState() {
  state = structuredClone(defaultState);
  localStorage.removeItem(STORAGE_KEY);
}

export function exportState() {
  return JSON.stringify(getState(), null, 2);
}

export function importState(json) {
  const parsed = JSON.parse(json);
  state = deepMerge(defaultState, parsed);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  listeners.forEach(fn => fn(state));
}

function deepMerge(defaults, overrides) {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    if (
      overrides[key] && typeof overrides[key] === 'object' && !Array.isArray(overrides[key]) &&
      defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])
    ) {
      result[key] = deepMerge(defaults[key], overrides[key]);
    } else {
      result[key] = overrides[key];
    }
  }
  return result;
}
