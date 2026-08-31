package bilibili

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

// AccountClient 将协议与持久化分开，测试可以覆盖完整刷新事务而不访问真实账号。
type AccountClient interface {
	GenerateQR(context.Context) (QRCode, error)
	PollQR(context.Context, string) (string, Credentials, error)
	Profile(context.Context, string) (Profile, error)
	RefreshCookies(context.Context, Credentials) (Credentials, bool, error)
	ConfirmRefresh(context.Context, string, string) error
}

type Accounts struct {
	db     *gorm.DB
	client AccountClient
}

func NewAccounts(db *gorm.DB, client AccountClient) *Accounts {
	// 即使数据库报错，也不能把 Cookie/刷新令牌连同 SQL 参数打印到日志。
	return &Accounts{db: db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}), client: client}
}

type AccountView struct {
	model.BilibiliAccount
	CanRefresh     bool `json:"canRefresh"`
	ConfirmPending bool `json:"confirmPending"`
}

func view(a model.BilibiliAccount) AccountView {
	return AccountView{BilibiliAccount: a, CanRefresh: a.RefreshToken != "", ConfirmPending: a.PendingRefreshToken != ""}
}

func (a *Accounts) List(ctx context.Context) ([]AccountView, error) {
	var rows []model.BilibiliAccount
	err := a.db.WithContext(ctx).Order("is_default DESC, created_at ASC, id ASC").Find(&rows).Error
	result := make([]AccountView, 0, len(rows))
	for _, row := range rows {
		result = append(result, view(row))
	}
	return result, err
}

func (a *Accounts) Get(ctx context.Context, id string) (model.BilibiliAccount, error) {
	var row model.BilibiliAccount
	q := a.db.WithContext(ctx)
	if id == "" {
		q = q.Where("is_default = TRUE")
	} else {
		q = q.Where("id = ?", id)
	}
	err := q.First(&row).Error
	return row, err
}

// Credentials 固定每次业务操作的账号快照；非默认账号不存在时绝不回退到默认账号。
func (a *Accounts) Credentials(ctx context.Context, id string) (model.BilibiliAccount, error) {
	row, err := a.Get(ctx, id)
	if err != nil {
		return row, errors.New("请先在集成配置中登录或选择可用的哔哩哔哩账号")
	}
	if row.LastCheckedAt == nil || time.Since(*row.LastCheckedAt) > 12*time.Hour {
		result, refreshErr := a.Refresh(ctx, row.ID, false)
		if refreshErr != nil {
			return row, refreshErr
		}
		row = result.BilibiliAccount
	}
	if row.Status == "expired" {
		return row, ErrLoginExpired
	}
	return row, nil
}

// 账号列表操作使用数据库事务锁，保证跨实例的默认账号和 UID 去重一致。
func lockAccounts(tx *gorm.DB) error { return tx.Exec("SELECT pg_advisory_xact_lock(91120002)").Error }

func (a *Accounts) SetDefault(ctx context.Context, id string) error {
	return a.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAccounts(tx); err != nil {
			return err
		}
		var row model.BilibiliAccount
		if err := tx.Where("id = ?", id).First(&row).Error; err != nil {
			return err
		}
		if row.Status == "expired" {
			return ErrLoginExpired
		}
		if err := tx.Model(&model.BilibiliAccount{}).Where("is_default = TRUE").Update("is_default", false).Error; err != nil {
			return err
		}
		return tx.Model(&row).Update("is_default", true).Error
	})
}

func (a *Accounts) Delete(ctx context.Context, id string) error {
	return a.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAccounts(tx); err != nil {
			return err
		}
		var row model.BilibiliAccount
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&row).Error; err != nil {
			return err
		}
		if err := tx.Delete(&row).Error; err != nil {
			return err
		}
		if !row.IsDefault {
			return nil
		}
		var next model.BilibiliAccount
		err := tx.Where("status <> 'expired'").Order("created_at, id").First(&next).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		return tx.Model(&next).Update("is_default", true).Error
	})
}

