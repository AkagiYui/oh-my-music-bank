import { useSyncExternalStore } from 'react';
import { api, clearTokens, getAccessToken, setTokens, type User } from '../lib/api';
import { queryClient } from '../lib/query-client';

type AuthState = { user: User | null; ready: boolean };
let state: AuthState = { user: null, ready: false };
let sessionGeneration = 0;
const listeners = new Set<() => void>();
function update(next: AuthState) {
  state = next;
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// 使用不可变快照订阅登录态，避免 React 重渲染时丢失全局会话。
export function useAuth() {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  return { ...snapshot, isAuthenticated: snapshot.user !== null, isAdmin: snapshot.user?.role === 'admin' };
}

export async function loadSession() {
  const generation = ++sessionGeneration;
  if (!getAccessToken()) {
    update({ user: null, ready: true });
    return;
  }
  try {
    const user = await api.auth.me();
    if (generation === sessionGeneration) update({ user, ready: true });
  } catch {
    if (generation === sessionGeneration) update({ user: null, ready: true });
  }
}

export async function login(email: string, password: string): Promise<User> {
  const generation = ++sessionGeneration;
  const res = await api.auth.login({ email, password });
  if (generation === sessionGeneration) {
    queryClient.clear();
    setTokens(res.accessToken, res.refreshToken);
    update({ user: res.user, ready: true });
  }
  return res.user;
}

export async function register(username: string, email: string, password: string): Promise<User> {
  const generation = ++sessionGeneration;
  const res = await api.auth.register({ username, email, password });
  if (generation === sessionGeneration) {
    queryClient.clear();
    setTokens(res.accessToken, res.refreshToken);
    update({ user: res.user, ready: true });
  }
  return res.user;
}

export async function logout() {
  const generation = ++sessionGeneration;
  try {
    await api.auth.logout();
  } finally {
    if (generation === sessionGeneration) {
      clearTokens();
      queryClient.clear();
      localStorage.removeItem('ommb.tryKey');
      update({ user: null, ready: true });
    }
  }
}
window.addEventListener('ommb:session-expired', () => {
  ++sessionGeneration;
  clearTokens();
  queryClient.clear();
  update({ user: null, ready: true });
});
