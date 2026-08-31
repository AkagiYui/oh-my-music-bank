# checkbox

2026-08-31 · engine · 已迁移至 @base-ui/react/checkbox，保留复选框外观。

## Changed

- web/src/components/ui/checkbox.tsx:4：改用 Base UI Root/Indicator 与原生类型；状态样式转换为 data-checked/data-disabled，并支持 className 状态回调。
- Root 使用 span，显式补充 inline-flex/align-middle 保持 16px 尺寸和图标对齐。
- 已对比 https://ui.shadcn.com/r/styles/new-york/checkbox.json：当前 Tailwind v4 样式为本地定制，保留颜色、边框、阴影和焦点环。
- 所有调用方的 checked/onCheckedChange 均使用布尔值，不需要迁移参数；无 asChild 或依赖 button ref 的用法。组件扫描 radix-ui、@radix-ui、IconPlaceholder 无残留；逐文件类型检查通过。

## Left alone

- 保留现有 label 包裹与 htmlFor/id 关联；不改页面表单布局。
- Sonner 不依赖 Radix，不属于本次迁移。

## Behavior changes

- Root 从 button 变为 span，Base UI 提供隐藏的原生 input 参与表单提交，disabled 对应 data-disabled。
- 不确定状态使用独立 indeterminate 属性，checked/onCheckedChange 为布尔值；当前无不确定状态调用方。
- Space 切换选择；Base UI 的 Enter 不切换复选框，在表单内可触发提交，保留其原生语义。

## Verify by hand

- 在站点设置中点击复选框文字、Tab 聚焦后按 Space，确认注册开关更新且能保存。
- 在 Bilibili 导入页面逐项选择、全选及取消，确认勾选图标和提交内容一致。
- 禁用复选框不可切换，焦点环和 16px 外观正常。
