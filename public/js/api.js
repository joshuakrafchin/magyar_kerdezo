// Server API client — all calls go through our server (no direct Gemini)

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (res.status === 401) {
    // Not authenticated — redirect to login
    window.location.href = '/auth/login';
    throw new Error('Not authenticated');
  }

  return res;
}

// ── Auth ──

export async function getMe() {
  const res = await apiFetch('/auth/me');
  if (!res.ok) return null;
  return res.json();
}

export async function logout() {
  await apiFetch('/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

// ── State sync ──

export async function loadState() {
  const res = await apiFetch('/api/state');
  if (!res.ok) throw new Error('Failed to load state');
  return res.json();
}

export async function saveState(state) {
  const res = await apiFetch('/api/state', {
    method: 'PUT',
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error('Failed to save state');
}

// ── Question generation ──

export async function generateBatch(level, aboutMeEssay, interviewTopics, batchTopics, batchCount) {
  const res = await apiFetch('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ level, aboutMeEssay, interviewTopics, batchTopics, batchCount }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Generation failed' }));
    throw new Error(err.error || 'Generation failed');
  }

  return res.json();
}

// ── Vocabulary ──

export async function extractVocabulary(sentences) {
  const res = await apiFetch('/api/extract-vocab', {
    method: 'POST',
    body: JSON.stringify({ sentences }),
  });

  if (!res.ok) throw new Error('Vocab extraction failed');
  return res.json();
}

// ── Invitations ──

export async function getInvitations() {
  const res = await apiFetch('/api/invitations');
  if (!res.ok) throw new Error('Failed to load invitations');
  return res.json();
}

export async function inviteUser(email) {
  const res = await apiFetch('/api/invitations', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Invite failed');
  return data;
}
