// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package data

import (
	"context"
	"errors"
	"testing"

	"github.com/bytedance/gg/gptr"
	"github.com/stretchr/testify/assert"
	"go.uber.org/mock/gomock"

	rpcmocks "github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/component/rpc/mocks"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/entity"
)

func TestValidateMultiPartDataStore(t *testing.T) {
	ctrl := gomock.NewController(t)
	fileProvider := rpcmocks.NewMockIFileProvider(ctrl)
	fileProvider.EXPECT().UploadFileForServer(gomock.Any(), "image/png", []byte("png"), int64(12)).Return("12/cat.png", nil)
	fileProvider.EXPECT().MGetFileURL(gomock.Any(), []string{"12/cat.png"}).Return(map[string]string{"12/cat.png": "https://files/cat.png"}, nil)
	adapter := &DatasetRPCAdapter{
		fileProvider: fileProvider,
		mediaFetcher: fakeRemoteMediaFetcher{media: &fetchedRemoteMedia{Body: []byte("png"), ContentType: "image/png", Name: "cat.png"}},
	}
	strategy := entity.MultiModalStoreStrategyStore
	typ := entity.ContentTypeImage

	result, err := adapter.ValidateMultiPartData(context.Background(), 12, []string{"https://example.com/cat.png"}, &entity.MultiModalStoreOption{
		MultiModalStoreStrategy: &strategy,
		ContentType:             &typ,
	})
	assert.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Nil(t, result[0].ErrorType)
	assert.Equal(t, "https://example.com/cat.png", gptr.Indirect(result[0].OriginImage.URL))
	assert.Equal(t, "12/cat.png", gptr.Indirect(result[0].Image.URI))
	assert.Equal(t, "https://files/cat.png", gptr.Indirect(result[0].Image.URL))
	assert.Equal(t, entity.StorageProvider_S3, gptr.Indirect(result[0].Image.StorageProvider))
}

func TestValidateMultiPartDataReturnsPerURLFailure(t *testing.T) {
	adapter := &DatasetRPCAdapter{mediaFetcher: fakeRemoteMediaFetcher{err: errors.New("blocked")}}
	typ := entity.ContentTypeVideo
	result, err := adapter.ValidateMultiPartData(context.Background(), 12, []string{"http://127.0.0.1/video.mp4"}, &entity.MultiModalStoreOption{ContentType: &typ})
	assert.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, entity.ItemErrorType_GetImageFailed, gptr.Indirect(result[0].ErrorType))
	assert.Contains(t, gptr.Indirect(result[0].ErrMsg), "blocked")
}

func TestValidateMultiPartDataRejectsUnknownStrategy(t *testing.T) {
	strategy := entity.MultiModalStoreStrategy("unknown")
	result, err := (&DatasetRPCAdapter{}).ValidateMultiPartData(context.Background(), 12, nil, &entity.MultiModalStoreOption{
		MultiModalStoreStrategy: &strategy,
	})
	assert.Error(t, err)
	assert.Nil(t, result)
}

func TestValidateMultiPartDataReportsUnavailableFileProvider(t *testing.T) {
	adapter := &DatasetRPCAdapter{
		mediaFetcher: fakeRemoteMediaFetcher{media: &fetchedRemoteMedia{Body: []byte("png"), ContentType: "image/png", Name: "cat.png"}},
	}
	result, err := adapter.ValidateMultiPartData(context.Background(), 12, []string{"https://example.com/cat.png"}, nil)
	assert.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, entity.ItemErrorType_UploadImageFailed, gptr.Indirect(result[0].ErrorType))
	assert.Contains(t, gptr.Indirect(result[0].ErrMsg), "file provider is unavailable")
}

func TestValidateRemoteMediaURLBlocksPrivateAddresses(t *testing.T) {
	for _, rawURL := range []string{
		"http://127.0.0.1/a.png",
		"http://10.0.0.1/a.png",
		"http://[::1]/a.png",
		"file:///etc/passwd",
	} {
		t.Run(rawURL, func(t *testing.T) {
			_, err := validateRemoteMediaURL(context.Background(), rawURL)
			assert.Error(t, err)
		})
	}
}

func TestFillEvaluationSetItemMediaURLs(t *testing.T) {
	ctrl := gomock.NewController(t)
	fileProvider := rpcmocks.NewMockIFileProvider(ctrl)
	fileProvider.EXPECT().MGetFileURL(gomock.Any(), []string{"12/cat.png"}).Return(map[string]string{"12/cat.png": "https://signed/cat.png"}, nil)
	provider := entity.StorageProvider_S3
	external := entity.StorageProvider_ExternalUrl
	items := []*entity.EvaluationSetItem{
		{
			Turns: []*entity.Turn{
				{
					FieldDataList: []*entity.FieldData{
						{
							Content: &entity.Content{
								ContentType: gptr.Of(entity.ContentTypeMultipart),
								MultiPart: []*entity.Content{
									{ContentType: gptr.Of(entity.ContentTypeImage), Image: &entity.Image{URI: gptr.Of("12/cat.png"), StorageProvider: &provider}},
									{ContentType: gptr.Of(entity.ContentTypeVideo), Video: &entity.Video{URI: gptr.Of("https://cdn/video.mp4"), StorageProvider: &external}},
								},
							},
						},
					},
				},
			},
		},
	}

	err := (&DatasetRPCAdapter{fileProvider: fileProvider}).fillEvaluationSetItemMediaURLs(context.Background(), items)
	assert.NoError(t, err)
	assert.Equal(t, "https://signed/cat.png", gptr.Indirect(items[0].Turns[0].FieldDataList[0].Content.MultiPart[0].Image.URL))
	assert.Equal(t, "https://cdn/video.mp4", gptr.Indirect(items[0].Turns[0].FieldDataList[0].Content.MultiPart[1].Video.URL))
}
