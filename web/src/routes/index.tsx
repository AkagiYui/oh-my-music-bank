import { Fragment } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
export const Route = createFileRoute('/')({
  component: Home,
});
function Code(props: { children: string }) {
  return (
    <pre className="overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
      <code>{props.children}</code>
    </pre>
  );
}
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
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
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
  return (
    <div className="space-y-10">
      <section className="space-y-4 py-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight">自定义音源系统</h1>
        <p className="mx-auto max-w-xl text-muted-foreground">
          管理员上传音频，系统自动解析信息并分发到对象存储；你只需一个 API Key 即可检索音乐与获取播放地址。
        </p>
        <div className="flex justify-center gap-3">
          <Button onClick={() => navigate({ to: '/search' })}>立即试搜</Button>
          <Button variant="outline" onClick={() => navigate({ to: '/register' })}>
            注册获取 API Key
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">三步接入</h2>
        <Card>
          <CardContent className="space-y-6 p-6">
            <Step n={1} title="注册并登录">
              <p className="text-sm text-muted-foreground">首个注册的账号自动成为管理员。</p>
            </Step>
            <Step n={2} title="在控制台创建 API Key">
              <p className="text-sm text-muted-foreground">
                明文只在创建时展示一次，请妥善保存。密钥形如{' '}
                <code className="rounded bg-muted px-1">omb_xxxxxxxx…</code>
              </p>
            </Step>
            <Step n={3} title="带上 Key 调用开放接口">
              <Code>{`curl -H "X-API-Key: omb_你的密钥" \\
  "https://你的域名/api/open/v1/search?q=告白气球"`}</Code>
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
              在请求头携带 <code className="rounded bg-muted px-1">X-API-Key: omb_…</code> 或{' '}
              <code className="rounded bg-muted px-1">Authorization: Bearer omb_…</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="divide-y rounded-md border">
              {(ENDPOINTS ?? []).map((e, index) => (
                <Fragment key={index}>
                  <div className="flex flex-wrap items-center gap-3 p-3 text-sm">
                    <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                      {e.method}
                    </span>
                    <code className="font-mono text-xs">{e.path}</code>
                    <span className="ml-auto text-muted-foreground">{e.desc}</span>
                  </div>
                </Fragment>
              ))}
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">返回示例（搜索）</div>
              <Code>{`{
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
}`}</Code>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
