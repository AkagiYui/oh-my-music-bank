import { createRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';
import { Badge } from './badge';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { Progress } from './progress';

it('按钮只有显式提交时才触发表单，禁用时不响应操作', () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const click = vi.fn();
  const screen = render(
    <form onSubmit={submit}>
      <Button onClick={click}>普通操作</Button>
      <Button type="submit">提交</Button>
      <Button disabled onClick={click}>
        禁用操作
      </Button>
    </form>,
  );
  fireEvent.click(screen.getByRole('button', { name: '普通操作' }));
  expect(click).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '禁用操作' }));
  expect(click).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '提交' }));
  expect(submit).toHaveBeenCalledTimes(1);
});

it('Badge render 合并链接语义、事件、样式与 ref', () => {
  const ref = createRef<HTMLAnchorElement>();
  const click = vi.fn();
  const renderedClick = vi.fn((event: React.MouseEvent) => event.preventDefault());
  const screen = render(
    <Badge
      variant="outline"
      onClick={click}
      render={<a ref={ref} href="/tracks" onClick={renderedClick} className="custom-link" />}
    >
      曲目
    </Badge>,
  );
  const link = screen.getByRole('link', { name: '曲目' });
  expect(ref.current).toBe(link);
  expect(link.classList.contains('custom-link')).toBe(true);
  expect(link.classList.contains('border-border')).toBe(true);
  fireEvent.click(link);
  expect(renderedClick).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
});

it('复选框不确定与禁用状态保持语义，并通过隐藏输入参与表单', () => {
  // jsdom 26 缺少 PointerEvent；此处只需点击的鼠标字段，完整交互另由浏览器回归测试验证。
  vi.stubGlobal('PointerEvent', MouseEvent);
  const change = vi.fn();
  const screen = render(
    <form>
      <Checkbox aria-label="全部" indeterminate disabled onCheckedChange={change} />
      <Checkbox aria-label="选择" name="selected" value="track-1" defaultChecked />
    </form>,
  );
  const mixed = screen.getByRole('checkbox', { name: '全部' });
  expect(mixed.getAttribute('aria-checked')).toBe('mixed');
  fireEvent.click(mixed);
  expect(change).not.toHaveBeenCalled();
  const form = screen.container.querySelector('form')!;
  expect(new FormData(form).get('selected')).toBe('track-1');
  fireEvent.click(screen.getByRole('checkbox', { name: '选择' }));
  expect(new FormData(form).has('selected')).toBe(false);
});

it('进度值、范围和不确定状态同步给辅助技术', () => {
  const screen = render(<Progress aria-label="上传" value={30} min={10} max={50} />);
  const progress = screen.getByRole('progressbar', { name: '上传' });
  expect(progress.getAttribute('aria-valuenow')).toBe('30');
  expect(progress.getAttribute('aria-valuemin')).toBe('10');
  expect(progress.getAttribute('aria-valuemax')).toBe('50');
  expect(screen.container.querySelector<HTMLElement>('[data-slot="progress-indicator"]')!.style.width).toBe('50%');
  screen.rerender(<Progress aria-label="上传" value={null} />);
  expect(progress.hasAttribute('aria-valuenow')).toBe(false);
});
