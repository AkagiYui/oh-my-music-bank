/** 路由 `/` —— 落地页 + API 使用引导。 */
import { For, type JSX } from 'solid-js';
import { createFileRoute, useNavigate } from '@tanstack/solid-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

export const Route = createFileRoute('/')({
  component: Home,
});

function Code(props: { children: string }) {
  return (
    <pre class="overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
      <code>{props.children}</code>
    </pre>
  );
}

const ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: 'GET', path: '/api/open/v1/search?q={关键词}', desc: '按标题或别名搜索可用曲目' },
  { method: 'GET', path: '/api/open/v1/tracks/{id}', desc: '获取曲目详情与各音质音频地址' },
];

function Step(props: { n: number; title: string; children: JSX.Element }) {
  return (
    <div class="flex gap-3">
      <div class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {props.n}
      </div>
      <div class="space-y-2">
        <div class="font-medium">{props.title}</div>
        {props.children}
      </div>
    </div>
  );
}

function Home() {
  const navigate = useNavigate();
  return (
    <div class="space-y-10">
      <section class="space-y-4 py-6 text-center">
        <h1 class="text-4xl font-bold tracking-tight">自定义音源系统</h1>
        <p class="mx-auto max-w-xl text-muted-foreground">
          管理员上传音频，系统自动解析信息并分发到对象存储；你只需一个 API Key 即可检索音乐与获取播放地址。
        </p>
        <div class="flex justify-center gap-3">
          <Button onClick={() => navigate({ to: '/search' })}>立即试搜</Button>
          <Button variant="outline" onClick={() => navigate({ to: '/register' })}>
            注册获取 API Key
          </Button>
        </div>
      </section>

      <section class="space-y-4">
        <h2 class="text-2xl font-semibold">三步接入</h2>
        <Card>
          <CardContent class="space-y-6 p-6">
            <Step n={1} title="注册并登录">
              <p class="text-sm text-muted-foreground">首个注册的账号自动成为管理员。</p>
            </Step>
            <Step n={2} title="在控制台创建 API Key">
              <p class="text-sm text-muted-foreground">
                明文只在创建时展示一次，请妥善保存。密钥形如 <code class="rounded bg-muted px-1">omb_xxxxxxxx…</code>
              </p>
            </Step>
            <Step n={3} title="带上 Key 调用开放接口">
              <Code>{`curl -H "X-API-Key: omb_你的密钥" \\
  "https://你的域名/api/open/v1/search?q=告白气球"`}</Code>
            </Step>
          </CardContent>
        </Card>
      </section>

      <section class="space-y-4">
        <h2 class="text-2xl font-semibold">开放接口</h2>
        <Card>
          <CardHeader>
            <CardTitle>鉴权</CardTitle>
            <CardDescription>
              在请求头携带 <code class="rounded bg-muted px-1">X-API-Key: omb_…</code> 或{' '}
              <code class="rounded bg-muted px-1">Authorization: Bearer omb_…</code>
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <div class="divide-y rounded-md border">
              <For each={ENDPOINTS}>
                {(e) => (
                  <div class="flex flex-wrap items-center gap-3 p-3 text-sm">
                    <span class="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                      {e.method}
                    </span>
                    <code class="font-mono text-xs">{e.path}</code>
                    <span class="ml-auto text-muted-foreground">{e.desc}</span>
                  </div>
                )}
              </For>
            </div>
            <div class="space-y-1">
              <div class="text-sm font-medium">返回示例（搜索）</div>
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
