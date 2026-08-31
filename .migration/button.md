# button

2026-08-31 · engine · 已迁移至 @base-ui/react/button，保留当前 new-york 外观。

## Changed

- web/src/components/ui/button.tsx:2：真实 Button primitive 替代 Slot/native button；保留所有 variants、尺寸、设计令牌和 className，并支持 Base UI 状态回调与 render。
- web/src/routes/admin.upload.tsx:75：上传按钮显式 type="submit"。
- web/src/routes/dashboard.tsx:166：修改邮箱、修改密码按钮显式 type="submit"。
- 已逐项对比 https://ui.shadcn.com/r/styles/new-york/button.json：当前文件含尺寸、variant、Tailwind v4 焦点与图标定制，按技能要求仅转换当前文件，不覆盖为其他风格。
- 调用方扫描没有 asChild、ref 到特定按钮类型或其他不兼容用法；组件扫描 radix-ui、@radix-ui、IconPlaceholder 无残留。
- 迁移前 vp check、vp build 通过；迁移后逐文件类型检查通过。

## Left alone

- Sonner、播放器业务逻辑、原生 range、其他未涉及 Radix 的组件保持不变。
- 所有已有按钮 variant 和页面布局类保持不变。

## Behavior changes

- Base UI 按钮默认 type="button"，不同于原生按钮的表单内默认提交；已按业务用途适配三个依赖旧默认值的调用方，没有全局修改 Base UI 的默认行为。
- asChild API 改为 render；当前无调用方使用 asChild。

## Verify by hand

- 登录、注册、创建 API Key、上传、修改邮箱、修改密码均可点击提交；回车提交仍有效。
- 禁用按钮不可触发动作，Tab/Space/Enter 操作正常，按钮外观与迁移前一致。
