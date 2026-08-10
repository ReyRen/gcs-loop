CREATE TABLE IF NOT EXISTS `prompt_generate_record`
(
    `id`                   bigint unsigned                         NOT NULL COMMENT 'Record ID',
    `prompt_id`            bigint unsigned                         NOT NULL DEFAULT '0' COMMENT 'Prompt ID',
    `space_id`             bigint unsigned                         NOT NULL DEFAULT '0' COMMENT 'Space ID',
    `prompt_key`           varchar(128) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT 'Prompt key',
    `generate_prompt_type` varchar(64) COLLATE utf8mb4_general_ci  NOT NULL DEFAULT '' COMMENT 'Generation type',
    `original_prompt`      mediumtext COLLATE utf8mb4_general_ci   NOT NULL COMMENT 'Original prompt',
    `generated_prompt`     mediumtext COLLATE utf8mb4_general_ci            COMMENT 'Generated prompt',
    `model_id`             bigint unsigned                         NOT NULL DEFAULT '0' COMMENT 'Model ID',
    `input_tokens`         bigint                                  NOT NULL DEFAULT '0' COMMENT 'Input tokens',
    `output_tokens`        bigint                                  NOT NULL DEFAULT '0' COMMENT 'Output tokens',
    `status`               varchar(32) COLLATE utf8mb4_general_ci  NOT NULL DEFAULT 'running' COMMENT 'Execution status',
    `is_retry`             tinyint(1)                              NOT NULL DEFAULT '0' COMMENT 'Whether this is a retry',
    `is_liked`             tinyint(1)                                       DEFAULT NULL COMMENT 'Marked useful',
    `is_disliked`          tinyint(1)                                       DEFAULT NULL COMMENT 'Marked not useful',
    `is_accepted`          tinyint(1)                                       DEFAULT NULL COMMENT 'Result adopted',
    `is_canceled`          tinyint(1)                                       DEFAULT NULL COMMENT 'Generation canceled',
    `generated_by`         varchar(128) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT 'User ID',
    `started_at`           bigint unsigned                         NOT NULL DEFAULT '0' COMMENT 'Start time in milliseconds',
    `ended_at`             bigint unsigned                         NOT NULL DEFAULT '0' COMMENT 'End time in milliseconds',
    `cost_ms`              bigint unsigned                         NOT NULL DEFAULT '0' COMMENT 'Elapsed milliseconds',
    `created_at`           datetime                                NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Creation time',
    `updated_at`           datetime                                NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Update time',
    `deleted_at`           bigint                                  NOT NULL DEFAULT '0' COMMENT 'Soft deletion time',
    PRIMARY KEY (`id`),
    KEY `idx_prompt_user_started` (`prompt_id`, `generated_by`, `started_at`) USING BTREE,
    KEY `idx_space_started` (`space_id`, `started_at`) USING BTREE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='Prompt generation and optimization records';
