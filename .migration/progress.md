# progress

2026-08-31 · engine · 已迁移至 @base-ui/react/progress，保留进度条外观并同步无障碍数值。

## Changed

- web/src/components/ui/progress.tsx:1：使用 Base UI Root/Track/Indicator 与原生 Props；支持 className 状态回调。
- value 传入 Root，由 primitive 计算填充宽度，移除手工 translateX，保留颜色、尺寸、圆角和 transition-all。
- web/src/routes/admin.jobs.tsx:50：唯一调用方增加可访问名称“收录进度”。
- 已对比 https://ui.shadcn.com/r/styles/new-york/progress.json：当前 Tailwind v4 尺寸、颜色和导出结构为本地定制，保留当前风格。
- 调用方扫描只使用数值 value/className；无 getValueLabel 或 ref 不兼容用法。组件扫描 radix-ui、@radix-ui、IconPlaceholder 无残留；逐文件类型检查通过。

## Left alone

- 任务轮询、取消和重试业务逻辑保持不变。
- Sonner 与其他非 Radix 组件保持不变。

## Behavior changes

- 修正旧组件未把 value 传入 Root 的问题：读屏现在能读到与视觉一致的实际进度，而非始终处于不确定状态。
- Base UI 的 value 为必填 number | null；不确定进度显式传 null。当前调用方始终传数值。
- 填充比例按 min/max 计算，不再固定假定范围为 0–100；额外 Track 为 Base UI 标准结构。

## Verify by hand

- 打开任务页面，确认数值为 30 时填充约 30%，随任务更新增长，满值填满。
- 使用读屏检查“收录进度”和数值同步；进度条不挤动周围内容。
