# label

2026-08-31 · engine · Radix Label 已替换为原生 label。

## Changed

- web/src/components/ui/label.tsx:5：Base UI 无独立 Label primitive，使用 React.ComponentProps<'label'> 与原生 label，保留 htmlFor、ref、select-none 及现有字体和间距。
- disabled 的 group/peer 样式增加对 Base UI presence attribute 的支持。
- 已对比 https://ui.shadcn.com/r/styles/new-york/label.json；当前 Tailwind v4 标签样式、别名与原注册表有差异，保留本地定制。
- 调用方均使用原生 htmlFor/id 组合，没有 asChild。组件扫描 radix-ui、@radix-ui、IconPlaceholder 无残留；逐文件类型检查通过。

## Left alone

- 现有 Label 调用方、其他表单结构以及 Sonner 不改动。
- 本轮不把页面的普通 div 标签重构成 Field，那属于后续规范整改。

## Behavior changes

- 标签由原生元素实现；select-none 保留原本避免文本选择的表现。

## Verify by hand

- 点击登录/注册/设置页面的标签，焦点进入关联输入框。
- Tab 导航顺序、标签文本和间距与迁移前一致。
