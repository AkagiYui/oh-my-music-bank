import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invalidateIntegrationQueries } from '../lib/query-invalidation';
import { createFileRoute } from '@tanstack/react-router';
import { api } from '../lib/api';
import { clearFeedback, notifyError } from '../lib/feedback';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Field, FieldGroup, FieldLabel } from '../components/ui/field';
import { BilibiliAccounts } from '../components/BilibiliAccounts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
export const Route = createFileRoute('/admin/integrations')({
  component: IntegrationsPage,
});
function IntegrationsPage() {
  const { data: cfg } = useQuery({
    queryKey: ['admin.integrations:cfg'],
    queryFn: () => api.admin.integrations.get(),
  });
  const [appId, setAppId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  async function test(provider: string) {
    setTesting(true);
    clearFeedback();
    try {
      const r = await api.admin.integrations.test(provider);
      setTestMessage(r.message);
    } catch (e) {
      notifyError(e);
    } finally {
      setTesting(false);
    }
  }
  useEffect(() => {
    const c = cfg;
    if (c) setAppId(c.xfyunAppId);
  }, [cfg]);
  async function save() {
    const body: {
      xfyunAppId?: string;
      xfyunApiKey?: string;
    } = { xfyunAppId: appId.trim() };
    if (apiKey.trim()) body.xfyunApiKey = apiKey.trim();
    await api.admin.integrations.update(body);
    setApiKey('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    void invalidateIntegrationQueries();
  }
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">集成配置</h1>

      <BilibiliAccounts />

      <Card>
        <CardHeader>
          <CardTitle>讯飞听歌识曲</CardTitle>
          <CardDescription>
            在讯飞开放平台创建「听歌识曲」应用，填入 AppID 与 APIKey。APIKey 状态：
            {cfg?.xfyunApiKeySet ? (
              <>
                <span className="text-green-600"> 已配置</span>
              </>
            ) : (
              <span className="text-destructive"> 未配置</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="appid">AppID</FieldLabel>
              <Input id="appid" value={appId} onChange={(e) => setAppId(e.currentTarget.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="apikey">APIKey（留空则不修改）</FieldLabel>
              <Input id="apikey" type="password" value={apiKey} onChange={(e) => setApiKey(e.currentTarget.value)} />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save}>保存</Button>
        {saved ? (
          <>
            <span className="text-sm text-green-600">已保存</span>
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={testing} onClick={() => test('xfyun')}>
          发送讯飞测试请求
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            if (confirm('清除讯飞凭据？')) {
              await api.admin.integrations.update({
                xfyunAppId: '',
                xfyunApiKey: '',
              });
              void invalidateIntegrationQueries();
            }
          }}
        >
          清除讯飞凭据
        </Button>
      </div>
      {testMessage ? (
        <>
          <p role="status" className="text-sm">
            {testMessage}
          </p>
        </>
      ) : null}
    </div>
  );
}
