CREATE TABLE IF NOT EXISTS `prompt_optimization_task`
(
    `id`                       bigint unsigned NOT NULL,
    `space_id`                 bigint unsigned NOT NULL DEFAULT 0,
    `experiment_id`            bigint unsigned NOT NULL DEFAULT 0,
    `prompt_id`                bigint unsigned NOT NULL DEFAULT 0,
    `prompt_key`               varchar(128) NOT NULL DEFAULT '',
    `source_prompt_version`    varchar(64) NOT NULL DEFAULT '',
    `name`                     varchar(128) NOT NULL DEFAULT '',
    `mode`                     varchar(32) NOT NULL DEFAULT 'effect_first',
    `status`                   varchar(32) NOT NULL DEFAULT 'queued',
    `stage`                    varchar(32) NOT NULL DEFAULT 'preparing',
    `progress`                 int NOT NULL DEFAULT 0,
    `request_data`             mediumblob NOT NULL,
    `original_prompt_template` mediumblob,
    `optimized_prompt_template` mediumblob,
    `baseline_metrics`         mediumblob,
    `best_metrics`             mediumblob,
    `error_message`            text,
    `idempotency_key`          varchar(128) DEFAULT NULL,
    `created_by`               varchar(128) NOT NULL DEFAULT '',
    `started_at`               bigint NOT NULL DEFAULT 0,
    `ended_at`                 bigint NOT NULL DEFAULT 0,
    `applied_at`               bigint NOT NULL DEFAULT 0,
    `created_at`               datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`               datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at`               bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_prompt_opt_idempotency` (`space_id`, `created_by`, `idempotency_key`),
    KEY `idx_prompt_opt_expt_created` (`space_id`, `experiment_id`, `created_at`, `id`),
    KEY `idx_prompt_opt_prompt_created` (`space_id`, `prompt_id`, `deleted_at`, `created_at`, `id`),
    KEY `idx_prompt_opt_status` (`status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='Durable Prompt optimization tasks based on evaluation experiments';

CREATE TABLE IF NOT EXISTS `prompt_optimization_iteration`
(
    `id`                 bigint unsigned NOT NULL,
    `task_id`            bigint unsigned NOT NULL DEFAULT 0,
    `iteration_no`       int NOT NULL DEFAULT 0,
    `candidate_template` mediumblob NOT NULL,
    `rationale`          text,
    `metrics`            mediumblob,
    `sample_results`     longblob,
    `input_tokens`       bigint NOT NULL DEFAULT 0,
    `output_tokens`      bigint NOT NULL DEFAULT 0,
    `created_at`         datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_prompt_opt_iteration` (`task_id`, `iteration_no`),
    KEY `idx_prompt_opt_iteration_created` (`task_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='Per-iteration candidates and evaluation report for Prompt optimization';