type LoginView struct {
	ID        string       `json:"id"`
	URL       string       `json:"url,omitempty"`
	ExpiresAt time.Time    `json:"expiresAt"`
	Status    string       `json:"status"`
	Account   *AccountView `json:"account,omitempty"`
}

func (a *Accounts) CreateLogin(ctx context.Context, userID string) (LoginView, error) {
	if userID == "" {
		return LoginView{}, errors.New("缺少登录用户")
	}
	qr, err := a.client.GenerateQR(ctx)
	if err != nil {
		return LoginView{}, err
	}
	s := model.BilibiliLogin{ID: uuid.NewString(), UserID: userID, QRKey: qr.Key, ExpiresAt: time.Now().Add(180 * time.Second)}
	err = a.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAccounts(tx); err != nil {
			return err
		}
		// 每个站点用户只保留最新二维码，重新生成立即使旧轮询失效。
		if err := tx.Where("user_id = ? OR expires_at < ?", userID, time.Now()).Delete(&model.BilibiliLogin{}).Error; err != nil {
			return err
		}
		return tx.Create(&s).Error
	})
	return LoginView{ID: s.ID, URL: qr.URL, ExpiresAt: s.ExpiresAt, Status: "waiting"}, err
}

func (a *Accounts) PollLogin(ctx context.Context, userID, id string) (LoginView, error) {
	result := LoginView{ID: id}
	err := a.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAccounts(tx); err != nil {
			return err
		}
		var s model.BilibiliLogin
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", id, userID).First(&s).Error; err != nil {
			return err
		}
		result.ExpiresAt = s.ExpiresAt
		if s.AccountID != nil {
			var account model.BilibiliAccount
			if err := tx.Where("id = ?", *s.AccountID).First(&account).Error; err != nil {
				return err
			}
			v := view(account)
			result.Status = "success"
			result.Account = &v
			return nil
		}
		if s.QRKey == "" || time.Now().After(s.ExpiresAt) {
			result.Status = "expired"
			return nil
		}
		if s.LastPollAt != nil && time.Since(*s.LastPollAt) < 2*time.Second {
			result.Status = "waiting"
			return nil
		}
		now := time.Now()
		status, credentials, err := a.client.PollQR(ctx, s.QRKey)
		if err != nil {
			return err
		}
		result.Status = status
		if status == "expired" {
			s.ExpiresAt = now
		}
		if status == "success" {
			mid := cookieValue(credentials.Cookie, "DedeUserID")
			if n, err := strconv.ParseInt(mid, 10, 64); err != nil || n <= 0 {
				return errors.New("登录账号 UID 无效")
			}
			// 即使资料接口暂时失败，也先保存一次性扫码结果，避免已确认的登录丢失。
			p, profileErr := a.client.Profile(ctx, credentials.Cookie)
			if profileErr == nil && strconv.FormatInt(p.MID, 10) != mid {
				return errors.New("登录账号与资料不匹配")
			}
			var account model.BilibiliAccount
			err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("mid = ?", mid).First(&account).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				// 旧 Cookie 可能不含 UID，识别到相同会话时原位升级，保留任务引用。
				err = tx.Where("id = 'legacy' AND mid IS NULL").First(&account).Error
				if err == nil {
					legacy, e := a.client.Profile(ctx, account.Cookie)
					if e != nil || strconv.FormatInt(legacy.MID, 10) != mid {
						account = model.BilibiliAccount{}
					}
				} else if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
			} else if err != nil {
				return err
			}
			if account.ID == "" {
				account = model.BilibiliAccount{ID: uuid.NewString(), Name: "哔哩哔哩用户 " + mid}
			}
			account.MID = &mid
			account.Cookie = credentials.Cookie
			account.RefreshToken = credentials.RefreshToken
			account.PendingRefreshToken = ""
			account.Status = "active"
			account.LastCheckedAt = &now
			if profileErr == nil {
				account.Name = p.Name
				account.Avatar = p.Avatar
			}
			if profileErr != nil {
				account.Status = "unchecked"
				account.LastCheckedAt = nil
			}
			var count int64
			if err := tx.Model(&model.BilibiliAccount{}).Where("is_default = TRUE").Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				account.IsDefault = true
			}
			if err := tx.Save(&account).Error; err != nil {
				return err
			}
			s.AccountID = &account.ID
			s.QRKey = ""
			v := view(account)
			result.Account = &v
		}
		s.LastPollAt = &now
		return tx.Save(&s).Error
	})
	return result, err
}

