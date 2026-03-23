const STORAGE_KEY = 'magyar_kerdezo_state';

const defaultState = {
  apiKey: '',
  personalDetails: {
    name: '', age: '', job: '', city: '', family: '', hobbies: '', other: ''
  },
  currentLevel: 'A1',
  questions: [],
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

export function getState() {
  if (!state) {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        state = JSON.parse(saved);
        // Merge with defaults for any new fields
        state = deepMerge(defaultState, state);
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
