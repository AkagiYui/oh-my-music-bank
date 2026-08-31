import { queryOptions } from '@tanstack/react-query';
import { api } from './api';

/** 公开 DTO 与管理 DTO 分开，公开缓存中不得混入管理设置。 */
export interface SiteConfig {
  systemTitle: string;
  siteDescription: string;
  homeTitle: string;
  homeDescription: string;
  logoUrl: string;
  faviconUrl: string;
  footerText: string;
  footerLinkUrl: string;
  apiOrigin: string;
  registrationEnabled: boolean;
}
export interface SiteSettings extends SiteConfig {
  logRetentionDays: number;
}
export const siteQueryOptions = queryOptions({
  queryKey: ['site'],
  queryFn: ({ signal }) => api.site(signal),
  staleTime: 60_000,
  gcTime: 300_000,
  refetchOnWindowFocus: true,
  refetchInterval: 60_000,
});
export const settingsQueryOptions = queryOptions({
  queryKey: ['admin.settings'],
  queryFn: ({ signal }) => api.admin.site.get(signal),
});

/** 只在浏览器解析自动来源，不把当前访问域名写回数据库。 */
export function resolveAPIOrigin(configured: string, currentOrigin = window.location.origin): string {
  if (!configured.trim()) return currentOrigin;
  const url = new URL(configured.trim());
  const ipv4 = url.hostname.split('.');
  const loopback =
    ipv4.length === 4 && ipv4[0] === '127' && ipv4.every((part) => /^\d+$/.test(part) && Number(part) <= 255);
  const local = url.hostname === 'localhost' || url.hostname === '[::1]' || loopback;
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('API 独立域名格式无效');
  if (currentOrigin.startsWith('https:') && url.protocol === 'http:') {
    throw new Error('HTTPS 站点不能调用 HTTP API，请配置 HTTPS 域名');
  }
  return url.origin;
}

export function publicSiteSettings(settings: SiteSettings): SiteConfig {
  // 显式白名单，未来增加管理字段时不会因对象展开而进入公开缓存。
  return {
    systemTitle: settings.systemTitle,
    siteDescription: settings.siteDescription,
    homeTitle: settings.homeTitle,
    homeDescription: settings.homeDescription,
    logoUrl: settings.logoUrl,
    faviconUrl: settings.faviconUrl,
    footerText: settings.footerText,
    footerLinkUrl: settings.footerLinkUrl,
    apiOrigin: settings.apiOrigin,
    registrationEnabled: settings.registrationEnabled,
  };
}
