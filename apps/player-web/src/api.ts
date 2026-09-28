import { API_URL } from './config';

export interface User {
  id: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
}

export function getToken(): string | null {
  return localStorage.getItem('fc_token');
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem('fc_user');
  return raw ? (JSON.parse(raw) as User) : null;
}

export function storeSession(token: string, user: User) {
  localStorage.setItem('fc_token', token);
  localStorage.setItem('fc_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('fc_token');
  localStorage.removeItem('fc_user');
}

export async function request(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${getToken() ?? ''}`,
      ...(options.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

const get = (path: string) => request(path);

export const fetchMyGames = () => get('/api/users/me/games');
export const fetchLeaderboard = () => get('/api/leaderboard');
export const fetchRtcConfig = () => get('/api/rtc/config');

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function signup(email: string, username: string, password: string) {
  return post('/api/auth/signup', { email, username, password });
}

export function login(identifier: string, password: string) {
  return post('/api/auth/login', { identifier, password });
}

export function forgotPassword(identifier: string) {
  return post('/api/auth/forgot', { identifier });
}

export function resetPassword(token: string, password: string) {
  return post('/api/auth/reset', { token, password });
}

export function resetWithCode(identifier: string, code: string, password: string) {
  return post('/api/auth/reset', { identifier, code, password });
}

export function changePassword(oldPassword: string, newPassword: string) {
  return request('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}
