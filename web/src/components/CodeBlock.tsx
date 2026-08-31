import { useMemo } from 'react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';

// 首页只需要 Bash 和 JSON，避免把所有语言规则打进前端包。
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);

export function CodeBlock({ children, language }: { children: string; language: 'bash' | 'json' }) {
  // 高亮器负责转义原文；动态 API 地址也只作为代码文本展示。
  const highlighted = useMemo(() => hljs.highlight(children, { language }).value, [children, language]);

  return (
    <pre className="overflow-auto rounded-none border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
      <code className={`syntax-highlight language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  );
}
