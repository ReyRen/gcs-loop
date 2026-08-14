// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package data

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/bytedance/gg/gptr"

	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/entity"
)

const (
	maxRemoteMediaBytes = int64(20 * 1024 * 1024)
	remoteMediaTimeout  = 15 * time.Second
)

type fetchedRemoteMedia struct {
	Body        []byte
	ContentType string
	Name        string
}

type remoteMediaFetcher interface {
	Fetch(ctx context.Context, rawURL string, maxBytes int64) (*fetchedRemoteMedia, error)
}

type safeRemoteMediaFetcher struct{}

func (safeRemoteMediaFetcher) Fetch(ctx context.Context, rawURL string, maxBytes int64) (*fetchedRemoteMedia, error) {
	parsed, err := validateRemoteMediaURL(ctx, rawURL)
	if err != nil {
		return nil, err
	}

	transport := &http.Transport{
		// Do not inherit a process-wide HTTP proxy here. The custom dialer is part
		// of the SSRF boundary and must connect to the validated origin directly.
		Proxy:                 nil,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
		DialContext: func(dialCtx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			ips, err := resolvePublicIPs(dialCtx, host)
			if err != nil {
				return nil, err
			}
			return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(dialCtx, network, net.JoinHostPort(ips[0].String(), port))
		},
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   remoteMediaTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			_, err := validateRemoteMediaURL(req.Context(), req.URL.String())
			return err
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "image/*,audio/*,video/*")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("remote media returned HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > maxBytes {
		return nil, fmt.Errorf("remote media exceeds %d bytes", maxBytes)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxBytes {
		return nil, fmt.Errorf("remote media exceeds %d bytes", maxBytes)
	}
	if len(body) == 0 {
		return nil, fmt.Errorf("remote media is empty")
	}

	contentType := strings.ToLower(strings.TrimSpace(strings.SplitN(resp.Header.Get("Content-Type"), ";", 2)[0]))
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = http.DetectContentType(body)
	}
	name := path.Base(parsed.Path)
	if dispositionName := filenameFromDisposition(resp.Header.Get("Content-Disposition")); dispositionName != "" {
		name = dispositionName
	}
	if name == "" || name == "." || name == "/" {
		name = "media"
	}
	if path.Ext(name) == "" {
		if exts, _ := mime.ExtensionsByType(contentType); len(exts) > 0 {
			name += exts[0]
		}
	}
	return &fetchedRemoteMedia{Body: body, ContentType: contentType, Name: name}, nil
}

func validateRemoteMediaURL(ctx context.Context, rawURL string) (*url.URL, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(rawURL))
	if err != nil || parsed.Hostname() == "" {
		return nil, fmt.Errorf("invalid media URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("only http and https media URLs are supported")
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("media URL credentials are not allowed")
	}
	if _, err := resolvePublicIPs(ctx, parsed.Hostname()); err != nil {
		return nil, err
	}
	return parsed, nil
}

