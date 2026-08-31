# preset b1Zh6udKE

2026-08-31 · 按 shadcn CLI 解码并合并应用用户预设，继续使用 Base UI。

## 配置

| 设置 | 值 |
| --- | --- |
| style | base-lyra |
| baseColor | neutral |
| theme / chartColor | blue / blue |
| font / fontHeading | noto-sans / inherit |
| iconLibrary | lucide |
| radius | default |
| menuColor / menuAccent | default-translucent / subtle |

官方预览：https://ui.shadcn.com/create?preset=b1Zh6udKE

使用 `pnpm dlx shadcn@latest init --preset b1Zh6udKE --base base --force --no-reinstall --yes` 更新配置、主题和字体，再逐个审阅 CLI 的 `add --dry-run`、`--diff` 与 `--view` 输出后合并组件；未批量覆盖现有封装。

## 首次应用范围

首次应用仅覆盖配置、主题和基础组件，未覆盖所有页面。`preset resolve` 精确匹配只证明配置一致，不能证明任意 JSX、自定义组件和调用方样式已同步；此前将其描述为完整应用不够准确。

- `web/components.json` 保存 base-lyra 与菜单配置，后续新增组件继续走 Base UI。
- `web/src/app.css` 使用预设的浅色/深色、图表、侧栏和字体令牌；清理 CLI 产生的重复动画导入及旧 body 字体覆盖，使 Noto Sans 真正生效。
- 安装 `@fontsource-variable/noto-sans` 与官方 `shadcn/tailwind.css` 所需依赖；字体随 Vite 构建本地提供，不请求 Google Fonts。原有依赖版本及完整性记录未变化。
- Button、Badge、Card、Checkbox、Input、Label、NativeSelect、Progress、Textarea 同步 Lyra 的紧凑尺寸、直角、字体、边框和状态样式。
- 清理四处 NativeSelect 调用方的旧外观覆盖；className 仅保留布局宽度。任务进度条不再强制旧高度。
- lint 的 Radix 禁用提示不再写死旧 base-vega，随 components.json 的 Base UI style 使用。

## 保留的功能

- Button 真实 primitive、显式表单提交和状态 className 回调；Badge 的事件/ref/render 合并；Checkbox 的禁用属性、标签和键盘语义；Progress 的 value/min/max 无障碍数值同步。
- Input 保留原生 input，避免样式切换改变文件上传及既有 ref 的语义；Progress 保留现有封装接口，仅合并预设外观。
- Sonner 使用现有主题令牌，没有引入 next-themes；错误浮层、长内容滚动、关闭按钮和错误去重均不变。
- 还原 CLI 初始化覆盖的 utils.ts，完整保留本地 formatDuration 等函数。
- 中文字符由系统字体回退显示；Noto Sans Variable 的拉丁字符资源由本地字体包提供。
- 未改后端、CI、容器、用户既有通知逻辑或手工编辑生成路由；未新增不需要的菜单组件。半透明菜单设置用于后续支持该预设的浮层组件。

## 首次验证

- `preset resolve --json` 返回 code=b1Zh6udKE，fallbacks=[]；info 返回 base=base/style=base-lyra。
- `vp install --frozen-lockfile`、`vp check`、`vp test run`（14 项）、`vp run test:e2e`（20 项）、`vp build`、`git diff --check` 全部通过。
- E2E 包含上传、账号设置、复选框、进度条以及 7 项错误提示布局回归。
- 额外临时 Chromium 检查通过：Noto Sans 字体文件实际加载，body 使用 Noto Sans Variable，按钮为直角，输入框高 32px，390px 手机页面无横向溢出。检查并查看了桌面站点设置和手机登录截图，临时测试文件已删除。
- 项目源码和锁文件中无 Radix 引入，剩余 Radix 封装 0。

## 页面形状覆盖修正

用户指出剩余圆角后，检查发现页面导航、列表、代码块、封面、标签、播放器和裁剪器仍包含旧 `rounded` / `rounded-md` / `rounded-full`；播放器还通过调用方 className 覆盖了 Button 的 Lyra 样式。Sonner 则把非零的默认 `--radius` 直接用于通知框，并保留了其自带按钮圆角。

`radius=default` 与 Lyra 组件使用 `rounded-none` 并不矛盾：前者保存通用主题令牌，后者决定对应组件形状。因此本次未修改 `--radius: 0.625rem`，也没有使用全局 `* { border-radius: 0 !important }`。

- 清理站点与管理导航、列表、编辑区、封面、代码块、步骤标记、播放器和裁剪器的旧圆角。
- 7 个文件内的 13 处手写状态/别名/关联标签改用现有 Badge，颜色和形状由预设组件控制；收藏夹选择按钮复用 Button，并保留选中状态语义。
- Sonner 通知表面及关闭/操作按钮使用直角；合并调用方 toastOptions，保留错误去重、长内容滚动、关闭按钮的中文标签和浮层布局。
- 通过 `shadcn add @shadcn/avatar --yes` 获取官方 Base Lyra Avatar，用于艺术家头像及加载失败回退。官方 Avatar 的圆形是有意设计，不属于残留圆角；未引入 Radix。

### 修正后的验证

- 新增持久化浏览器回归 `web/e2e/preset.spec.ts`：1280px/390px 下遍历 17 个页面及 404 页面，检查实际计算样式及伪元素，不只匹配源码 className；仅豁免官方 Avatar 子树。
- 另检查展开后的艺术家/专辑/曲目编辑区、关联标签、播放器、API Key 首次展示、B 站收藏夹选中状态、视频封面、裁剪器、错误通知及关闭按钮，并验证 Avatar 确实保持圆形。
- `vp install --frozen-lockfile`、`vp check`、`vp test run`（14 项）、`vp run test:e2e`（24 项）、`vp build`、`git diff --check` 全部通过；原有错误提示布局回归仍通过。
- 查看桌面编辑页、手机导入错误页截图；测试使用模拟业务数据，不代表已遍历任意真实数据或浏览器原生弹窗。
- `preset resolve --json` 仍返回 code=b1Zh6udKE、fallbacks=[]；后端、CI、容器和此前未提交的其他工作保持原样。

## 静态标签与操作按钮的区分

随后在实际控制台验证发现，默认 Badge 与默认 Button 在 Lyra 中共享主色背景、文字颜色、字号及直角，仅尺寸和交互反馈不同。静态“启用”标签紧邻操作按钮时容易混淆，因此不调整预设或基础组件，而统一修改调用方的 variant：

- 控制台与管理端两处 API Key 状态改为 `outline`、“已启用”和勾选图标。
- 曲目“可搜索”状态改为 `outline` 并加勾选图标；音质和首页 HTTP 方法标签也改用 `outline`。
- 保留原有 `secondary` / `destructive` 标签以及所有操作按钮样式；应用内不再有静态标签使用主色 `default`。
- 实际浏览器确认“已启用”为透明背景、深色文字和描边，“创建”仍为蓝底主按钮。14 项单测、24 项 E2E、检查和构建再次通过。
