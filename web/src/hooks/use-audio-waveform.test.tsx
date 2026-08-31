import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';
import { useAudioWaveform } from './use-audio-waveform';
import { createWaveformReader } from '../lib/waveform-reader';
import type { WrappedAudioBuffer } from 'mediabunny';

vi.mock('../lib/waveform-reader', () => ({ createWaveformReader: vi.fn() }));

function media() {
  const audio = document.createElement('audio');
  let ranges: [number, number][] = [];
  Object.defineProperties(audio, {
    duration: { value: 20 },
    buffered: {
      get: () => ({ length: ranges.length, start: (i: number) => ranges[i][0], end: (i: number) => ranges[i][1] }),
    },
  });
  return {
    ref: { current: audio },
    buffer: (next: [number, number][]) => {
      ranges = next;
      audio.dispatchEvent(new Event('progress'));
    },
  };
}

it('无缓冲不读取，增长时仅追加解码，卸载后销毁读取器', async () => {
  const dispose = vi.fn();
  const buffers = vi.fn(async function* (range: { start: number; end: number }) {
    yield {
      timestamp: range.start,
      duration: range.end - range.start,
      buffer: {
        length: 1,
        sampleRate: 1,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array([0.5]),
      } as unknown as AudioBuffer,
    };
  });
  vi.mocked(createWaveformReader).mockReturnValue({ buffers, dispose });
  const audio = media();
  const { result, unmount } = renderHook(() => useAudioWaveform(audio.ref, '/a.m4a'));
  expect(result.current.status).toBe('waiting');
  act(() => audio.buffer([[0, 2]]));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(buffers).toHaveBeenLastCalledWith({ start: 0, end: 2 });
  const first = result.current.path;
  act(() =>
    audio.buffer([
      [0, 4],
      [12, 14],
    ]),
  );
  await waitFor(() => expect(buffers).toHaveBeenCalledTimes(3));
  expect(buffers.mock.calls.map(([range]) => range)).toEqual([
    { start: 0, end: 2 },
    { start: 2, end: 4 },
    { start: 12, end: 14 },
  ]);
  expect(result.current.path).toContain(first);
  unmount();
  expect(dispose).toHaveBeenCalledOnce();
});

it('切换时取消仍在等待的解码，晚到结果不会回填；失败保留基础裁剪功能', async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const dispose = vi.fn();
  const buffers = vi.fn(async function* () {
    await pending;
    yield {
      timestamp: 0,
      duration: 1,
      buffer: {
        length: 1,
        sampleRate: 1,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array([1]),
      } as unknown as AudioBuffer,
    };
  });
  vi.mocked(createWaveformReader).mockReturnValue({ buffers, dispose });
  const audio = media();
  const hook = renderHook(() => useAudioWaveform(audio.ref, '/a.m4a'));
  act(() => audio.buffer([[0, 2]]));
  await waitFor(() => expect(buffers).toHaveBeenCalledOnce());
  hook.unmount();
  expect(dispose).toHaveBeenCalledOnce();
  await act(async () => {
    resolve();
    await pending;
  });
  expect(hook.result.current.path).toBe('');

  vi.mocked(createWaveformReader).mockReturnValue({
    dispose: vi.fn(),
    buffers: async function* () {
      yield await Promise.reject<WrappedAudioBuffer>(new Error('unsupported'));
    },
  });
  const next = media();
  const { result } = renderHook(() => useAudioWaveform(next.ref, '/b.m4a'));
  act(() => next.buffer([[0, 2]]));
  await waitFor(() => expect(result.current.status).toBe('unavailable'));
  expect(result.current.path).toBe('');
});
