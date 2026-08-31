import { fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';
import { TrackFilters } from './TrackFilters';

it('音质选择器首次渲染和外部重置时显示文案，而不是接口值', () => {
  const onChange = vi.fn();
  const screen = render(<TrackFilters value={{ quality: 'lossless' }} onChange={onChange} />);
  const trigger = screen.getByRole('combobox', { name: '音质筛选' });
  expect(trigger.tagName).toBe('BUTTON');
  expect(trigger.textContent).toBe('无损');
  screen.rerender(<TrackFilters value={{}} onChange={onChange} />);
  expect(trigger.textContent).toBe('全部音质');
  expect(onChange).not.toHaveBeenCalled();
});

it('编辑其他筛选字段时保留当前音质和语种', () => {
  const onChange = vi.fn();
  const screen = render(<TrackFilters value={{ quality: 'high', language: '中文' }} onChange={onChange} />);
  fireEvent.change(screen.getByPlaceholderText('专辑筛选'), { target: { value: '测试专辑' } });
  expect(onChange).toHaveBeenCalledWith({ quality: 'high', language: '中文', album: '测试专辑' });
});
