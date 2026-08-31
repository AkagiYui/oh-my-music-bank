import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { AudioPlayer } from './AudioPlayer';

describe('AudioPlayer', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  it('切换曲目时重置地址和进度，忽略旧媒体事件', async () => {
    const screen = render(
      <StrictMode>
        <AudioPlayer sources={[{ id: 'a', url: '/a.wav', label: 'A' }]} />
      </StrictMode>,
    );
    const oldAudio = screen.container.querySelector('audio')!;
    Object.defineProperty(oldAudio, 'duration', { value: 100 });
    fireEvent.loadedMetadata(oldAudio);
    oldAudio.currentTime = 30;
    fireEvent.timeUpdate(oldAudio);
    expect(screen.getByLabelText('播放进度').getAttribute('value')).toBe('30');
    screen.rerender(
      <StrictMode>
        <AudioPlayer sources={[{ id: 'b', url: '/b.wav', label: 'B' }]} />
      </StrictMode>,
    );
    const audio = screen.container.querySelector('audio')!;
    expect(audio).not.toBe(oldAudio);
    expect(audio.getAttribute('src')).toBe('/b.wav');
    fireEvent.timeUpdate(oldAudio);
    expect(screen.getByLabelText('播放进度').getAttribute('value')).toBe('0');
  });
  it('切换音质保留进度和播放状态，并应用响度衰减', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const screen = render(
      <AudioPlayer
        sources={[
          { id: 'a', url: '/a.wav', label: '标准' },
          { id: 'b', url: '/b.wav', label: '无损', loudness: -8 },
        ]}
      />,
    );
    const audio = screen.container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { value: 100 });
    Object.defineProperty(audio, 'paused', { value: false });
    fireEvent.loadedMetadata(audio);
    audio.currentTime = 37;
    fireEvent.click(screen.getByText('无损'));
    expect(audio.getAttribute('src')).toBe('/b.wav');
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(37);
    expect(play).toHaveBeenCalled();
    expect(audio.volume).toBeCloseTo(10 ** (-6 / 20));
    fireEvent.click(screen.getByLabelText('静音'));
    expect(audio.volume).toBe(0);
  });
  it('播放错误和被拒绝的 play 请求显示反馈', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('blocked'));
    const screen = render(<AudioPlayer sources={[{ id: 'a', url: '/a.wav', label: 'A' }]} />);
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法播放'));
    fireEvent.error(screen.container.querySelector('audio')!);
    expect(screen.getByRole('alert').textContent).toContain('音频加载失败');
  });
});
