// ommb 提供仅供服务器维护者使用的命令行 action。
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
)

const usage = `用法：ommb <action> [选项]

可用 action：
  reset-password  按邮箱重置密码，并撤销该账号的全部登录会话

运行 ommb reset-password --help 查看选项。
`

func main() {
	if err := run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "错误：", err)
		os.Exit(1)
	}
}

func run(args []string, input *os.File, output, errOutput io.Writer) error {
	if len(args) == 0 {
		fmt.Fprint(errOutput, usage)
		return errors.New("请指定 action")
	}
	switch args[0] {
	case "help", "-h", "--help":
		fmt.Fprint(output, usage)
		return nil
	case "reset-password":
		err := runResetPassword(args[1:], input, output, errOutput)
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	default:
		fmt.Fprint(errOutput, usage)
		return errors.New("未知 action")
	}
}
