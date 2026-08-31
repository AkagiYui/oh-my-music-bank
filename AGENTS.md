# 项目约定

重构或实现新功能时，添加必要的中文注释。

## 后端（Go / Gin）

- Go 1.26。修改后端后用 `gofmt -w` 格式化，并用 `go vet ./...` 检查。
- 构建测试：`go build -o /dev/null ./cmd/server/.`（避免产物落盘）。
- 数据库结构由 `internal/storage/db/migrations` 下的 goose SQL 迁移维护，
  服务启动时自动执行（`db.Migrate`，带 advisory lock 防并发）。
  **禁止使用 GORM `AutoMigrate` 建表或改表**。新增/修改字段、索引、约束、默认值时，
  必须新增一个 goose migration 文件（编号递增，含 `-- +goose Up` 与 `-- +goose Down`）。
- `internal/model` 中的 GORM tag 仅用于运行时 ORM 映射
  （`column`/`primaryKey`/`foreignKey`/`constraint`/`autoCreateTime`/`autoUpdateTime`/`-`），
  不要在 tag 中维护 `type`/`not null`/`default`/`index`/`uniqueIndex` 等 schema 定义。
- 仓库根 `schema.sql` 是给人看的完整参考，须与 `00001_init_schema.sql` 保持一致。
- 大整数主键（曲目/艺术家的雪花 ID）在 JSON 中以字符串序列化，避免前端精度丢失。

## 前端（React SPA）

- 技术栈：React + TanStack React Router（文件式路由）+ TanStack Query + Vite+（vp）+ Tailwind v4 + shadcn/ui。
- 纯 SPA，无 SSR/SSG。在 `web/` 目录下操作，使用 `vp install --frozen-lockfile` 安装依赖。
- 开发、测试、格式和 lint 配置统一放在 `web/vite.config.ts`；工具链版本及别名由 `web/pnpm-workspace.yaml` 管理。
- 修改后：`vp check`、`vp test run`、`vp run test:e2e` 与 `vp build`。
- Tailwind 任意值写法尽量简化为标准工具类（如 `w-[200px]` → `w-50`）。
- `web/src/routeTree.gen.ts` 由插件在 `vp dev`/`vp build` 时自动生成（已提交以便全新检出可直接 typecheck），不要手改。

## 安全

- API Key 只存 SHA-256，明文仅在创建时返回一次。
- 真实凭据放 `.env`（已被忽略），切勿提交。
