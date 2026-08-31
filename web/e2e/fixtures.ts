import { expect, type Page } from '@playwright/test';
import type { TrackDTO } from '../src/lib/api';

const user = {
  id: 'user-1',
  username: '测试管理员',
  email: 'admin@example.test',
  role: 'admin',
  isActive: true,
  createdAt: '2026-08-31T00:00:00Z',
};
export const track: TrackDTO = {
  id: '9007199254740993',
  title: '测试曲目',
  duration: 120,
  available: true,
  aliases: ['别名'],
  aliasRows: [],
  artists: [{ id: '9007199254740994', name: '测试艺术家' }],
  albums: [{ id: 'album-1', title: '测试专辑' }],
  languages: [{ id: 1, name: '中文' }],
  lyric: '测试歌词',
  lrcLyric: '',
  audios: [
    {
      id: 'audio-1',
      qualityLabel: 'standard',
      format: 'wav',
      bitrate: 128000,
      samplingRate: 44100,
      bitDepth: 16,
      channelCount: 2,
      duration: 120,
      size: 1024,
      url: '/test-audio.wav',
    },
  ],
  origins: [],
};
const key = {
  id: 'key-1',
  name: '测试 Key',
  keyPrefix: 'omb_test',
  isRevoked: false,
  rpmOverride: null,
  username: user.username,
  userId: user.id,
  createdAt: user.createdAt,
};
const job = {
  id: 'job-1',
  kind: 'upload',
  status: 'failed',
  stage: '失败',
  progress: 30,
  attempts: 1,
  errorMessage: '测试错误',
  createdAt: user.createdAt,
  cancelRequested: false,
};

