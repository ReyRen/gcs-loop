# 多模态评测集前端接入指南

本文档描述 GCS Loop 多模态评测集的前端调用契约。后端沿用现有评测集接口，不新增“多模态评测集”资源类型：只要 Schema 中至少一个字段的 `content_type` 为 `MultiPart`，该评测集就具备图文、音频和视频混排能力。

本次实现仅修改后端。前端可参照 Loop 官方页面完成交互，不需要等待新的接口生成。

## 1. 基本约定

- 浏览器 Console 接口使用登录态 Cookie 鉴权。
- 所有 `i64` ID 在 JSON 中按字符串传输，例如 `"7670078211023175681"`。
- 业务成功条件是响应 `code === 0`。HTTP 200 仍可能携带非零业务错误码。
- 多模态内容必须放在 `content.multi_part` 中，并保留数组顺序。
- `MultiPart` 内仅支持一层 `Text`、`Image`、`Audio`、`Video`，不支持嵌套 `MultiPart`。
- 后端默认限制：每个单元格最多 20 个文件、50 个 part、单文件 20 MiB。

常量：

| 字段 | 值 |
| --- | --- |
| `content_type` | `Text`、`Image`、`Audio`、`Video`、`MultiPart` |
| `storage_provider` | `5` = S3/MinIO，`6` = ExternalUrl |
| `default_display_format` | `1` = PlainText，`2` = Markdown，`3` = JSON，`4` = YAML，`5` = Code |
| `multi_modal_store_strategy` | `store` 或 `passthrough` |

## 2. 推荐页面流程

```text
创建多模态评测集
  -> 上传本地媒体或校验外链
  -> 组装有序 multi_part
  -> 批量新增数据
  -> 列表接口回显文本和签名媒体 URL
  -> 按需提交评测集版本
```

## 3. 创建多模态评测集

`POST /api/evaluation/v1/evaluation_sets`

请求示例：

```json
{
  "workspace_id": "7670078211023175681",
  "name": "多模态评测集",
  "description": "图文、音频和视频混排评测数据",
  "evaluation_set_schema": {
    "field_schemas": [
      {
        "key": "input",
        "name": "input",
        "description": "多模态输入",
        "content_type": "MultiPart",
        "multi_model_spec": {
          "max_file_count": 20,
          "max_file_size": 20971520,
          "max_part_count": 50,
          "supported_formats_by_type": {
            "Image": ["jpg", "jpeg", "png", "gif", "bmp", "webp"],
            "Audio": ["mp3", "wav", "flac", "aac", "ogg", "m4a", "opus", "amr"],
            "Video": ["mp4", "mov", "webm", "mkv", "avi", "mpeg", "mpg"]
          }
        }
      },
      {
        "key": "reference_output",
        "name": "reference_output",
        "description": "参考答案",
        "content_type": "Text",
        "default_display_format": 1
      }
    ]
  }
}
```

`multi_model_spec` 可以不传，后端会补齐安全默认值；若只传部分限制，缺失项也会补齐。

响应示例：

```json
{
  "evaluation_set_id": "123456789",
  "code": 0,
  "msg": ""
}
```

## 4. 上传本地媒体文件

先申请预签名上传地址：

`POST /api/foundation/v1/sign_upload_files`

```json
{
  "workspace_id": "7670078211023175681",
  "business_type": "evaluation",
  "keys": [
    "7670078211023175681/evaluation/随机目录/cat.png"
  ]
}
```

响应的 `uris[0]` 是临时上传 URL。前端随后执行：

```http
PUT {uris[0]}
Content-Type: image/png

<文件二进制>
```

上传成功后，业务数据中保存的是最初申请签名时的 `key`，不是临时 `uris[0]`：

```json
{
  "content_type": "Image",
  "image": {
    "name": "cat.png",
    "uri": "7670078211023175681/evaluation/随机目录/cat.png",
    "storage_provider": 5
  }
}
```

音频和视频分别使用 `audio`、`video` 字段，流程相同。

## 5. 校验或转存外链媒体

`POST /api/evaluation/v1/evaluation_sets/multi_part_data/validate`

转存到 GCS Loop：

```json
{
  "space_id": "7670078211023175681",
  "preview_data": [
    "https://example.com/cat.png"
  ],
  "store_option": {
    "multi_modal_store_strategy": "store",
    "content_type": 2
  }
}
```

其中 `content_type` 为 Data 模块枚举：`2` 图片、`3` 音频、`4` 视频。

