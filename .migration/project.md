# project

当前配置已按用户后续请求切换为 `base-lyra`，并合并应用 preset `b1Zh6udKE`。详见 [预设应用记录](./preset-b1Zh6udKE.md)。下文保留迁移到 Base UI 及随后修正 CLI 配置时的记录。

2026-08-31 · engine · 项目中 5 个 Radix 封装全部完成迁移，保留既有 new-york 外观和 Sonner 错误提示。

## Changed

- `web/package.json`、`web/pnpm-lock.yaml`：添加 `@base-ui/react@1.7.0`，在全部组件完成后移除 `radix-ui`；清除 70 个不再使用的包条目。保留依赖的版本与完整性定义无变化。
- 用户随后要求避免 CLI 再引入 Radix：`web/components.json` 的组件来源改为官方 `base-vega`，只变更后续生成配置，未执行 init/apply/overwrite，不覆盖现有组件和主题。
- `web/vite.config.ts` 增加 no-restricted-imports，禁止源码导入 radix-ui 及其子路径、@radix-ui/*，误用会在 vp check 中报错。
- Button 使用真实 Base UI primitive；Label 使用原生 label；Badge 使用 useRender/mergeProps；Checkbox 使用 Root/Indicator；Progress 使用 Root/Track/Indicator。逐组件差异、行为变化和检查清单见同目录各自报告。
- 调用方扫描覆盖整个 `web/src`：无 asChild、Radix CSS 变量或 data-state 样式残留；5 处复选框回调均为布尔值，无 ref 类型适配需求。上传、修改邮箱、修改密码三处提交按钮显式设置 type="submit"。
- 修复 Progress 未把 value 传给 Root 的问题，增加任务进度的无障碍名称，视觉宽度与辅助技术读数一致。
- `web/src/components/ui/base-ui.test.tsx`：覆盖默认按钮/提交/禁用语义、Badge render 事件和 ref 合并、复选框表单值与不确定状态、进度范围与无障碍值。jsdom 26 缺少 PointerEvent，测试内仅补足点击构造器；真实交互由 Chromium 验证。
- `web/e2e/base-ui.spec.ts`：新增账号设置实际提交、复选框标签点击/Space/尺寸/保存、进度视觉宽度回归用例。

## Left alone

- Sonner 与既有错误反馈逻辑全部保持不变；它不是 Radix 库，迁移技能明确要求不改。
- Input、Textarea、Card、NativeSelect 不依赖 Radix，未重写。
- 当前组件源码与 `web/src/app.css` 的主题保持不变；base-vega 是后续新增组件的来源，不代表现有组件已重新套用 Vega 样式。
- 原有后端、CI、容器、文档和通知修改均不包含在迁移差异中；未手动修改 routeTree.gen.ts。
- 前次审查中的原生 confirm、自定义选择器、页面 Field/Label 与间距整改不属于本次 primitive 迁移。

## Behavior changes

- **后续组件来源已修正**：迁移最初保留的 new-york 会让 CLI 继续选择 Radix；用户追加要求后已切为 base-vega，普通 shadcn add 现在选择 Base UI。新增组件采用 Vega 源码样式并沿用项目主题令牌，不保证与本地旧组件的尺寸细节完全一致，安装前仍应审阅 dry-run/diff。
- 配置不能改写显式 Radix URL 或第三方组件的实现；lint 负责拦截项目中的直接 Radix 导入，第三方包的传递依赖仍需审阅锁文件，不能把这条规则当作依赖安装防火墙。
- Button 默认 type="button"，显式提交点已适配；Checkbox 的 Space 切换状态，Enter 保留 Base UI 的表单提交语义；不确定状态使用独立 indeterminate 属性。
- Progress 显式接收 number | null，并使用 min/max 计算比例；旧组件只画出进度、读屏却不确定的问题已修正。

## Verify by hand

- 登录/注册/上传/账号设置的表单提交、Tab/Space/Enter、禁用状态；设置和 Bilibili 导入的选择、全选；任务进度及读屏；错误提示出现/变长/关闭后的布局。
- 已执行自动验证：迁移前 `vp check`、`vp build` 均通过；每个封装迁移后类型检查通过；最终 `vp install --frozen-lockfile`、`vp check`、`vp test run`（14 项）、`vp run test:e2e`（Chromium 20 项，包含 7 项错误提示布局回归）、`vp build`、`git diff --check` 均通过。
- 追加配置修正后：`pnpm dlx shadcn@latest info --json` 确认识别为 style=base-vega/base=base；`add dialog --dry-run` 与 `add dialog --view dialog.tsx` 确认生成 @base-ui/react/dialog，未实际安装或覆盖组件。临时 lint 探针验证四种 Radix 包/子路径导入均被拒绝，Base UI 导入通过，探针已删除；check、14 项单测、20 项 E2E 与构建再次通过。
- 自动浏览器验证包含 390px 手机与 1280px 桌面场景；未进行真实读屏软件或 Safari/Firefox 人工测试。
- 为遵守技能的干净工作树与逐组件提交要求，使用隔离分支 `suki/migrate-base-ui`，以当前前端为快照基线逐组件提交；只有基线之后的迁移差异回写原工作树，原分支不切换、不自动提交。
- 最终扫描 `web/src/components/ui`、`web/src`、依赖清单及锁文件：剩余 Radix 封装 **0**，无 Radix 引用或依赖。
