import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { siteQueryOptions, type SiteConfig } from '../lib/site';
import { Button } from './ui/button';

const SiteContext = createContext<SiteConfig | null>(null);
export function useSiteConfig(): SiteConfig {
  const site = useContext(SiteContext);
  if (!site) throw new Error('站点配置尚未加载');
  return site;
}

/** 配置加载成功后再展示页面，避免首屏闪现错误品牌或未确认的注册入口。 */
export function SiteProvider({ children }: { children: ReactNode }) {
  const query = useQuery(siteQueryOptions);
  if (!query.data)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <p role={query.isError ? 'alert' : 'status'}>{query.isError ? '站点配置加载失败，请重试' : '正在加载站点…'}</p>
        {query.isError && <Button onClick={() => void query.refetch()}>重试</Button>}
      </div>
    );
  return <SiteContext value={query.data}>{children}</SiteContext>;
}

export function BrandLogo({ url }: { url: string }) {
  const [failedURL, setFailedURL] = useState<string | null>(null);
  return url && failedURL !== url ? (
    <img
      src={url}
      alt=""
      className="size-7 shrink-0 object-contain"
      referrerPolicy="no-referrer"
      onError={() => setFailedURL(url)}
    />
  ) : (
    <span aria-hidden="true" className="text-primary">
      ♪
    </span>
  );
}

const pageTitles: Record<string, string> = {
  '/login': '登录',
  '/register': '注册',
  '/search': '搜索音乐',
  '/dashboard': '控制台',
  '/admin': '系统概览',
  '/music': '概览',
  '/admin/settings': '站点设置',
  '/admin/integrations': '集成',
  '/music/upload': '上传音频',
  '/music/jobs': '收录任务',
  '/music/import': '哔哩哔哩导入',
  '/music/tracks': '曲目',
  '/music/artists': '艺术家',
  '/music/albums': '专辑',
  '/admin/api-keys': 'API Key',
  '/admin/logs': '调用日志',
  '/admin/users': '用户',
};
export function SiteMetadata() {
  const site = useSiteConfig();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const page = pathname === '/' ? site.homeTitle : (pageTitles[pathname.replace(/\/$/, '')] ?? '页面不存在');
  useEffect(() => {
    document.title = page === site.systemTitle ? site.systemTitle : `${page} · ${site.systemTitle}`;
    // 只写文本属性，不解释管理员文案中的 HTML；清空配置时同步移除旧图标。
    const meta = (key: string, value: string, property = false) => {
      const attr = property ? 'property' : 'name';
      let element = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attr, key);
        document.head.append(element);
      }
      element.content = value;
    };
    const description = pathname === '/' ? site.homeDescription : site.siteDescription;
    meta('description', description);
    meta('application-name', site.systemTitle);
    meta('og:site_name', site.systemTitle, true);
    meta('og:title', document.title, true);
    meta('og:description', description, true);
    let icon = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (site.faviconUrl) {
      if (!icon) {
        icon = document.createElement('link');
        icon.rel = 'icon';
        document.head.append(icon);
      }
      icon.href = site.faviconUrl;
    } else icon?.remove();
  }, [site, page, pathname]);
  return null;
}

export function SiteFooter() {
  const site = useSiteConfig();
  if (!site.footerText) return null;
  return (
    <footer className="border-t px-4 py-6 text-center text-sm whitespace-pre-wrap wrap-anywhere text-muted-foreground">
      {site.footerLinkUrl ? (
        <a href={site.footerLinkUrl} rel="noopener noreferrer" className="hover:underline">
          {site.footerText}
        </a>
      ) : (
        site.footerText
      )}
    </footer>
  );
}
