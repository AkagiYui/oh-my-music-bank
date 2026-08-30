import { splitProps, type JSX } from 'solid-js';
import { cn } from '../../lib/utils';

export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [l, o] = splitProps(props, ['class']);
  return (
    <input
      class={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        l.class,
      )}
      {...o}
    />
  );
}
