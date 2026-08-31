// Package cache 提供站点设置的内存缓存，避免每次请求都查库。
package cache

import (
	"maps"
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
)

// Manager 设置缓存管理器。
type Manager struct {
	db       *gorm.DB
	mu       sync.RWMutex
	settings map[string]string
	stop     chan struct{}
}

// New 创建缓存管理器。
func New(db *gorm.DB) *Manager {
	return &Manager{
		db:       db,
		settings: make(map[string]string),
		stop:     make(chan struct{}),
	}
}

// WarmSettings 从数据库加载全部设置到内存。
func (m *Manager) WarmSettings() error {
	var rows []model.Setting
	if err := m.db.Find(&rows).Error; err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.settings = make(map[string]string, len(rows))
	for _, r := range rows {
		m.settings[r.Key] = r.Value
	}
	return nil
}

// GetSetting 读取设置值，不存在返回空串。
func (m *Manager) GetSetting(key string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.settings[key]
}

// GetSettingDefault 读取设置值，为空时返回默认值。
func (m *Manager) GetSettingDefault(key, def string) string {
	if v := m.GetSetting(key); v != "" {
		return v
	}
	return def
}

// SetSetting 写穿：更新数据库并刷新内存。
func (m *Manager) SetSetting(key, value string) error {
	if err := m.db.Save(&model.Setting{Key: key, Value: value}).Error; err != nil {
		return err
	}
	m.mu.Lock()
	m.settings[key] = value
	m.mu.Unlock()
	return nil
}

// StartBackgroundRefresh 周期性刷新设置缓存。
func (m *Manager) StartBackgroundRefresh(interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-m.stop:
				return
			case <-t.C:
				_ = m.WarmSettings()
			}
		}
	}()
}

// Stop 停止后台刷新。
func (m *Manager) Stop() {
	close(m.stop)
}

// 多字段配置一次提交，持久化成功后再刷新缓存。
func (m *Manager) SetSettings(values map[string]string) error {
	if err := m.db.Transaction(func(tx *gorm.DB) error {
		for k, v := range values {
			if err := tx.Save(&model.Setting{Key: k, Value: v}).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	maps.Copy(m.settings, values)
	return nil
}
