import { useState, useEffect } from 'react';
export function Feedback() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    const apiError = (event: Event) => setMessage((event as CustomEvent<string>).detail);
    const unhandled = (event: PromiseRejectionEvent) => {
      setMessage(event.reason instanceof Error ? event.reason.message : String(event.reason));
      event.preventDefault();
    };
    window.addEventListener('ommb:api-error', apiError);
    window.addEventListener('unhandledrejection', unhandled);
    return () => {
      window.removeEventListener('ommb:api-error', apiError);
      window.removeEventListener('unhandledrejection', unhandled);
    };
  }, []);
  return message ? (
    <>
      <div
        role="alert"
        className="mx-auto flex max-w-5xl items-center gap-3 rounded border border-destructive bg-background p-3 text-sm text-destructive"
      >
        <span>{message}</span>
        <button className="ml-auto" onClick={() => setMessage('')}>
          关闭
        </button>
      </div>
    </>
  ) : null;
}
