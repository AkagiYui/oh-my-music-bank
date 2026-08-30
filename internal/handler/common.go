// Package handler 提供管理端、认证及开放接口的 HTTP 处理器。
package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"
)

// parsePagination 解析 page/pageSize 查询参数并返回 offset。
func parsePagination(c *gin.Context) (page, pageSize, offset int) {
	page, _ = strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ = strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	return page, pageSize, (page - 1) * pageSize
}
