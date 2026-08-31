import { fireEvent, render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BiliCropper } from './BiliCropper';
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});
it('片段试听使用最新终点，换源后清理旧播放会话', () => {
  const onChange = vi.fn();
  const screen = render(<BiliCropper src="/a.wav" duration={100} start={10} end={80} onChange={onChange} />);
  const audio = screen.container.querySelector('audio')!;
  fireEvent.click(screen.getByText('试听片段'));
  expect(audio.currentTime).toBe(10);
  screen.rerender(<BiliCropper src="/a.wav" duration={100} start={10} end={20} onChange={onChange} />);
  audio.currentTime = 21;
  fireEvent.timeUpdate(audio);
  expect(audio.pause).toHaveBeenCalled();
  screen.rerender(<BiliCropper src="/b.wav" duration={50} start={0} end={50} onChange={onChange} />);
  expect(screen.container.querySelector('audio')).not.toBe(audio);
  expect(screen.container.querySelector('audio')!.getAttribute('src')).toBe('/b.wav');
});
it('键盘裁剪不允许越过起止边界', () => {
  const onChange = vi.fn();
  const screen = render(<BiliCropper src="/a.wav" duration={100} start={0} end={0.5} onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole('slider', { name: '裁剪起点' }), { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith(0, 0.5);
});
