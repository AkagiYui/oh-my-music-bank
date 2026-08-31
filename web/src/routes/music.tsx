import { createFileRoute } from '@tanstack/react-router';
import { ManagementLayout, type ManagementNavItem } from '../components/ManagementLayout';

export const Route = createFileRoute('/music')({
  component: MusicLayout,
});

// 曲目及其关联资料、音频收录组成独立业务区，不再混入系统管理导航。
const NAV: ManagementNavItem[] = [
  { to: '/music', label: '概览', exact: true },
  { to: '/music/tracks', label: '曲目' },
  { to: '/music/artists', label: '艺术家' },
  { to: '/music/albums', label: '专辑' },
  { to: '/music/upload', label: '上传音频' },
  { to: '/music/import', label: '哔哩哔哩导入' },
  { to: '/music/jobs', label: '收录任务' },
];

function MusicLayout() {
  return <ManagementLayout title="曲库管理" items={NAV} />;
}
