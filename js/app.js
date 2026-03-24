import { getState, setState, resetState, exportState, importState, DEFAULT_INTERVIEW_TOPICS } from './state.js';
import { generateQuestions, extractVocabulary } from './gemini.js';
import { LEVELS, QUESTIONS_PER_LEVEL, getLevelIndex } from './curriculum.js';
import { speak, stop } from './speech.js';
import {
  selectSessionQuestions,
  recordCorrect,
  recordIncorrect,
  isMastered,
  initRepetitionData,
} from './spaced-repetition.js';

// ─── Screen Management ───
const screens = ['welcome', 'loading', 'quiz', 'results', 'settings', 'vocab', 'flashcards', 'fc-results'];
let currentScreen = 'welcome';
let previousScreen = 'welcome';
let backgroundGenerating = false;
let hardMode = false;

function showScreen(name) {
  previousScreen = currentScreen;
  currentScreen = name;
  screens.forEach(s => {
    document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name);
  });
  const nav = document.getElementById('nav');
  nav.classList.toggle('hidden', name === 'welcome' || name === 'loading');
  if (name === 'quiz' || name === 'flashcards') updateNavLevel();
}

function updateNavLevel() {
  const state = getState();
  document.getElementById('nav-level').textContent = `Level: ${state.currentLevel}`;
}

// ─── Welcome Screen ───
function initWelcome() {
  const state = getState();

  // Populate fields from state
  document.getElementById('input-api-key').value = state.apiKey || '';
  document.getElementById('about-me-essay').value = state.aboutMeEssay || '';

  // Level selector
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.level === state.currentLevel);
    btn.onclick = () => {
      document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    };
  });

  // Show continue button if we have questions
  const hasQuestions = state.questions && state.questions.length > 0;
  const btnContinue = document.getElementById('btn-continue');
  btnContinue.classList.toggle('hidden', !hasQuestions);
  document.getElementById('btn-vocab-welcome').classList.toggle('hidden', !hasQuestions);

  // Start button (Gemini generation)
  document.getElementById('btn-start').onclick = () => startGeneration();

  // Load JSON button
  document.getElementById('btn-load-json').onclick = () => {
    document.getElementById('load-json-file').click();
  };
  document.getElementById('load-json-file').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('load-json-status');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const questions = normalizeImportedQuestions(data);
        if (questions.length === 0) {
          statusEl.textContent = 'No valid questions found in file.';
          statusEl.style.color = 'var(--error)';
          return;
        }
        saveWelcomeFields();
        setState({ questions });
        statusEl.textContent = `Loaded ${questions.length} questions!`;
        statusEl.style.color = 'var(--success)';
        setTimeout(() => startQuiz(), 500);
      } catch (err) {
        statusEl.textContent = 'Invalid JSON: ' + err.message;
        statusEl.style.color = 'var(--error)';
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Continue button
  btnContinue.onclick = () => {
    saveWelcomeFields();
    startQuiz();
  };
}

/**
 * Normalize imported JSON questions into the app's internal format.
 */
function normalizeImportedQuestions(data) {
  let raw = Array.isArray(data) ? data : (data.questions || []);
  return raw
    .filter(q => q.questionHu && q.meaningOptions && q.responseOptions)
    .map((q, i) => ({
      id: q.id || `imported-${Date.now()}-${i}`,
      level: q.level || 'A1',
      topic: q.topic || 'imported',
      questionHu: q.questionHu,
      meaningOptions: q.meaningOptions,
      responseOptions: q.responseOptions,
      explanation: q.explanation || '',
      repetition: q.repetition || {
        interval: 0,
        easeFactor: 2.5,
        nextReview: 0,
        consecutiveCorrect: 0,
        attempts: 0,
      },
    }));
}

function saveWelcomeFields() {
  const apiKey = document.getElementById('input-api-key').value.trim();
  const aboutMeEssay = document.getElementById('about-me-essay').value.trim();
  const selectedLevel = document.querySelector('.level-btn.selected')?.dataset.level || 'A1';
  setState({ apiKey, aboutMeEssay, currentLevel: selectedLevel });
}

// ─── Loading / Background Generation ───
async function startGeneration() {
  saveWelcomeFields();
  const state = getState();

  if (!state.apiKey) {
    alert('Please enter your Gemini API key to generate questions.');
    return;
  }

  showScreen('loading');

  const startLevel = getLevelIndex(state.currentLevel);
  const allQuestions = [];
  let totalExpected = 0;
  let firstBatchSent = false;

  // Calculate total questions to generate
  for (let i = startLevel; i < LEVELS.length; i++) {
    totalExpected += QUESTIONS_PER_LEVEL[LEVELS[i]];
  }

  document.getElementById('loading-count').textContent = `0 / ${totalExpected} questions`;

  try {
    for (let i = startLevel; i < LEVELS.length; i++) {
      const level = LEVELS[i];
      const count = QUESTIONS_PER_LEVEL[level];
      document.getElementById('loading-status').textContent = `Generating ${level} questions...`;

      await generateQuestions(
        state.apiKey,
        level,
        state.aboutMeEssay,
        state.interviewTopics,
        count,
        null, // progress handled via onBatchReady
        (batchQuestions) => {
          // Each batch arrives here
          allQuestions.push(...batchQuestions);
          setState({ questions: [...allQuestions] });

          // Update progress UI
          const pct = Math.round((allQuestions.length / totalExpected) * 100);
          document.getElementById('loading-progress').style.width = `${pct}%`;
          document.getElementById('loading-count').textContent = `${allQuestions.length} / ${totalExpected} questions`;

          // After first batch (5 questions), start the quiz immediately
          if (!firstBatchSent && allQuestions.length >= 5) {
            firstBatchSent = true;
            backgroundGenerating = true;
            showScreen('quiz');
            updateBackgroundBanner(allQuestions.length, totalExpected);
            startQuiz();
          } else if (firstBatchSent) {
            // Update background banner
            updateBackgroundBanner(allQuestions.length, totalExpected);
          }
        },
        (batchVocab) => {
          // Merge vocab words as they arrive from each batch
          mergeVocabWords(batchVocab);
        }
      );
    }

    // All done
    backgroundGenerating = false;
    setState({ questions: [...allQuestions] });
    hideBackgroundBanner();

    if (!firstBatchSent) {
      // Edge case: all batches done before quiz started
      document.getElementById('loading-status').textContent = 'Done! Starting quiz...';
      document.getElementById('loading-progress').style.width = '100%';
      setTimeout(() => startQuiz(), 500);
    }
  } catch (err) {
    backgroundGenerating = false;
    hideBackgroundBanner();

    if (allQuestions.length >= 5) {
      // We have enough to quiz on, just stop background loading
      console.error('Background generation error:', err);
      return;
    }

    document.getElementById('loading-status').textContent = `Error: ${err.message}`;
    document.getElementById('loading-progress').style.width = '0%';
    console.error('Generation error:', err);

    const container = document.querySelector('.loading-container');
    if (!document.getElementById('btn-loading-back')) {
      const btn = document.createElement('button');
      btn.id = 'btn-loading-back';
      btn.className = 'btn btn-secondary';
      btn.textContent = 'Back to Home';
      btn.style.marginTop = '20px';
      btn.onclick = () => {
        showScreen('welcome');
        initWelcome();
      };
      container.appendChild(btn);
    }
  }
}

