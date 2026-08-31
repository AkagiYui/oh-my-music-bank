import { expect, it } from 'vite-plus/test';
import { mergeRanges, missingRanges, WaveformPeaks } from './audio-waveform';

it('缓冲区增长和跳播只补齐缺失的时间区间', () => {
  const decoded = mergeRanges([
    { start: 0, end: 4 },
    { start: 12, end: 15 },
    { start: 3, end: 6 },
  ]);
  expect(decoded).toEqual([
    { start: 0, end: 6 },
    { start: 12, end: 15 },
  ]);
  expect(
    missingRanges(
      [
        { start: 0, end: 8 },
        { start: 10, end: 18 },
      ],
      decoded,
    ),
  ).toEqual([
    { start: 6, end: 8 },
    { start: 10, end: 12 },
    { start: 15, end: 18 },
  ]);
  expect(missingRanges([{ start: 1, end: 5 }], decoded)).toEqual([]);
});

it('按样本时间定位并合并反相声道的峰值，区分静音和未加载', () => {
  const peaks = new WaveformPeaks(4);
  const channels = [new Float32Array([0, 0.2, -0.8, 0.3]), new Float32Array([0, -0.2, 0.8, -0.9])];
  const buffer = {
    length: 4,
    sampleRate: 4,
    numberOfChannels: 2,
    getChannelData: (i: number) => channels[i],
  };
  peaks.add(buffer, 2, { start: 2, end: 2.75 });
  expect(peaks.peaks[0]).toBe(-1);
  expect(peaks.peaks[800]).toBe(0);
  expect(peaks.peaks[900]).toBeCloseTo(0.2);
  expect(peaks.peaks[1000]).toBeCloseTo(0.8);
  expect(peaks.peaks[1100]).toBe(-1);
  expect(peaks.path()).toContain('M800,49.40v1.20');
  expect(peaks.path()).not.toContain('M0,');
  peaks.add(buffer, 2, { start: 2.75, end: 3 });
  expect(peaks.peaks[1100]).toBeCloseTo(0.9);
  expect(peaks.peaks[1000]).toBeCloseTo(0.8);
});

it('负时间戳和超出音频末尾的样本不会落入其他桶', () => {
  const peaks = new WaveformPeaks(1);
  const buffer = {
    length: 4,
    sampleRate: 2,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array([1, 0.5, 0.25, 1]),
  };
  peaks.add(buffer, -0.5, { start: 0, end: 2 });
  expect(peaks.peaks[0]).toBe(0.5);
  expect(peaks.peaks[800]).toBe(0.25);
  expect(peaks.peaks.filter((v) => v >= 0)).toHaveLength(2);
});
