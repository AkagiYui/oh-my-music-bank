import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invalidateIntegrationQueries } from '../lib/query-invalidation';
import { createFileRoute } from '@tanstack/react-router';
import { api } from '../lib/api';
import { clearFeedback, notifyError } from '../lib/feedback';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Field, FieldGroup, FieldLabel } from '../components/ui/field';
import { Checkbox } from '../components/ui/checkbox';
import { BilibiliAccounts } from '../components/BilibiliAccounts';
import { resetNeteaseFingerprint } from '../lib/netease-afp';
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
  const [afpBusy, setAfpBusy] = useState('');
  const [afpVerify, setAfpVerify] = useState(true);
  const [afpUrl, setAfpUrl] = useState('');
  const afp = cfg?.neteaseAfp;
  // 指纹资源换版本后，前端已加载的 Worker 必须丢弃重来。
  async function runAfp(action: 'fetch' | 'remove') {
    setAfpBusy(action);
    clearFeedback();
    try {
      if (action === 'fetch') {
        const r = await api.admin.integrations.neteaseAfpFetch();
        setTestMessage(
          `已拉取扩展 ${r.version || '未知版本'}：afp.wasm ${r.wasmSize} 字节，${r.verified ? '校验通过' : '未校验哈希'}`,
        );
      } else {
        await api.admin.integrations.neteaseAfpRemove();
        setTestMessage('已移除本站保存的指纹资源');
      }
      resetNeteaseFingerprint();
      void invalidateIntegrationQueries();
    } catch (e) {
      notifyError(e);
    } finally {
      setAfpBusy('');
    }
  }
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
    if (!c) return;
    setAppId(c.xfyunAppId);
    if (c.neteaseAfp) {
      setAfpVerify(c.neteaseAfp.verifyHash);
      setAfpUrl(c.neteaseAfp.sourceUrl ?? '');
    }
  }, [cfg]);
  async function saveAfpOptions() {
    setAfpBusy('options');
    clearFeedback();
    try {
      await api.admin.integrations.update({ neteaseAfpVerifyHash: afpVerify, neteaseAfpSourceUrl: afpUrl.trim() });
      setTestMessage('已保存网易云指纹资源的来源设置');
      void invalidateIntegrationQueries();
    } catch (e) {
      notifyError(e);
    } finally {
      setAfpBusy('');
    }
  }
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

      <Card>
        <CardHeader>
          <CardTitle>网易云听歌识曲</CardTitle>
          <CardDescription>
            无需账号，但指纹算法只存在于网易官方 Chrome 扩展中，本站不分发这两个文件。
            应用店只提供扩展的当前版本，无法按版本号拉取，因此这里锁的是内容哈希：拉取时逐个校验 afp.wasm 与
            sandbox.bundle.js，任一与已审计版本不符就整体失败，已保存的旧副本保持可用。 识别时由管理员浏览器加载并在
            Worker 内计算指纹。状态：
            {afp?.ready ? (
              <span className="text-green-600"> 已就绪</span>
            ) : (
              <span className="text-destructive"> 未拉取</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 text-xs text-muted-foreground">
            <span>扩展 ID：{afp?.extensionId}</span>
            <span className="break-all">已审计 afp.wasm：{afp?.expectedWasmSha}</span>
            <span className="break-all">已审计 sandbox.bundle.js：{afp?.expectedGlueSha}</span>
            {afp?.source === 'bundled' ? <span>当前使用镜像内预置的文件（构建时已校验）</span> : null}
            {afp?.source === 'fetched' ? (
              <span>
                管理员拉取 · 扩展版本 {afp.version || '未知'} · 拉取于 {afp.fetchedAt}
              </span>
            ) : null}
            {afp?.source === 'fetched' && !afp.verified ? (
              <span className="text-destructive">该副本在关闭校验的情况下拉取，未与已审计版本比对</span>
            ) : null}
          </div>

          <FieldGroup className="mt-3">
            <Field>
              <FieldLabel htmlFor="afp-url">自定义下载地址（留空使用 Chrome 应用店）</FieldLabel>
              <Input
                id="afp-url"
                value={afpUrl}
                placeholder="https://…/extension.crx 或 .zip"
                onChange={(e) => setAfpUrl(e.currentTarget.value)}
              />
            </Field>
          </FieldGroup>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <Checkbox
              checked={afpVerify}
              onCheckedChange={(checked) => setAfpVerify(checked === true)}
              aria-label="校验内容哈希"
            />
            校验内容哈希
          </label>
          {afpVerify ? null : (
            <p className="mt-1 text-xs text-destructive">
              关闭后拉取的是未经审计的第三方代码，且会在管理员浏览器中执行，请自行确认来源可信。
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={afpBusy !== ''} onClick={() => void saveAfpOptions()}>
              {afpBusy === 'options' ? '保存中…' : '保存来源设置'}
            </Button>
            <Button variant="outline" disabled={afpBusy !== ''} onClick={() => void runAfp('fetch')}>
              {afpBusy === 'fetch' ? '拉取中…' : afp?.source === 'fetched' ? '重新拉取' : '拉取指纹资源'}
            </Button>
            {afp?.source === 'fetched' ? (
              <Button
                variant="ghost"
                disabled={afpBusy !== ''}
                onClick={() => {
                  if (confirm('移除本站保存的网易云指纹资源？移除后若镜像内有预置文件将回落使用。'))
                    void runAfp('remove');
                }}
              >
                移除拉取的副本
              </Button>
            ) : null}
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
