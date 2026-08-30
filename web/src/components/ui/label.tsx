import { splitProps, type JSX } from 'solid-js';
import { cn } from '../../lib/utils';

export function Label(props: JSX.LabelHTMLAttributes<HTMLLabelElement>) {
  const [l, o] = splitProps(props, ['class']);
  return (
    <label
      class={cn('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70', l.class)}
      {...o}
    />
  );
}
