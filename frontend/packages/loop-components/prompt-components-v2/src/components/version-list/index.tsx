// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable security/detect-object-injection */
/* eslint-disable max-lines-per-function */
/* eslint-disable @coze-arch/max-line-per-function */
/* eslint-disable complexity */
/* eslint-disable max-lines */

import { useEffect, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';
import { useRequest } from 'ahooks';
import { I18n } from '@cozeloop/i18n-adapter';
import { useModalData } from '@cozeloop/hooks';
import { handleCopy, sleep, useReportEvent } from '@cozeloop/components';
import {
  type Label,
  type CommitInfo,
  type Prompt,
  PromptType,
} from '@cozeloop/api-schema/prompt';
import { StonePromptApi, AuthApi } from '@cozeloop/api-schema';
import {
  IconCozApply,
  IconCozCopy,
  IconCozDuplicate,
  IconCozUpdate,
} from '@coze-arch/coze-design/icons';
import {
  Button,
  Descriptions,
  List,
  Modal,
  Space,
  Spin,
  Tag,
  Toast,
  Tooltip,
  Typography,
} from '@coze-arch/coze-design';

import { usePromptStore } from '@/store/use-prompt-store';
import { useBasicStore } from '@/store/use-basic-store';
import { useVersionList } from '@/hooks/use-version-list';
import { usePrompt } from '@/hooks/use-prompt';
import { CALL_SLEEP_TIME, EVENT_NAMES } from '@/consts';

import { VersionLabelModal } from '../version-label';
import { SnippetUseageModal } from '../snippet-useage-modal';
import { usePromptDevProviderContext } from '../prompt-develop/components/prompt-provider';
import { PromptCreateModal } from '../prompt-create-modal';
import VersionItem from './version-item';

interface InvokeParam {
  description?: string;
  example?: string;
  key?: string;
  type?: string;
  value_field?: string;
}
interface InvokeInfo {
  curl?: string;
  execute_endpoint?: string;
  parameters?: InvokeParam[];
  prompt_key?: string;
  request_body?: string;
  streaming_curl?: string;
  streaming_execute_endpoint?: string;
  version?: string;
}

export function VersionList() {
  const sendEvent = useReportEvent();
  const { spaceID, buttonConfig } = usePromptDevProviderContext();

  const labelModal = useModalData<{
    labels: Label[];
    version: string;
  }>();

  const { promptInfo } = usePromptStore(
    useShallow(state => ({ promptInfo: state.promptInfo })),
  );

  const baseVersion = (
    promptInfo?.prompt_draft?.draft_info ||
    promptInfo?.prompt_commit?.commit_info
  )?.base_version;

  const isSnippet =
    promptInfo?.prompt_basic?.prompt_type === PromptType.Snippet;

  const {
    setVersionChangeLoading,
    setVersionChangeVisible,
    versionChangeLoading,
  } = useBasicStore(
    useShallow(state => ({
      setVersionChangeLoading: state.setVersionChangeLoading,
      setVersionChangeVisible: state.setVersionChangeVisible,
      versionChangeLoading: state.versionChangeLoading,
    })),
  );
  const [draftVersion, setDraftVersion] = useState<CommitInfo>();

  const { promptByVersionService } = usePrompt({
    promptID: promptInfo?.id,
    spaceID,
  });

  const [activeVersion, setActiveVersion] = useState<string | undefined>();

  const [getDraftLoading, setGetDraftLoading] = useState(true);

  const promptInfoModal = useModalData<Prompt>();

  const [invokeVisible, setInvokeVisible] = useState(false);
  const [invokeData, setInvokeData] = useState<InvokeInfo>({});
  const [invokeLoading, setInvokeLoading] = useState(false);
  const [publicApiConfig, setPublicApiConfig] = useState<{
    host?: string;
    api_key?: string;
    base_url?: string;
  }>({});

  const handleInvoke = async () => {
    if (!promptInfo?.id || !activeVersion || !spaceID) {
      return;
    }
    setInvokeVisible(true);
    setInvokeData({});
    setInvokeLoading(true);
    try {
      const baseUrl = process.env.API_SCHEMA_BASE_URL || '';
      const version = encodeURIComponent(activeVersion);
      const wsId = encodeURIComponent(spaceID);
      const resp = await fetch(
        `${baseUrl}/api/prompt/v1/prompts/${promptInfo.id}/commits/${version}/invoke_info?workspace_id=${wsId}`,
        {
          headers: { 'Agw-Js-Conv': 'str' },
        },
      );
      const data: InvokeInfo = await resp.json();
      console.log(data, 1111);
      setInvokeData(data.invoke_info);

      // 调用 public_api_config 接口
      AuthApi.GetPublicApiConfig({
        workspace_id: spaceID,
      })
        .then(configRes => {
          setPublicApiConfig({
            host: configRes?.host,
            api_key: configRes?.api_key,
            base_url: configRes?.base_url,
          });
        })
        .catch(() => {
          setPublicApiConfig({});
        });
      // eslint-disable-next-line @coze-arch/use-error-in-catch -- 异常时显示兜底文案
    } catch {
      setInvokeData({});
    } finally {
      setInvokeLoading(false);
    }
  };

  const versionListService = useVersionList({
    promptID: promptInfo?.id,
    spaceID,
    draftVersion,
  });

  const { data: versionListData } = versionListService;

  const isActionButtonShow = Boolean(activeVersion);

  const rollbackService = useRequest(
    () =>
      StonePromptApi.RevertDraftFromCommit({
        prompt_id: promptInfo?.id,
        commit_version_reverting_from: activeVersion,
      }),
    {
      manual: true,
      ready: Boolean(spaceID && promptInfo?.id && activeVersion),
      refreshDeps: [spaceID, promptInfo?.id, activeVersion],
      onSuccess: async () => {
        Toast.success(I18n.t('rollback_success'));
        setVersionChangeLoading(true);
        await sleep(CALL_SLEEP_TIME);
        promptByVersionService
          .runAsync({ version: activeVersion || '', withCommit: true })
          .then(() => {
            setVersionChangeLoading(false);
            setVersionChangeVisible(false);
          })
          .catch(() => {
            setVersionChangeLoading(false);
            setVersionChangeVisible(false);
          });
      },
    },
  );
  const snippetUseageModal = useModalData<{
    totalReferenceCount: number;
    promptVersion?: string;
  }>();

  const handleVersionChange = (version?: string) => {
    if (version === activeVersion) {
      return;
    }
    setVersionChangeLoading(true);
    promptByVersionService
      .runAsync({ version: version || '', withCommit: true })
      .then(() => {
        setVersionChangeLoading(false);
        sendEvent?.(EVENT_NAMES.cozeloop_pe_version, {
          prompt_id: `${promptInfo?.id || 'playground'}`,
        });
      })
      .catch(() => {
        setVersionChangeLoading(false);
      });

    setActiveVersion(version);
  };

  const handleLabelChange = (version: string, labels: Label[]) => {
    if (!versionListData) {
      return;
    }
    const newLabelMap = {
      ...versionListData.versionLabelMap,
    };
    if (!newLabelMap[version]) {
      newLabelMap[version] = [];
    }

    const changeLabelSet = new Set(labels.map(item => item.key));

    for (const [key, value] of Object.entries(newLabelMap)) {
      if (key !== version) {
        newLabelMap[key] = value.filter(item => !changeLabelSet.has(item.key));
      } else {
        newLabelMap[key] = labels;
      }
    }
    versionListService.mutate({
      ...versionListData,
      versionLabelMap: newLabelMap,
    });
  };

  const parentReferencesMap = versionListData?.parentReferencesMap || {};

  useEffect(() => {
    if (spaceID && promptInfo?.id) {
      promptInfo?.prompt_draft?.draft_info &&
        setDraftVersion({
          version: '',
          base_version:
            promptInfo?.prompt_draft?.draft_info?.base_version || '',
          description: '',
          committed_by: '',
          committed_at: promptInfo?.prompt_draft?.draft_info?.updated_at,
        });
      setActiveVersion('');
      setGetDraftLoading(false);
      setTimeout(() => {
        versionListService.reload();
      }, CALL_SLEEP_TIME);
    }
    return () => {
      setActiveVersion(undefined);
      setGetDraftLoading(true);
    };
  }, [spaceID, promptInfo?.id]);

  return (
    <div className="flex-1 w-full h-full py-6 flex flex-col gap-2 overflow-hidden ">
      <div
        className="w-full h-full overflow-y-auto px-6"
        onScroll={e => {
          const target = e.currentTarget;

          const isAtBottom =
            target.scrollHeight - target.scrollTop <= target.clientHeight + 1;

          if (
            !versionListData?.hasMore ||
            !isAtBottom ||
            versionListService.loadingMore
          ) {
            return;
          }
          versionListService.loadMore();
        }}
      >
        <List
          dataSource={versionListData?.list || []}
          renderItem={item => {
            const totalReferenceCount =
              parentReferencesMap?.[item.version || ''] ?? 0;
            return (
              <VersionItem
                className="cursor-pointer mb-3"
                key={item.version}
                baseVersion={baseVersion}
                active={activeVersion === item.version}
                version={item}
                labels={
                  versionListData?.versionLabelMap?.[item.version || ''] || []
                }
                onClick={() => handleVersionChange(item.version)}
                onEditLabels={v => {
                  labelModal.open({
                    labels: v,
                    version: item.version || '',
                  });
                }}
                renderExraInfos={() =>
                  isSnippet ? (
                    <Descriptions.Item
                      itemKey={I18n.t('prompt_reference_project')}
                      className="!text-[13px]"
                    >
                      <Space spacing={4} wrap>
                        <Tag
                          color="brand"
                          onClick={() =>
                            snippetUseageModal.open({
                              totalReferenceCount,
                              promptVersion: item.version || '',
                            })
                          }
                        >
                          {I18n.t('prompt_number_of_projects_referencing', {
                            placeholder1: totalReferenceCount,
                          })}
                        </Tag>
                      </Space>
                    </Descriptions.Item>
                  ) : null
                }
              />
            );
          }}
          size="small"
          emptyContent={
            versionListService.loading || getDraftLoading ? <div></div> : null
          }
          loadMore={
            versionListService.loadingMore || getDraftLoading ? (
              <div className="w-full text-center">
                <Spin />
              </div>
            ) : null
          }
        />
      </div>
      {isActionButtonShow ? (
        <Space className="w-full flex-shrink-0 px-6">
          <Button
            className="flex-1"
            color="primary"
            disabled={versionChangeLoading}
            icon={<IconCozApply />}
            onClick={handleInvoke}
          >
            {I18n.t('prompt_invoke')}
          </Button>
          <Button
            className="flex-1"
            color="primary"
            disabled={versionChangeLoading}
            icon={<IconCozDuplicate />}
            onClick={() => promptInfoModal.open(promptInfo)}
          >
            {I18n.t('create_copy')}
          </Button>
          <Button
            className="flex-1"
            color="red"
            disabled={versionChangeLoading}
            icon={<IconCozUpdate />}
            onClick={() =>
              Modal.confirm({
                title: I18n.t('restore_to_this_version'),
                content: I18n.t('restore_version_tip'),
                onOk: rollbackService.runAsync,
                cancelText: I18n.t('cancel'),
                okText: I18n.t('restore'),
                okButtonProps: {
                  color: 'red',
                },
                autoLoading: true,
              })
            }
          >
            {I18n.t('restore_to_this_version')}
          </Button>
        </Space>
      ) : null}
      <PromptCreateModal
        spaceID={spaceID}
        visible={promptInfoModal.visible}
        onCancel={promptInfoModal.close}
        data={promptInfoModal?.data}
        isCopy
        onOk={res => {
          promptInfoModal.close();
          buttonConfig?.copyButton?.onSuccess?.({ prompt: res });
        }}
        isSnippet={promptInfo?.prompt_basic?.prompt_type === PromptType.Snippet}
      />

      <VersionLabelModal
        visible={labelModal.visible}
        spaceID={spaceID}
        promptID={promptInfo?.id || ''}
        labels={labelModal.data?.labels || []}
        version={labelModal.data?.version}
        onCancel={() => {
          labelModal.close();
        }}
        onConfirm={val => {
          handleLabelChange(
            labelModal.data?.version || '',
            val.map(item => ({ key: item })),
          );
          labelModal.close();
        }}
      />

      <SnippetUseageModal
        spaceID={spaceID}
        visible={snippetUseageModal.visible}
        snippet={{
          ...promptInfo,
          prompt_commit: {
            commit_info: { version: snippetUseageModal.data?.promptVersion },
          },
        }}
        totalReferenceCount={snippetUseageModal.data?.totalReferenceCount}
        onCancel={snippetUseageModal.close}
        onOk={() => {
          snippetUseageModal.close();
        }}
        onVersionItemClick={versionPrompt => {
          buttonConfig?.promptJumpButton?.onClick?.({ prompt: versionPrompt });
        }}
      />

      <InvokeModal
        visible={invokeVisible}
        data={invokeData}
        loading={invokeLoading}
        publicApiConfig={publicApiConfig}
        onClose={() => setInvokeVisible(false)}
      />
    </div>
  );
}

interface InvokeModalProps {
  visible: boolean;
  data: InvokeInfo;
  loading: boolean;
  publicApiConfig?: {
    host?: string;
    api_key?: string;
    base_url?: string;
  };
  onClose: () => void;
}

function InvokeModal({
  visible,
  data,
  loading,
  publicApiConfig,
  onClose,
}: InvokeModalProps) {
  const [tab, setTab] = useState<string>('sync');

  return (
    <Modal
      visible={visible}
      title={I18n.t('prompt_invoke')}
      width={900}
      footer={null}
      onCancel={onClose}
    >
      {loading ? (
        <div className="flex items-center justify-center h-[300px]">
          <Spin />
        </div>
      ) : (
        <div
          className="flex flex-col gap-4"
          style={{ maxHeight: '70vh', overflow: 'auto' }}
        >
          <div className="flex items-center gap-3">
            <Tag color="primary">{data.prompt_key || '-'}</Tag>
            <Tag size="small">v{data.version || '-'}</Tag>
            {/* <Tooltip content={I18n.t('copy')}>
              <Button
                size="small"
                onClick={() =>
                  handleCopy(
                    `Prompt Key: ${data.prompt_key}\nVersion: ${data.version}\nEndpoint: ${data.execute_endpoint}`,
                  )
                }
              >
                {I18n.t('copy_prompt_key')}
              </Button>
            </Tooltip> */}
          </div>

          {publicApiConfig?.base_url ? (
            <div>
              <Typography.Text strong>Base URL</Typography.Text>
              <div style={{ position: 'relative' }}>
                <Tooltip content={I18n.t('copy')}>
                  <IconCozCopy
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      zIndex: 1,
                      cursor: 'pointer',
                    }}
                    onClick={() => handleCopy(publicApiConfig.base_url || '')}
                  />
                </Tooltip>
                <pre
                  style={{
                    background: 'rgb(247, 247, 252)',
                    borderRadius: 4,
                    padding: '8px 60px 8px 12px',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    overflow: 'auto',
                    margin: '8px 0 0 0',
                  }}
                >
                  {publicApiConfig.base_url}
                </pre>
              </div>
            </div>
          ) : null}

          {data.parameters?.length ? (
            <div>
              <Typography.Text strong>{I18n.t('param_value')}</Typography.Text>
              <div className="mt-2 border rounded overflow-hidden">
                <table className="w-full text-sm">
                  <thead style={{ background: 'rgb(247, 247, 252)' }}>
                    <tr>
                      <th className="text-left p-2 font-medium">Key</th>
                      <th className="text-left p-2 font-medium">
                        {I18n.t('type')}
                      </th>
                      <th className="text-left p-2 font-medium">Example</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.parameters.map((p, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-mono text-xs">{p.key}</td>
                        <td className="p-2">
                          <Tag size="small">{p.type}</Tag>
                        </td>
                        <td className="p-2 text-xs text-gray-500">
                          {p.example || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Button
                size="small"
                color={tab === 'sync' ? 'primary' : 'secondary'}
                onClick={() => setTab('sync')}
              >
                {I18n.t('prompt_synchronous_call')}
              </Button>
              <Button
                size="small"
                color={tab === 'stream' ? 'primary' : 'secondary'}
                onClick={() => setTab('stream')}
              >
                {I18n.t('prompt_streaming_call')}
              </Button>
            </div>
            <div style={{ position: 'relative' }}>
              <Tooltip content={I18n.t('copy')}>
                <IconCozCopy
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 1,
                  }}
                  onClick={() =>
                    handleCopy(
                      tab === 'sync'
                        ? data.curl || ''
                        : data.streaming_curl || '',
                    )
                  }
                ></IconCozCopy>
              </Tooltip>
              <pre
                style={{
                  background: 'rgb(247, 247, 252)',
                  borderRadius: 4,
                  padding: '16px 60px 16px 16px',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  overflow: 'auto',
                  maxHeight: 300,
                  margin: 0,
                }}
              >
                {tab === 'sync' ? data.curl || '-' : data.streaming_curl || '-'}
              </pre>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
