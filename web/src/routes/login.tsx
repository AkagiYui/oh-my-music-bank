/** 路由 `/login` —— 登录。 */
import { Show, createSignal } from 'solid-js';
import { createFileRoute, Link, useNavigate } from '@tanstack/solid-router';
import { ApiError } from '../lib/api';
import { login } from '../stores/auth';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  async function submit(e: Event) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const u = await login(email(), password());
      navigate({ to: u.role === 'admin' ? '/admin' : '/dashboard' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="mx-auto max-w-sm py-10">
      <Card>
        <CardHeader>
          <CardTitle>登录</CardTitle>
        </CardHeader>
        <CardContent>
          <form class="space-y-4" onSubmit={submit}>
            <div class="space-y-1.5">
              <Label for="email">邮箱</Label>
              <Input id="email" type="email" required value={email()} onInput={(e) => setEmail(e.currentTarget.value)} />
            </div>
            <div class="space-y-1.5">
              <Label for="password">密码</Label>
              <Input
                id="password"
                type="password"
                required
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
              />
            </div>
            <Show when={error()}>
              <p class="text-sm text-destructive">{error()}</p>
            </Show>
            <Button type="submit" class="w-full" disabled={loading()}>
              {loading() ? '登录中…' : '登录'}
            </Button>
          </form>
          <p class="mt-4 text-center text-sm text-muted-foreground">
            还没有账号？
            <Link to="/register" class="text-primary hover:underline">
              注册
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
