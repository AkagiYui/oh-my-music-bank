// 普通播放与裁剪试听共用音频焦点；暂停监听器同时取消尚未完成的播放意图。
const listeners = new Set<(owner: HTMLAudioElement) => void>();

export function requestAudioFocus(owner: HTMLAudioElement) {
  listeners.forEach((listener) => listener(owner));
}

export function subscribeAudioFocus(listener: (owner: HTMLAudioElement) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
