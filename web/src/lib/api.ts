/** 与后端通信的 API 客户端：JWT 令牌管理、自动刷新、统一错误处理。 */

const ACCESS_KEY = 'ommb.access';
const REFRESH_KEY = 'ommb.refresh';

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}
export function setTokens(access: string, refresh?: string) {
  localStorage.setItem(ACCESS_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

/** 业务错误：携带 HTTP 状态与机器可读 code。 */
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseResponse(res: Response): Promise<any> {
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const e = json?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? res.statusText);
  }
  return json;
}

let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  const rt = localStorage.getItem(REFRESH_KEY);
  if (!rt) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (!res.ok) return false;
        const json = await res.json();
        setTokens(json.data.accessToken, json.data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

async function request(path: string, init: RequestInit = {}, auth = false): Promise<any> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (auth) {
    const t = getAccessToken();
    if (t) headers.set('Authorization', `Bearer ${t}`);
  }
  let res = await fetch(path, { ...init, headers });
  if (res.status === 401 && auth && (await tryRefresh())) {
    const t = getAccessToken();
    if (t) headers.set('Authorization', `Bearer ${t}`);
    res = await fetch(path, { ...init, headers });
  }
  return parseResponse(res);
}

async function openRequest(apiKey: string, path: string): Promise<any> {
  const res = await fetch(path, { headers: { 'X-API-Key': apiKey } });
  return parseResponse(res);
}

const qs = (params: Record<string, string | number | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

// ===== 类型 =====
export interface User {
  id: string;
  username: string;
  email: string;
  role: string;
}
export interface AdminUser extends User {
  isActive: boolean;
  createdAt: string;
}
export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  description: string;
  rpmOverride: number | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  isRevoked: boolean;
  createdAt: string;
}
export interface AdminApiKey extends ApiKey {
  userId: string;
  username: string;
}
export interface ArtistDTO {
  id: string;
  name: string;
}
export interface ArtistListItem {
  id: string;
  name: string;
  avatarUrl?: string;
  trackCount: number;
}
export interface ArtistDetail {
  id: string;
  name: string;
  avatarKey?: string;
  avatarUrl?: string;
  aliases: { id: string; alias: string }[];
  albums: AlbumDTO[];
  trackCount: number;
}
export interface AlbumDTO {
  id: string;
  title: string;
  coverUrl?: string;
}
export interface AlbumListItem {
  id: string;
  title: string;
  coverUrl?: string;
  trackCount: number;
}
export interface AlbumDetail {
  id: string;
  title: string;
  coverKey?: string;
  coverUrl?: string;
  artists: ArtistDTO[];
  tracks: { id: string; title: string; duration: number }[];
}
export interface Language {
  id: number;
  name: string;
}
export interface AudioDTO {
  id: string;
  qualityLabel: string;
  format: string;
  bitrate: number;
  samplingRate: number;
  bitDepth: number;
  channelCount: number;
  duration: number;
  size: number;
  loudness?: number | null;
  url: string;
}
export interface OriginDTO {
  id: string;
  fileKey: string;
  hash: string;
  format: string;
  encoder: string;
  status: string;
  size: number;
  duration: number;
  bitrate: number;
  url: string;
  createdAt: string;
}
export interface TrackDTO {
  id: string;
  title: string;
  duration: number;
  available: boolean;
  coverUrl?: string;
  liveId?: string;
  aliases: string[];
  artists: ArtistDTO[];
  albums?: AlbumDTO[];
  languages?: Language[];
  lyric?: string;
  lrcLyric?: string;
  audios?: AudioDTO[];
  origins?: OriginDTO[];
  aliasRows?: { id: string; alias: string }[];
}
export interface LogEntry {
  id: string;
  createdAt: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  clientIp: string;
  apiKeyId: string | null;
  userId: string | null;
  username: string;
  keyName: string;
}
export interface StatsOverview {
  users: number;
  tracks: number;
  artists: number;
  albums: number;
  audios: number;
  originAudios: number;
  apiKeys: number;
  totalRequests: number;
  requestsToday: number;
  newUsersToday: number;
}
export interface TimeseriesPoint {
  date: string;
  requests: number;
  registrations: number;
}
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface BiliFolder {
  id: number;
  title: string;
  mediaCount: number;
}
export interface BiliMedia {
  bvid: string;
  title: string;
  cover: string;
  duration: number;
  pages: number;
  upName: string;
}
export interface BiliPage {
  cid: number;
  page: number;
  part: string;
  duration: number;
}
export interface BiliVideoInfo {
  aid: number;
  bvid: string;
  title: string;
  cover: string;
  owner: string;
  pages: BiliPage[];
}
export interface RecognizeCandidate {
  title: string;
  artist: string;
  source: string;
  songId?: string;
}
export interface MetaSong {
  id: string;
  title: string;
  artists: string[];
  album: string;
  coverUrl?: string;
  durationMs: number;
  lyric?: string;
  lrc?: string;
}
export interface IntegrationsConfig {
  bilibiliCookieSet: boolean;
  xfyunAppId: string;
  xfyunApiKeySet: boolean;
}

