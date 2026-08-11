ALTER TABLE `prompt_commit` ADD COLUMN `ext_info` text COLLATE utf8mb4_general_ci COMMENT 'Extended information field';
ALTER TABLE `prompt_commit` ADD COLUMN `metadata` text COLLATE utf8mb4_general_ci COMMENT 'Template metadata field';
ALTER TABLE `prompt_commit` ADD COLUMN `has_snippets` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否包含prompt片段';
ALTER TABLE `prompt_commit` ADD COLUMN `mcp_config` text COLLATE utf8mb4_general_ci COMMENT 'mcp config info';
ALTER TABLE `prompt_commit` ADD COLUMN `encrypt_messages` longtext COLLATE utf8mb4_general_ci COMMENT 'encrypt message list';
ALTER TABLE `prompt_commit` ADD INDEX `idx_prompt_id_created_at_id` (`prompt_id`, `created_at`, `id`);
ALTER TABLE `prompt_commit` ADD COLUMN `commit_fingerprint` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'Canonical fingerprint used for idempotent commit retries';
