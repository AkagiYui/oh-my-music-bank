import { useEffect } from 'react';
import { notifyError } from '../lib/feedback';
import { Toaster } from './ui/sonner';

export function Feedback() {
  useEffect(() => {
    // 后台界面动作的未捕获异常也交给 Sonner，避免静默失败。
    const unhandled = (event: PromiseRejectionEvent) => {
      notifyError(event.reason);
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', unhandled);
    return () => window.removeEventListener('unhandledrejection', unhandled);
  }, []);

  return (
    <Toaster
      position="bottom-right"
      closeButton
      richColors
      containerAriaLabel="通知"
      offset={{ bottom: 'calc(var(--global-player-height, 0px) + 24px)', right: 24, left: 24 }}
      mobileOffset={{ bottom: 'calc(var(--global-player-height, 0px) + 16px)', right: 16, left: 16 }}
      toastOptions={{
        closeButtonAriaLabel: '关闭错误提示',
        classNames: { toast: 'items-start!', content: 'min-w-0 flex-1' },
      }}
    />
  );
}
