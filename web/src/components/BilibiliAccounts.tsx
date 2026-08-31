import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { PlusIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { api, type BiliLogin } from '~/lib/api';
import { notifyError, clearFeedback } from '~/lib/feedback';
import { invalidateIntegrationQueries } from '~/lib/query-invalidation';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '~/components/ui/avatar';
import { Badge } from '~/components/ui/badge';

export function BilibiliAccounts() {
  const {
    data: accounts,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ['bilibili:accounts'],
    queryFn: api.admin.bilibili.accounts,
  });
  const [login, setLogin] = useState<BiliLogin | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [pollError, setPollError] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  async function createLogin() {
    const token = ++generation.current;
    setBusy('login');
    setLogin(null);
    setMessage('');
    setPollError(false);
    clearFeedback();
    try {
      const next = await api.admin.bilibili.createLogin();
      if (token === generation.current) setLogin(next);
    } catch (e) {
      if (token === generation.current) notifyError(e);
    } finally {
      if (token === generation.current) setBusy('');
    }
  }

  const loginId = login?.id;
  const expiresAt = login?.expiresAt;
  useEffect(() => {
    if (!loginId || !expiresAt) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // 串行轮询，卸载/更换二维码后忽略旧请求，避免慢响应覆盖新登录。
    async function poll() {
      if (Date.now() >= Date.parse(expiresAt!)) {
        setLogin((current) => current && { ...current, status: 'expired' });
        return;
      }
      try {
        const next = await api.admin.bilibili.pollLogin(loginId!);
        if (cancelled) return;
        if (next.status === 'success') {
          setLogin(null);
          setMessage(`已登录 ${next.account?.name ?? '哔哩哔哩账号'}`);
          void invalidateIntegrationQueries();
          return;
        }
        setLogin((current) => current && { ...current, status: next.status });
        if (next.status !== 'expired') timer = setTimeout(poll, 3000);
      } catch {
        if (!cancelled) setPollError(true);
      }
    }
    timer = setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loginId, expiresAt, retry]);

  async function act(id: string, action: 'default' | 'refresh' | 'delete') {
    if (
      action === 'delete' &&
      !confirm(
        '从本站移除此哔哩哔哩账号？已提交任务若仍需使用它将失败，不会切换到其他账号。此操作不会注销 B 站其他设备。',
      )
    )
      return;
    setBusy(id);
    setMessage('');
    clearFeedback();
    try {
      if (action === 'default') {
        await api.admin.bilibili.setDefaultAccount(id);
        setMessage('默认导入账号已更新');
      }
      if (action === 'refresh') {
        const result = await api.admin.bilibili.refreshAccount(id);
        setMessage(result.message);
      }
      if (action === 'delete') {
        await api.admin.bilibili.deleteAccount(id);
        setMessage('账号已从本站移除');
      }
    } catch (e) {
      notifyError(e);
    } finally {
      void invalidateIntegrationQueries();
      setBusy('');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>哔哩哔哩账号</CardTitle>
        <CardDescription>
          使用哔哩哔哩 App 扫码登录，无需复制 Cookie。支持多个账号，默认账号用于新导入；后台定期检查并刷新登录状态。
          账号由本站管理员共享，登录凭据仅保存在服务端。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isPending && <p role="status">正在加载账号…</p>}
        {error && (
          <Button variant="outline" onClick={() => void refetch()}>
            账号加载失败，重试
          </Button>
        )}
        {accounts?.length === 0 && (
          <p className="text-sm text-muted-foreground">尚未登录账号，扫码添加后即可浏览收藏夹和导入音频。</p>
        )}
        {accounts?.map((account) => (
          <section key={account.id} aria-label={account.name} className="flex flex-wrap items-center gap-3">
            <Avatar>
              <AvatarImage src={account.avatar || undefined} alt={account.name} referrerPolicy="no-referrer" />
              <AvatarFallback>{account.name.slice(0, 1) || 'B'}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate">{account.name}</span>
                {account.isDefault && <Badge>默认</Badge>}
                <Badge variant={account.status === 'expired' ? 'destructive' : 'secondary'}>
                  {account.status === 'active' ? '已登录' : account.status === 'expired' ? '登录失效' : '待检查'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">UID：{account.mid ?? '待识别'}</p>
              {!account.canRefresh && (
                <p className="text-xs text-muted-foreground">旧账号缺少刷新凭据，请重新扫码启用自动刷新。</p>
              )}
              {account.confirmPending && (
                <p className="text-xs text-muted-foreground">新 Cookie 已保存，等待确认旧凭据失效。</p>
              )}
              {account.lastCheckedAt && (
                <p className="text-xs text-muted-foreground">
                  上次检查：{new Date(account.lastCheckedAt).toLocaleString()}
                </p>
              )}
              {account.lastRefreshedAt && (
                <p className="text-xs text-muted-foreground">
                  上次刷新：{new Date(account.lastRefreshedAt).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {!account.isDefault && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy || account.status === 'expired'}
                  onClick={() => void act(account.id, 'default')}
                >
                  设为默认
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void act(account.id, 'refresh')}>
                <RefreshCwIcon data-icon="inline-start" />
                {busy === account.id ? '处理中…' : '检查并刷新'}
              </Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act(account.id, 'delete')}>
                <Trash2Icon data-icon="inline-start" />
                移除
              </Button>
            </div>
          </section>
        ))}
        {login && (
          <section aria-label="扫码登录" className="flex flex-col items-center gap-3">
            {login.status !== 'expired' &&
              login.url && (
                // 二维码在浏览器本地生成，不向第三方图片服务发送登录链接。
                <QRCodeSVG value={login.url} size={200} marginSize={4} title="哔哩哔哩登录二维码" />
              )}
            <p role="status">
              {pollError
                ? '暂时无法获取扫码状态，请重试'
                : login.status === 'expired'
                  ? '二维码已过期，请重新生成'
                  : login.status === 'scanned'
                    ? '已扫码，请在手机上确认登录'
                    : '请使用哔哩哔哩 App 扫描二维码'}
            </p>
            <p className="text-xs text-muted-foreground">
              二维码有效期 3 分钟，请勿分享给他人。重复登录同一 UID 会更新原账号。
            </p>
            <div className="flex gap-2">
              {pollError && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setPollError(false);
                    setRetry((v) => v + 1);
                  }}
                >
                  重试查询
                </Button>
              )}
              <Button variant="outline" disabled={!!busy} onClick={() => void createLogin()}>
                重新生成二维码
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  generation.current++;
                  setLogin(null);
                }}
              >
                取消登录
              </Button>
            </div>
          </section>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </CardContent>
      <CardFooter>
        <Button disabled={!!busy} onClick={() => void createLogin()}>
          <PlusIcon data-icon="inline-start" />
          {busy === 'login' ? '正在生成二维码…' : '扫码添加账号'}
        </Button>
      </CardFooter>
    </Card>
  );
}
