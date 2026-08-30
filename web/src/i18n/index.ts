/** 轻量 i18n（@solid-primitives/i18n），默认中文，可切换英文。 */
import { createMemo, createRoot, createSignal } from 'solid-js';
import * as i18n from '@solid-primitives/i18n';

const dict = {
  zh: {
    nav: { home: '首页', search: '试搜', docs: 'API 文档', dashboard: '控制台', admin: '管理', login: '登录', logout: '退出' },
  },
  en: {
    nav: { home: 'Home', search: 'Search', docs: 'API', dashboard: 'Dashboard', admin: 'Admin', login: 'Login', logout: 'Logout' },
  },
};

export type Locale = keyof typeof dict;

const [locale, setLocale] = createSignal<Locale>('zh');
export { locale, setLocale };

const flat = createRoot(() => createMemo(() => i18n.flatten(dict[locale()])));

/** 翻译函数：`t('nav.home')`。 */
export const t = i18n.translator(flat, i18n.resolveTemplate);
