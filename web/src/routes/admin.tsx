import { createFileRoute } from '@tanstack/react-router';
import { ManagementLayout, type ManagementNavItem } from '../components/ManagementLayout';

export const Route = createFileRoute('/admin')({
  component: AdminLayout,
});

// 系统管理仅保留账户、访问控制和站点配置；音乐业务统一从曲库管理进入。
const NAV: ManagementNavItem[] = [
  { to: '/admin', label: '概览', exact: true },
  { to: '/admin/api-keys', label: 'API Key' },
  { to: '/admin/logs', label: '调用日志' },
  { to: '/admin/users', label: '用户' },
  { to: '/admin/settings', label: '站点设置' },
  { to: '/admin/integrations', label: '集成' },
];

function AdminLayout() {
  return <ManagementLayout title="系统管理" items={NAV} />;
}
