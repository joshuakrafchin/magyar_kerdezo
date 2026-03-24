import { getState, setState, resetState, exportState, importState, DEFAULT_INTERVIEW_TOPICS } from './state.js';
import { generateQuestions } from './gemini.js';
import { LEVELS, QUESTIONS_PER_LEVEL, getLevelIndex } from './curriculum.js';
import { speak, stop } from './speech.js';
import { checkAuth, login, logout } from './auth.js';
import {
  selectSessionQuestions,
  recordCorrect,
  recordIncorrect,
  isMastered,
  initRepetitionData,
} from './spaced-repetition.js';

// ─── Screen Management ───
const screens = ['login', 'welcome', 'loading', 'quiz', 'results', 'settings'];
let currentScreen = 'login';
let previousScreen = 'login';
let backgroundGenerating = false;
let hardMode = false;

function showScreen(name) {
  previousScreen = currentScreen;
  currentScreen = name;
  screens.forEach(s => {
    document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name);
  });
  const nav = document.getElementById('nav');
  nav.classList.toggle('hidden', name === 'welcome' || name === 'loading' || name === 'login');
  if (name === 'quiz') updateNavLevel();
}

function updateNavLevel() {
  const state = getState();
  document.getElementById('nav-level').textContent = `Level: ${state.currentLevel}`;
}

// ─── Login Screen ───
document.getElementById('btn-login').onclick = async () => {
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('hidden');

  try {
    await login(password);
    showScreen('welcome');
    initWelcome();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
};

document.getElementById('login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('btn-login').click();
  }
});

// ─── Logout ───
document.getElementById('btn-logout').onclick = async () => {
  await logout();
  showScreen('login');
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').classList.add('hidden');
};

// ─── Welcome Screen ───
function initWelcome() {
  const state = getState();

  // Populate fields from state
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
  const btnContinue = document.getElementById('btn-continue');
  btnContinue.classList.toggle('hidden', !state.questions || state.questions.length === 0);

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
  const aboutMeEssay = document.getElementById('about-me-essay').value.trim();
  const selectedLevel = document.querySelector('.level-btn.selected')?.dataset.level || 'A1';
  setState({ aboutMeEssay, currentLevel: selectedLevel });
}

// ─── Loading / Background Generation ───
async function startGeneration() {
  saveWelcomeFields();
  const state = getState();

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
  if (currentScreen !== 'quiz') return;

  // 1/2/3 or A/B/C to pick an option
  let idx = -1;
  if (e.key === '1' || e.key.toLowerCase() === 'a') idx = 0;
  if (e.key === '2' || e.key.toLowerCase() === 'b') idx = 1;
  if (e.key === '3' || e.key.toLowerCase() === 'c') idx = 2;

  if (idx >= 0 && idx < currentOptionCards.length) {
    const { card, opt, allOptions } = currentOptionCards[idx];
    if (!card.classList.contains('disabled')) {
      handleOptionClick(card, opt, allOptions);
    }
    return;
  }

  // Enter or Space to advance to next question
  if (e.key === 'Enter' || e.key === ' ') {
    const btnNext = document.getElementById('btn-next');
    if (!btnNext.classList.contains('hidden')) {
      e.preventDefault();
      sessionIndex++;
      showQuestion();
    }
    return;
  }

  // R to replay audio
  if (e.key.toLowerCase() === 'r') {
    const q = sessionQuestions[sessionIndex];
    if (q) speak(q.questionHu, getState().settings.speechRate);
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
  const speechRate = parseFloat(document.getElementById('speech-rate').value);
  const autoSpeak = document.getElementById('auto-speak').checked;
  setState({ settings: { ...getState().settings, speechRate, autoSpeak } });

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

// ─── Init ───
async function init() {
  const state = getState();
  // Restore hard mode preference
  hardMode = state.settings.hardMode || false;
  document.getElementById('hard-mode-checkbox').checked = hardMode;

  // Check if already authenticated
  const isAuth = await checkAuth();
  if (isAuth) {
    showScreen('welcome');
    initWelcome();
  } else {
    showScreen('login');
  }
}

init();