function updateBackgroundBanner(loaded, total) {
  const banner = document.getElementById('bg-loading-banner');
  const text = document.getElementById('bg-loading-text');
  if (banner && currentScreen === 'quiz') {
    banner.classList.remove('hidden');
    text.textContent = `Loading more questions... (${loaded}/${total})`;
  }
}

function hideBackgroundBanner() {
  const banner = document.getElementById('bg-loading-banner');
  if (banner) banner.classList.add('hidden');
}

// ─── Quiz Screen ───
let sessionQuestions = [];
let sessionIndex = 0;
let quizStep = 1; // 1 = meaning, 2 = response
let sessionStats = { correct: 0, incorrect: 0, bestStreak: 0, currentStreak: 0, mistakes: [] };

function startQuiz() {
  const state = getState();
  const levelQuestions = state.questions.filter(q => {
    const qLevel = getLevelIndex(q.level);
    const currentLevel = getLevelIndex(state.currentLevel);
    return qLevel >= currentLevel;
  });

  sessionQuestions = selectSessionQuestions(levelQuestions, 10);

  if (sessionQuestions.length === 0) {
    alert('No questions available. Please generate new questions.');
    showScreen('welcome');
    initWelcome();
    return;
  }

  sessionIndex = 0;
  sessionStats = { correct: 0, incorrect: 0, bestStreak: 0, currentStreak: 0, mistakes: [] };
  showScreen('quiz');

  // Show/hide background banner
  if (backgroundGenerating) {
    const state2 = getState();
    let totalExpected = 0;
    for (let i = getLevelIndex(state2.currentLevel); i < LEVELS.length; i++) {
      totalExpected += QUESTIONS_PER_LEVEL[LEVELS[i]];
    }
    updateBackgroundBanner(state2.questions.length, totalExpected);
  }

  showQuestion();
}

function showQuestion() {
  if (sessionIndex >= sessionQuestions.length) {
    showResults();
    return;
  }

  const q = sessionQuestions[sessionIndex];
  quizStep = 1;

  // Update progress
  document.getElementById('quiz-progress-fill').style.width =
    `${(sessionIndex / sessionQuestions.length) * 100}%`;
  document.getElementById('quiz-progress-text').textContent =
    `${sessionIndex + 1} / ${sessionQuestions.length}`;

  // Show question
  const questionTextEl = document.getElementById('quiz-question-text');
  if (hardMode) {
    document.getElementById('quiz-step-label').textContent = 'Step 1: What did you hear?';
    questionTextEl.textContent = '\uD83D\uDD0A Listen...';
    questionTextEl.classList.add('hard-mode-hidden');
  } else {
    document.getElementById('quiz-step-label').textContent = 'Step 1: What does this mean?';
    questionTextEl.textContent = q.questionHu;
    questionTextEl.classList.remove('hard-mode-hidden');
  }
  document.getElementById('quiz-explanation').classList.add('hidden');
  document.getElementById('btn-next').classList.add('hidden');

  // Speak — always auto-speak in hard mode
  const state = getState();
  if (state.settings.autoSpeak || hardMode) {
    speak(q.questionHu, state.settings.speechRate);
  }

  // Speak button
  document.getElementById('btn-speak').onclick = () => {
    speak(q.questionHu, getState().settings.speechRate);
  };

  // Show meaning options
  renderOptions(q.meaningOptions);
}

let currentOptionCards = []; // track for keyboard access

function renderOptions(options) {
  const container = document.getElementById('quiz-options');
  container.innerHTML = '';
  currentOptionCards = [];

  const letters = ['A', 'B', 'C'];
  // Shuffle options
  const shuffled = [...options].sort(() => Math.random() - 0.5);

  shuffled.forEach((opt, i) => {
    const card = document.createElement('button');
    card.className = 'option-card';
    card.innerHTML = `<span class="option-letter">${letters[i]}</span><span>${opt.text}</span>`;
    card.onclick = () => handleOptionClick(card, opt, shuffled);
    container.appendChild(card);
    currentOptionCards.push({ card, opt, allOptions: shuffled });
  });
}

