import { TOPICS } from './curriculum.js';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

/**
 * Generate questions in batches. Calls onBatchReady with each batch of parsed questions
 * so the caller can start the quiz early.
 */
export async function generateQuestions(apiKey, level, aboutMeEssay, interviewTopics, count, onProgress, onBatchReady) {
  const batchSize = 5;
  const allQuestions = [];

  for (let i = 0; i < count; i += batchSize) {
    const batchCount = Math.min(batchSize, count - i);
    // Pick curriculum topics for this batch
    const curriculumTopics = TOPICS[level];
    const batchTopics = [];
    for (let j = 0; j < batchCount; j++) {
      batchTopics.push(curriculumTopics[(i + j) % curriculumTopics.length]);
    }

    const questions = await generateBatch(apiKey, level, aboutMeEssay, interviewTopics, batchTopics, batchCount);
    allQuestions.push(...questions);
    if (onProgress) onProgress(allQuestions.length);
    if (onBatchReady) onBatchReady(questions, allQuestions.length);

    // Small delay between batches to respect rate limits
    if (i + batchSize < count) {
      await sleep(1000);
    }
  }

  return allQuestions;
}

async function generateBatch(apiKey, level, aboutMeEssay, interviewTopics, curriculumTopics, count) {
  const personalContext = buildPersonalContext(aboutMeEssay, interviewTopics);
  const topicList = curriculumTopics.map((t, i) => `${i + 1}. ${t}`).join('\n');

  const prompt = `You are a Hungarian language exam question generator for a simplified naturalization interview. Generate exactly ${count} interview-style questions for a CEFR ${level} Hungarian language exam.

${personalContext}

Curriculum topics to cover (one question per topic):
${topicList}

For each question, create:
1. A question in Hungarian that an interviewer would ask
2. Three English translation options (one correct, two plausible but wrong)
3. Three Hungarian response options (one correct and natural, two plausible but wrong)
4. A brief English explanation of the correct answer

IMPORTANT RULES:
- Questions must be appropriate for CEFR level ${level}
- Use natural, conversational Hungarian
- Wrong options should be plausible (common mistakes learners make)
- Responses should be complete sentences
- If personal details are provided in the essay, incorporate them into questions and correct answers so the student practices answering about their own life
- Also include questions about the interview topics listed above, especially about famous Hungarians, children, pets, hobbies, and other naturalization interview topics
- Vary question types: yes/no, open-ended, choice questions

Return ONLY a valid JSON array with this exact structure:
[
  {
    "questionHu": "Hogy hívnak?",
    "topic": "greetings and introductions",
    "meaningOptions": [
      {"text": "What is your name?", "correct": true},
      {"text": "Where are you from?", "correct": false},
      {"text": "How old are you?", "correct": false}
    ],
    "responseOptions": [
      {"text": "Péternek hívnak.", "correct": true},
      {"text": "Budapesten lakom.", "correct": false},
      {"text": "Harminc éves vagyok.", "correct": false}
    ],
    "explanation": "'Hogy hívnak?' means 'What is your name?' (informal). The correct response uses the pattern '[Name]-nak/nek hívnak.'"
  }
]`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.9,
    },
  };

  const response = await fetchWithRetry(`${API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('No content returned from Gemini API');
  }

  try {
    const questions = JSON.parse(text);
    return questions.map((q, i) => ({
      id: `${level}-${Date.now()}-${i}`,
      level,
      ...q,
      repetition: {
        interval: 0,
        easeFactor: 2.5,
        nextReview: 0,
        consecutiveCorrect: 0,
        attempts: 0,
      },
    }));
  } catch {
    // Try to extract JSON from the response
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const questions = JSON.parse(match[0]);
      return questions.map((q, i) => ({
        id: `${level}-${Date.now()}-${i}`,
        level,
        ...q,
        repetition: {
          interval: 0,
          easeFactor: 2.5,
          nextReview: 0,
          consecutiveCorrect: 0,
          attempts: 0,
        },
      }));
    }
    throw new Error('Failed to parse Gemini response as JSON');
  }
}

/**
 * Extract individual vocabulary words from Hungarian sentences.
 * Returns array of {hu, en} objects.
 */
export async function extractVocabulary(apiKey, sentences) {
  const batchSize = 20;
  const allWords = [];

  for (let i = 0; i < sentences.length; i += batchSize) {
    const batch = sentences.slice(i, i + batchSize);
    const words = await extractVocabBatch(apiKey, batch);
    allWords.push(...words);

    if (i + batchSize < sentences.length) {
      await sleep(1000);
    }
  }

  // Deduplicate by Hungarian word (lowercase)
  const seen = new Map();
  for (const w of allWords) {
    const key = w.hu.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, w);
    }
  }
  return [...seen.values()];
}

async function extractVocabBatch(apiKey, sentences) {
  const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const prompt = `Extract ALL individual vocabulary words and short phrases from these Hungarian sentences. For each word, provide the dictionary form (lemma) in Hungarian and its English translation.

Sentences:
${numbered}

Rules:
- Extract every meaningful word (nouns, verbs, adjectives, adverbs, pronouns, prepositions, question words)
- Use the dictionary/base form (infinitive for verbs, nominative singular for nouns)
- Skip proper nouns (names of people, specific places) unless they are common Hungarian words
- Include common phrases that are better learned as a unit (e.g. "hogy van" = "how are you")
- Do NOT include articles (a, az, egy) by themselves
- Each word should appear only once even if it appears in multiple sentences

Return ONLY a valid JSON array:
[{"hu": "word", "en": "translation"}, ...]`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3,
    },
  };

  const response = await fetchWithRetry(`${API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return [];

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    return [];
  }
}

function buildPersonalContext(aboutMeEssay, interviewTopics) {
  const parts = [];

  if (aboutMeEssay && aboutMeEssay.trim()) {
    parts.push(`STUDENT'S PERSONAL ESSAY (use this to personalize questions and correct answers — ask about what they wrote):\n${aboutMeEssay.trim()}`);
  }

  if (interviewTopics && interviewTopics.length > 0) {
    parts.push(`INTERVIEW TOPICS TO COVER (weave these into questions naturally, even if not in the essay):\n${interviewTopics.map((t, i) => `- ${t}`).join('\n')}`);
  }

  // Always add naturalization context
  parts.push(`CONTEXT: This is preparation for a Hungarian simplified naturalization interview. The student needs to practice answering personal questions about their life, family, daily routine, and knowledge of Hungary.`);

  return parts.join('\n\n');
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(1000 * (i + 1));
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
