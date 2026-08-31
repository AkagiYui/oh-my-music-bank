import { render } from '@testing-library/react';
import { expect, it } from 'vite-plus/test';
import { CodeBlock } from './CodeBlock';

it('高亮 Bash 字符串并完整保留换行、中文与动态地址', () => {
  const source = 'curl -H "X-API-Key: omb_你的密钥" \\\n  "https://api.example.test/api/open/v1/search?q=告白气球"';
  const { container, rerender } = render(<CodeBlock language="bash">{source}</CodeBlock>);
  expect(container.querySelector('code')?.textContent).toBe(source);
  expect(container.querySelectorAll('.hljs-string')).toHaveLength(2);
  const updated = source.replace('api.example.test', 'music.example.test');
  rerender(<CodeBlock language="bash">{updated}</CodeBlock>);
  expect(container.querySelector('code')?.textContent).toBe(updated);
});

it('按 JSON 语法区分字段名、字符串和数字', () => {
  const source = '{"id": "123456789", "title": "告白气球", "duration": 215}';
  const { container } = render(<CodeBlock language="json">{source}</CodeBlock>);
  expect(container.querySelector('code')?.textContent).toBe(source);
  expect(container.querySelector('.hljs-attr')?.textContent).toBe('"id"');
  expect(container.querySelector('.hljs-string')?.textContent).toBe('"123456789"');
  expect(container.querySelector('.hljs-number')?.textContent).toBe('215');
});

it.each(['bash', 'json'] as const)('%s 代码中的 HTML 只显示为文本', (language) => {
  const source = '"</code><img src=x onerror=alert(1)><script>alert(1)</script>&"';
  const { container } = render(<CodeBlock language={language}>{source}</CodeBlock>);
  expect(container.querySelector('code')?.textContent).toBe(source);
  expect(container.querySelector('img, script')).toBeNull();
});
