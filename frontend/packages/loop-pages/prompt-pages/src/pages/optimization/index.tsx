// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable @coze-arch/max-line-per-function -- 主组件包含轮询、草稿保存与状态路由等完整编排逻辑 */
import { useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';

import { I18n } from '@cozeloop/i18n-adapter';
import { useBreadcrumb } from '@cozeloop/hooks';
import { PageLoading } from '@cozeloop/components';
import { useNavigateModule, useSpace } from '@cozeloop/biz-hooks-adapter';
import type { PromptDetail } from '@cozeloop/api-schema/prompt';
import { TemplateType } from '@cozeloop/api-schema/prompt';
import type { PromptOptimizeTask } from '@cozeloop/api-schema/evaluation';
import { StoneEvaluationApi, StonePromptApi } from '@cozeloop/api-schema';
import { IconCozLongArrowUp } from '@coze-arch/coze-design/icons';
import { Button, IconButton, Modal, Typography } from '@coze-arch/coze-design';

import { TerminatedStatus } from './TerminatedStatus';
import { SuccessStatus } from './SuccessStatus';
import { RunningStatus } from './RunningStatus';
import { FailedStatus } from './FailedStatus';

// 官网优化任务状态（字符串）
const STATUS_RUNNING = ['Created', 'Running'];

export default function PromptOptimizationPage() {
  const { promptID, optimizationID } = useParams<{
    promptID: string;
    optimizationID: string;
  }>();
  const { spaceID } = useSpace();
  const navigate = useNavigateModule();

  const [task, setTask] = useState<PromptOptimizeTask>();
  const [loading, setLoading] = useState(true);
  const [applyingToDraft, setApplyingToDraft] = useState(false);
  const [overwriteVisible, setOverwriteVisible] = useState(false);
  const [setTerminating] = useState(false);
  // 源版本 Prompt 详情（用于 diff 左侧与构造草稿）
  const [sourceDetail, setSourceDetail] = useState<PromptDetail>();

  const timeoutRef = useRef<number | null>(null);
  const backoffRef = useRef(1);
  const visibilityRef = useRef(true);
  // 页面右上角 header 插槽，用于放置「提交新版本」按钮
  const [portalSlot, setPortalSlot] = useState<HTMLElement | null>(null);
  // 页面左上角返回按钮插槽
  const [portalBack, setPortalBack] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalSlot(document.getElementById('page-header-slot'));
    setPortalBack(document.getElementById('page-header-back-btn'));
  }, []);

  // 源版本号：新接口无 original_prompt_template，原始 Prompt 取自 optimize_target.target_version
  const sourceVersion = task?.optimize_target?.target_version;

  useBreadcrumb({
    text: task?.task_name || I18n.t('prompt_optimization_title'),
  });

  // 拉取源版本 Prompt 详情（模型配置、工具、MCP 等用于构造草稿）
  const loadSourceDetail = useCallback(async () => {
    if (!spaceID || !promptID || !sourceVersion) {
      return;
    }
    try {
      const res = await StonePromptApi.GetPrompt({
        prompt_id: promptID,
        workspace_id: spaceID,
        commit_version: sourceVersion,
        with_commit: true,
      });
      setSourceDetail(res.prompt?.prompt_commit?.detail);
    } catch (e) {
      console.error('Load source prompt detail failed:', e);
    }
  }, [spaceID, promptID, sourceVersion]);

  const pollOnce = useCallback(async () => {
    if (!spaceID || !promptID || !optimizationID) {
      return;
    }
    try {
      const res = await StoneEvaluationApi.GetPromptOptimizeTask({
        workspace_id: spaceID,
        prompt_id: promptID,
        task_id: optimizationID,
      });
      backoffRef.current = 1;
      setLoading(false);
      const t = res.optimize_task;
      if (!t) {
        return;
      }
      setTask(t);
      if (t.status === 'Success') {
        // 终态后拉取源版本详情用于展示对比与构造草稿
        void loadSourceDetail();
        return;
      }
      if (STATUS_RUNNING.includes(t.status ?? '')) {
        timeoutRef.current = window.setTimeout(pollOnce, 2000);
      }
    } catch (e) {
      console.error('Poll prompt optimize task failed:', e);
      const delay = Math.min(30000, 2000 * backoffRef.current);
      backoffRef.current = Math.min(backoffRef.current * 2, 15);
      timeoutRef.current = window.setTimeout(pollOnce, delay);
    }
  }, [spaceID, promptID, optimizationID, loadSourceDetail]);

  useEffect(() => {
    void pollOnce();
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [pollOnce]);

  // 页面隐藏时暂停轮询，重新可见时立即恢复（终态下 pollOnce 不会继续排下一次）
  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      visibilityRef.current = visible;
      if (visible) {
        void pollOnce();
      } else if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pollOnce]);

  // 用户点击「提交新版本」：把优化结果显式保存为 Prompt 草稿，再跳转编辑器确认
  const handleSubmitNewVersion = async () => {
    if (!spaceID || !promptID || !task?.optimize_result) {
      return;
    }
    // 检查当前是否已有草稿，有则提示覆盖
    const promptRes = await StonePromptApi.GetPrompt({
      prompt_id: promptID,
      workspace_id: spaceID,
      with_draft: true,
      with_commit: true,
    });
    if (promptRes.prompt?.prompt_draft) {
      setOverwriteVisible(true);
      return;
    }
    await applyToDraft(false);
  };

  // 终止优化任务：调用 terminate 接口后，轮询会自动切换到 Terminated 状态
  const handleTerminate = async () => {
    if (!spaceID || !promptID || !optimizationID) {
      return;
    }
    setTerminating(true);
    try {
      await StoneEvaluationApi.TerminatePromptOptimizeTask({
        workspace_id: spaceID,
        prompt_id: promptID,
        task_id: optimizationID,
      });
      void pollOnce();
    } catch (e) {
      console.error('Terminate prompt optimize task failed:', e);
    } finally {
      setTerminating(false);
    }
  };

  const applyToDraft = async (overwrite: boolean) => {
    if (!spaceID || !promptID || !task?.optimize_result || !sourceVersion) {
      return;
    }
    setApplyingToDraft(true);
    try {
      const optimizedMessages =
        task.optimize_result.optimized_prompt_message_list;
      // 组合优化结果 + 源 Prompt 的模型配置、工具、MCP 等
      const res = await StonePromptApi.SaveDraft({
        prompt_id: promptID,
        prompt_draft: {
          draft_info: { base_version: sourceVersion },
          detail: {
            prompt_template: {
              messages: optimizedMessages ?? [],
              template_type:
                sourceDetail?.prompt_template?.template_type ??
                TemplateType.Normal,
              variable_defs: sourceDetail?.prompt_template?.variable_defs,
            },
            model_config: sourceDetail?.model_config ?? {},
            tools: sourceDetail?.tools ?? [],
            tool_call_config: sourceDetail?.tool_call_config ?? {},
            mcp_config: sourceDetail?.mcp_config ?? {},
          },
        },
      });
      console.log('res', res);
      if (!overwrite) {
        setOverwriteVisible(false);
      }
      // 保存成功后跳转 Prompt 编辑器，由用户确认版本后自行 commit
      navigate(`pe/prompts/${promptID}`);
    } catch (e) {
      console.error('Save draft failed:', e);
    } finally {
      setApplyingToDraft(false);
    }
  };

  if (loading) {
    return <PageLoading className="h-full w-full" />;
  }

  const status = task?.status;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto ">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <Typography.Title heading={4} className="!mb-1">
              {task?.task_name || I18n.t('prompt_optimization_title')}
            </Typography.Title>
            <Typography.Text className="coz-fg-secondary">
              {I18n.t('prompt_optimization_source_version')}:{' '}
              {sourceVersion ?? '-'}
            </Typography.Text>
          </div>
          {status === 'Failed' ? (
            <Button
              onClick={() =>
                navigate(
                  `evaluation/experiments/${task?.optimize_task_data_set?.related_expt_id}`,
                )
              }
            >
              {I18n.t('prompt_optimization_back_to_experiment')}
            </Button>
          ) : null}
        </div>

        {/* 运行中 / 排队中 */}
        {task && (status === 'Created' || status === 'Running') ? (
          <RunningStatus task={task} onTerminate={handleTerminate} />
        ) : null}

        {/* 失败 */}
        {task && status === 'Failed' ? <FailedStatus task={task} /> : null}

        {/* 终止 */}
        {status === 'Terminated' ? <TerminatedStatus /> : null}

        {/* 成功 */}
        {task && status === 'Success' ? (
          <SuccessStatus task={task} sourceDetail={sourceDetail} />
        ) : null}
      </div>

      {/* 覆盖草稿确认框 */}
      <Modal
        visible={overwriteVisible}
        title={I18n.t('prompt_optimization_submit_new_version')}
        okText={I18n.t('confirm')}
        cancelText={I18n.t('cancel')}
        onCancel={() => setOverwriteVisible(false)}
        onOk={() => void applyToDraft(true)}
        confirmLoading={applyingToDraft}
      >
        <Typography.Text>
          {I18n.t('prompt_optimization_draft_overwrite_confirm')}
        </Typography.Text>
      </Modal>

      {/* 返回按钮：渲染到页面左上角 header 插槽 */}
      {portalBack
        ? createPortal(
            <IconButton
              color="secondary"
              className="!w-[32px] !h-[32px]"
              icon={
                <IconCozLongArrowUp
                  className="-rotate-90 text-[20px] cursor-pointer shrink-0 !coz-fg-plus !font-medium"
                  onClick={() => history.back()}
                />
              }
            />,
            portalBack,
          )
        : null}

      {/* 提交新版本按钮：渲染到页面右上角 header 插槽 */}
      {portalSlot && status === 'Success'
        ? createPortal(
            <Button
              type="primary"
              loading={applyingToDraft}
              onClick={() => void handleSubmitNewVersion()}
            >
              {I18n.t('prompt_optimization_submit_new_version')}
            </Button>,
            portalSlot,
          )
        : null}
    </div>
  );
}
