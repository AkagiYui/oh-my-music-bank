import { useSyncExternalStore } from 'react';
const dict = {
  zh: {
    home: '首页',
    search: '搜索',
    docs: 'API 文档',
    dashboard: '控制台',
    admin: '管理',
    login: '登录',
    logout: '退出',
  },
  en: {
    home: 'Home',
    search: 'Search',
    docs: 'API',
    dashboard: 'Dashboard',
    admin: 'Admin',
    login: 'Login',
    logout: 'Logout',
  },
};
export type Locale = keyof typeof dict;
let locale: Locale = 'zh';
const listeners = new Set<() => void>();
export function setLocale(value: Locale) {
  locale = value;
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useI18n() {
  const current = useSyncExternalStore(subscribe, () => locale);
  return {
    locale: current,
    setLocale,
    t: (key: `nav.${keyof typeof dict.zh}`) => dict[current][key.slice(4) as keyof typeof dict.zh],
  };
}
