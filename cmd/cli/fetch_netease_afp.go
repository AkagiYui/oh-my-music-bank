package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/akagiyui/oh-my-music-bank/internal/service/recognize"
)

// runFetchNeteaseAFP 把网易云指纹资源下载到本地目录，供镜像构建期预置使用。
// 与管理端「从 Chrome 应用店拉取」共用同一套解包与哈希校验逻辑。
func runFetchNeteaseAFP(args []string, output, errOutput io.Writer) error {
	flags := flag.NewFlagSet("fetch-netease-afp", flag.ContinueOnError)
	flags.SetOutput(errOutput)
	out := flags.String("out", "", "输出目录（必填）")
	source := flags.String("url", "", "自定义下载地址（CRX 或 ZIP）；留空使用 Chrome 应用店")
	skipVerify := flags.Bool("skip-verify", false, "跳过内容哈希校验；拉进来的将是未经审计的第三方代码")
	timeout := flags.Duration("timeout", time.Minute, "下载超时")
	flags.Usage = func() {
		fmt.Fprintln(errOutput, "用法：ommb fetch-netease-afp --out <目录> [--url <地址>] [--skip-verify]")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *out == "" || flags.NArg() != 0 {
		flags.Usage()
		return errors.New("--out 必填")
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	assets, err := recognize.FetchAFPAssets(ctx, *source, !*skipVerify)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		return err
	}
	for name, data := range map[string][]byte{
		recognize.AFPWasmName: assets.Wasm,
		recognize.AFPGlueName: assets.Glue,
	} {
		if err := os.WriteFile(filepath.Join(*out, name), data, 0o644); err != nil {
			return err
		}
	}
	fmt.Fprintf(output, "已写入 %s：%s %d 字节，%s %d 字节（扩展版本 %s，哈希校验 %v）\n",
		*out, recognize.AFPWasmName, len(assets.Wasm), recognize.AFPGlueName, len(assets.Glue), assets.Version, assets.Verified)
	return nil
}