func resolvePublicIPs(ctx context.Context, host string) ([]net.IP, error) {
	if ip := net.ParseIP(host); ip != nil {
		if !isPublicIP(ip) {
			return nil, fmt.Errorf("private or local media URL is not allowed")
		}
		return []net.IP{ip}, nil
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(addrs) == 0 {
		return nil, fmt.Errorf("cannot resolve media URL host")
	}
	ips := make([]net.IP, 0, len(addrs))
	for _, addr := range addrs {
		if !isPublicIP(addr.IP) {
			return nil, fmt.Errorf("private or local media URL is not allowed")
		}
		ips = append(ips, addr.IP)
	}
	return ips, nil
}

func isPublicIP(ip net.IP) bool {
	return ip != nil && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() &&
		!ip.IsLinkLocalMulticast() && !ip.IsUnspecified() && !ip.IsMulticast()
}

func filenameFromDisposition(value string) string {
	_, params, err := mime.ParseMediaType(value)
	if err != nil {
		return ""
	}
	return path.Base(params["filename"])
}

func mediaContentTypeFromMIME(value string) (entity.ContentType, error) {
	switch {
	case strings.HasPrefix(value, "image/"):
		return entity.ContentTypeImage, nil
	case strings.HasPrefix(value, "audio/"):
		return entity.ContentTypeAudio, nil
	case strings.HasPrefix(value, "video/"):
		return entity.ContentTypeVideo, nil
	default:
		return "", fmt.Errorf("unsupported media content type %q", value)
	}
}

func newOriginMedia(contentType entity.ContentType, rawURL, name string) *entity.UploadAttachmentDetail {
	provider := entity.StorageProvider_ExternalUrl
	detail := &entity.UploadAttachmentDetail{ContentType: gptr.Of(contentType)}
	switch contentType {
	case entity.ContentTypeImage:
		detail.OriginImage = &entity.Image{Name: gptr.Of(name), URI: gptr.Of(rawURL), URL: gptr.Of(rawURL), StorageProvider: &provider}
	case entity.ContentTypeAudio:
		detail.OriginAudio = &entity.Audio{Name: gptr.Of(name), URI: gptr.Of(rawURL), URL: gptr.Of(rawURL), StorageProvider: &provider}
	case entity.ContentTypeVideo:
		detail.OriginVideo = &entity.Video{Name: gptr.Of(name), URI: gptr.Of(rawURL), URL: gptr.Of(rawURL), StorageProvider: &provider}
	}
	return detail
}

func setStoredMedia(detail *entity.UploadAttachmentDetail, contentType entity.ContentType, name, uri, mediaURL string, provider entity.StorageProvider) {
	switch contentType {
	case entity.ContentTypeImage:
		detail.Image = &entity.Image{Name: gptr.Of(name), URI: gptr.Of(uri), URL: gptr.Of(mediaURL), StorageProvider: &provider}
	case entity.ContentTypeAudio:
		detail.Audio = &entity.Audio{Name: gptr.Of(name), URI: gptr.Of(uri), URL: gptr.Of(mediaURL), StorageProvider: &provider}
	case entity.ContentTypeVideo:
		detail.Video = &entity.Video{Name: gptr.Of(name), URI: gptr.Of(uri), URL: gptr.Of(mediaURL), StorageProvider: &provider}
	}
}

func setMediaValidationError(detail *entity.UploadAttachmentDetail, errorType entity.ItemErrorType, err error) {
	detail.ErrorType = &errorType
	detail.ErrMsg = gptr.Of(err.Error())
}

type mediaURLBinding struct {
	uri      string
	provider *entity.StorageProvider
	setURL   func(*string)
}

func (a *DatasetRPCAdapter) fillEvaluationSetItemMediaURLs(ctx context.Context, items []*entity.EvaluationSetItem) error {
	keys := make([]string, 0)
	media := make([]mediaURLBinding, 0)
	seen := make(map[string]struct{})
	for _, item := range items {
		for _, turn := range item.Turns {
			for _, field := range turn.FieldDataList {
				collectContentMedia(field.Content, &keys, &media, seen)
			}
		}
	}
	if len(keys) == 0 {
		return nil
	}
	if a.fileProvider == nil {
		return fmt.Errorf("file provider is not configured")
	}
	urls, err := a.fileProvider.MGetFileURL(ctx, keys)
	if err != nil {
		return err
	}
	for _, object := range media {
		if object.provider != nil && *object.provider == entity.StorageProvider_ExternalUrl {
			object.setURL(gptr.Of(object.uri))
			continue
		}
		if signedURL := urls[object.uri]; signedURL != "" {
			object.setURL(gptr.Of(signedURL))
		}
	}
	return nil
}

func collectContentMedia(content *entity.Content, keys *[]string, media *[]mediaURLBinding, seen map[string]struct{}) {
	if content == nil {
		return
	}
	var object *mediaURLBinding
	switch content.GetContentType() {
	case entity.ContentTypeImage:
		if content.Image != nil && content.Image.URI != nil {
			object = &mediaURLBinding{uri: *content.Image.URI, provider: content.Image.StorageProvider, setURL: func(value *string) { content.Image.URL = value }}
		}
	case entity.ContentTypeAudio:
		if content.Audio != nil && content.Audio.URI != nil {
			object = &mediaURLBinding{uri: *content.Audio.URI, provider: content.Audio.StorageProvider, setURL: func(value *string) { content.Audio.URL = value }}
		}
	case entity.ContentTypeVideo:
		if content.Video != nil && content.Video.URI != nil {
			object = &mediaURLBinding{uri: *content.Video.URI, provider: content.Video.StorageProvider, setURL: func(value *string) { content.Video.URL = value }}
		}
	case entity.ContentTypeMultipart:
		for _, part := range content.MultiPart {
			collectContentMedia(part, keys, media, seen)
		}
	}
	if object == nil || object.uri == "" {
		return
	}
	*media = append(*media, *object)
	if object.provider != nil && *object.provider == entity.StorageProvider_ExternalUrl {
		object.setURL(gptr.Of(object.uri))
		return
	}
	if _, ok := seen[object.uri]; !ok {
		seen[object.uri] = struct{}{}
		*keys = append(*keys, object.uri)
	}
}
