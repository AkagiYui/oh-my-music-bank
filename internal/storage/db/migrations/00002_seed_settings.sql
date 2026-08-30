-- +goose Up
-- 站点默认设置：品牌名与注册开关。
INSERT INTO "settings" ("key", "value")
VALUES
    ('site.brand_name', 'Oh My Music Bank'),
    ('site.registration_enabled', 'true')
ON CONFLICT ("key") DO NOTHING;

-- 预置常见语种，供曲目打标使用。
INSERT INTO "language" ("name")
VALUES ('华语'), ('英语'), ('日语'), ('韩语'), ('粤语'), ('器乐')
ON CONFLICT ("name") DO NOTHING;

-- +goose Down
DELETE FROM "settings" WHERE "key" IN ('site.brand_name', 'site.registration_enabled');
DELETE FROM "language" WHERE "name" IN ('华语', '英语', '日语', '韩语', '粤语', '器乐');
