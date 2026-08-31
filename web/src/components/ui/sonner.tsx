import type { CSSProperties } from 'react';
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { cn } from '~/lib/utils';

// 沿用 shadcn/ui 的 Sonner 组件；SPA 暂无主题切换器，使用当前页面的浅色主题和设计令牌。
function Toaster({ toastOptions, ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          // Lyra 的通知表面是直角；预设的默认 radius 令牌并不代表组件的实际形状。
          '--border-radius': '0px',
        } as CSSProperties
      }
      toastOptions={{
        ...toastOptions,
        classNames: {
          ...toastOptions?.classNames,
          // Sonner 自带按钮圆角，合并时保留调用方的长内容滚动和布局配置。
          closeButton: cn('rounded-none!', toastOptions?.classNames?.closeButton),
          actionButton: cn('rounded-none!', toastOptions?.classNames?.actionButton),
          cancelButton: cn('rounded-none!', toastOptions?.classNames?.cancelButton),
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
