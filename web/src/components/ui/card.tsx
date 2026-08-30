import { splitProps, type JSX } from 'solid-js';
import { cn } from '../../lib/utils';

type DivProps = JSX.HTMLAttributes<HTMLDivElement>;

export function Card(props: DivProps) {
  const [l, o] = splitProps(props, ['class']);
  return <div class={cn('rounded-lg border bg-card text-card-foreground shadow-sm', l.class)} {...o} />;
}

export function CardHeader(props: DivProps) {
  const [l, o] = splitProps(props, ['class']);
  return <div class={cn('flex flex-col space-y-1.5 p-6', l.class)} {...o} />;
}

export function CardTitle(props: DivProps) {
  const [l, o] = splitProps(props, ['class']);
  return <h3 class={cn('text-lg font-semibold leading-none tracking-tight', l.class)} {...o} />;
}

export function CardDescription(props: DivProps) {
  const [l, o] = splitProps(props, ['class']);
  return <p class={cn('text-sm text-muted-foreground', l.class)} {...o} />;
}

export function CardContent(props: DivProps) {
  const [l, o] = splitProps(props, ['class']);
  return <div class={cn('p-6 pt-0', l.class)} {...o} />;
}

export function CardFooter(props: DivProps) {
  const [l, o] = splitProps(props, ['class']);
  return <div class={cn('flex items-center p-6 pt-0', l.class)} {...o} />;
}