// ─── Keyboard Shortcuts ───
document.addEventListener('keydown', (e) => {
  if (currentScreen !== 'quiz' && currentScreen !== 'flashcards') return;

  const isFlashcard = currentScreen === 'flashcards';
  const activeOptions = isFlashcard ? fcOptionCards : currentOptionCards;

  // 1/2/3 or A/B/C to pick an option
  let idx = -1;
  if (e.key === '1' || e.key.toLowerCase() === 'a') idx = 0;
  if (e.key === '2' || e.key.toLowerCase() === 'b') idx = 1;
  if (e.key === '3' || e.key.toLowerCase() === 'c') idx = 2;

  if (idx >= 0 && idx < activeOptions.length) {
    const { card, opt, allOptions } = activeOptions[idx];
    if (!card.classList.contains('disabled')) {
      if (isFlashcard) {
        handleFcClick(card, opt, allOptions);
      } else {
        handleOptionClick(card, opt, allOptions);
      }
    }
    return;
  }

  // Enter or Space to advance to next question
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (isFlashcard) {
      advanceFlashcard();
    } else {
      const btnNext = document.getElementById('btn-next');
      if (!btnNext.classList.contains('hidden')) {
        sessionIndex++;
        showQuestion();
      }
    }
    return;
  }

  // R to replay audio
  if (e.key.toLowerCase() === 'r') {
    if (isFlashcard) {
      const card = fcCards[fcIndex];
      if (card) speak(card.hu, getState().settings.speechRate);
    } else {
      const q = sessionQuestions[sessionIndex];
      if (q) speak(q.questionHu, getState().settings.speechRate);
    }
  }
});

function handleOptionClick(card, selected, allOptions) {
  const q = sessionQuestions[sessionIndex];
  const cards = document.querySelectorAll('.option-card');

  // Disable all cards
  cards.forEach(c => c.classList.add('disabled'));

  // Mark correct/incorrect
  cards.forEach(c => {
    const optText = c.querySelector('span:last-child').textContent;
    const opt = allOptions.find(o => o.text === optText);
    if (opt && opt.correct) c.classList.add('correct');
  });

  if (!selected.correct) {
    card.classList.add('incorrect');
  }

  if (quizStep === 1) {
    // Step 1 complete — show explanation and move to step 2
    const isCorrect = selected.correct;

    setTimeout(() => {
      // Reveal text in hard mode after step 1
      const questionTextEl = document.getElementById('quiz-question-text');
      questionTextEl.textContent = q.questionHu;
      questionTextEl.classList.remove('hard-mode-hidden');

      if (isCorrect) {
        quizStep = 2;
        document.getElementById('quiz-step-label').textContent = 'Step 2: Choose the correct response';

        const correctMeaning = q.meaningOptions.find(o => o.correct);
        document.getElementById('quiz-explanation').textContent =
          `"${q.questionHu}" = "${correctMeaning.text}"`;
        document.getElementById('quiz-explanation').classList.remove('hidden');

        renderOptions(q.responseOptions);
      } else {
        quizStep = 2;
        document.getElementById('quiz-step-label').textContent =
          'Step 2: Choose the correct response (review)';

        const correctMeaning = q.meaningOptions.find(o => o.correct);
        document.getElementById('quiz-explanation').textContent =
          `Correct meaning: "${q.questionHu}" = "${correctMeaning.text}"`;
        document.getElementById('quiz-explanation').classList.remove('hidden');

        renderOptions(q.responseOptions);
      }
    }, 1200);

    q._step1Correct = isCorrect;
  } else {
    // Step 2 complete — record full result
    const step2Correct = selected.correct;
    const fullyCorrect = q._step1Correct && step2Correct;

    // Show explanation
    document.getElementById('quiz-explanation').textContent = q.explanation;
    document.getElementById('quiz-explanation').classList.remove('hidden');

    // Update spaced repetition
    updateQuestionRepetition(q, fullyCorrect);

    // Update session stats
    if (fullyCorrect) {
      sessionStats.correct++;
      sessionStats.currentStreak++;
      sessionStats.bestStreak = Math.max(sessionStats.bestStreak, sessionStats.currentStreak);
    } else {
      sessionStats.incorrect++;
      sessionStats.currentStreak = 0;
      sessionStats.mistakes.push({
        questionHu: q.questionHu,
        correctMeaning: q.meaningOptions.find(o => o.correct)?.text,
        correctResponse: q.responseOptions.find(o => o.correct)?.text,
        explanation: q.explanation,
      });
    }

    // Show next button
    document.getElementById('btn-next').classList.remove('hidden');
  }
}

function updateQuestionRepetition(sessionQ, correct) {
  const state = getState();
  const questions = [...state.questions];
  const idx = questions.findIndex(q => q.id === sessionQ.id);
  if (idx === -1) return;

  const q = { ...questions[idx] };
  const rep = q.repetition || initRepetitionData();
  q.repetition = correct ? recordCorrect(rep) : recordIncorrect(rep);
  questions[idx] = q;

  // Check level advancement
  let currentLevel = state.currentLevel;
  const levelQuestions = questions.filter(q2 => q2.level === currentLevel);
  const masteredCount = levelQuestions.filter(q2 => isMastered(q2.repetition || initRepetitionData())).length;
  const threshold = Math.ceil(levelQuestions.length * 0.8);

  if (masteredCount >= threshold) {
    const levelIdx = LEVELS.indexOf(currentLevel);
    if (levelIdx < LEVELS.length - 1) {
      currentLevel = LEVELS[levelIdx + 1];
    }
  }

  setState({ questions, currentLevel });
  updateNavLevel();
}

document.getElementById('btn-next').onclick = () => {
  sessionIndex++;
  showQuestion();
};

