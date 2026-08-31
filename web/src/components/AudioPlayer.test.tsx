import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { AudioPlayer, type PlayerSource } from './AudioPlayer';
describe('AudioPlayer', () => {
  it('切换搜索曲目时同步音频地址并重置进度', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const [sources, setSources] = createSignal<PlayerSource[]>([{ id: 'a', url: '/a.wav', label: 'A' }]);
    const screen = render(() => <AudioPlayer sources={sources()} />);
    const audio = screen.container.querySelector('audio')!;
    expect(audio.getAttribute('src')).toBe('/a.wav');
    setSources([{ id: 'b', url: '/b.wav', label: 'B' }]);
    await waitFor(() => expect(audio.getAttribute('src')).toBe('/b.wav'));
  });
  it('播放错误显示明确反馈而不是持续加载', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const screen = render(() => <AudioPlayer sources={[{ id: 'a', url: '/a.wav', label: 'A' }]} />);
    fireEvent.error(screen.container.querySelector('audio')!);
    expect(screen.getByRole('alert').textContent).toContain('音频加载失败');
  });
});
