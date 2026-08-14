// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package data

import (
	"context"
	"testing"

	"github.com/bytedance/gg/gptr"
	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/data/domain/dataset"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/entity"
	"github.com/stretchr/testify/assert"
)

func TestConvert2DatasetFieldSchemas(t *testing.T) {
	ctx := context.Background()
	t.Run("empty", func(t *testing.T) {
		res, err := convert2DatasetFieldSchemas(ctx, nil)
		assert.NoError(t, err)
		assert.Nil(t, res)
	})

	t.Run("normal", func(t *testing.T) {
		schemas := []*entity.FieldSchema{
			{Key: "k1", Name: "n1", ContentType: "Text"},
		}
		res, err := convert2DatasetFieldSchemas(ctx, schemas)
		assert.NoError(t, err)
		assert.Len(t, res, 1)
		assert.Equal(t, "k1", *res[0].Key)
	})
}

func TestConvert2DatasetData(t *testing.T) {
	ctx := context.Background()
	t.Run("empty", func(t *testing.T) {
		res, err := convert2DatasetData(ctx, nil)
		assert.NoError(t, err)
		assert.Nil(t, res)
	})

	t.Run("normal", func(t *testing.T) {
		turns := []*entity.Turn{
			{
				FieldDataList: []*entity.FieldData{
					{
						Key:  "k1",
						Name: "n1",
						Content: &entity.Content{
							ContentType: gptr.Of(entity.ContentTypeText),
							Text:        gptr.Of("hello"),
						},
					},
				},
			},
		}
		res, err := convert2DatasetData(ctx, turns)
		assert.NoError(t, err)
		assert.Len(t, res, 1)
		assert.Equal(t, "k1", *res[0].Key)
		assert.Equal(t, "hello", *res[0].Content)
	})
}

func TestConvert2DatasetDataMultiPart(t *testing.T) {
	ctx := context.Background()
	provider := entity.StorageProvider_ImageX
	turns := []*entity.Turn{{FieldDataList: []*entity.FieldData{{
		Key: "input",
		Content: &entity.Content{
			ContentType: gptr.Of(entity.ContentTypeMultipart),
			MultiPart: []*entity.Content{
				{ContentType: gptr.Of(entity.ContentTypeText), Text: gptr.Of("describe this")},
				{ContentType: gptr.Of(entity.ContentTypeImage), Image: &entity.Image{Name: gptr.Of("cat.png"), URI: gptr.Of("1/file/cat.png"), StorageProvider: &provider}},
				{ContentType: gptr.Of(entity.ContentTypeAudio), Audio: &entity.Audio{Name: gptr.Of("voice.mp3"), URI: gptr.Of("1/file/voice.mp3"), StorageProvider: gptr.Of(entity.StorageProvider_S3)}},
			},
		},
	}}}}

	res, err := convert2DatasetData(ctx, turns)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, dataset.ContentType_MultiPart, res[0].GetContentType())
	assert.Len(t, res[0].Parts, 3)
	assert.Equal(t, "describe this", res[0].Parts[0].GetContent())
	assert.Equal(t, dataset.ContentType_Image, res[0].Parts[1].GetContentType())
	assert.Equal(t, dataset.StorageProvider_S3, res[0].Parts[1].Attachments[0].GetProvider())
	assert.Equal(t, "1/file/cat.png", res[0].Parts[1].Attachments[0].GetURI())
	assert.Equal(t, dataset.ContentType_Audio, res[0].Parts[2].GetContentType())
}

func TestConvertMultiPartSchemaDefaults(t *testing.T) {
	res, err := convert2DatasetFieldSchemas(context.Background(), []*entity.FieldSchema{{
		Key: "input", Name: "input", ContentType: entity.ContentTypeMultipart,
	}})
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.NotNil(t, res[0].MultiModelSpec)
	assert.Equal(t, int64(20), res[0].MultiModelSpec.GetMaxFileCount())
	assert.Equal(t, int32(50), res[0].MultiModelSpec.GetMaxPartCount())
	assert.Contains(t, res[0].MultiModelSpec.SupportedFormatsByType[dataset.ContentType_Image], "png")
	assert.Contains(t, res[0].MultiModelSpec.SupportedFormatsByType[dataset.ContentType_Audio], "mp3")
	assert.Contains(t, res[0].MultiModelSpec.SupportedFormatsByType[dataset.ContentType_Video], "mp4")
}

func TestConvertMultiPartSchemaMergesPartialSpec(t *testing.T) {
	res, err := convert2DatasetFieldSchemas(context.Background(), []*entity.FieldSchema{{
		Key: "input", Name: "input", ContentType: entity.ContentTypeMultipart,
		MultiModelSpec: &entity.MultiModalSpec{MaxFileCount: 3},
	}})
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.NotNil(t, res[0].MultiModelSpec)
	assert.Equal(t, int64(3), res[0].MultiModelSpec.GetMaxFileCount())
	assert.Equal(t, int64(20*1024*1024), res[0].MultiModelSpec.GetMaxFileSize())
	assert.Equal(t, int32(50), res[0].MultiModelSpec.GetMaxPartCount())
	assert.Contains(t, res[0].MultiModelSpec.SupportedFormatsByType[dataset.ContentType_Audio], "mp3")
}

