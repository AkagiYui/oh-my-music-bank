package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/akagiyui/oh-my-music-bank/internal/service/objectgc"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/idgen"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
)

// ArtistHandler 处理管理员的艺术家管理。
type ArtistHandler struct {
	db    *gorm.DB
	store *objectstore.Public
}

// NewArtistHandler 创建艺术家处理器。
func NewArtistHandler(db *gorm.DB, store *objectstore.Public) *ArtistHandler {
	return &ArtistHandler{db: db, store: store}
}

type artistAliasDTO struct {
	ID    string `json:"id"`
	Alias string `json:"alias"`
}

type artistListItem struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	AvatarURL  string `json:"avatarUrl,omitempty"`
	TrackCount int64  `json:"trackCount"`
}

type artistDetailDTO struct {
	ID         string           `json:"id"`
	Name       string           `json:"name"`
	AvatarKey  string           `json:"avatarKey,omitempty"`
	AvatarURL  string           `json:"avatarUrl,omitempty"`
	Aliases    []artistAliasDTO `json:"aliases"`
	Albums     []AlbumDTO       `json:"albums"`
	TrackCount int64            `json:"trackCount"`
}

// List 列出艺术家（可按关键词过滤），含曲目数量。
func (h *ArtistHandler) List(c *gin.Context) {
	page, pageSize, offset := parsePagination(c)
	query := h.db.Model(&model.Artist{})
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		query = query.Where("name ILIKE ?", "%"+q+"%")
	}
	var total int64
	query.Count(&total)

	var artists []model.Artist
	if err := query.Order("name ASC").Offset(offset).Limit(pageSize).Find(&artists).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to list artists"))
		return
	}

	// 批量统计曲目数。
	counts := map[int64]int64{}
	if len(artists) > 0 {
		ids := make([]int64, len(artists))
		for i, a := range artists {
			ids[i] = a.ID
		}
		var rows []struct {
			ArtistID int64
			Cnt      int64
		}
		h.db.Table("track_artists").Select("artist_id, COUNT(*) AS cnt").
			Where("artist_id IN ?", ids).Group("artist_id").Scan(&rows)
		for _, r := range rows {
			counts[r.ArtistID] = r.Cnt
		}
	}

	out := make([]artistListItem, 0, len(artists))
	for _, a := range artists {
		item := artistListItem{ID: itoa(a.ID), Name: a.Name, TrackCount: counts[a.ID]}
		if a.AvatarKey != nil {
			item.AvatarURL = h.store.URL(*a.AvatarKey)
		}
		out = append(out, item)
	}
	response.Paginated(c, out, total, page, pageSize)
}

// Detail 返回艺术家详情（别名、专辑、曲目数）。
func (h *ArtistHandler) Detail(c *gin.Context) {
	a, ok := h.find(c)
	if !ok {
		return
	}
	dto := artistDetailDTO{ID: itoa(a.ID), Name: a.Name, Aliases: []artistAliasDTO{}, Albums: []AlbumDTO{}}
	if a.AvatarKey != nil {
		dto.AvatarKey = *a.AvatarKey
		dto.AvatarURL = h.store.URL(*a.AvatarKey)
	}

	var aliases []model.ArtistAlias
	h.db.Where("artist_id = ?", a.ID).Order("alias ASC").Find(&aliases)
	for _, al := range aliases {
		dto.Aliases = append(dto.Aliases, artistAliasDTO{ID: itoa(al.ID), Alias: al.Alias})
	}

	var albums []struct {
		ID       int64
		Title    string
		CoverKey *string
	}
	h.db.Table("artist_albums aa").Select("al.id, al.title, al.cover_key").
		Joins("JOIN album al ON al.id = aa.album_id").Where("aa.artist_id = ?", a.ID).Scan(&albums)
	for _, al := range albums {
		item := AlbumDTO{ID: itoa(al.ID), Title: al.Title}
		if al.CoverKey != nil {
			item.CoverURL = h.store.URL(*al.CoverKey)
		}
		dto.Albums = append(dto.Albums, item)
	}

	h.db.Model(&model.TrackArtist{}).Where("artist_id = ?", a.ID).Count(&dto.TrackCount)
	response.Success(c, dto)
}

// Create 新建艺术家，分配雪花 ID。
func (h *ArtistHandler) Create(c *gin.Context) {
	var req struct {
		Name      string  `json:"name" binding:"required"`
		AvatarKey *string `json:"avatarKey"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	artist := model.Artist{Name: req.Name, AvatarKey: req.AvatarKey, ID: idgen.Next()}
	if err := h.db.Create(&artist).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to create artist"))
		return
	}
	response.Created(c, artist)
}

// Update 修改艺术家名称或头像。
func (h *ArtistHandler) Update(c *gin.Context) {
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	var req struct {
		Name      *string `json:"name"`
		AvatarKey *string `json:"avatarKey"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	updates := map[string]any{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.AvatarKey != nil {
		updates["avatar_key"] = *req.AvatarKey
	}
	if len(updates) == 0 {
		response.NoContent(c)
		return
	}
	if err := h.db.Model(&model.Artist{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to update artist"))
		return
	}
	response.NoContent(c)
}

// AddAlias 为艺术家添加别名。
func (h *ArtistHandler) AddAlias(c *gin.Context) {
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	var req struct {
		Alias string `json:"alias" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	alias := model.ArtistAlias{ArtistID: id, Alias: req.Alias}
	if err := h.db.Create(&alias).Error; err != nil {
		c.JSON(http.StatusConflict, pkgerrors.Conflict("alias already exists or invalid"))
		return
	}
	response.Created(c, alias)
}

// DeleteAlias 删除艺术家别名。
func (h *ArtistHandler) DeleteAlias(c *gin.Context) {
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	if err := h.db.Where("id = ? AND artist_id = ?", c.Param("aliasId"), id).Delete(&model.ArtistAlias{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, pkgerrors.Internal("failed to delete alias"))
		return
	}
	response.NoContent(c)
}

// Delete 删除艺术家（级联解除关联）。
func (h *ArtistHandler) Delete(c *gin.Context) {
	err := h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var item model.Artist
		if err := tx.Where("id = ?", c.Param("id")).First(&item).Error; err != nil {
			return err
		}
		if item.AvatarKey != nil {
			if err := objectgc.Schedule(tx, objectstore.BucketPublic, *item.AvatarKey, 0); err != nil {
				return err
			}
		}
		return tx.Delete(&item).Error
	})
	if err != nil {
		c.JSON(422, pkgerrors.BadRequest("删除失败: "+err.Error()))
		return
	}
	response.NoContent(c)
}

// find 按路径 id 读取艺术家。
func (h *ArtistHandler) find(c *gin.Context) (*model.Artist, bool) {
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return nil, false
	}
	var a model.Artist
	if err := h.db.Where("id = ?", id).First(&a).Error; err != nil {
		c.JSON(http.StatusNotFound, pkgerrors.NotFound("artist not found"))
		return nil, false
	}
	return &a, true
}

// parseInt64Param 解析路径中的 int64 参数。
func parseInt64Param(c *gin.Context, name string) (int64, bool) {
	id, err := strconv.ParseInt(c.Param(name), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest("invalid "+name))
		return 0, false
	}
	return id, true
}
