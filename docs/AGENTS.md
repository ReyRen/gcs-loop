# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with docs in this repository.

> 中层索引，串联 reference/（事实说明）和 guidance/（操作手册）。

## 文件树

```
docs/
├── AGENTS.md                           ← 本文件
├── reference/
│   ├── backend-modules-api.md          # 后端 6 模块职责、分层、API 路由
│   └── frontend-packages.md            # 前端 59 包分层结构
└── guidance/
    ├── api-documentation-guide.md       # OpenAPI / Swagger 与前端对接指南
    ├── deployment-guide.md             # Docker Compose 部署指南
    └── idl-codegen-guide.md             # IDL 变更后代码生成完整流程
```

## 导航

| 我想… | 文件 |
|-------|------|
| 了解后端某个模块的职责和 API 路由 | `reference/backend-modules-api.md` |
| 了解前端包的分层和依赖关系 | `reference/frontend-packages.md` |
| 使用 Swagger/OpenAPI 与前端对接 | `guidance/api-documentation-guide.md` |
| 使用 Docker Compose 部署 Coze Loop | `guidance/deployment-guide.md` |
| 修改 IDL 后走完代码生成流程 | `guidance/idl-codegen-guide.md` |

## 文档分类原则

- **reference/**：事实说明——描述"是什么"，不随任务变化
- **guidance/**：操作手册——描述"怎么做"，面向具体操作步骤
