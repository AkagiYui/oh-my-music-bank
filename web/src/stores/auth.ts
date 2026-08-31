/** 登录态全局 store。 */
import { createSignal } from 'solid-js';
import { api, clearTokens, getAccessToken, setTokens, type User } from '../lib/api';

const [user, setUser] = createSignal<User | null>(null);
const [ready, setReady] = createSignal(false);

export { user, ready };
export const isAuthenticated = () => user() !== null;
export const isAdmin = () => user()?.role === 'admin';

/** 启动时从本地令牌恢复用户信息。 */
export function loadSession() {
  if (!getAccessToken()) {
    setReady(true);
    return;
  }
  api.auth
    .me()
    .then((u) => setUser(u))
    .catch(() => {
      setUser(null);
    })
    .finally(() => setReady(true));
}

export async function login(email: string, password: string): Promise<User> {
  const res = await api.auth.login({ email, password });
  setTokens(res.accessToken, res.refreshToken);
  setUser(res.user);
  return res.user;
}

export async function register(username: string, email: string, password: string): Promise<User> {
  const res = await api.auth.register({ username, email, password });
  setTokens(res.accessToken, res.refreshToken);
  setUser(res.user);
  return res.user;
}

export async function logout() {
  await api.auth.logout();
  clearTokens();
  localStorage.removeItem('ommb.tryKey');
  setUser(null);
}
window.addEventListener('ommb:session-expired', () => {
  clearTokens();
  setUser(null);
});
