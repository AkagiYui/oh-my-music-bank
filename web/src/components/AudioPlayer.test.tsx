import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { StrictMode } from 'react';
import { AudioPlayer } from './AudioPlayer';
import { Feedback } from './Feedback';
import { BiliCropper } from './BiliCropper';
import { GlobalPlayerProvider, useGlobalPlayer } from './GlobalPlayer';
import { clearFeedback } from '../lib/feedback';

const sources = [
  { id: 'a', resolve: signed('/a.wav'), label: '标准' },
  { id: 'b', resolve: signed('/b.wav'), label: '无损', loudness: -8 },
];
function signed(url: string) {
  return () => Promise.resolve({ url, expiresAt: new Date(Date.now() + 60_000).toISOString() });
}
function metadata(audio: HTMLAudioElement, duration = 100) {
  Object.defineProperty(audio, 'duration', { value: duration, configurable: true });
  fireEvent.loadedMetadata(audio);
}
function setupMedia() {
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: true, configurable: true });
    this.dispatchEvent(new Event('pause'));
  });
  return vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: false, configurable: true });
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  });
}

describe('AudioPlayer', () => {
  beforeEach(() => {
    clearFeedback();
    setupMedia();
  });
  it('切换曲目重置进度并忽略旧媒体事件', async () => {
    const screen = render(
      <StrictMode>
        <AudioPlayer sources={[sources[0]]} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    await waitFor(() => expect(screen.container.querySelector('audio')!.getAttribute('src')).toBe('/a.wav'));
    const oldAudio = screen.container.querySelector('audio')!;
    metadata(oldAudio);
    oldAudio.currentTime = 30;
    fireEvent.timeUpdate(oldAudio);
    expect(screen.getByLabelText('播放进度').getAttribute('value')).toBe('30');
    screen.rerender(
      <StrictMode>
        <AudioPlayer sources={[sources[1]]} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    await waitFor(() => expect(screen.container.querySelector('audio')!.getAttribute('src')).toBe('/b.wav'));
    const audio = screen.container.querySelector('audio')!;
    expect(audio).not.toBe(oldAudio);
    expect(audio.getAttribute('src')).toBe('/b.wav');
    fireEvent.timeUpdate(oldAudio);
    expect(screen.getByLabelText('播放进度').getAttribute('value')).toBe('0');
  });
  it('切换音质保留进度和播放状态，并应用响度衰减', async () => {
    const screen = render(<AudioPlayer sources={sources} />);
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    await waitFor(() => expect(screen.container.querySelector('audio')!.getAttribute('src')).toBe('/a.wav'));
    let audio = screen.container.querySelector('audio')!;
    metadata(audio);
    audio.currentTime = 37;
    fireEvent.change(screen.getByLabelText('音质'), { target: { value: '1' } });
    await waitFor(() => expect(screen.container.querySelector('audio')!.getAttribute('src')).toBe('/b.wav'));
    audio = screen.container.querySelector('audio')!;
    expect(audio.getAttribute('src')).toBe('/b.wav');
    metadata(audio);
    expect(audio.currentTime).toBe(37);
    expect(audio.paused).toBe(false);
    expect(audio.volume).toBeCloseTo(10 ** (-6 / 20));
    fireEvent.click(screen.getByLabelText('静音'));
    expect(audio.muted).toBe(true);
  });
  it('播放错误和被拒绝的请求显示反馈', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('blocked'));
    const screen = render(
      <>
        <Feedback />
        <AudioPlayer sources={[sources[0]]} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    await waitFor(() => expect(screen.container.querySelector('audio')!.getAttribute('src')).toBe('/a.wav'));
    await waitFor(() => expect(screen.getByText('操作失败').parentElement!.textContent).toContain('无法播放'));
    fireEvent.error(screen.container.querySelector('audio')!);
    await waitFor(() => expect(screen.container.querySelector('audio')!.getAttribute('src')).toBe('/a.wav'));
    fireEvent.error(screen.container.querySelector('audio')!);
    await waitFor(() => expect(screen.getByText('操作失败').parentElement!.textContent).toContain('音频加载失败'));
  });
  it('签名已过期时自动重新签发，不尝试播放旧地址', async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce({ url: '/expired.wav', expiresAt: new Date(Date.now() - 1000).toISOString() })
      .mockResolvedValueOnce({ url: '/fresh.wav', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    const screen = render(<AudioPlayer sources={[{ id: 'a', label: '标准', resolve }]} />);
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    await waitFor(() => expect(screen.container.querySelector('audio')!.getAttribute('src')).toBe('/fresh.wav'));
    expect(resolve).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
  });
  it('音质载入中启动裁剪，不会被晚到的元数据恢复全局播放；反向也互斥', async () => {
    const screen = render(
      <>
        <AudioPlayer sources={sources} />
        <BiliCropper src="/crop.wav" duration={100} start={10} end={20} onChange={() => {}} />
      </>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: '播放' })[0]);
    await waitFor(() => expect(screen.container.querySelector('audio')!.getAttribute('src')).toBe('/a.wav'));
    let audio = screen.container.querySelector('audio')!;
    metadata(audio);
    audio.currentTime = 37;
    fireEvent.change(screen.getByLabelText('音质'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('试听片段'));
    await waitFor(() => expect(screen.container.querySelector('audio')!.getAttribute('src')).toBe('/b.wav'));
    audio = screen.container.querySelector('audio')!;
    metadata(audio);
    expect(audio.currentTime).toBe(37);
    expect(audio.paused).toBe(true);
    const crop = screen.container.querySelectorAll('audio')[1];
    expect(crop.paused).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(audio.paused).toBe(false);
    expect(crop.paused).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(audio.paused).toBe(true);
    expect(crop.paused).toBe(false);
  });
  it('暂停后被取消的播放 Promise 不弹出错误，也不响应迟到的 play 事件', async () => {
    let reject!: (error: Error) => void;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
    const screen = render(
      <>
        <Feedback />
        <AudioPlayer sources={sources} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    await waitFor(() => expect(typeof reject).toBe('function'));
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    await act(async () => reject(new Error('cancelled')));
    const audio = screen.container.querySelector('audio')!;
    fireEvent.play(audio);
    expect(audio.paused).toBe(true);
    expect(screen.queryByText('操作失败')).toBeNull();
  });
});

function PlaybackEntry({ id }: { id: string }) {
  const player = useGlobalPlayer();
  return (
    <button
      onClick={() =>
        player.start({
          id,
          title: id,
          artist: '艺术家',
          sources: [{ id, resolve: signed(`/${id}.wav`), label: '标准' }],
        })
      }
    >
      {id}
    </button>
  );
}

it('所有入口共享播放器：页面卸载不断播，同曲目不重置，换曲/关闭释放旧音频并保留音量设置', async () => {
  setupMedia();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const screen = render(
    <GlobalPlayerProvider>
      <PlaybackEntry id="A" />
      <PlaybackEntry id="B" />
    </GlobalPlayerProvider>,
  );
  expect(screen.container.querySelectorAll('audio')).toHaveLength(0);
  fireEvent.click(screen.getByText('A'));
  await waitFor(() => expect(screen.container.querySelector('audio')!.getAttribute('src')).toBe('/A.wav'));
  const audio = screen.container.querySelector('audio')!;
  metadata(audio);
  audio.currentTime = 25;
  fireEvent.timeUpdate(audio);
  fireEvent.click(screen.getByLabelText('静音'));
  fireEvent.click(screen.getByRole('button', { name: 'A' }));
  expect(audio.paused).toBe(true);
  expect(audio.currentTime).toBe(25);
  fireEvent.click(screen.getByRole('button', { name: 'A' }));
  expect(audio.paused).toBe(false);
  screen.rerender(
    <GlobalPlayerProvider>
      <PlaybackEntry id="B" />
    </GlobalPlayerProvider>,
  );
  expect(screen.container.querySelector('audio')).toBe(audio);
  expect(audio.currentTime).toBe(25);
  expect(audio.paused).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'B' }));
  await waitFor(() => expect(screen.container.querySelector('audio')!.getAttribute('src')).toBe('/B.wav'));
  expect(screen.container.querySelectorAll('audio')).toHaveLength(1);
  expect(audio.paused).toBe(true);
  const next = screen.container.querySelector('audio')!;
  expect(next.getAttribute('src')).toBe('/B.wav');
  expect(next.muted).toBe(true);
  fireEvent.click(screen.getByLabelText('关闭播放器'));
  expect(next.paused).toBe(true);
  expect(screen.queryByRole('region', { name: '全局播放器' })).toBeNull();
});
