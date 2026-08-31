package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/akagiyui/oh-my-music-bank/internal/config"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	storage "github.com/akagiyui/oh-my-music-bank/internal/storage/db"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/term"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

func runResetPassword(args []string, input *os.File, output, errOutput io.Writer) error {
	flags := flag.NewFlagSet("reset-password", flag.ContinueOnError)
	flags.SetOutput(errOutput)
	email := flags.String("email", "", "需要重置密码的账号邮箱（必填）")
	configPath := flags.String("config", "config.yaml", "配置文件路径；同时读取当前目录 .env 和环境变量")
	fromStdin := flags.Bool("password-stdin", false, "从标准输入读取一行新密码（不进行二次确认）")
	flags.Usage = func() {
		fmt.Fprintln(errOutput, "用法：ommb reset-password --email <邮箱> [--config <路径>] [--password-stdin]")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*email) == "" || flags.NArg() != 0 {
		return errors.New("必须指定 --email，且不能包含位置参数")
	}
	if !*fromStdin && !term.IsTerminal(int(input.Fd())) {
		return errors.New("请在终端中运行以隐藏密码输入，或显式使用 --password-stdin")
	}
	// 显式指定的配置文件拼错时必须失败，避免静默使用其他数据库。
	if flagsWasSet(flags, "config") {
		if _, err := os.Stat(*configPath); err != nil {
			return fmt.Errorf("无法读取指定配置文件: %w", err)
		}
	}
	cfg, err := config.LoadDatabase(*configPath)
	if err != nil {
		return fmt.Errorf("加载数据库配置失败: %w", err)
	}
	password, err := readPassword(input, errOutput, *fromStdin)
	if err != nil {
		return err
	}
	defer clear(password)
	db, err := storage.Init(cfg.DSN, 1, 1, cfg.ConnMaxLifetimeSecs, cfg.ConnMaxIdleTimeSecs)
	if err != nil {
		return fmt.Errorf("连接数据库失败: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	defer sqlDB.Close()

	// 维护命令不执行迁移；锁等待超时或任一写入失败时整体回滚。
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	u, err := resetPassword(ctx, db, *email, password)
	if err != nil {
		return err
	}
	fmt.Fprintf(output, "已重置 %s 的密码，并撤销全部登录会话。\n", u.Email)
	if !u.IsActive {
		fmt.Fprintln(output, "该账号仍处于禁用状态，需要管理员启用后才能登录。")
	}
	return nil
}

func flagsWasSet(flags *flag.FlagSet, name string) bool {
	found := false
	flags.Visit(func(f *flag.Flag) {
		if f.Name == name {
			found = true
		}
	})
	return found
}

func readPassword(input *os.File, output io.Writer, fromStdin bool) ([]byte, error) {
	if fromStdin {
		// 最多读取 bcrypt 上限加 CRLF 和一个溢出字节；不裁剪密码中的空格。
		password, err := io.ReadAll(io.LimitReader(input, 75))
		if err != nil {
			clear(password)
			return nil, fmt.Errorf("读取密码失败: %w", err)
		}
		password = bytes.TrimSuffix(password, []byte("\n"))
		password = bytes.TrimSuffix(password, []byte("\r"))
		if err := validatePassword(password); err != nil {
			clear(password)
			return nil, err
		}
		return password, nil
	}

	fd := int(input.Fd())
	state, err := term.GetState(fd)
	if err != nil {
		return nil, fmt.Errorf("读取终端状态失败: %w", err)
	}
	// ReadPassword 期间收到中断也要恢复回显，避免退出后终端看不到输入。
	interrupts := make(chan os.Signal, 1)
	done := make(chan struct{})
	signal.Notify(interrupts, os.Interrupt, syscall.SIGTERM)
	defer func() {
		signal.Stop(interrupts)
		close(done)
		_ = term.Restore(fd, state)
	}()
	go func() {
		select {
		case <-interrupts:
			_ = term.Restore(fd, state)
			os.Exit(130)
		case <-done:
		}
	}()
	fmt.Fprint(output, "新密码（至少 8 个字符，最多 72 字节，输入不回显）：")
	password, err := term.ReadPassword(fd)
	fmt.Fprintln(output)
	if err != nil {
		clear(password)
		return nil, fmt.Errorf("读取密码失败: %w", err)
	}
	if err := validatePassword(password); err != nil {
		clear(password)
		return nil, err
	}
	fmt.Fprint(output, "再次输入新密码：")
	confirmation, err := term.ReadPassword(fd)
	fmt.Fprintln(output)
	defer clear(confirmation)
	if err != nil {
		clear(password)
		return nil, fmt.Errorf("读取确认密码失败: %w", err)
	}
	if !bytes.Equal(password, confirmation) {
		clear(password)
		return nil, errors.New("两次输入的密码不一致，未做任何修改")
	}
	return password, nil
}

func validatePassword(password []byte) error {
	if !utf8.Valid(password) || utf8.RuneCount(password) < 8 || len(password) > 72 || bytes.ContainsAny(password, "\r\n\x00") {
		return errors.New("密码必须为至少 8 个字符、最多 72 字节的有效 UTF-8 单行文本，不能含 NUL")
	}
	return nil
}

// resetPassword 与登录、刷新共用用户行锁，使密码更新和会话撤销原子生效。
func resetPassword(ctx context.Context, db *gorm.DB, email string, password []byte) (*model.User, error) {
	if err := validatePassword(password); err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword(password, 12)
	if err != nil {
		return nil, fmt.Errorf("生成密码哈希失败: %w", err)
	}
	var user model.User
	// 错误 SQL 也不能把密码哈希写入终端日志。
	err = db.WithContext(ctx).Session(&gorm.Session{Logger: logger.Discard}).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("email = ?", email).First(&user).Error; err != nil {
			return err
		}
		if err := tx.Model(&user).Update("password_hash", string(hash)).Error; err != nil {
			return err
		}
		return tx.Where("user_id = ?", user.ID).Delete(&model.AuthSession{}).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errors.New("未找到该邮箱对应的账号，未做任何修改")
	}
	if err != nil {
		// 数据库错误可能包含连接凭据或参数，不向命令行输出原始错误。
		return nil, errors.New("重置失败，事务已回滚；请检查数据库连接、权限及迁移状态")
	}
	return &user, nil
}
