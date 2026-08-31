import { act, render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { api, getAccessToken, setTokens } from '../lib/api';
import { queryClient } from '../lib/query-client';
import { loadSession, login, logout, useAuth } from './auth';
const oldUser = { id: 'old', username: '旧用户', email: 'old@example.test', role: 'user' };
const newUser = { id: 'new', username: '新用户', email: 'new@example.test', role: 'admin' };
function Session() {
  const { user } = useAuth();
  return <p>{user?.username ?? '未登录'}</p>;
}
beforeEach(() => {
  window.dispatchEvent(new Event('ommb:session-expired'));
});
it('旧会话恢复晚到不会覆盖新账号，身份变化清理查询缓存', async () => {
  let resolve!: (user: typeof oldUser) => void;
  vi.spyOn(api.auth, 'me').mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  vi.spyOn(api.auth, 'login').mockResolvedValue({
    user: newUser,
    accessToken: 'new-token',
    refreshToken: 'new-refresh',
  });
  setTokens('old-token');
  const screen = render(<Session />);
  const restoration = loadSession();
  queryClient.setQueryData(['private-data'], { secret: 'old' });
  await act(() => login('new@example.test', 'test-password'));
  expect(queryClient.getQueryData(['private-data'])).toBeUndefined();
  await act(async () => {
    resolve(oldUser);
    await restoration;
  });
  expect(screen.getByText('新用户')).toBeTruthy();
});
it('旧退出请求晚到不会清空随后建立的新会话', async () => {
  let resolve!: (value: object) => void;
  vi.spyOn(api.auth, 'logout').mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  vi.spyOn(api.auth, 'login').mockResolvedValue({
    user: newUser,
    accessToken: 'new-token',
    refreshToken: 'new-refresh',
  });
  const screen = render(<Session />);
  const pendingLogout = logout();
  await act(() => login('new@example.test', 'test-password'));
  await act(async () => {
    resolve({});
    await pendingLogout;
  });
  expect(screen.getByText('新用户')).toBeTruthy();
  expect(getAccessToken()).toBe('new-token');
});
