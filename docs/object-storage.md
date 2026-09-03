# 对象存储部署

生产环境使用两套**完全独立**的 S3/MinIO 配置，分别对应两个桶：

- 公共桶（`storage.public`）：只保存 `cover/` 下的封面和头像，允许匿名 `s3:GetObject`。
- 私有桶（`storage.private`）：保存 `audio/`、`origin/`、`staging/`，不配置匿名策略。

两套配置各自持有 endpoint、Access Key / Secret Key、桶名与 region，互不共享，可以位于不同的服务商、
账号或区域。应用内部为每个桶创建独立的客户端：公共桶客户端只能拼接对外 URL，私有桶客户端只能签发
预签名 URL，二者在类型层面不可互换，避免私有对象被当作公开地址返回。

应用只在用户点击播放或下载时签发私有桶的短期 GET URL。曲目详情接口仅返回 UUID 和音频元数据，
不会返回对象 key 或可播放地址。预签名 URL 响应使用 `Cache-Control: private, no-store`。

## 配置

```dotenv
# 公共桶
S3_PUBLIC_ENDPOINT=https://cn-nb1.rains3.com
S3_PUBLIC_ACCESS_KEY=...
S3_PUBLIC_SECRET_KEY=...
S3_PUBLIC_BUCKET=ommb-public
S3_PUBLIC_REGION=
S3_PUBLIC_BASE_URL=https://ommb-public.cn-nb1.rains3.com

# 私有桶
S3_PRIVATE_ENDPOINT=https://cn-nb1.rains3.com
S3_PRIVATE_ACCESS_KEY=...
S3_PRIVATE_SECRET_KEY=...
S3_PRIVATE_BUCKET=ommb-private
S3_PRIVATE_REGION=
S3_PRIVATE_PRESIGNED_URL_TTL=30m
```

对应的结构化环境变量为 `OMMB_STORAGE_PUBLIC_*` 与 `OMMB_STORAGE_PRIVATE_*`，YAML 键为
`storage.public.*` 与 `storage.private.*`。同一 endpoint 下不允许两者使用同一个桶名。

## 启动自检与状态页

服务启动时对两个桶分别执行 `HeadBucket`，任一桶不可达或不存在立即退出并打印是哪一套配置出错。
管理员在「系统管理 → 概览」可看到两桶的 endpoint、桶名、访问前缀 / 临时地址有效期与连通性，
接口为 `GET /api/v1/admin/storage`，响应不含任何凭据。

## MinIO 策略

公共桶的匿名策略只需要读取对象。把示例中的 `ommb-public` 替换为实际桶名：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": ["*"] },
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::ommb-public/*"]
    }
  ]
}
```

私有桶不要设置匿名策略。为**每个桶单独**创建服务账号，不使用 MinIO 管理员 AK/SK，也不要让一套凭据
同时覆盖两个桶。公共桶账号的策略：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::ommb-public"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::ommb-public/*"]
    }
  ]
}
```

私有桶账号的策略相同，只把资源换成 `ommb-private`。`s3:ListBucket` 用于启动自检的 `HeadBucket`。

预签名 URL 使用私有桶的 AK/SK 计算签名，不需要额外权限。若浏览器需要跨域读取音频响应，
私有桶的 CORS 应只允许实际前端来源的 `GET`、`HEAD`，并暴露 `Accept-Ranges`、`Content-Length`、
`Content-Range`；不要用 `*` 放开带凭据请求。

## 切换清单

1. 在 RainS3 控制台创建公共桶和私有桶，可以位于不同账号或服务商。
2. 把旧桶的 `cover/` 复制到公共桶，其余 `audio/`、`origin/`、`staging/` 复制到私有桶。
3. 应用公共桶匿名策略，确认私有桶无匿名策略。
4. 为两个桶分别创建上述最小权限服务账号，按「配置」一节更新 `.env`。旧的 `S3_ENDPOINT`、
   `S3_ACCESS_KEY`、`S3_SECRET_KEY`、`OMMB_STORAGE_PRESIGNED_URL_TTL` 已不再被读取，可以删除。
5. 启动服务，确认日志打印「对象存储就绪」且概览页两桶均为「可用」。
6. 分别验证公共封面匿名请求为 200、私有音频匿名请求为 403、应用签发地址可返回 200/206。
7. 数据库迁移和应用部署完成、抽样核对对象后，再按运维保留期删除旧桶；不要在切换当天删除回滚副本。