// Refresh 用行锁串行化手动/自动刷新，只有明确的认证失效才标记过期。
func (a *Accounts) Refresh(ctx context.Context, id string, force bool) (AccountView, error) {
	var row model.BilibiliAccount
	var upstreamErr error
	err := a.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&row).Error; err != nil {
			return err
		}
		if !force && row.LastCheckedAt != nil && time.Since(*row.LastCheckedAt) < 12*time.Hour && row.PendingRefreshToken == "" {
			return nil
		}
		// 上次新凭据已经落库但确认失败时，先重试确认，不能再次轮换。
		if row.PendingRefreshToken != "" {
			if err := a.client.ConfirmRefresh(ctx, row.Cookie, row.PendingRefreshToken); err != nil {
				upstreamErr = err
				return nil
			}
			row.PendingRefreshToken = ""
		}
		creds := Credentials{Cookie: row.Cookie, RefreshToken: row.RefreshToken}
		now := time.Now()
		if row.RefreshToken != "" {
			next, changed, e := a.client.RefreshCookies(ctx, creds)
			if e != nil {
				upstreamErr = e
			} else if changed {
				row.Cookie = next.Cookie
				row.PendingRefreshToken = row.RefreshToken
				row.RefreshToken = next.RefreshToken
				row.LastRefreshedAt = &now
			}
		}
		if upstreamErr == nil {
			p, e := a.client.Profile(ctx, row.Cookie)
			if e != nil {
				upstreamErr = e
			} else if row.MID != nil && *row.MID != strconv.FormatInt(p.MID, 10) {
				upstreamErr = errors.New("账号资料与已保存的 UID 不匹配")
			} else {
				// 未知 UID 的旧账号保持 NULL，扫码时在去重事务中完成身份合并。
				row.Name = p.Name
				row.Avatar = p.Avatar
				row.Status = "active"
			}
		}
		if errors.Is(upstreamErr, ErrLoginExpired) {
			row.Status = "expired"
		}
		if upstreamErr == nil || errors.Is(upstreamErr, ErrLoginExpired) {
			row.LastCheckedAt = &now
		}
		return tx.Save(&row).Error
	})
	if err != nil {
		return view(row), err
	}
	if upstreamErr != nil {
		return view(row), upstreamErr
	}
	// 必须在前一个事务成功提交之后确认；进程重启后 pending 字段仍可恢复。
	if row.PendingRefreshToken != "" {
		err = a.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&row).Error; err != nil {
				return err
			}
			if row.PendingRefreshToken == "" {
				return nil
			}
			if err := a.client.ConfirmRefresh(ctx, row.Cookie, row.PendingRefreshToken); err != nil {
				return nil
			}
			row.PendingRefreshToken = ""
			return tx.Save(&row).Error
		})
	}
	return view(row), err
}

// Maintain 在现有后台工作器中调用；所有账号均检查，不只维护默认账号。
func (a *Accounts) Maintain(ctx context.Context) {
	rows, err := a.List(ctx)
	if err != nil {
		return
	}
	for _, row := range rows {
		if ctx.Err() != nil {
			return
		}
		if row.RefreshToken == "" || row.Status == "expired" {
			continue
		}
		callCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		_, _ = a.Refresh(callCtx, row.ID, false)
		cancel()
	}
}