func TestConvert2DatasetItems(t *testing.T) {
	ctx := context.Background()
	t.Run("empty", func(t *testing.T) {
		res, err := convert2DatasetItems(ctx, nil)
		assert.NoError(t, err)
		assert.Nil(t, res)
	})

	t.Run("normal", func(t *testing.T) {
		items := []*entity.EvaluationSetItem{
			{ID: 1, Turns: []*entity.Turn{{}}},
		}
		res, err := convert2DatasetItems(ctx, items)
		assert.NoError(t, err)
		assert.Len(t, res, 1)
		assert.Equal(t, int64(1), *res[0].ID)
	})
}

func TestConvert2DatasetFeatures(t *testing.T) {
	ctx := context.Background()
	assert.Nil(t, convert2DatasetFeatures(ctx, nil))
	res := convert2DatasetFeatures(ctx, &dataset.DatasetFeatures{
		EditSchema: gptr.Of(true),
	})
	assert.True(t, res.EditSchema)
}

func TestConvert2EvaluationSetFieldSchemas(t *testing.T) {
	ctx := context.Background()
	assert.Nil(t, convert2EvaluationSetFieldSchemas(ctx, nil))
	schemas := []*dataset.FieldSchema{
		{Key: gptr.Of("k1"), ContentType: dataset.ContentTypePtr(dataset.ContentType_Text)},
	}
	res := convert2EvaluationSetFieldSchemas(ctx, schemas)
	assert.Len(t, res, 1)
	assert.Equal(t, "k1", res[0].Key)
}

func TestConvert2EvaluationSetSchema(t *testing.T) {
	ctx := context.Background()
	assert.Nil(t, convert2EvaluationSetSchema(ctx, nil))
	schema := &dataset.DatasetSchema{
		ID: gptr.Of(int64(1)),
	}
	res := convert2EvaluationSetSchema(ctx, schema)
	assert.Equal(t, int64(1), res.ID)
}

func TestConvert2EvaluationSetDraftVersion(t *testing.T) {
	ctx := context.Background()
	assert.Nil(t, convert2EvaluationSetDraftVersion(ctx, nil))
	ds := &dataset.Dataset{
		ID: 1,
	}
	res := convert2EvaluationSetDraftVersion(ctx, ds)
	assert.Equal(t, int64(1), res.ID)
}

func TestConvert2EvaluationSets(t *testing.T) {
	ctx := context.Background()
	assert.Nil(t, convert2EvaluationSets(ctx, nil))
	datasets := []*dataset.Dataset{
		{ID: 1},
	}
	res := convert2EvaluationSets(ctx, datasets)
	assert.Len(t, res, 1)
	assert.Equal(t, int64(1), res[0].ID)
}

func TestConvert2EvaluationSetVersions(t *testing.T) {
	ctx := context.Background()
	assert.Nil(t, convert2EvaluationSetVersions(ctx, nil))
	versions := []*dataset.DatasetVersion{
		{ID: 1},
	}
	res := convert2EvaluationSetVersions(ctx, versions)
	assert.Len(t, res, 1)
	assert.Equal(t, int64(1), res[0].ID)
}

func TestConvert2EvaluationSetItem(t *testing.T) {
	ctx := context.Background()
	assert.Nil(t, convert2EvaluationSetItem(ctx, nil))
	item := &dataset.DatasetItem{
		ID: gptr.Of(int64(1)),
	}
	res := convert2EvaluationSetItem(ctx, item)
	assert.Equal(t, int64(1), res.ID)
}

func TestConvert2EvaluationSetItems(t *testing.T) {
	ctx := context.Background()
	assert.Nil(t, convert2EvaluationSetItems(ctx, nil))
	items := []*dataset.DatasetItem{
		{ID: gptr.Of(int64(1))},
	}
	res := convert2EvaluationSetItems(ctx, items)
	assert.Len(t, res, 1)
	assert.Equal(t, int64(1), res[0].ID)
}

func TestConvert2EvaluationSetErrorGroups(t *testing.T) {
	ctx := context.Background()
	assert.Nil(t, convert2EvaluationSetErrorGroups(ctx, nil))
	errs := []*dataset.ItemErrorGroup{
		{
			Summary: gptr.Of("err"),
			Type:    gptr.Of(dataset.ItemErrorType_MismatchSchema),
			Details: []*dataset.ItemErrorDetail{
				{Message: gptr.Of("detail"), Index: gptr.Of(int32(1))},
			},
		},
	}
	res := convert2EvaluationSetErrorGroups(ctx, errs)
	assert.Len(t, res, 1)
	assert.Equal(t, "err", *res[0].Summary)
	assert.Len(t, res[0].Details, 1)
	assert.Equal(t, "detail", *res[0].Details[0].Message)
}