// ─── Results Screen ───
function showResults() {
  stop(); // Stop any TTS
  showScreen('results');

  document.getElementById('stat-correct').textContent = sessionStats.correct;
  document.getElementById('stat-incorrect').textContent = sessionStats.incorrect;
  document.getElementById('stat-streak').textContent = sessionStats.bestStreak;

  // Level progress bars
  const state = getState();
  const progressContainer = document.getElementById('level-progress-bars');
  progressContainer.innerHTML = '';

  LEVELS.forEach(level => {
    const levelQs = state.questions.filter(q => q.level === level);
    if (levelQs.length === 0) return;

    const mastered = levelQs.filter(q => isMastered(q.repetition || initRepetitionData())).length;
    const pct = Math.round((mastered / levelQs.length) * 100);

    const item = document.createElement('div');
    item.className = 'level-progress-item';
    item.innerHTML = `
      <div class="level-progress-label">
        <span>${level}</span>
        <span>${mastered}/${levelQs.length} mastered (${pct}%)</span>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar-fill" style="width: ${pct}%"></div>
      </div>
    `;
    progressContainer.appendChild(item);
  });

  // Mistakes review
  const mistakesCard = document.getElementById('mistakes-review-card');
  const mistakesList = document.getElementById('mistakes-list');

  if (sessionStats.mistakes.length > 0) {
    mistakesCard.style.display = '';
    mistakesList.innerHTML = '';
    sessionStats.mistakes.forEach(m => {
      const item = document.createElement('div');
      item.className = 'mistake-item';
      item.innerHTML = `
        <div class="mistake-question">${m.questionHu}</div>
        <div class="mistake-answer">Meaning: ${m.correctMeaning}</div>
        <div class="mistake-answer">Response: ${m.correctResponse}</div>
        <div class="mistake-answer" style="color: var(--primary); margin-top: 4px;">${m.explanation}</div>
      `;
      mistakesList.appendChild(item);
    });
  } else {
    mistakesCard.style.display = 'none';
  }
}

document.getElementById('btn-continue-quiz').onclick = () => startQuiz();
document.getElementById('btn-new-session').onclick = () => {
  showScreen('welcome');
  initWelcome();
};
document.getElementById('btn-back-welcome').onclick = () => {
  showScreen('welcome');
  initWelcome();
};

// ─── Settings Screen ───
function initSettings() {
  const state = getState();
  document.getElementById('settings-api-key').value = state.apiKey || '';
  document.getElementById('s-about-me').value = state.aboutMeEssay || '';
  document.getElementById('speech-rate').value = state.settings.speechRate;
  document.getElementById('speech-rate-value').textContent = state.settings.speechRate;
  document.getElementById('auto-speak').checked = state.settings.autoSpeak;
  renderTopicsEditor(state.interviewTopics || []);
}

document.getElementById('btn-settings').onclick = () => {
  initSettings();
  showScreen('settings');
};

document.getElementById('btn-settings-back').onclick = () => {
  // Save settings
  const apiKey = document.getElementById('settings-api-key').value.trim();
  const speechRate = parseFloat(document.getElementById('speech-rate').value);
  const autoSpeak = document.getElementById('auto-speak').checked;
  setState({ apiKey, settings: { ...getState().settings, speechRate, autoSpeak } });

  showScreen(previousScreen === 'settings' ? 'quiz' : previousScreen);
};

document.getElementById('btn-save-essay').onclick = () => {
  const aboutMeEssay = document.getElementById('s-about-me').value.trim();
  setState({ aboutMeEssay });
  alert('About Me saved!');
};

document.getElementById('speech-rate').oninput = (e) => {
  document.getElementById('speech-rate-value').textContent = e.target.value;
};

// ─── Topics Editor ───
function renderTopicsEditor(topics) {
  const container = document.getElementById('topics-editor');
  container.innerHTML = '';

  topics.forEach((topic, i) => {
    const row = document.createElement('div');
    row.className = 'topic-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input topic-input';
    input.value = topic;
    input.onchange = () => {
      const state = getState();
      const updated = [...state.interviewTopics];
      updated[i] = input.value.trim();
      setState({ interviewTopics: updated });
    };

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-icon topic-remove';
    removeBtn.textContent = '\u00D7';
    removeBtn.title = 'Remove topic';
    removeBtn.onclick = () => {
      const state = getState();
      const updated = state.interviewTopics.filter((_, idx) => idx !== i);
      setState({ interviewTopics: updated });
      renderTopicsEditor(updated);
    };

    row.appendChild(input);
    row.appendChild(removeBtn);
    container.appendChild(row);
  });
}

document.getElementById('btn-add-topic').onclick = () => {
  const input = document.getElementById('new-topic-input');
  const value = input.value.trim();
  if (!value) return;

  const state = getState();
  const updated = [...(state.interviewTopics || []), value];
  setState({ interviewTopics: updated });
  renderTopicsEditor(updated);
  input.value = '';
};

document.getElementById('new-topic-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('btn-add-topic').click();
  }
});

document.getElementById('btn-reset-topics').onclick = () => {
  if (confirm('Reset interview topics to defaults?')) {
    setState({ interviewTopics: [...DEFAULT_INTERVIEW_TOPICS] });
    renderTopicsEditor([...DEFAULT_INTERVIEW_TOPICS]);
  }
};

// ─── Data management ───
document.getElementById('btn-export').onclick = () => {
  const data = exportState();
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'magyar_kerdezo_backup.json';
  a.click();
  URL.revokeObjectURL(url);
};

document.getElementById('btn-import').onclick = () => {
  document.getElementById('import-file').click();
};

document.getElementById('import-file').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      importState(ev.target.result);
      alert('Data imported successfully!');
      showScreen('welcome');
      initWelcome();
    } catch (err) {
      alert('Invalid file: ' + err.message);
    }
  };
  reader.readAsText(file);
};

