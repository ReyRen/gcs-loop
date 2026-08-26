ALTER TABLE `prompt_optimization_task`
    ADD INDEX `idx_prompt_opt_prompt_created` (`space_id`, `prompt_id`, `deleted_at`, `created_at`, `id`);