export async function mockApp(page: Page, loggedIn = true) {
  const errors: string[] = [];
  const requests: { path: string; method: string; body: Record<string, unknown>; params: URLSearchParams }[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
  });
  await page.addInitScript((logged) => {
    if (logged) {
      localStorage.setItem('ommb.access', 'test-access');
      localStorage.setItem('ommb.refresh', 'test-refresh');
    }
  }, loggedIn);
  await page.route('**/test-audio*.wav', async (route) => {
    const audio = Buffer.alloc(44 + 16000);
    audio.write('RIFF', 0);
    audio.writeUInt32LE(audio.length - 8, 4);
    audio.write('WAVEfmt ', 8);
    audio.writeUInt32LE(16, 16);
    audio.writeUInt16LE(1, 20);
    audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(8000, 24);
    audio.writeUInt32LE(16000, 28);
    audio.writeUInt16LE(2, 32);
    audio.writeUInt16LE(16, 34);
    audio.write('data', 36);
    audio.writeUInt32LE(16000, 40);
    await route.fulfill({ contentType: 'audio/wav', body: audio });
  });
  await page.route('**/test-cover.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#6366f1"/></svg>',
    }),
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    let body: Record<string, unknown> = {};
    try {
      body = request.postDataJSON() ?? {};
    } catch {
      /* 上传请求使用 multipart。 */
    }
    requests.push({ path, method, body, params: url.searchParams });
    const paged = (data: unknown[]) => ({
      data,
      total: 101,
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 20),
    });
    let response: unknown = { data: {} };
    if (path.endsWith('/auth/login') || path.endsWith('/auth/register'))
      response = { data: { user, accessToken: 'test-access', refreshToken: 'test-refresh' } };
    else if (path.endsWith('/auth/me')) response = { data: user };
    else if (path.endsWith('/site') || path.endsWith('/site/settings'))
      response = { data: { brandName: 'Music Bank', registrationEnabled: true, logRetentionDays: '0' } };
    else if (path.endsWith('/stats/overview'))
      response = {
        data: {
          users: 2,
          tracks: 3,
          artists: 1,
          albums: 1,
          audios: 4,
          originAudios: 4,
          apiKeys: 1,
          totalRequests: 5,
          requestsToday: 2,
          newUsersToday: 1,
        },
      };
    else if (path.endsWith('/stats/timeseries'))
      response = { data: [{ date: '2026-08-31', requests: 5, registrations: 2 }] };
    else if (path.endsWith('/bilibili/status')) response = { data: { configured: true } };
    else if (path.endsWith('/bilibili/favorites')) response = { data: [{ id: 1, title: '测试收藏夹', mediaCount: 2 }] };
    else if (path.endsWith('/bilibili/favorites/1'))
      response = {
        data: {
          items: [
            { bvid: 'BVtest', title: '测试视频', cover: '/test-cover.svg', duration: 120, pages: 2, upName: '测试 UP' },
          ],
          hasMore: true,
        },
      };
    else if (path.endsWith('/bilibili/resolve'))
      response = {
        data: {
          aid: 1,
          bvid: url.searchParams.get('bvid'),
          title: '测试视频',
          cover: '/test-cover.svg',
          owner: '测试 UP',
          pages: [
            { cid: 1, page: 1, part: '第一段', duration: 120 },
            { cid: 2, page: 2, part: '第二段', duration: 180 },
          ],
        },
      };
    else if (path.endsWith('/bilibili/media-token')) response = { data: { url: `/test-audio-${body.cid}.wav` } };
    else if (path.endsWith('/bilibili/recognize'))
      response = { data: [{ title: '识别曲目', artist: '识别艺术家', source: 'xfyun' }] };
    else if (path.endsWith('/integrations'))
      response = { data: { bilibiliCookieSet: true, xfyunApiKeySet: true, xfyunAppId: 'test-app' } };
    else if (path.endsWith('/integrations/test')) response = { data: { message: '连接成功' } };
    else if (path.endsWith('/metadata/search'))
      response = {
        data: [{ id: 'meta-1', title: '匹配曲目', artists: ['艺术家'], album: '专辑', durationMs: 120000 }],
      };
    else if (path.endsWith('/jobs/upload')) response = { data: job };
    else if (path.endsWith('/jobs/bilibili')) response = { data: [job] };
    else if (path.endsWith('/jobs')) response = paged([job]);
    else if (path.endsWith('/tracks') || path.endsWith('/search'))
      response = paged([{ ...track, title: url.searchParams.get('page') === '2' ? '第二页曲目' : track.title }]);
    else if (path.endsWith(`/tracks/${track.id}`)) response = { data: track };
    else if (path.endsWith('/artists'))
      response =
        method === 'POST'
          ? { data: { id: 'artist-new', name: body.name } }
          : paged([{ id: '9007199254740994', name: '测试艺术家', trackCount: 1 }]);
    else if (path.endsWith('/artists/9007199254740994'))
      response = {
        data: {
          id: '9007199254740994',
          name: '测试艺术家',
          aliases: [{ id: 'alias-1', alias: '艺名' }],
          albums: [],
          trackCount: 1,
        },
      };
    else if (path.endsWith('/albums')) response = paged([{ id: 'album-1', title: '测试专辑', trackCount: 1 }]);
    else if (path.endsWith('/albums/album-1'))
      response = {
        data: {
          id: 'album-1',
          title: '测试专辑',
          artists: track.artists,
          tracks: [{ id: track.id, title: track.title, duration: 120, trackNo: 1, discNo: 1 }],
        },
      };
    else if (path.endsWith('/languages')) response = { data: [{ id: 1, name: '中文' }] };
    else if (path.endsWith('/api-keys'))
      response = method === 'POST' ? { data: { apiKey: key, key: 'omb_created_once' } } : paged([key]);
    else if (path.endsWith('/users')) response = paged([user]);
    else if (path.endsWith('/logs'))
      response = paged([
        {
          id: 'log-1',
          createdAt: user.createdAt,
          path: '/api/open/v1/search',
          statusCode: 200,
          latencyMs: 12,
          clientIp: '127.0.0.1',
          username: user.username,
          keyName: key.name,
        },
      ]);
    await route.fulfill({ json: response });
  });
  return { requests, assertNoErrors: () => expect(errors).toEqual([]) };
}
