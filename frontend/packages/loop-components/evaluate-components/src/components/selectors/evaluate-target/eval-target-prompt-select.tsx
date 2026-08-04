// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { useCallback, useRef, useState } from 'react';

import classNames from 'classnames';
import { useDebounceFn, useRequest } from 'ahooks';
import { I18n } from '@cozeloop/i18n-adapter';
import { BaseSearchSelect, type BaseSelectProps } from '@cozeloop/components';
import {
  useResourcePageJump,
  useOpenWindow,
  useSpace,
} from '@cozeloop/biz-hooks-adapter';
import { EvalTargetType } from '@cozeloop/api-schema/evaluation';
import { StoneEvaluationApi } from '@cozeloop/api-schema';
import { IconCozPlus } from '@coze-arch/coze-design/icons';
import { type SelectProps, Modal } from '@coze-arch/coze-design';

import { useGlobalEvalConfig } from '@/stores/eval-global-config';

import { getPromptEvalTargetOption } from './utils';

/**
 * 评测对象选择器, 公共, 开源逻辑
 */
const PromptEvalTargetSelect = ({
  showCreateBtn = false,
  onlyShowOptionName = false,
  ...props
}: SelectProps &
  BaseSelectProps & {
    showCreateBtn?: boolean;
    onlyShowOptionName?: boolean;
  }) => {
  const { spaceID } = useSpace();
  const [createPromptVisible, setCreatePromptVisible] = useState(false);
  const [submitModalUrl, setSubmitModalUrl] = useState<string>('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectRef = useRef<any>(null);
  const { PromptCreate } = useGlobalEvalConfig();
  const { getPromptDetailURL } = useResourcePageJump();
  const { getURL } = useOpenWindow();
  const service = useRequest(async (text?: string) => {
    const res = await StoneEvaluationApi.ListSourceEvalTargets({
      target_type: EvalTargetType.CozeLoopPrompt,
      name: text || undefined,
      workspace_id: spaceID,
      page_size: 100,
    });
    return res.eval_targets?.map(item =>
      getPromptEvalTargetOption(item, onlyShowOptionName),
    );
  });

  const handleSearch = useDebounceFn(service.run, {
    wait: 500,
  });

  const fetchTargetOptionsByIds = useCallback(
    async (ids: string[] | number[]) => {
      const res = await StoneEvaluationApi.BatchGetEvalTargetsBySource({
        workspace_id: spaceID || '',
        source_target_ids: ids as string[],
        eval_target_type: EvalTargetType.CozeLoopPrompt,
        need_source_info: true,
      });
      return (res?.eval_targets || []).map(item =>
        getPromptEvalTargetOption(item, onlyShowOptionName),
      );
    },
    [spaceID],
  );
  return (
    <>
      <BaseSearchSelect
        ref={selectRef}
        className={classNames(props.className)}
        emptyContent={I18n.t('no_data')}
        loading={service.loading}
        onSearch={handleSearch.run}
        showRefreshBtn={true}
        loadOptionByIds={fetchTargetOptionsByIds}
        onClickRefresh={() => service.run()}
        outerBottomSlot={
          showCreateBtn ? (
            <div
              onClick={() => {
                selectRef.current?.close();
                setCreatePromptVisible(true);
              }}
              className="h-8 px-2 flex flex-row items-center cursor-pointer"
            >
              <IconCozPlus className="h-4 w-4 text-brand-9 mr-2" />
              <div className="text-sm font-medium text-brand-9">
                {I18n.t('new_prompt')}
              </div>
            </div>
          ) : null
        }
        optionList={service.data}
        {...props}
      />

      {showCreateBtn && PromptCreate ? (
        <PromptCreate
          visible={createPromptVisible}
          onCancel={() => setCreatePromptVisible(false)}
          onOk={res => {
            setCreatePromptVisible(false);
            setSubmitModalUrl(getURL(getPromptDetailURL(`${res.id}`)));
            service.run();
          }}
        />
      ) : null}
      <Modal
        visible={!!submitModalUrl}
        onCancel={() => setSubmitModalUrl('')}
        title={I18n.t('prompt_detail')}
        width="90vw"
        height="90vh"
        footer={null}
        hasScroll={false}
      >
        {submitModalUrl ? (
          <iframe
            src={submitModalUrl}
            className="w-full h-full border-0"
            title="prompt-detail"
          />
        ) : null}
      </Modal>
    </>
  );
};

export default PromptEvalTargetSelect;
