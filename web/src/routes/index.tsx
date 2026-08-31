import { useSiteConfig } from '../components/SiteBranding';
import { CodeBlock } from '../components/CodeBlock';
import { resolveAPIOrigin } from '../lib/site';
import { Badge } from '../components/ui/badge';
import { Fragment } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
export const Route = createFileRoute('/')({
  component: Home,
});
const ENDPOINTS: {
  method: string;
  path: string;
  desc: string;
}[] = [
  { method: 'GET', path: '/api/open/v1/search?q={关键词}', desc: '按标题或别名搜索可用曲目' },
  { method: 'GET', path: '/api/open/v1/tracks/{id}', desc: '获取曲目详情与各音质音频地址' },
];
function Step(props: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-none bg-primary text-sm font-semibold text-primary-foreground">
        {props.n}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="font-medium">{props.title}</div>
        {props.children}
      </div>
    </div>
  );
}
function Home() {
  const navigate = useNavigate();
  const site = useSiteConfig();
  const apiOrigin = resolveAPIOrigin(site.apiOrigin);
  return (
    <div className="space-y-10">
      <section className="space-y-4 py-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight wrap-anywhere">{site.homeTitle}</h1>
        {site.homeDescription && (
          <p className="mx-auto max-w-xl whitespace-pre-wrap wrap-anywhere text-muted-foreground">
            {site.homeDescription}
          </p>
        )}
        <div className="flex justify-center gap-3">
          <Button onClick={() => navigate({ to: '/search' })}>立即试搜</Button>
          <Button variant="outline" onClick={() => navigate({ to: site.registrationEnabled ? '/register' : '/login' })}>
            {site.registrationEnabled ? '注册获取 API Key' : '登录获取 API Key'}
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">三步接入</h2>
        <Card>
          <CardContent className="space-y-6 p-6">
            <Step n={1} title={site.registrationEnabled ? '注册并登录' : '登录账号'}>
              <p className="text-sm text-muted-foreground">
                {site.registrationEnabled
                  ? '创建账号后，在控制台管理你的 API Key。'
                  : '当前站点未开放注册，请联系管理员获取账号。'}
              </p>
            </Step>
            <Step n={2} title="在控制台创建 API Key">
              <p className="text-sm text-muted-foreground">
                明文只在创建时展示一次，请妥善保存。密钥形如{' '}
                <code className="rounded-none bg-muted px-1">omb_xxxxxxxx…</code>
              </p>
            </Step>
            <Step n={3} title="带上 Key 调用开放接口">
              <CodeBlock language="bash">{`curl -H "X-API-Key: omb_你的密钥" \\
  "${apiOrigin}/api/open/v1/search?q=告白气球"`}</CodeBlock>
            </Step>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">开放接口</h2>
        <Card>
          <CardHeader>
            <CardTitle>鉴权</CardTitle>
            <CardDescription>
              在请求头携带 <code className="rounded-none bg-muted px-1">X-API-Key: omb_…</code> 或{' '}
              <code className="rounded-none bg-muted px-1">Authorization: Bearer omb_…</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm wrap-anywhere">
              API 地址：<code>{apiOrigin}/api/open/v1</code>
            </p>
            <div className="divide-y rounded-none border">
              {(ENDPOINTS ?? []).map((e, index) => (
                <Fragment key={index}>
                  <div className="flex flex-wrap items-center gap-3 p-3 text-sm">
                    <Badge variant="outline">{e.method}</Badge>
                    <code className="font-mono text-xs">{e.path}</code>
                    <span className="ml-auto text-muted-foreground">{e.desc}</span>
                  </div>
                </Fragment>
              ))}
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">返回示例（搜索）</div>
              <CodeBlock language="json">{`{
  "data": [
    {
      "id": "123456789",
      "title": "告白气球",
      "duration": 215,
      "artists": [{ "id": "987", "name": "周杰伦" }],
      "coverUrl": "https://.../cover/123456789.jpg"
    }
  ],
  "total": 1, "page": 1, "pageSize": 20
}`}</CodeBlock>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
