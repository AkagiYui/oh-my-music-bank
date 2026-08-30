// Package errors 定义统一的 API 错误响应结构与构造函数。
package errors

// APIError 机器可读的错误码 + 人类可读的消息。
type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ErrorResponse HTTP 错误响应包裹体：{"error": {...}}。
type ErrorResponse struct {
	Error APIError `json:"error"`
}

// New 构造一个错误响应。
func New(code, message string) ErrorResponse {
	return ErrorResponse{Error: APIError{Code: code, Message: message}}
}

// 常见错误的便捷构造函数。
func BadRequest(msg string) ErrorResponse   { return New("bad_request", msg) }
func Unauthorized(msg string) ErrorResponse { return New("unauthorized", msg) }
func Forbidden(msg string) ErrorResponse    { return New("forbidden", msg) }
func NotFound(msg string) ErrorResponse     { return New("not_found", msg) }
func Conflict(msg string) ErrorResponse     { return New("conflict", msg) }
func TooManyRequests(msg string) ErrorResponse {
	return New("rate_limited", msg)
}
func Internal(msg string) ErrorResponse { return New("internal_error", msg) }
