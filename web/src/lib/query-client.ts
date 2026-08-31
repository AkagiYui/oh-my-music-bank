import { QueryClient, QueryCache } from '@tanstack/react-query';
import { notifyError } from './feedback';

// 页面切换复用缓存；过期后先显示旧数据，再后台更新。身份变化仍由 auth 清空缓存。
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: notifyError,
  }),
  defaultOptions: {
    queries: {
      retry: false,
      // 编辑器不在切回窗口时重取数据，避免覆盖尚未保存的表单。
      refetchOnWindowFocus: false,
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
    },
  },
});
