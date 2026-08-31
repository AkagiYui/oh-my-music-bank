import { QueryClient, QueryCache } from '@tanstack/react-query';

// 编辑器不在切回窗口时重取数据，避免覆盖尚未保存的表单；身份变化时清空缓存。
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => window.dispatchEvent(new CustomEvent('ommb:api-error', { detail: error.message })),
  }),
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0, gcTime: 0 },
  },
});
