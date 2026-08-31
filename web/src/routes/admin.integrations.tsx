import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
export const Route = createFileRoute('/admin/integrations')({
  component: IntegrationsPage,
});
function IntegrationsPage() {
  const { data: cfg, refetch } = useQuery({
    queryKey: ['admin.integrations:cfg'],
    queryFn: () => api.admin.integrations.get(),
  });
  const [cookie, setCookie] = useState('');
  const [appId, setAppId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  async function test(provider: string) {
    setTesting(true);
    setTestMessage('');
    try {
      const r = await api.admin.integrations.test(provider);
      setTestMessage(r.message);
    } catch (e) {
      setTestMessage(String(e));
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
      bilibiliCookie?: string;
      xfyunAppId?: string;
      xfyunApiKey?: string;
    } = { xfyunAppId: appId.trim() };
    if (cookie.trim()) body.bilibiliCookie = cookie.trim();
    if (apiKey.trim()) body.xfyunApiKey = apiKey.trim();
    await api.admin.integrations.update(body);
    setCookie('');
    setApiKey('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    refetch();
  }
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">集成配置</h1>

      <Card>
        <CardHeader>
          <CardTitle>哔哩哔哩</CardTitle>
          <CardDescription>
            从浏览器登录 bilibili.com 后复制 Cookie（至少含 SESSDATA）。当前状态：
            {cfg?.bilibiliCookieSet ? (
              <>
                <span className="text-green-600"> 已配置</span>
              </>
            ) : (
              <span className="text-destructive"> 未配置</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="cookie">Cookie（留空则不修改）</Label>
          <Textarea
            id="cookie"
            rows={3}
            placeholder="SESSDATA=xxx; bili_jct=xxx; ..."
            value={cookie}
            onChange={(e) => setCookie(e.currentTarget.value)}
          />
        </CardContent>
      </Card>

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
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="appid">AppID</Label>
            <Input id="appid" value={appId} onChange={(e) => setAppId(e.currentTarget.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apikey">APIKey（留空则不修改）</Label>
            <Input id="apikey" type="password" value={apiKey} onChange={(e) => setApiKey(e.currentTarget.value)} />
          </div>
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
        <Button variant="outline" disabled={testing} onClick={() => test('bilibili')}>
          测试 B 站连接
        </Button>
        <Button variant="outline" disabled={testing} onClick={() => test('xfyun')}>
          发送讯飞测试请求
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            if (confirm('清除 B 站 Cookie？')) {
              await api.admin.integrations.update({ bilibiliCookie: '' });
              refetch();
            }
          }}
        >
          清除 B 站凭据
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            if (confirm('清除讯飞凭据？')) {
              await api.admin.integrations.update({
                xfyunAppId: '',
                xfyunApiKey: '',
              });
              refetch();
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
