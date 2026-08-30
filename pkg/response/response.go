// Package response 提供统一的 HTTP JSON 响应辅助函数。
package response

import (
	"net/http"
	"reflect"

	"github.com/gin-gonic/gin"
)

// PaginatedResponse 列表响应中的分页元数据。
type PaginatedResponse struct {
	Data     any   `json:"data"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

// ensureNonNilSlice 把 nil slice 兜底为空切片，避免 JSON 序列化成 null 导致前端无法迭代。
func ensureNonNilSlice(data any) any {
	if data == nil {
		return data
	}
	v := reflect.ValueOf(data)
	if v.Kind() == reflect.Slice && v.IsNil() {
		return reflect.MakeSlice(v.Type(), 0, 0).Interface()
	}
	return data
}

// Success 返回标准成功响应（200）。
func Success(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{"data": data})
}

// Created 返回 201 创建成功响应。
func Created(c *gin.Context, data any) {
	c.JSON(http.StatusCreated, gin.H{"data": data})
}

// NoContent 返回 204 无内容响应。
func NoContent(c *gin.Context) {
	c.Status(http.StatusNoContent)
}

// Paginated 返回带分页元数据的成功响应。
func Paginated(c *gin.Context, data any, total int64, page, pageSize int) {
	c.JSON(http.StatusOK, PaginatedResponse{
		Data:     ensureNonNilSlice(data),
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}
