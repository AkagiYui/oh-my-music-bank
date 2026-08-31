-- +goose Up
-- 仅替换整套原厂文案；任何文案已被管理员定制时，保留全部现有配置。
WITH defaults (key, previous_value, next_value) AS (
    VALUES
    ('site.system_title', 'Oh My Music Bank', '声迹'),
    ('site.description', '自定义音源系统 —— 上传、解析、检索与分发音频', '探索歌曲、歌手与专辑，查找音乐背后的作品信息。从熟悉的旋律出发，走近你喜欢的音乐。'),
    ('site.home_title', '自定义音源系统', '每一首喜欢，都值得被找到'),
    ('site.home_description', '管理员上传音频，系统自动解析信息并分发到对象存储；你只需一个 API Key 即可检索音乐与获取播放地址。', '重逢一首念念不忘的歌，认识一个打动你的声音，了解一张值得细听的专辑。关于音乐的好奇，就从这里开始。'),
    ('site.footer_text', '', '音乐不止于聆听。')
)
UPDATE settings AS target
SET value = defaults.next_value
FROM defaults
WHERE target.key = defaults.key
  AND NOT EXISTS (
      SELECT 1 FROM defaults AS expected
      LEFT JOIN settings AS current ON current.key = expected.key
      WHERE current.value IS DISTINCT FROM expected.previous_value
  );

-- +goose Down
-- 回退同样只处理完整默认文案，避免覆盖升级后管理员保存的内容。
WITH defaults (key, previous_value, next_value) AS (
    VALUES
    ('site.system_title', '声迹', 'Oh My Music Bank'),
    ('site.description', '探索歌曲、歌手与专辑，查找音乐背后的作品信息。从熟悉的旋律出发，走近你喜欢的音乐。', '自定义音源系统 —— 上传、解析、检索与分发音频'),
    ('site.home_title', '每一首喜欢，都值得被找到', '自定义音源系统'),
    ('site.home_description', '重逢一首念念不忘的歌，认识一个打动你的声音，了解一张值得细听的专辑。关于音乐的好奇，就从这里开始。', '管理员上传音频，系统自动解析信息并分发到对象存储；你只需一个 API Key 即可检索音乐与获取播放地址。'),
    ('site.footer_text', '音乐不止于聆听。', '')
)
UPDATE settings AS target
SET value = defaults.next_value
FROM defaults
WHERE target.key = defaults.key
  AND NOT EXISTS (
      SELECT 1 FROM defaults AS expected
      LEFT JOIN settings AS current ON current.key = expected.key
      WHERE current.value IS DISTINCT FROM expected.previous_value
  );
