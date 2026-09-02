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
  it('搜索和播放签名使用 API 来源，不泄漏登录令牌、Cookie 或跟随重定向', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [], total: 0 })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: '1',
              audios: [{ id: '11111111-1111-7111-8111-111111111111' }],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { url: 'https://s3.example.test/audio?signature=signed', expiresAt: '2030-01-01' } }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    setTokens('private-jwt', 'private-refresh');
    await api.open.search('https://api.example.test', 'omb_public', '测试');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('https://api.example.test/api/open/v1/search?');
    expect(new Headers(init.headers).get('X-API-Key')).toBe('omb_public');
    expect(init).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    const track = await api.open.getTrack('https://api.example.test', 'omb_public', '1');
    expect(track.audios).toEqual([{ id: '11111111-1111-7111-8111-111111111111' }]);
    const signed = await api.open.playbackURL(
      'https://api.example.test',
      'omb_public',
      '11111111-1111-7111-8111-111111111111',
    );
    expect(signed.url).toContain('signature=signed');
    const [playbackURL, playbackInit] = fetch.mock.calls[2];
    expect(playbackURL).toBe(
      'https://api.example.test/api/open/v1/audios/11111111-1111-7111-8111-111111111111/playback-url',
    );
    expect(playbackInit.method).toBe('POST');
    expect(playbackInit.credentials).toBe('omit');
    expect(new Headers(playbackInit.headers).has('Authorization')).toBe(false);
  });
});
