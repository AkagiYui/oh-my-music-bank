# badge

2026-08-31 · engine · Badge 的 Radix Slot 已迁移至 Base UI useRender。

## Changed

- web/src/components/ui/badge.tsx:2：使用 @base-ui/react/use-render 与 merge-props，默认仍输出 span，render 可组合其他元素，state 保留 data-slot/data-variant。
- 所有本地 variant、配色、圆角、尺寸和图标规则保持不变。
- 对比 https://ui.shadcn.com/r/styles/new-york/badge.json：本地含多态、额外 variants 和 Tailwind v4 定制，未覆盖为其他风格。
- 当前调用方无 asChild，不需要改动；扫描 radix-ui、@radix-ui、IconPlaceholder 无残留，逐文件类型检查通过。

## Left alone

- 页面手写的状态 span 不在 Radix 迁移范围，未擅自改成 Badge。
- Sonner 与其他第三方库保持不变。

## Behavior changes

- 自定义输出 API 从 asChild 改为 render，现有调用方没有使用旧 API。

## Verify by hand

- 收录任务中的状态徽标仍显示正确文字、尺寸与 destructive/secondary 颜色。
- render 组合元素时保留目标标签、调用方事件和 ref。
