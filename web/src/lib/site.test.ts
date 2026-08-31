import { describe, expect, it, vi } from 'vite-plus/test';
import { resolveAPIOrigin } from './site';
import { api, setTokens } from './api';

describe('API 来源', () => {
  it('未配置时保留浏览器协议、域名和端口', () => {
    expect(resolveAPIOrigin('', 'https://music.example.test:8443')).toBe('https://music.example.test:8443');
    expect(resolveAPIOrigin('  ', 'http://localhost:5173')).toBe('http://localhost:5173');
    expect(resolveAPIOrigin('https://API.example.test:8443/', 'https://music.example.test')).toBe(
      'https://api.example.test:8443',
    );
  });
  it('拒绝凭据、路径、脚本和混合内容', () => {
    for (const value of [
      'javascript:alert(1)',
      '//api.example.test',
      'https://a:b@api.example.test',
      'https://api.example.test/api',
      'https://api.example.test/?key=x',
      'https://api.example.test/#x',
      'http://api.example.test',
      'http://localhost:9111',
    ]) {
      expect(() => resolveAPIOrigin(value, 'https://music.example.test')).toThrow();
    }
  });
  it('试搜与媒体使用 API 来源，不泄漏登录令牌、Cookie 或跟随重定向', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [], total: 0 })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: '1',
              audios: [
                { id: 'a', url: '/api/v1/media/audio/1?token=signed' },
                { id: 'b', url: 'https://cdn.example.test/audio?signature=signed' },
              ],
            },
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    setTokens('private-jwt', 'private-refresh');
    await api.open.search('https://api.example.test', 'omb_public', '测试');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('https://api.example.test/api/open/v1/search?');
    expect(init).toEqual({
      headers: { 'X-API-Key': 'omb_public' },
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    const track = await api.open.getTrack('https://api.example.test', 'omb_public', '1');
    expect(track.audios?.map((audio) => audio.url)).toEqual([
      'https://api.example.test/api/v1/media/audio/1?token=signed',
      'https://cdn.example.test/audio?signature=signed',
    ]);
  });
});
