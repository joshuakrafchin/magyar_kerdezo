import { getState, setState, resetState, exportState, importState } from './state.js';
import { generateQuestions } from './gemini.js';
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
const screens = ['welcome', 'loading', 'quiz', 'results', 'settings'];
let currentScreen = 'welcome';
let previousScreen = 'welcome';

function showScreen(name) {
  previousScreen = currentScreen;
  currentScreen = name;
  screens.forEach(s => {
    document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name);
  });
  const nav = document.getElementById('nav');
  nav.classList.toggle('hidden', name === 'welcome' || name === 'loading');
  if (name === 'quiz') updateNavLevel();
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
  document.getElementById('pd-name').value = state.personalDetails.name || '';
  document.getElementById('pd-age').value = state.personalDetails.age || '';
  document.getElementById('pd-job').value = state.personalDetails.job || '';
  document.getElementById('pd-city').value = state.personalDetails.city || '';
  document.getElementById('pd-family').value = state.personalDetails.family || '';
  document.getElementById('pd-hobbies').value = state.personalDetails.hobbies || '';
  document.getElementById('pd-other').value = state.personalDetails.other || '';

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

  // Start button
  document.getElementById('btn-start').onclick = () => startGeneration();

  // Continue button
  btnContinue.onclick = () => {
    saveWelcomeFields();
    startQuiz();
  };
}

function saveWelcomeFields() {
  const apiKey = document.getElementById('input-api-key').value.trim();
  const personalDetails = {
    name: document.getElementById('pd-name').value.trim(),
    age: document.getElementById('pd-age').value.trim(),
    job: document.getElementById('pd-job').value.trim(),
    city: document.getElementById('pd-city').value.trim(),
    family: document.getElementById('pd-family').value.trim(),
    hobbies: document.getElementById('pd-hobbies').value.trim(),
    other: document.getElementById('pd-other').value.trim(),
  };
  const selectedLevel = document.querySelector('.level-btn.selected')?.dataset.level || 'A1';
  setState({ apiKey, personalDetails, currentLevel: selectedLevel });
}

// ─── Loading Screen ───
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

      const questions = await generateQuestions(
        state.apiKey,
        level,
        state.personalDetails,
        count,
        (generated) => {
          const total = allQuestions.length + generated;
          const pct = Math.round((total / totalExpected) * 100);
          document.getElementById('loading-progress').style.width = `${pct}%`;
          document.getElementById('loading-count').textContent = `${total} / ${totalExpected} questions`;
        }
      );

      allQuestions.push(...questions);
    }

    setState({ questions: allQuestions });
    document.getElementById('loading-status').textContent = 'Done! Starting quiz...';
    document.getElementById('loading-progress').style.width = '100%';

    setTimeout(() => startQuiz(), 500);
  } catch (err) {
    document.getElementById('loading-status').textContent = `Error: ${err.message}`;
    document.getElementById('loading-progress').style.width = '0%';
    console.error('Generation error:', err);

    // Add a retry / back button
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
  document.getElementById('quiz-step-label').textContent = 'Step 1: What does this mean?';
  document.getElementById('quiz-question-text').textContent = q.questionHu;
  document.getElementById('quiz-explanation').classList.add('hidden');
  document.getElementById('btn-next').classList.add('hidden');

  // Speak
  const state = getState();
  if (state.settings.autoSpeak) {
    speak(q.questionHu, state.settings.speechRate);
  }

  // Speak button
  document.getElementById('btn-speak').onclick = () => {
    speak(q.questionHu, getState().settings.speechRate);
  };

  // Show meaning options
  renderOptions(q.meaningOptions);
}

function renderOptions(options) {
  const container = document.getElementById('quiz-options');
  container.innerHTML = '';

  const letters = ['A', 'B', 'C'];
  // Shuffle options
  const shuffled = [...options].sort(() => Math.random() - 0.5);

  shuffled.forEach((opt, i) => {
    const card = document.createElement('button');
    card.className = 'option-card';
    card.innerHTML = `<span class="option-letter">${letters[i]}</span><span>${opt.text}</span>`;
    card.onclick = () => handleOptionClick(card, opt, shuffled);
    container.appendChild(card);
  });
}

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
      if (isCorrect) {
        // Move to step 2
        quizStep = 2;
        document.getElementById('quiz-step-label').textContent = 'Step 2: Choose the correct response';

        // Show the correct meaning
        const correctMeaning = q.meaningOptions.find(o => o.correct);
        document.getElementById('quiz-explanation').textContent =
          `"${q.questionHu}" = "${correctMeaning.text}"`;
        document.getElementById('quiz-explanation').classList.remove('hidden');

        renderOptions(q.responseOptions);
      } else {
        // Wrong meaning — still show step 2 for learning, but mark as incorrect
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

    // Store step 1 result temporarily
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
document.getElementById('btn-settings').onclick = () => {
  const state = getState();
  document.getElementById('settings-api-key').value = state.apiKey || '';
  document.getElementById('s-pd-name').value = state.personalDetails.name || '';
  document.getElementById('s-pd-age').value = state.personalDetails.age || '';
  document.getElementById('s-pd-job').value = state.personalDetails.job || '';
  document.getElementById('s-pd-city').value = state.personalDetails.city || '';
  document.getElementById('s-pd-family').value = state.personalDetails.family || '';
  document.getElementById('s-pd-hobbies').value = state.personalDetails.hobbies || '';
  document.getElementById('s-pd-other').value = state.personalDetails.other || '';
  document.getElementById('speech-rate').value = state.settings.speechRate;
  document.getElementById('speech-rate-value').textContent = state.settings.speechRate;
  document.getElementById('auto-speak').checked = state.settings.autoSpeak;
  showScreen('settings');
};

document.getElementById('btn-settings-back').onclick = () => {
  // Save settings
  const apiKey = document.getElementById('settings-api-key').value.trim();
  const speechRate = parseFloat(document.getElementById('speech-rate').value);
  const autoSpeak = document.getElementById('auto-speak').checked;
  setState({ apiKey, settings: { speechRate, autoSpeak } });

  showScreen(previousScreen === 'settings' ? 'quiz' : previousScreen);
};

document.getElementById('btn-save-details').onclick = () => {
  const personalDetails = {
    name: document.getElementById('s-pd-name').value.trim(),
    age: document.getElementById('s-pd-age').value.trim(),
    job: document.getElementById('s-pd-job').value.trim(),
    city: document.getElementById('s-pd-city').value.trim(),
    family: document.getElementById('s-pd-family').value.trim(),
    hobbies: document.getElementById('s-pd-hobbies').value.trim(),
    other: document.getElementById('s-pd-other').value.trim(),
  };
  setState({ personalDetails });
  alert('Personal details saved!');
};

document.getElementById('speech-rate').oninput = (e) => {
  document.getElementById('speech-rate-value').textContent = e.target.value;
};

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

// ─── Init ───
function init() {
  const state = getState();
  initWelcome();

  // If we have questions, show continue option
  if (state.questions && state.questions.length > 0) {
    showScreen('welcome');
  }
}

init();
