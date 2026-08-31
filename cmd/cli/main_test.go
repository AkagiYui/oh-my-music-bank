package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func passwordInput(t *testing.T, value string) *os.File {
	t.Helper()
	path := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(path, []byte(value), 0600); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Close() })
	return f
}

func TestCommandHelpAndInvalidArguments(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
		ok   bool
	}{
		{"help", []string{"--help"}, true},
		{"action help", []string{"reset-password", "--help"}, true},
		{"missing action", nil, false},
		{"unknown action", []string{"unknown"}, false},
		{"missing email", []string{"reset-password"}, false},
		{"blank email", []string{"reset-password", "--email", " "}, false},
		{"extra argument", []string{"reset-password", "--email", "a@example.com", "extra"}, false},
		{"unknown flag", []string{"reset-password", "--unknown"}, false},
		{"plaintext flag", []string{"reset-password", "--password", "not-a-real-secret"}, false},
		{"nonterminal", []string{"reset-password", "--email", "a@example.com"}, false},
		{"missing config", []string{"reset-password", "--email", "a@example.com", "--password-stdin", "--config", filepath.Join(t.TempDir(), "missing.yaml")}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var output bytes.Buffer
			err := run(tc.args, passwordInput(t, ""), &output, &output)
			if (err == nil) != tc.ok {
				t.Fatalf("unexpected result: %v", err)
			}
			if tc.ok && !strings.Contains(output.String(), "reset-password") {
				t.Fatalf("help missing action: %s", &output)
			}
			if strings.Contains(output.String(), "not-a-real-secret") {
				t.Fatal("password leaked to command output")
			}
		})
	}
}

func TestReadPasswordStdin(t *testing.T) {
	for _, tc := range []struct {
		name, input, want string
		ok                bool
	}{
		{"EOF", "12345678", "12345678", true},
		{"LF", "12345678\n", "12345678", true},
		{"CRLF", "12345678\r\n", "12345678", true},
		{"preserve spaces", " 12345678 \n", " 12345678 ", true},
		{"unicode", strings.Repeat("密", 8), strings.Repeat("密", 8), true},
		{"72 bytes", strings.Repeat("密", 24) + "\r\n", strings.Repeat("密", 24), true},
		{"empty", "", "", false},
		{"short", "1234567", "", false},
		{"short unicode", strings.Repeat("密", 7), "", false},
		{"73 bytes", strings.Repeat("a", 73), "", false},
		{"long unicode", strings.Repeat("密", 25), "", false},
		{"huge", strings.Repeat("x", 10000), "", false},
		{"multiple lines", "12345678\n87654321\n", "", false},
		{"NUL", "12345678\x00", "", false},
		{"invalid UTF-8", "12345678\xff", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := readPassword(passwordInput(t, tc.input), io.Discard, true)
			if (err == nil) != tc.ok || string(got) != tc.want {
				t.Fatalf("password validation: len=%d, error=%v", len(got), err)
			}
		})
	}
}
