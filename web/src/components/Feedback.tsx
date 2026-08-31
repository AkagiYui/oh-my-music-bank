import { Show, createSignal, onCleanup, onMount } from 'solid-js';
export function Feedback() {
  const [message, setMessage] = createSignal('');
  onMount(() => {
    const apiError = (event: Event) => setMessage((event as CustomEvent<string>).detail);
    const unhandled = (event: PromiseRejectionEvent) => {
      setMessage(event.reason instanceof Error ? event.reason.message : String(event.reason));
      event.preventDefault();
    };
    window.addEventListener('ommb:api-error', apiError);
    window.addEventListener('unhandledrejection', unhandled);
    onCleanup(() => {
      window.removeEventListener('ommb:api-error', apiError);
      window.removeEventListener('unhandledrejection', unhandled);
    });
  });
  return (
    <Show when={message()}>
      <div
        role="alert"
        class="mx-auto flex max-w-5xl items-center gap-3 rounded border border-destructive bg-background p-3 text-sm text-destructive"
      >
        <span>{message()}</span>
        <button class="ml-auto" onClick={() => setMessage('')}>
          关闭
        </button>
      </div>
    </Show>
  );
}
