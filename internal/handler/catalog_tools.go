package handler

import (
	"fmt"
	"github.com/akagiyui/oh-my-music-bank/internal/model"
	"github.com/akagiyui/oh-my-music-bank/internal/service/objectgc"
	"github.com/akagiyui/oh-my-music-bank/internal/storage/objectstore"
	pkgerrors "github.com/akagiyui/oh-my-music-bank/pkg/errors"
	"github.com/akagiyui/oh-my-music-bank/pkg/response"
	"github.com/gin-gonic/gin"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
)

func mergeIDs(c *gin.Context) (int64, int64, error) {
	source, ok := parseInt64Param(c, "id")
	if !ok {
		return 0, 0, fmt.Errorf("invalid source")
	}
	var r struct {
		TargetID string `json:"targetId"`
	}
	if c.ShouldBindJSON(&r) != nil {
		return 0, 0, fmt.Errorf("invalid request")
	}
	target, e := optionalTrackID(r.TargetID)
	if e != nil || target == 0 || target == source {
		return 0, 0, fmt.Errorf("请选择不同的目标 ID")
	}
	return source, target, nil
}
func (h *TrackHandler) Merge(c *gin.Context) {
	source, target, err := mergeIDs(c)
	if err != nil {
		c.JSON(400, pkgerrors.BadRequest(err.Error()))
		return
	}
	err = h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// 按固定顺序加锁，合并和入库不交错；来源文件只转移引用，不删除。
		var tracks []model.Track
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ?", []int64{source, target}).Order("id").Find(&tracks).Error; err != nil {
			return err
		}
		if len(tracks) != 2 {
			return fmt.Errorf("曲目不存在")
		}
		var from, to model.Track
		for _, t := range tracks {
			if t.ID == source {
				from = t
			} else {
				to = t
			}
		}
		var audios []model.Audio
		if err := tx.Where("track_id = ?", source).Find(&audios).Error; err != nil {
			return err
		}
		for _, a := range audios {
			if err := tx.Model(&a).Updates(map[string]any{"track_id": target}).Error; err != nil {
				return err
			}
		}
		for _, stmt := range []string{
			"UPDATE origin_audio SET track_id=? WHERE track_id=?",
			"UPDATE ingest_job SET track_id=? WHERE track_id=?",
			"INSERT INTO track_artists(track_id,artist_id,position) SELECT ?,artist_id,position FROM track_artists WHERE track_id=? ON CONFLICT(track_id,artist_id) DO NOTHING",
			"INSERT INTO track_albums(track_id,album_id,track_no,disc_no) SELECT ?,album_id,track_no,disc_no FROM track_albums WHERE track_id=? ON CONFLICT(track_id,album_id) DO NOTHING",
			"INSERT INTO track_languages(track_id,language_id) SELECT ?,language_id FROM track_languages WHERE track_id=? ON CONFLICT(track_id,language_id) DO NOTHING",
			"INSERT INTO track_aliases(track_id,alias) SELECT ?,alias FROM track_aliases WHERE track_id=? ON CONFLICT(track_id,alias) DO NOTHING",
		} {
			if err := tx.Exec(stmt, target, source).Error; err != nil {
				return err
			}
		}
		if from.Title != to.Title {
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.TrackAlias{TrackID: target, Alias: from.Title}).Error; err != nil {
				return err
			}
		}
		updates := map[string]any{}
		if to.CoverKey == nil || *to.CoverKey == "" {
			updates["cover_key"] = from.CoverKey
		} else if from.CoverKey != nil {
			if err := objectgc.Schedule(tx, objectstore.BucketPublic, *from.CoverKey, 0); err != nil {
				return err
			}
		}
		if to.Lyric == nil || *to.Lyric == "" {
			updates["lyric"] = from.Lyric
		}
		if to.LRCLyric == nil || *to.LRCLyric == "" {
			updates["lrc_lyric"] = from.LRCLyric
		}
		if err := tx.Model(&to).Updates(updates).Error; err != nil {
			return err
		}
		return tx.Delete(&from).Error
	})
	if err != nil {
		c.JSON(422, pkgerrors.BadRequest(err.Error()))
		return
	}
	response.Success(c, gin.H{"id": itoa(target)})
}
func (h *ArtistHandler) Merge(c *gin.Context) {
	source, target, err := mergeIDs(c)
	if err != nil {
		c.JSON(400, pkgerrors.BadRequest(err.Error()))
		return
	}
	err = h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var artists []model.Artist
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ?", []int64{source, target}).Order("id").Find(&artists).Error; err != nil {
			return err
		}
		if len(artists) != 2 {
			return fmt.Errorf("艺术家不存在")
		}
		var from, to model.Artist
		for _, a := range artists {
			if a.ID == source {
				from = a
			} else {
				to = a
			}
		}
		for _, stmt := range []string{
			"INSERT INTO track_artists(artist_id,track_id,position) SELECT ?,track_id,position FROM track_artists WHERE artist_id=? ON CONFLICT(track_id,artist_id) DO NOTHING",
			"INSERT INTO artist_albums(artist_id,album_id) SELECT ?,album_id FROM artist_albums WHERE artist_id=? ON CONFLICT(artist_id,album_id) DO NOTHING",
			"INSERT INTO live_artists(artist_id,live_id,role) SELECT ?,live_id,role FROM live_artists WHERE artist_id=? ON CONFLICT(live_id,artist_id) DO NOTHING",
			"INSERT INTO artist_aliases(artist_id,alias) SELECT ?,alias FROM artist_aliases WHERE artist_id=? ON CONFLICT(artist_id,alias) DO NOTHING",
		} {
			if err := tx.Exec(stmt, target, source).Error; err != nil {
				return err
			}
		}
		if from.Name != to.Name {
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.ArtistAlias{ArtistID: target, Alias: from.Name}).Error; err != nil {
				return err
			}
		}
		if to.AvatarKey == nil || *to.AvatarKey == "" {
			if err := tx.Model(&to).Update("avatar_key", from.AvatarKey).Error; err != nil {
				return err
			}
		} else if from.AvatarKey != nil {
			if err := objectgc.Schedule(tx, objectstore.BucketPublic, *from.AvatarKey, 0); err != nil {
				return err
			}
		}
		return tx.Delete(&from).Error
	})
	if err != nil {
		c.JSON(422, pkgerrors.BadRequest(err.Error()))
		return
	}
	response.Success(c, gin.H{"id": itoa(target)})
}
func (h *AlbumHandler) OrderTracks(c *gin.Context) {
	id, ok := parseInt64Param(c, "id")
	if !ok {
		return
	}
	var r struct {
		Tracks []struct {
			ID      string `json:"id"`
			TrackNo int    `json:"trackNo"`
			DiscNo  int    `json:"discNo"`
		} `json:"tracks"`
	}
	if c.ShouldBindJSON(&r) != nil || len(r.Tracks) > 1000 {
		c.JSON(400, pkgerrors.BadRequest("invalid tracks"))
		return
	}
	err := h.db.Transaction(func(tx *gorm.DB) error {
		seen := map[string]bool{}
		for _, t := range r.Tracks {
			if t.TrackNo < 1 || t.DiscNo < 1 || seen[t.ID] {
				return fmt.Errorf("曲序和碟号必须为正数，曲目不得重复")
			}
			seen[t.ID] = true
			tid, e := optionalTrackID(t.ID)
			if e != nil || tid == 0 {
				return fmt.Errorf("invalid track ID")
			}
			res := tx.Model(&model.TrackAlbum{}).Where("album_id = ? AND track_id = ?", id, tid).Updates(map[string]any{"track_no": t.TrackNo, "disc_no": t.DiscNo})
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected != 1 {
				return fmt.Errorf("曲目不属于此专辑")
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, pkgerrors.BadRequest(err.Error()))
		return
	}
	response.NoContent(c)
}