document.getElementById('btn-reset').onclick = () => {
  if (confirm('Are you sure? This will delete all your progress and questions.')) {
    resetState();
    showScreen('welcome');
    initWelcome();
  }
};

// ─── Vocab Screen ───
let vocabSelected = new Set();

function mergeVocabWords(newWords) {
  const state = getState();
  const existing = new Map((state.vocabWords || []).map(w => [w.hu.toLowerCase(), w]));
  for (const w of newWords) {
    const key = w.hu.toLowerCase();
    if (!existing.has(key)) {
      existing.set(key, { hu: w.hu, en: w.en });
    }
  }
  setState({ vocabWords: [...existing.values()] });
}

function lookupWord(text) {
  const state = getState();
  const words = state.vocabWords || [];
  const lower = text.toLowerCase();
  // Exact match
  const exact = words.find(w => w.hu.toLowerCase() === lower || w.en.toLowerCase() === lower);
  if (exact) return exact;
  // Partial match (selected word might be inflected)
  const partial = words.find(w =>
    lower.startsWith(w.hu.toLowerCase()) || w.hu.toLowerCase().startsWith(lower)
  );
  return partial || null;
}

function getVocabList() {
  const state = getState();
  return state.vocabWords || [];
}

function isInFlashcards(hu) {
  const state = getState();
  return state.flashcards.some(f => f.hu.toLowerCase() === hu.toLowerCase());
}

