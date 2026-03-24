const TOKEN_KEY = 'magyar_kerdezo_session';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function login(password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Login failed');
  }

  const { token } = await res.json();
  setToken(token);
  return token;
}

export async function checkAuth() {
  const token = getToken();
  if (!token) return false;

  try {
    const res = await fetch('/api/auth', {
      headers: { 'X-Session-Token': token },
    });
    const data = await res.json();
    return data.authenticated;
  } catch {
    return false;
  }
}

export async function logout() {
  const token = getToken();
  if (token) {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'X-Session-Token': token },
      });
    } catch { /* ignore */ }
  }
  clearToken();
}

export function authHeaders() {
  const token = getToken();
  return token ? { 'X-Session-Token': token } : {};
}
