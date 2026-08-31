import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const u = await login(email, password);
      navigate({ to: u.role === 'admin' ? '/admin' : '/dashboard' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="mx-auto max-w-sm py-10">
      <Card>
        <CardHeader>
          <CardTitle>登录</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="email">邮箱</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
            </div>
            {error ? (
              <>
                <p className="text-sm text-destructive">{error}</p>
              </>
            ) : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '登录中…' : '登录'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            还没有账号？
            <Link to="/register" className="text-primary hover:underline">
              注册
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