// ===== 接口集合 =====
export const api = {
  site: (): Promise<{ brandName: string; registrationEnabled: boolean }> =>
    request('/api/v1/site').then((r) => r.data),

  auth: {
    register: (b: { username: string; email: string; password: string }) =>
      request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(b) }).then((r) => r.data),
    login: (b: { email: string; password: string }) =>
      request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(b) }).then((r) => r.data),
    me: (): Promise<User> => request('/api/v1/auth/me', {}, true).then((r) => r.data),
  },

  apiKeys: {
    list: (): Promise<Paginated<ApiKey>> => request('/api/v1/api-keys?pageSize=100', {}, true),
    create: (b: { name: string; description?: string }): Promise<{ apiKey: ApiKey; key: string }> =>
      request('/api/v1/api-keys', { method: 'POST', body: JSON.stringify(b) }, true).then((r) => r.data),
    revoke: (id: string) => request(`/api/v1/api-keys/${id}/revoke`, { method: 'POST' }, true),
    remove: (id: string) => request(`/api/v1/api-keys/${id}`, { method: 'DELETE' }, true),
  },

  admin: {
    stats: {
      overview: (): Promise<StatsOverview> => request('/api/v1/admin/stats/overview', {}, true).then((r) => r.data),
      timeseries: (days = 30): Promise<TimeseriesPoint[]> =>
        request(`/api/v1/admin/stats/timeseries?days=${days}`, {}, true).then((r) => r.data),
    },
    logs: {
      list: (p: { page?: number; apiKeyId?: string; userId?: string; statusCode?: number } = {}): Promise<Paginated<LogEntry>> =>
        request(`/api/v1/admin/logs${qs({ pageSize: 30, ...p })}`, {}, true),
    },
    users: {
      list: (): Promise<Paginated<AdminUser>> => request('/api/v1/admin/users?pageSize=100', {}, true),
      setRole: (id: string, role: string) =>
        request(`/api/v1/admin/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }, true),
      toggleActive: (id: string, isActive: boolean) =>
        request(`/api/v1/admin/users/${id}/active`, { method: 'PUT', body: JSON.stringify({ isActive }) }, true),
      remove: (id: string) => request(`/api/v1/admin/users/${id}`, { method: 'DELETE' }, true),
    },
    apiKeys: {
      list: (q = ''): Promise<Paginated<AdminApiKey>> => request(`/api/v1/admin/api-keys${qs({ q, pageSize: 50 })}`, {}, true),
      update: (id: string, b: Record<string, unknown>) =>
        request(`/api/v1/admin/api-keys/${id}`, { method: 'PUT', body: JSON.stringify(b) }, true),
      remove: (id: string) => request(`/api/v1/admin/api-keys/${id}`, { method: 'DELETE' }, true),
    },
    tracks: {
      list: (q = ''): Promise<Paginated<TrackDTO>> => request(`/api/v1/admin/tracks${qs({ q, pageSize: 50 })}`, {}, true),
      detail: (id: string): Promise<TrackDTO> => request(`/api/v1/admin/tracks/${id}`, {}, true).then((r) => r.data),
      update: (id: string, b: Record<string, unknown>) =>
        request(`/api/v1/admin/tracks/${id}`, { method: 'PUT', body: JSON.stringify(b) }, true),
      remove: (id: string) => request(`/api/v1/admin/tracks/${id}`, { method: 'DELETE' }, true),
      addAlias: (id: string, alias: string) =>
        request(`/api/v1/admin/tracks/${id}/aliases`, { method: 'POST', body: JSON.stringify({ alias }) }, true),
      deleteAlias: (id: string, aliasId: string) =>
        request(`/api/v1/admin/tracks/${id}/aliases/${aliasId}`, { method: 'DELETE' }, true),
      setArtists: (id: string, artistIds: string[]) =>
        request(`/api/v1/admin/tracks/${id}/artists`, { method: 'PUT', body: JSON.stringify({ artistIds }) }, true),
      setAlbums: (id: string, albumIds: string[]) =>
        request(`/api/v1/admin/tracks/${id}/albums`, { method: 'PUT', body: JSON.stringify({ albumIds }) }, true),
      setLanguages: (id: string, languageIds: number[]) =>
        request(`/api/v1/admin/tracks/${id}/languages`, { method: 'PUT', body: JSON.stringify({ languageIds }) }, true),
    },
    artists: {
      list: (q = ''): Promise<Paginated<ArtistListItem>> => request(`/api/v1/admin/artists${qs({ q, pageSize: 50 })}`, {}, true),
      detail: (id: string): Promise<ArtistDetail> => request(`/api/v1/admin/artists/${id}`, {}, true).then((r) => r.data),
      create: (name: string): Promise<{ id: string; name: string }> =>
        request('/api/v1/admin/artists', { method: 'POST', body: JSON.stringify({ name }) }, true).then((r) => r.data),
      update: (id: string, b: { name?: string; avatarKey?: string }) =>
        request(`/api/v1/admin/artists/${id}`, { method: 'PUT', body: JSON.stringify(b) }, true),
      remove: (id: string) => request(`/api/v1/admin/artists/${id}`, { method: 'DELETE' }, true),
      addAlias: (id: string, alias: string) =>
        request(`/api/v1/admin/artists/${id}/aliases`, { method: 'POST', body: JSON.stringify({ alias }) }, true),
      deleteAlias: (id: string, aliasId: string) =>
        request(`/api/v1/admin/artists/${id}/aliases/${aliasId}`, { method: 'DELETE' }, true),
    },
    albums: {
      list: (q = ''): Promise<Paginated<AlbumListItem>> => request(`/api/v1/admin/albums${qs({ q, pageSize: 50 })}`, {}, true),
      detail: (id: string): Promise<AlbumDetail> => request(`/api/v1/admin/albums/${id}`, {}, true).then((r) => r.data),
      create: (title: string): Promise<{ id: string; title: string }> =>
        request('/api/v1/admin/albums', { method: 'POST', body: JSON.stringify({ title }) }, true).then((r) => r.data),
      update: (id: string, b: { title?: string; coverKey?: string }) =>
        request(`/api/v1/admin/albums/${id}`, { method: 'PUT', body: JSON.stringify(b) }, true),
      remove: (id: string) => request(`/api/v1/admin/albums/${id}`, { method: 'DELETE' }, true),
      setArtists: (id: string, artistIds: string[]) =>
        request(`/api/v1/admin/albums/${id}/artists`, { method: 'PUT', body: JSON.stringify({ artistIds }) }, true),
    },
    languages: {
      list: (): Promise<Language[]> => request('/api/v1/admin/languages', {}, true).then((r) => r.data),
      create: (name: string) => request('/api/v1/admin/languages', { method: 'POST', body: JSON.stringify({ name }) }, true),
      remove: (id: number) => request(`/api/v1/admin/languages/${id}`, { method: 'DELETE' }, true),
    },
    audio: {
      upload: (file: File, fields: { title?: string; artist?: string }): Promise<TrackDTO> => {
        const fd = new FormData();
        fd.append('file', file);
        if (fields.title) fd.append('title', fields.title);
        if (fields.artist) fd.append('artist', fields.artist);
        return request('/api/v1/admin/audio/upload', { method: 'POST', body: fd }, true).then((r) => r.data);
      },
      remove: (id: string) => request(`/api/v1/admin/audio/${id}`, { method: 'DELETE' }, true),
    },
    site: {
      get: (): Promise<{ brandName: string; registrationEnabled: boolean }> =>
        request('/api/v1/admin/site/settings', {}, true).then((r) => r.data),
      update: (b: { brandName?: string; registrationEnabled?: boolean }) =>
        request('/api/v1/admin/site/settings', { method: 'PUT', body: JSON.stringify(b) }, true),
    },
    integrations: {
      get: (): Promise<IntegrationsConfig> => request('/api/v1/admin/integrations', {}, true).then((r) => r.data),
      update: (b: { bilibiliCookie?: string; xfyunAppId?: string; xfyunApiKey?: string }) =>
        request('/api/v1/admin/integrations', { method: 'PUT', body: JSON.stringify(b) }, true),
    },
    metadata: {
      search: (q: string): Promise<MetaSong[]> =>
        request(`/api/v1/admin/metadata/search?q=${encodeURIComponent(q)}`, {}, true).then((r) => r.data),
      song: (id: string): Promise<MetaSong> => request(`/api/v1/admin/metadata/song/${id}`, {}, true).then((r) => r.data),
      enrich: (trackId: string, b: Record<string, unknown>): Promise<TrackDTO> =>
        request(`/api/v1/admin/tracks/${trackId}/enrich`, { method: 'POST', body: JSON.stringify(b) }, true).then((r) => r.data),
    },
    bilibili: {
      status: (): Promise<{ configured: boolean }> => request('/api/v1/admin/bilibili/status', {}, true).then((r) => r.data),
      favorites: (): Promise<BiliFolder[]> => request('/api/v1/admin/bilibili/favorites', {}, true).then((r) => r.data),
      favoriteItems: (mediaId: number, pn = 1): Promise<{ items: BiliMedia[]; hasMore: boolean }> =>
        request(`/api/v1/admin/bilibili/favorites/${mediaId}?pn=${pn}`, {}, true).then((r) => r.data),
      resolve: (bvid: string): Promise<BiliVideoInfo> =>
        request(`/api/v1/admin/bilibili/resolve?bvid=${encodeURIComponent(bvid)}`, {}, true).then((r) => r.data),
      streamUrl: (bvid: string, cid: number): string =>
        `/api/v1/admin/bilibili/stream?bvid=${encodeURIComponent(bvid)}&cid=${cid}&token=${encodeURIComponent(getAccessToken() ?? '')}`,
      ingest: (b: { bvid: string; cid: number; startSec?: number; endSec?: number; title?: string; artist?: string }): Promise<any> =>
        request('/api/v1/admin/bilibili/ingest', { method: 'POST', body: JSON.stringify(b) }, true).then((r) => r.data),
      recognize: (b: { bvid: string; cid: number; startSec?: number; endSec?: number; provider: string }): Promise<RecognizeCandidate[]> =>
        request('/api/v1/admin/bilibili/recognize', { method: 'POST', body: JSON.stringify(b) }, true).then((r) => r.data),
    },
  },

  open: {
    search: (apiKey: string, q: string, page = 1): Promise<Paginated<TrackDTO>> =>
      openRequest(apiKey, `/api/open/v1/search?q=${encodeURIComponent(q)}&page=${page}&pageSize=20`),
    getTrack: (apiKey: string, id: string): Promise<TrackDTO> =>
      openRequest(apiKey, `/api/open/v1/tracks/${id}`).then((r) => r.data),
  },
};