function renderVocabList() {
  const container = document.getElementById('vocab-list');
  const emptyEl = document.getElementById('vocab-empty');
  const search = document.getElementById('vocab-search').value.toLowerCase();

  let vocab = getVocabList();

  // Update extract button text
  const extractCard = document.getElementById('vocab-extract-card');
  const state = getState();
  const extractBtn = document.getElementById('btn-extract-vocab');
  if (!extractBtn.disabled) {
    if (vocab.length > 0) {
      extractBtn.textContent =
        `Re-extract Words (${state.questions.length} questions)`;
    } else if (state.questions.length > 0) {
      extractBtn.textContent =
        `Extract Words from ${state.questions.length} Questions`;
    }
  }
  extractCard.style.display = state.questions.length > 0 ? '' : 'none';

  if (search) {
    vocab = vocab.filter(v =>
      v.hu.toLowerCase().includes(search) || v.en.toLowerCase().includes(search)
    );
  }

  container.innerHTML = '';

  if (vocab.length === 0) {
    emptyEl.classList.remove('hidden');
    container.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  container.classList.remove('hidden');

  // Sort alphabetically by Hungarian word
  vocab.sort((a, b) => a.hu.localeCompare(b.hu, 'hu'));

  vocab.forEach(v => {
    const row = document.createElement('div');
    const inDeck = isInFlashcards(v.hu);
    row.className = `vocab-row${vocabSelected.has(v.hu) ? ' selected' : ''}${inDeck ? ' in-deck' : ''}`;

    row.innerHTML = `
      <input type="checkbox" class="vocab-checkbox" ${vocabSelected.has(v.hu) ? 'checked' : ''}>
      <span class="vocab-hu">${v.hu}</span>
      <span class="vocab-en">${v.en}</span>
      ${inDeck ? '<span class="vocab-deck-badge">in deck</span>' : ''}
    `;

    const checkbox = row.querySelector('.vocab-checkbox');
    const toggle = () => {
      if (vocabSelected.has(v.hu)) {
        vocabSelected.delete(v.hu);
        row.classList.remove('selected');
        checkbox.checked = false;
      } else {
        vocabSelected.add(v.hu);
        row.classList.add('selected');
        checkbox.checked = true;
      }
      updateVocabCount();
    };

    row.onclick = (e) => {
      if (e.target === checkbox) return;
      toggle();
    };
    checkbox.onchange = toggle;
    container.appendChild(row);
  });

  updateVocabCount();
}

function updateVocabCount() {
  document.getElementById('vocab-selected-count').textContent =
    `${vocabSelected.size} selected`;
}

function openVocabScreen() {
  vocabSelected.clear();
  showScreen('vocab');
  renderVocabList();
  updateFcDeckCount();
}

document.getElementById('btn-vocab-nav').onclick = () => openVocabScreen();
document.getElementById('btn-vocab-welcome').onclick = () => openVocabScreen();
document.getElementById('btn-vocab-back').onclick = () => {
  showScreen(previousScreen === 'vocab' ? 'welcome' : previousScreen);
  if (currentScreen === 'welcome') initWelcome();
};

document.getElementById('vocab-search').oninput = () => renderVocabList();

// Extract vocabulary words from questions using Gemini
document.getElementById('btn-extract-vocab').onclick = async () => {
  const state = getState();
  if (!state.apiKey) {
    alert('Please set your Gemini API key first (on the home screen or in settings).');
    return;
  }
  if (!state.questions || state.questions.length === 0) {
    alert('No questions to extract words from. Generate questions first.');
    return;
  }

  const btn = document.getElementById('btn-extract-vocab');
  const statusEl = document.getElementById('vocab-extract-status');
  btn.disabled = true;
  btn.textContent = 'Extracting...';
  statusEl.classList.remove('hidden');
  statusEl.style.color = 'var(--primary)';

  try {
    // Collect all unique Hungarian sentences (questions + correct responses)
    const sentences = new Set();
    for (const q of state.questions) {
      sentences.add(q.questionHu);
      const correctResponse = q.responseOptions?.find(o => o.correct);
      if (correctResponse) sentences.add(correctResponse.text);
    }

    const sentenceArr = [...sentences];
    statusEl.textContent = `Extracting words from ${sentenceArr.length} sentences...`;

    const words = await extractVocabulary(state.apiKey, sentenceArr);

    // Merge with existing vocab words (keep repetition data for existing ones)
    const existing = new Map((state.vocabWords || []).map(w => [w.hu.toLowerCase(), w]));
    const merged = words.map(w => {
      const prev = existing.get(w.hu.toLowerCase());
      return {
        hu: w.hu,
        en: w.en,
        level: prev?.level || state.currentLevel,
        repetition: prev?.repetition || undefined,
      };
    });

    setState({ vocabWords: merged });
    statusEl.textContent = `Extracted ${merged.length} words!`;
    statusEl.style.color = 'var(--success)';
    renderVocabList();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.style.color = 'var(--error)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Extract Words from Questions';
    renderVocabList();
  }
};

document.getElementById('btn-select-all-vocab').onclick = () => {
  const search = document.getElementById('vocab-search').value.toLowerCase();
  let filtered = getVocabList();
  if (search) filtered = filtered.filter(v =>
    v.hu.toLowerCase().includes(search) || v.en.toLowerCase().includes(search)
  );
  filtered.forEach(v => vocabSelected.add(v.hu));
  renderVocabList();
};

document.getElementById('btn-deselect-all-vocab').onclick = () => {
  vocabSelected.clear();
  renderVocabList();
};

document.getElementById('btn-start-flashcards').onclick = () => startFlashcards();

document.getElementById('btn-clear-flashcards').onclick = () => {
  if (confirm('Remove all flashcards from your deck?')) {
    setState({ flashcards: [] });
    renderVocabList();
    updateFcDeckCount();
  }
};

function updateFcDeckCount() {
  const state = getState();
  const flashcards = state.flashcards || [];
  const total = flashcards.length;
  const mastered = flashcards.filter(f => isMastered(f.repetition || initRepetitionData())).length;
  document.getElementById('fc-deck-count').textContent =
    mastered > 0 ? `${total} (${mastered} mastered)` : total;
  const deckCard = document.getElementById('flashcard-deck-card');
  if (deckCard) deckCard.style.display = total > 0 ? '' : 'none';
}

document.getElementById('btn-add-to-flashcards').onclick = () => {
  if (vocabSelected.size === 0) {
    alert('Select some words first!');
    return;
  }
  const state = getState();
  const vocab = getVocabList();
  const existingHu = new Set(state.flashcards.map(f => f.hu.toLowerCase()));
  const newCards = [];

  for (const v of vocab) {
    if (vocabSelected.has(v.hu) && !existingHu.has(v.hu.toLowerCase())) {
      newCards.push({
        hu: v.hu,
        en: v.en,
        repetition: initRepetitionData(),
      });
    }
  }

  if (newCards.length > 0) {
    setState({ flashcards: [...state.flashcards, ...newCards] });
  }

  const skipped = vocabSelected.size - newCards.length;
  let msg = `Added ${newCards.length} word${newCards.length !== 1 ? 's' : ''} to flashcards.`;
  if (skipped > 0) msg += ` (${skipped} already in deck)`;
  alert(msg);

  vocabSelected.clear();
  renderVocabList();
  updateFcDeckCount();
};

// ─── Flashcard Study Mode ───
let fcCards = [];
let fcIndex = 0;
let fcStats = { correct: 0, incorrect: 0, bestStreak: 0, currentStreak: 0, mistakes: [] };
let fcOptionCards = [];
let fcHardMode = false;
let fcWaitingForTap = false;

function startFlashcards() {
  const state = getState();
  if (!state.flashcards || state.flashcards.length === 0) {
    alert('No flashcards yet! Go to Vocabulary to add some.');
    return;
  }

  // Select up to 10 cards — skip mastered words entirely (3x correct = done)
  const now = Date.now();
  const due = [];
  const fresh = [];

  for (const card of state.flashcards) {
    const rep = card.repetition || initRepetitionData();
    if (isMastered(rep)) {
      // Skip mastered cards — they never come back
      continue;
    } else if (rep.attempts === 0) {
      fresh.push(card);
    } else if (rep.nextReview <= now) {
      due.push(card);
    }
  }

  if (due.length === 0 && fresh.length === 0) {
    const total = state.flashcards.length;
    const masteredCount = state.flashcards.filter(f => isMastered(f.repetition || initRepetitionData())).length;
    if (masteredCount === total) {
      alert(`All ${total} flashcards mastered! Add more words from Vocabulary.`);
    } else {
      alert('No flashcards due for review right now. Try again later or add more words.');
    }
    return;
  }

  due.sort((a, b) => (a.repetition?.easeFactor || 2.5) - (b.repetition?.easeFactor || 2.5));

  fcCards = [];
  for (const pool of [due, fresh]) {
    for (const c of pool) {
      if (fcCards.length >= 10) break;
      fcCards.push(c);
    }
  }

  // Shuffle
  for (let i = fcCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fcCards[i], fcCards[j]] = [fcCards[j], fcCards[i]];
  }

  fcIndex = 0;
  fcStats = { correct: 0, incorrect: 0, bestStreak: 0, currentStreak: 0, mistakes: [] };
  showScreen('flashcards');
  showFlashcard();
}

