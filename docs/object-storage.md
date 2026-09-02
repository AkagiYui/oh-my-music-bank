# 对象存储部署

生产环境使用两个不同的 S3/MinIO 桶：

- 公共桶：只保存 `cover/` 下的封面和头像，允许匿名 `s3:GetObject`。
- 私有桶：保存 `audio/`、`origin/`、`staging/`，不配置匿名策略。

应用只在用户点击播放或下载时签发私有桶的短期 GET URL。曲目详情接口仅返回 UUID 和音频元数据，
不会返回对象 key 或可播放地址。预签名 URL 响应使用 `Cache-Control: private, no-store`。

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

私有桶不要设置匿名策略。为应用单独创建服务账号，不使用 MinIO 管理员 AK/SK；其策略可限制为：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::ommb-public", "arn:aws:s3:::ommb-private"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::ommb-public/*", "arn:aws:s3:::ommb-private/*"]
    }
  ]
}
```

预签名 URL 使用应用 AK/SK 计算签名，不需要额外的 MinIO 权限。若浏览器需要跨域读取音频响应，
私有桶的 CORS 应只允许实际前端来源的 `GET`、`HEAD`，并暴露 `Accept-Ranges`、`Content-Length`、
`Content-Range`；不要用 `*` 放开带凭据请求。

## 切换清单

1. 在 RainS3 控制台创建公共桶和私有桶。
2. 把旧桶的 `cover/` 复制到公共桶，其余 `audio/`、`origin/`、`staging/` 复制到私有桶。
3. 应用公共桶匿名策略，确认私有桶无匿名策略。
4. 创建上述最小权限服务账号并更新 `.env`：

   ```dotenv
   OMMB_STORAGE_PUBLIC_BUCKET=ommb-public
   OMMB_STORAGE_PRIVATE_BUCKET=ommb-private
   OMMB_STORAGE_PUBLIC_BASE_URL=https://ommb-public.cn-nb1.rains3.com
   OMMB_STORAGE_PRESIGNED_URL_TTL=30m
   ```

5. 分别验证公共封面匿名请求为 200、私有音频匿名请求为 403、应用签发地址可返回 200/206。
6. 数据库迁移和应用部署完成、抽样核对对象后，再按运维保留期删除旧桶；不要在切换当天删除回滚副本。
