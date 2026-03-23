import { TOPICS } from './curriculum.js';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export async function generateQuestions(apiKey, level, personalDetails, count, onProgress) {
  const batchSize = 10;
  const allQuestions = [];
  const topics = TOPICS[level];

  for (let i = 0; i < count; i += batchSize) {
    const batchCount = Math.min(batchSize, count - i);
    // Pick topics for this batch
    const batchTopics = [];
    for (let j = 0; j < batchCount; j++) {
      batchTopics.push(topics[(i + j) % topics.length]);
    }

    const questions = await generateBatch(apiKey, level, personalDetails, batchTopics, batchCount);
    allQuestions.push(...questions);
    if (onProgress) onProgress(allQuestions.length);

    // Small delay between batches to respect rate limits
    if (i + batchSize < count) {
      await sleep(1000);
    }
  }

  return allQuestions;
}

async function generateBatch(apiKey, level, pd, topics, count) {
  const personalContext = buildPersonalContext(pd);
  const topicList = topics.map((t, i) => `${i + 1}. ${t}`).join('\n');

  const prompt = `You are a Hungarian language exam question generator. Generate exactly ${count} interview-style questions for a CEFR ${level} Hungarian language exam.

${personalContext}

Topics to cover (one question per topic):
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
- If personal details are provided, incorporate them into questions and correct answers
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

function buildPersonalContext(pd) {
  if (!pd) return '';
  const parts = [];
  if (pd.name) parts.push(`The student's name is ${pd.name}`);
  if (pd.age) parts.push(`they are ${pd.age} years old`);
  if (pd.job) parts.push(`they work as a ${pd.job}`);
  if (pd.city) parts.push(`they live in ${pd.city}`);
  if (pd.family) parts.push(`family: ${pd.family}`);
  if (pd.hobbies) parts.push(`hobbies: ${pd.hobbies}`);
  if (pd.other) parts.push(`other details: ${pd.other}`);

  if (parts.length === 0) return '';
  return `STUDENT PERSONAL DETAILS (use these to personalize questions and correct answers):\n${parts.join(', ')}.`;
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