function showFlashcard() {
  if (fcIndex >= fcCards.length) {
    showFcResults();
    return;
  }

  const card = fcCards[fcIndex];

  document.getElementById('fc-progress-fill').style.width =
    `${(fcIndex / fcCards.length) * 100}%`;
  document.getElementById('fc-progress-text').textContent =
    `${fcIndex + 1} / ${fcCards.length}`;

  const questionTextEl = document.getElementById('fc-question-text');
  if (fcHardMode) {
    document.getElementById('fc-step-label').textContent = 'What did you hear?';
    questionTextEl.textContent = '\uD83D\uDD0A Listen...';
    questionTextEl.classList.add('hard-mode-hidden');
  } else {
    document.getElementById('fc-step-label').textContent = 'What does this mean?';
    questionTextEl.textContent = card.hu;
    questionTextEl.classList.remove('hard-mode-hidden');
  }
  document.getElementById('fc-flash-translation').className = 'flash-translation hidden';
  document.getElementById('fc-tap-hint').classList.add('hidden');
  fcWaitingForTap = false;

  // Speak
  const state = getState();
  if (state.settings.autoSpeak || fcHardMode) {
    speak(card.hu, state.settings.speechRate);
  }

  document.getElementById('fc-btn-speak').onclick = () => {
    speak(card.hu, getState().settings.speechRate);
  };

  // Generate 3 options: 1 correct + 2 wrong from other flashcards/vocab
  const state2 = getState();
  const wrongPool = state2.flashcards
    .filter(c => c.hu !== card.hu)
    .map(c => c.en);
  // Also pull from vocabWords if not enough
  if (wrongPool.length < 2) {
    for (const w of (state2.vocabWords || [])) {
      if (w.en !== card.en && !wrongPool.includes(w.en)) {
        wrongPool.push(w.en);
      }
    }
  }

  // Shuffle and pick 2 wrong
  for (let i = wrongPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wrongPool[i], wrongPool[j]] = [wrongPool[j], wrongPool[i]];
  }
  const wrong = wrongPool.slice(0, 2);

  const options = [
    { text: card.en, correct: true },
    ...wrong.map(w => ({ text: w, correct: false })),
  ];

  renderFcOptions(options);
}

function renderFcOptions(options) {
  const container = document.getElementById('fc-options');
  container.innerHTML = '';
  fcOptionCards = [];

  const letters = ['A', 'B', 'C'];
  const shuffled = [...options].sort(() => Math.random() - 0.5);

  shuffled.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-card';
    btn.innerHTML = `<span class="option-letter">${letters[i]}</span><span>${opt.text}</span>`;
    btn.onclick = () => handleFcClick(btn, opt, shuffled);
    container.appendChild(btn);
    fcOptionCards.push({ card: btn, opt, allOptions: shuffled });
  });
}

function handleFcClick(btn, selected, allOptions) {
  const card = fcCards[fcIndex];
  const cards = document.querySelectorAll('#fc-options .option-card');

  cards.forEach(c => c.classList.add('disabled'));
  cards.forEach(c => {
    const optText = c.querySelector('span:last-child').textContent;
    const opt = allOptions.find(o => o.text === optText);
    if (opt && opt.correct) c.classList.add('correct');
  });

  if (!selected.correct) {
    btn.classList.add('incorrect');
  }

  // Reveal text in hard mode
  const questionTextEl = document.getElementById('fc-question-text');
  questionTextEl.textContent = card.hu;
  questionTextEl.classList.remove('hard-mode-hidden');

  const isCorrect = selected.correct;

  // Flash the translation on the question card
  const flashEl = document.getElementById('fc-flash-translation');
  flashEl.textContent = `= ${card.en}`;
  flashEl.className = `flash-translation ${isCorrect ? 'flash-correct' : 'flash-incorrect'}`;

  // Show tap hint
  document.getElementById('fc-tap-hint').classList.remove('hidden');
  fcWaitingForTap = true;

  // Update spaced repetition for this flashcard
  const state = getState();
  const flashcards = [...state.flashcards];
  const idx = flashcards.findIndex(f => f.hu === card.hu);
  if (idx !== -1) {
    const fc = { ...flashcards[idx] };
    const rep = fc.repetition || initRepetitionData();
    fc.repetition = isCorrect ? recordCorrect(rep) : recordIncorrect(rep);
    flashcards[idx] = fc;
    setState({ flashcards });
  }

  if (isCorrect) {
    fcStats.correct++;
    fcStats.currentStreak++;
    fcStats.bestStreak = Math.max(fcStats.bestStreak, fcStats.currentStreak);
  } else {
    fcStats.incorrect++;
    fcStats.currentStreak = 0;
    fcStats.mistakes.push({ hu: card.hu, en: card.en });
  }
}

function advanceFlashcard() {
  if (!fcWaitingForTap) return;
  fcWaitingForTap = false;
  document.getElementById('fc-tap-hint').classList.add('hidden');
  document.getElementById('fc-flash-translation').className = 'flash-translation hidden';
  fcIndex++;
  showFlashcard();
}

// Tap anywhere on flashcard screen to advance
document.getElementById('screen-flashcards').addEventListener('click', (e) => {
  // Don't advance if clicking an option or speak button
  if (e.target.closest('.option-card') || e.target.closest('.btn-speak')) return;
  advanceFlashcard();
});

function showFcResults() {
  stop();
  showScreen('fc-results');
  document.getElementById('fc-stat-correct').textContent = fcStats.correct;
  document.getElementById('fc-stat-incorrect').textContent = fcStats.incorrect;
  document.getElementById('fc-stat-streak').textContent = fcStats.bestStreak;

  const mistakesCard = document.getElementById('fc-mistakes-card');
  const mistakesList = document.getElementById('fc-mistakes-list');
  if (fcStats.mistakes.length > 0) {
    mistakesCard.style.display = '';
    mistakesList.innerHTML = '';
    fcStats.mistakes.forEach(m => {
      const item = document.createElement('div');
      item.className = 'mistake-item';
      item.innerHTML = `
        <div class="mistake-question">${m.hu}</div>
        <div class="mistake-answer">${m.en}</div>
      `;
      mistakesList.appendChild(item);
    });
  } else {
    mistakesCard.style.display = 'none';
  }
}

document.getElementById('btn-fc-continue').onclick = () => startFlashcards();
document.getElementById('btn-fc-to-vocab').onclick = () => openVocabScreen();
document.getElementById('btn-fc-to-welcome').onclick = () => {
  showScreen('welcome');
  initWelcome();
};

