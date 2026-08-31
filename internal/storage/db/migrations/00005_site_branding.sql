-- +goose Up
-- 品牌配置集中持久化；旧键只做一次数据迁移，运行时不再读取旧配置。
INSERT INTO settings (key, value)
VALUES
    ('site.system_title', COALESCE((SELECT NULLIF(trim(value), '') FROM settings WHERE key = 'site.brand_name'), 'Oh My Music Bank')),
    ('site.description', '自定义音源系统 —— 上传、解析、检索与分发音频'),
    ('site.home_title', '自定义音源系统'),
    ('site.home_description', '管理员上传音频，系统自动解析信息并分发到对象存储；你只需一个 API Key 即可检索音乐与获取播放地址。'),
    ('site.logo_url', ''), ('site.favicon_url', ''),
    ('site.footer_text', ''), ('site.footer_link_url', ''),
    ('site.api_origin', '')
ON CONFLICT (key) DO NOTHING;
DELETE FROM settings WHERE key = 'site.brand_name';

-- +goose Down
INSERT INTO settings (key, value)
SELECT 'site.brand_name', value FROM settings WHERE key = 'site.system_title'
ON CONFLICT (key) DO NOTHING;
DELETE FROM settings WHERE key IN (
    'site.system_title', 'site.description', 'site.home_title', 'site.home_description',
    'site.logo_url', 'site.favicon_url', 'site.footer_text', 'site.footer_link_url', 'site.api_origin'
);
