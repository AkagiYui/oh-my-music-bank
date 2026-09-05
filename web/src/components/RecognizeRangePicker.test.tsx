import { fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';
import { RecognizeRangePicker } from './RecognizeRangePicker';

it('定长窗口只能整体平移，且不越过裁剪终点', () => {
  const onChange = vi.fn();
  const screen = render(
    <RecognizeRangePicker
      rangeStart={10}
      rangeEnd={20}
      start={13}
      length={6}
      maxLength={6}
      fixedLength
      onChange={onChange}
    />,
  );
  const handle = screen.getByRole('slider', { name: '识别片段位置' });
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith(14, 6);
  screen.rerender(
    <RecognizeRangePicker
      rangeStart={10}
      rangeEnd={20}
      start={14}
      length={6}
      maxLength={6}
      fixedLength
      onChange={onChange}
    />,
  );
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith(14, 6);
});

it('变长窗口两端都受服务上限约束', () => {
  const onChange = vi.fn();
  const screen = render(
    <RecognizeRangePicker
      rangeStart={0}
      rangeEnd={100}
      start={10}
      length={58}
      maxLength={58}
      fixedLength={false}
      onChange={onChange}
    />,
  );
  fireEvent.keyDown(screen.getByRole('slider', { name: '识别终点' }), { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith(10, 58);
  fireEvent.keyDown(screen.getByRole('slider', { name: '识别起点' }), { key: 'ArrowLeft' });
  expect(onChange).toHaveBeenLastCalledWith(10, 58);
  fireEvent.keyDown(screen.getByRole('slider', { name: '识别起点' }), { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith(11, 57);
});
