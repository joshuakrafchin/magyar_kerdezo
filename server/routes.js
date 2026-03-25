const express = require('express');
const { getAuthUrl, handleCallback, requireAuth, requireAdmin, TOKEN_MAX_AGE } = require('./auth');
const { queryOne, queryAll, run } = require('./db');
const { callGemini } = require('./gemini');
const { TOPICS, LEVELS, QUESTIONS_PER_LEVEL } = require('./curriculum');

const router = express.Router();

// ── Auth routes ──

router.get('/auth/login', (req, res) => {
  res.redirect(getAuthUrl());
});

router.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect('/?error=no_code');

    const result = await handleCallback(code);

    if (result.error === 'not_invited') {
      return res.redirect(`/?error=not_invited&email=${encodeURIComponent(result.email)}`);
    }

    res.cookie('token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: TOKEN_MAX_AGE,
    });

    res.redirect('/');
  } catch (err) {
    console.error('Auth callback error:', err);
    res.redirect('/?error=auth_failed');
  }
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/auth/me', requireAuth, (req, res) => {
  const { id, email, name, picture, role } = req.user;
  res.json({ id, email, name, picture, role });
});

// ── User state (progress sync) ──

router.get('/api/state', requireAuth, async (req, res) => {
  const row = await queryOne('SELECT state_json FROM user_state WHERE user_id = ?', [req.user.id]);
  if (!row) return res.json({});
  try {
    res.json(JSON.parse(row.state_json));
  } catch {
    res.json({});
  }
});

router.put('/api/state', requireAuth, express.json({ limit: '5mb' }), async (req, res) => {
  const stateJson = JSON.stringify(req.body);
  await run(
    `INSERT INTO user_state (user_id, state_json, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = datetime('now')`,
    [req.user.id, stateJson]
  );
  res.json({ ok: true });
});

// POST variant for sendBeacon (used on page unload)
router.post('/api/state', requireAuth, express.json({ limit: '5mb' }), async (req, res) => {
  const stateJson = JSON.stringify(req.body);
  await run(
    `INSERT INTO user_state (user_id, state_json, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = datetime('now')`,
    [req.user.id, stateJson]
  );
  res.json({ ok: true });
});

// ── Invitation system ──

router.get('/api/invitations', requireAuth, async (req, res) => {
  // Admin sees all, regular users see their own
  const invitations = req.user.role === 'admin'
    ? await queryAll(
        'SELECT i.email, i.created_at, u.name as invited_by_name FROM invitations i LEFT JOIN users u ON i.invited_by = u.id WHERE i.invited_by != ? ORDER BY i.created_at DESC',
        ['SYSTEM']
      )
    : await queryAll(
        'SELECT email, created_at FROM invitations WHERE invited_by = ? ORDER BY created_at DESC',
        [req.user.id]
      );
  res.json(invitations);
});

router.post('/api/invitations', requireAuth, express.json(), async (req, res) => {
  // Only admin can invite
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the admin can invite users' });
  }

  const email = req.body.email?.toLowerCase()?.trim();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const exists = await queryOne('SELECT 1 FROM invitations WHERE LOWER(email) = LOWER(?)', [email]);
  if (exists) {
    return res.status(409).json({ error: 'Already invited' });
  }

  await run('INSERT INTO invitations (email, invited_by) VALUES (?, ?)', [email, req.user.id]);
  res.json({ ok: true, email });
});

// ── Gemini proxy ──

router.post('/api/generate', requireAuth, express.json(), async (req, res) => {
  try {
    const { level, aboutMeEssay, interviewTopics, batchTopics, batchCount } = req.body;

    if (!level || !batchTopics || !batchCount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const personalContext = buildPersonalContext(aboutMeEssay, interviewTopics);
    const topicList = batchTopics.map((t, i) => `${i + 1}. ${t}`).join('\n');

    const prompt = `You are a Hungarian language exam question generator for a simplified naturalization interview. Generate exactly ${batchCount} interview-style questions for a CEFR ${level} Hungarian language exam.

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

ALSO: Extract ALL individual vocabulary words from every Hungarian sentence (questions AND responses). For each word, give the dictionary form (lemma) and English translation. Include every meaningful word (nouns, verbs, adjectives, adverbs, pronouns, prepositions, question words). Use dictionary/base forms. Skip articles (a, az, egy) by themselves. Include common phrases that are better learned as a unit.

Return ONLY a valid JSON object with this exact structure:
{
  "questions": [
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
  ],
  "vocabulary": [
    {"hu": "hív", "en": "to call"},
    {"hu": "hogy", "en": "how"}
  ]
}`;

    const text = await callGemini(prompt, 0.9);

    // Parse and return
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const objMatch = text.match(/\{[\s\S]*\}/);
      if (objMatch) {
        parsed = JSON.parse(objMatch[0]);
      } else {
        const arrMatch = text.match(/\[[\s\S]*\]/);
        if (arrMatch) {
          parsed = { questions: JSON.parse(arrMatch[0]), vocabulary: [] };
        } else {
          throw new Error('Unparseable response');
        }
      }
    }

    if (Array.isArray(parsed)) {
      parsed = { questions: parsed, vocabulary: [] };
    }

    res.json({
      questions: parsed.questions || [],
      vocabulary: parsed.vocabulary || [],
    });
  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/extract-vocab', requireAuth, express.json(), async (req, res) => {
  try {
    const { sentences } = req.body;
    if (!sentences?.length) return res.status(400).json({ error: 'No sentences' });

    const prompt = `Extract individual vocabulary words from these Hungarian sentences. For each word, provide the dictionary form (lemma) and English translation.

Sentences:
${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return ONLY a valid JSON array: [{"hu": "word", "en": "translation"}, ...]`;

    const text = await callGemini(prompt, 0.3);
    let words;
    try {
      words = JSON.parse(text);
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      words = match ? JSON.parse(match[0]) : [];
    }

    res.json(words);
  } catch (err) {
    console.error('Extract vocab error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Curriculum info ──

router.get('/api/curriculum', (req, res) => {
  res.json({ levels: LEVELS, topics: TOPICS, questionsPerLevel: QUESTIONS_PER_LEVEL });
});

// ── Helpers ──

function buildPersonalContext(essay, topics) {
  let ctx = '';
  if (essay?.trim()) {
    ctx += `\nThe student wrote this about themselves (use this to personalize questions):\n"${essay.trim()}"\n`;
  }
  if (topics?.length) {
    ctx += `\nInterview topics to include:\n${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n`;
  }
  return ctx;
}

module.exports = router;