- `store`：后端安全下载外链，校验媒体类型与 20 MiB 上限，再转存到平台对象存储。
- `passthrough`：校验后保留原外链，返回 `storage_provider = 6`。
- 每个 URL 独立返回校验结果；检查 `attachment_urls_check_detail[i].error_type` 和 `err_msg`。
- 后端拒绝 `file://`、携带账号密码的 URL、回环/内网/链路本地地址，并限制跳转次数，避免 SSRF。

转存成功时，图片读取 `attachment_urls_check_detail[i].image`，音频读取 `audio`，视频读取 `video`。将其直接作为下一步对应的媒体 part 使用即可。

## 6. 新增多模态数据

`POST /api/evaluation/v1/evaluation_sets/{evaluation_set_id}/items/batch_create`

```json
{
  "workspace_id": "7670078211023175681",
  "evaluation_set_id": "123456789",
  "skip_invalid_items": false,
  "allow_partial_add": false,
  "items": [
    {
      "turns": [
        {
          "field_data_list": [
            {
              "key": "input",
              "name": "input",
              "content": {
                "content_type": "MultiPart",
                "multi_part": [
                  {
                    "content_type": "Text",
                    "text": "请描述这张图片，并结合后面的音频给出结论。"
                  },
                  {
                    "content_type": "Image",
                    "image": {
                      "name": "cat.png",
                      "uri": "7670078211023175681/evaluation/随机目录/cat.png",
                      "storage_provider": 5
                    }
                  },
                  {
                    "content_type": "Audio",
                    "audio": {
                      "name": "question.mp3",
                      "format": "mp3",
                      "uri": "7670078211023175681/evaluation/随机目录/question.mp3",
                      "storage_provider": 5
                    }
                  }
                ]
              }
            },
            {
              "key": "reference_output",
              "name": "reference_output",
              "content": {
                "content_type": "Text",
                "text": "参考答案"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

注意：

- `multi_part` 数组顺序就是官方页面中的显示/输入顺序。
- 媒体 part 必须且只能携带一个对应媒体对象。
- 平台存储媒体必须传非空 `uri`；外链媒体同时传 `uri` 和 `storage_provider: 6`。
- `items` 每次最多 100 条。
- 若希望逐条容错，设置 `skip_invalid_items: true`，并读取响应中的 `errors` 与 `item_outputs`。

## 7. 列表与回显

`POST /api/evaluation/v1/evaluation_sets/{evaluation_set_id}/items/list`

```json
{
  "workspace_id": "7670078211023175681",
  "evaluation_set_id": "123456789",
  "page_number": 1,
  "page_size": 20
}
```

响应中的 `items[].turns[].field_data_list[].content.multi_part` 保持写入顺序。对于平台存储媒体，后端会返回临时签名后的 `image.url`、`audio.url` 或 `video.url`；对于 ExternalUrl，则 `url` 等于原始 `uri`。前端用 `url` 预览，用 `uri + storage_provider` 保存或再次提交。

不要把签名后的 `url` 当永久标识存回数据库，因为它会过期。

## 8. 更新数据与提交版本

更新单条数据：

`PUT /api/evaluation/v1/evaluation_sets/{evaluation_set_id}/items/{item_id}`

Body 继续传完整 `workspace_id`、`evaluation_set_id`、`item_id` 和 `turns`，其中多模态结构与批量新增完全一致。

提交评测集版本：

`POST /api/evaluation/v1/evaluation_sets/{evaluation_set_id}/versions`

```json
{
  "workspace_id": "7670078211023175681",
  "evaluation_set_id": "123456789",
  "version": "0.0.1",
  "desc": "首个多模态版本"
}
```

## 9. 前端验收清单

- 创建页只新增“多模态”选项，不改变文本评测集行为。
- 创建结果的 `features.multiModal` 为 `true`，Schema 中 `input.content_type` 为 `MultiPart`。
- 同一单元格可以按顺序添加文本、图片、音频、视频并拖拽排序。
- 前端在选择文件时按后端返回的 `multi_model_spec` 限制数量、格式、大小和 part 数。
- 上传失败、外链校验失败、单条数据校验失败都有对应行/文件级错误展示。
- 刷新列表后多模态顺序不变，平台文件可预览，外链仍可预览。
- 修改、删除、版本提交与现有文本评测集流程共用原接口。

## 10. Swagger

以上接口均已存在于 Swagger：`/api-docs`。当前部署可访问：

`http://172.18.36.230:8082/api-docs`

本次没有修改前端 IDL 或前端源码。
