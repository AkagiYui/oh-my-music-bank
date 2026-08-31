import { Checkbox } from '../components/ui/checkbox';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
export const Route = createFileRoute('/admin/settings')({
  component: SettingsPage,
});
function SettingsPage() {
  const { data: settings } = useQuery({
    queryKey: ['admin.settings:settings'],
    queryFn: () => api.admin.site.get(),
  });
  const [brandName, setBrandName] = useState('');
  const [regEnabled, setRegEnabled] = useState(true);
  const [saved, setSaved] = useState(false);
  const [retention, setRetention] = useState(0);
  useEffect(() => {
    const s = settings;
    if (s) {
      setBrandName(s.brandName);
      setRetention(Number(s.logRetentionDays));
      setRegEnabled(s.registrationEnabled);
    }
  }, [settings]);
  async function save() {
    if (retention > 0 && !confirm('保存后会永久删除超过保留天数的调用日志，确认启用？')) return;
    await api.admin.site.update({
      brandName: brandName,
      registrationEnabled: regEnabled,
      logRetentionDays: retention,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold">站点设置</h1>
      <Card>
        <CardHeader>
          <CardTitle>基础设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="brand">站点名称</Label>
            <Input id="brand" value={brandName} onChange={(e) => setBrandName(e.currentTarget.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              className="size-4"
              checked={regEnabled}
              onCheckedChange={(checked) => setRegEnabled(checked === true)}
            />
            开放注册
          </label>
          <div className="space-y-1">
            <Label htmlFor="retention">调用日志保留天数（0 为永久保留）</Label>
            <Input
              id="retention"
              type="number"
              min="0"
              max="3650"
              value={retention}
              onChange={(e) => setRetention(Number(e.currentTarget.value))}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={save}>保存</Button>
            {saved ? (
              <>
                <span className="text-sm text-green-600">已保存</span>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
