import { it, expect, vi } from 'vitest';
import { api, setTokens, clearTokens, getAccessToken } from './api';
it('退出后丢弃仍在返回的刷新结果', async () => {
  setTokens('old-access', 'old-refresh');
  let resolveRefresh!: (r: Response) => void;
  const mock = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolveRefresh = r;
        }),
    );
  vi.stubGlobal('fetch', mock);
  const request = api.auth.me().catch(() => null);
  await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
  clearTokens();
  resolveRefresh(
    new Response(
      JSON.stringify({
        data: { accessToken: 'new-access', refreshToken: 'new-refresh' },
      }),
      { status: 200 },
    ),
  );
  await request;
  expect(getAccessToken()).toBeNull();
  expect(mock).toHaveBeenCalledTimes(2);
});
it('重复上传从统一响应中提取曲目', async () => {
  const track = { id: '123', title: 'existing', artists: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { deduplicated: true, track } }))),
  );
  expect(await api.admin.audio.upload(new File(['x'], 'a.wav'), {})).toEqual(track);
});
it('非 JSON 错误响应保留友好提示', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 })));
  await expect(api.auth.me()).rejects.toThrow('服务返回了无效响应');
});
