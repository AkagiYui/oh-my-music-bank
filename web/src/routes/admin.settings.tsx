import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { api } from '../lib/api';
import { notifyError, clearFeedback } from '../lib/feedback';
import {
  publicSiteSettings,
  resolveAPIOrigin,
  settingsQueryOptions,
  siteQueryOptions,
  type SiteSettings,
} from '../lib/site';
import { BrandLogo } from '../components/SiteBranding';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../components/ui/field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
export const Route = createFileRoute('/admin/settings')({ component: SettingsPage });

function SettingsPage() {
  const query = useQuery(settingsQueryOptions);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">站点设置</h1>
      {query.data ? (
        <SettingsEditor initial={query.data} />
      ) : query.isError ? (
        <div className="flex flex-col gap-3" role="alert">
          <p>读取设置失败，未加载配置前不能保存。</p>
          <Button onClick={() => void query.refetch()}>重试</Button>
        </div>
      ) : (
        <p role="status">正在读取设置…</p>
      )}
    </div>
  );
}

function SettingsEditor({ initial }: { initial: SiteSettings }) {
  // 草稿只在加载和成功保存时建立，后台重取不能覆盖管理员尚未保存的输入。
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: api.admin.site.update,
    onSuccess: async (settings) => {
      // 先取消旧请求再替换缓存，防止保存前的响应回写旧品牌。
      await Promise.all([
        queryClient.cancelQueries({ queryKey: siteQueryOptions.queryKey }),
        queryClient.cancelQueries({ queryKey: settingsQueryOptions.queryKey }),
      ]);
      queryClient.setQueryData(settingsQueryOptions.queryKey, settings);
      queryClient.setQueryData(siteQueryOptions.queryKey, publicSiteSettings(settings));
      setDraft(settings);
      setBaseline(settings);
      setSaved(true);
    },
    onError: notifyError,
  });
  const update = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const textField = (
    key: keyof Pick<
      SiteSettings,
      | 'systemTitle'
      | 'siteDescription'
      | 'homeTitle'
      | 'homeDescription'
      | 'logoUrl'
      | 'faviconUrl'
      | 'footerText'
      | 'footerLinkUrl'
      | 'apiOrigin'
    >,
    label: string,
    description: string,
    max: number,
    multiline = false,
    required = false,
  ) => {
    const props = {
      id: key,
      value: draft[key],
      maxLength: max,
      required,
      'aria-describedby': `${key}-help`,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(key, e.currentTarget.value),
    };
    return (
      <Field>
        <FieldLabel htmlFor={key}>{label}</FieldLabel>
        {multiline ? (
          <Textarea {...props} rows={3} />
        ) : (
          <Input {...props} placeholder={key === 'apiOrigin' ? window.location.origin : undefined} />
        )}
        <FieldDescription id={`${key}-help`}>{description}</FieldDescription>
      </Field>
    );
  };
  let effectiveOrigin = '';
  let originError = '';
  try {
    effectiveOrigin = resolveAPIOrigin(draft.apiOrigin);
  } catch (error) {
    originError = (error as Error).message;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    clearFeedback();
    if (originError) {
      notifyError(originError);
      return;
    }
    if (
      draft.logRetentionDays > 0 &&
      (baseline.logRetentionDays === 0 || draft.logRetentionDays < baseline.logRetentionDays) &&
      !confirm('保存后会永久删除超过保留天数的调用日志，确认启用？')
    )
      return;
    mutation.mutate(draft);
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <fieldset disabled={mutation.isPending} className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>品牌与站点信息</CardTitle>
            <CardDescription>保存后立即应用到全站。文案作为纯文本显示，不支持 HTML。</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {textField(
                'systemTitle',
                '系统标题',
                '用于导航品牌、浏览器标题后缀和应用名称，最多 80 字。',
                80,
                false,
                true,
              )}
              {textField(
                'siteDescription',
                '站点描述',
                '用于非首页的页面描述元数据，最多 300 字；留空不显示描述。',
                300,
                true,
              )}
              {textField(
                'logoUrl',
                'Logo 地址',
                'HTTPS 图片地址或以 / 开头的本站资源路径；留空使用默认音符，加载失败自动回退。',
                2048,
              )}
              {textField(
                'faviconUrl',
                '站点图标地址',
                '浏览器标签页图标，支持 HTTPS 或本站资源路径；留空移除自定义图标。',
                2048,
              )}
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>首页与页脚</CardTitle>
            <CardDescription>自定义首页介绍及全站页脚的品牌露出。</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {textField('homeTitle', '首页标题', '首页主标题与浏览器首页标题，最多 120 字。', 120, false, true)}
              {textField(
                'homeDescription',
                '首页描述',
                '首页介绍和首页描述元数据，最多 2000 字；支持换行，留空隐藏。',
                2000,
                true,
              )}
              {textField(
                'footerText',
                '页脚文字',
                '可填写版权、组织名称或备案信息，最多 300 字；留空隐藏页脚。',
                300,
                true,
              )}
              {textField('footerLinkUrl', '页脚链接', '可选 HTTPS 链接或本站路径；填写时页脚文字将成为链接。', 2048)}
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>开放 API</CardTitle>
            <CardDescription>同时影响接入示例和搜索请求；登录、管理与配置接口仍保持同源。</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={!!originError}>
                <FieldLabel htmlFor="apiOrigin">API 独立域名</FieldLabel>
                <Input
                  id="apiOrigin"
                  aria-describedby="apiOrigin-help"
                  aria-invalid={!!originError}
                  maxLength={2048}
                  value={draft.apiOrigin}
                  placeholder={window.location.origin}
                  onChange={(e) => update('apiOrigin', e.currentTarget.value)}
                />
                <FieldDescription id="apiOrigin-help">
                  只填写协议、域名及可选端口，例如 https://api.example.com，不含 /api
                  路径。留空时每位访客使用当前页面的来源；此处占位地址不会保存。仅本机开发允许 HTTP。
                </FieldDescription>
                <FieldDescription>{originError || `当前生效地址：${effectiveOrigin}/api/open/v1`}</FieldDescription>
              </Field>
              <FieldDescription>
                请先完成域名解析、TLS 与反向代理，开放 /api/open/v1，并允许本站跨域发送 X-API-Key。 私有音频将由该 API
                签发对象存储临时地址；品牌设置不会自动配置 DNS、网关或存储桶策略。
              </FieldDescription>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>访问与日志</CardTitle>
            <CardDescription>注册策略与日志保留策略由后端执行。</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal">
                <Checkbox
                  id="registrationEnabled"
                  className="size-4"
                  checked={draft.registrationEnabled}
                  onCheckedChange={(checked) => update('registrationEnabled', checked === true)}
                />
                <FieldLabel htmlFor="registrationEnabled">开放注册</FieldLabel>
              </Field>
              <Field>
                <FieldLabel htmlFor="retention">调用日志保留天数（0 为永久保留）</FieldLabel>
                <Input
                  id="retention"
                  type="number"
                  min={0}
                  max={3650}
                  step={1}
                  required
                  value={draft.logRetentionDays}
                  onChange={(e) => update('logRetentionDays', Number(e.currentTarget.value))}
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>文案预览</CardTitle>
            <CardDescription>这是未保存的草稿，不会提前影响访客。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 wrap-anywhere">
            <div className="flex items-center gap-2">
              <BrandLogo url={draft.logoUrl} />
              <span>{draft.systemTitle}</span>
            </div>
            <div className="text-lg font-semibold">{draft.homeTitle}</div>
            <p className="whitespace-pre-wrap text-muted-foreground">{draft.homeDescription}</p>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{draft.footerText}</p>
          </CardContent>
        </Card>
        <div className="flex items-center gap-3">
          <Button type="submit">{mutation.isPending ? '保存中…' : '保存'}</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft(baseline);
              setSaved(false);
            }}
          >
            撤销未保存修改
          </Button>
          {saved && (
            <span role="status" className="text-sm text-muted-foreground">
              已保存
            </span>
          )}
        </div>
      </fieldset>
    </form>
  );
}
