import { createFileRoute, redirect } from '@tanstack/react-router';

// 兼容旧管理入口，避免收藏或外部链接失效；权限由曲库管理布局统一检查。
export const Route = createFileRoute('/admin/import')({
  beforeLoad: ({ location }) => {
    throw redirect({ to: '/music/import', search: true, hash: location.hash, replace: true });
  },
});
