package model

// User 系统用户，包含认证信息与角色权限。
type User struct {
	Base
	Username     string `json:"username"`                      // 用户名（唯一）
	Email        string `json:"email"`                         // 邮箱（唯一），用于登录
	PasswordHash string `gorm:"column:password_hash" json:"-"` // bcrypt 密码哈希，不对外暴露
	Role         string `json:"role"`                          // admin / user
	IsActive     bool   `gorm:"column:is_active" json:"isActive"`

	APIKeys []APIKey `gorm:"foreignKey:UserID" json:"-"`
}

// TableName 返回用户表名。
func (User) TableName() string { return "app_user" }
