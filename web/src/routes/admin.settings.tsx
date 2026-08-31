/** 路由 `/admin/settings` —— 站点设置（品牌名、是否开放注册）。 */
import { Show, createEffect, createResource, createSignal } from 'solid-js';
import { createFileRoute } from '@tanstack/solid-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

export const Route = createFileRoute('/admin/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  const [settings] = createResource(() => api.admin.site.get());
  const [brandName, setBrandName] = createSignal('');
  const [regEnabled, setRegEnabled] = createSignal(true);
  const [saved, setSaved] = createSignal(false);
  const [retention, setRetention] = createSignal(0);

  createEffect(() => {
    const s = settings();
    if (s) {
      setBrandName(s.brandName);
      setRetention(Number(s.logRetentionDays));
      setRegEnabled(s.registrationEnabled);
    }
  });

  async function save() {
    if (retention() > 0 && !confirm('保存后会永久删除超过保留天数的调用日志，确认启用？')) return;
    await api.admin.site.update({
      brandName: brandName(),
      registrationEnabled: regEnabled(),
      logRetentionDays: retention(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div class="max-w-lg space-y-4">
      <h1 class="text-2xl font-semibold">站点设置</h1>
      <Card>
        <CardHeader>
          <CardTitle>基础设置</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-1.5">
            <Label for="brand">站点名称</Label>
            <Input id="brand" value={brandName()} onInput={(e) => setBrandName(e.currentTarget.value)} />
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              class="size-4"
              checked={regEnabled()}
              onChange={(e) => setRegEnabled(e.currentTarget.checked)}
            />
            开放注册
          </label>
          <div class="space-y-1">
            <Label for="retention">调用日志保留天数（0 为永久保留）</Label>
            <Input
              id="retention"
              type="number"
              min="0"
              max="3650"
              value={retention()}
              onInput={(e) => setRetention(Number(e.currentTarget.value))}
            />
          </div>
          <div class="flex items-center gap-3">
            <Button onClick={save}>保存</Button>
            <Show when={saved()}>
              <span class="text-sm text-green-600">已保存</span>
            </Show>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