// ─── Flashcard Hard Mode Toggle ───
document.getElementById('fc-hard-mode-checkbox').onchange = (e) => {
  fcHardMode = e.target.checked;
};

// ─── Hard Mode Toggle ───
document.getElementById('hard-mode-checkbox').onchange = (e) => {
  hardMode = e.target.checked;
  // Persist preference
  setState({ settings: { ...getState().settings, hardMode } });
  // If mid-question on step 1, update display immediately
  if (currentScreen === 'quiz' && quizStep === 1 && sessionQuestions[sessionIndex]) {
    const q = sessionQuestions[sessionIndex];
    const questionTextEl = document.getElementById('quiz-question-text');
    if (hardMode) {
      questionTextEl.textContent = '\uD83D\uDD0A Listen...';
      questionTextEl.classList.add('hard-mode-hidden');
      document.getElementById('quiz-step-label').textContent = 'Step 1: What did you hear?';
      speak(q.questionHu, getState().settings.speechRate);
    } else {
      questionTextEl.textContent = q.questionHu;
      questionTextEl.classList.remove('hard-mode-hidden');
      document.getElementById('quiz-step-label').textContent = 'Step 1: What does this mean?';
    }
  }
};

// ─── Selection Popup ───
const selPopup = document.getElementById('selection-popup');
const selWord = document.getElementById('selection-popup-word');
const selAddBtn = document.getElementById('selection-popup-add');
const selStatus = document.getElementById('selection-popup-status');
let selTranslation = null; // cached {hu, en} from last translate

function hideSelectionPopup() {
  selPopup.classList.add('hidden');
  selStatus.classList.add('hidden');
  selTranslation = null;
}

function positionPopup(rect) {
  const x = Math.min(
    rect.left + rect.width / 2 - 80,
    window.innerWidth - 200
  );
  const above = rect.top > 160;
  selPopup.style.left = `${Math.max(8, x)}px`;
  if (above) {
    selPopup.style.top = '';
    selPopup.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  } else {
    selPopup.style.bottom = '';
    selPopup.style.top = `${rect.bottom + 8}px`;
  }
}

function showSelectionPopup(text, rect) {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > 80) return;

  // Local lookup — no API call
  const match = lookupWord(trimmed);

  selAddBtn.textContent = 'Add to Study List';
  selTranslation = null;
  positionPopup(rect);

  if (match) {
    selTranslation = match;
    selWord.innerHTML = `<strong>${match.hu}</strong> = ${match.en}`;

    const state = getState();
    const alreadyInDeck = state.flashcards.some(
      f => f.hu.toLowerCase() === match.hu.toLowerCase()
    );

    if (alreadyInDeck) {
      selStatus.textContent = 'Already in study list';
      selStatus.className = 'selection-popup-status status-ok';
      selStatus.classList.remove('hidden');
      selAddBtn.disabled = true;
    } else {
      selStatus.classList.add('hidden');
      selAddBtn.disabled = false;
    }
  } else {
    // Word not in our vocab — show it but allow adding as-is
    selWord.textContent = `"${trimmed}"`;
    selStatus.textContent = 'Not in vocabulary yet';
    selStatus.className = 'selection-popup-status status-err';
    selStatus.classList.remove('hidden');
    selAddBtn.disabled = true;
  }

  selPopup.classList.remove('hidden');
}

// Listen for text selection anywhere
document.addEventListener('mouseup', (e) => {
  // Ignore clicks on the popup itself
  if (e.target.closest('.selection-popup')) return;

  const sel = window.getSelection();
  const text = sel?.toString()?.trim();
  if (!text || text.length < 1) {
    // Small delay to avoid hiding when clicking the add button
    setTimeout(() => {
      if (!selPopup.matches(':hover')) hideSelectionPopup();
    }, 150);
    return;
  }

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  showSelectionPopup(text, rect);
});

// Touch support — show on selection change
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  const text = sel?.toString()?.trim();
  if (!text || text.length < 1 || sel.rangeCount === 0) return;

  // Only trigger on touch devices
  if (!('ontouchstart' in window)) return;

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  showSelectionPopup(text, rect);
});

// Add to flashcards button
selAddBtn.addEventListener('click', () => {
  if (!selTranslation) return;

  const state = getState();
  const existing = state.flashcards.some(
    f => f.hu.toLowerCase() === selTranslation.hu.toLowerCase()
  );
  if (existing) {
    selStatus.textContent = 'Already in study list';
    selStatus.className = 'selection-popup-status status-ok';
    selStatus.classList.remove('hidden');
    return;
  }

  // Add to flashcards
  const newCard = {
    hu: selTranslation.hu,
    en: selTranslation.en,
    repetition: initRepetitionData(),
  };
  setState({ flashcards: [...state.flashcards, newCard] });

  // Also add to vocabWords if not there
  const vocabWords = state.vocabWords || [];
  if (!vocabWords.some(w => w.hu.toLowerCase() === selTranslation.hu.toLowerCase())) {
    setState({ vocabWords: [...getState().vocabWords, { hu: selTranslation.hu, en: selTranslation.en }] });
  }

  selStatus.textContent = 'Added!';
  selStatus.className = 'selection-popup-status status-ok';
  selStatus.classList.remove('hidden');
  selAddBtn.disabled = true;

  // Update deck count if on vocab screen
  if (currentScreen === 'vocab') {
    updateFcDeckCount();
    renderVocabList();
  }

  // Clear selection and hide after brief flash
  setTimeout(() => {
    window.getSelection()?.removeAllRanges();
    hideSelectionPopup();
  }, 800);
});

// Hide on scroll or escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideSelectionPopup();
});

// ─── Init ───
function init() {
  const state = getState();
  // Restore hard mode preference
  hardMode = state.settings.hardMode || false;
  document.getElementById('hard-mode-checkbox').checked = hardMode;
  initWelcome();
}

init();
