// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';

import { usePagination, useRequest } from 'ahooks';
import { formatTimestampToString } from '@cozeloop/toolkit';
import { I18n } from '@cozeloop/i18n-adapter';
import {
  PrimaryPage,
  TableColActions,
  TableWithPagination,
  DEFAULT_PAGE_SIZE,
} from '@cozeloop/components';
import { AuthApi } from '@cozeloop/api-schema';
import {
  Button,
  Form,
  FormInput,
  FormSelect,
  Modal,
  Toast,
  Typography,
} from '@coze-arch/coze-design';

interface TokenItem {
  id?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  expire_at?: string;
  last_used_at?: string;
}

const DURATION_OPTIONS = [
  { label: '1 天', value: '1' },
  { label: '7 天', value: '7' },
  { label: '30 天', value: '30' },
  { label: '90 天', value: '90' },
  { label: '365 天', value: '365' },
  { label: '730 天', value: '730' },
];

export default function ApiKeysPage() {
  const [refreshFlag, setRefreshFlag] = useState(0);
  const [createVisible, setCreateVisible] = useState(false);
  const [editData, setEditData] = useState<TokenItem | null>(null);

  const listService = usePagination(
    ({ current, pageSize }) =>
      AuthApi.ListPersonalAccessTokens({
        page_number: current,
        page_size: pageSize,
      }).then(res => ({
        list: res.personal_access_tokens || [],
        total: Number(res.total || 0),
      })),
    {
      defaultPageSize: DEFAULT_PAGE_SIZE,
      refreshDeps: [refreshFlag],
    },
  );

  const createService = useRequest(
    (values: { name: string; duration_day: string }) =>
      AuthApi.CreatePersonalAccessToken(values),
    {
      manual: true,
      onSuccess: () => {
        Toast.success(I18n.t('create_success'));
        setCreateVisible(false);
        setRefreshFlag(f => f + 1);
      },
    },
  );

  const deleteService = useRequest(
    (id: string) => AuthApi.DeletePersonalAccessToken({ id }),
    {
      manual: true,
      onSuccess: () => {
        Toast.success(I18n.t('delete_success'));
        setRefreshFlag(f => f + 1);
      },
    },
  );

  const updateService = useRequest(
    (params: { id: string; name: string }) =>
      AuthApi.UpdatePersonalAccessToken(params),
    {
      manual: true,
      onSuccess: () => {
        Toast.success(I18n.t('update_success'));
        setEditData(null);
        setRefreshFlag(f => f + 1);
      },
    },
  );

  const handleUpdate = (v: { name: string }) => {
    if (editData?.id) {
      updateService.run({ id: editData.id, name: v.name });
    }
  };

  const columns = [
    {
      dataIndex: 'name',
      title: I18n.t('name'),
      width: 260,
      ellipsis: true,
    },
    {
      dataIndex: 'created_at',
      title: I18n.t('create_time'),
      width: 200,
      render: (text: string) => (
        <Typography.Text style={{ fontSize: 'inherit' }}>
          {text ? formatTimestampToString(text) : '-'}
        </Typography.Text>
      ),
    },
    {
      dataIndex: 'expire_at',
      title: I18n.t('expire_time'),
      width: 200,
      render: (text: string) => (
        <Typography.Text style={{ fontSize: 'inherit' }}>
          {text ? formatTimestampToString(text) : '-'}
        </Typography.Text>
      ),
    },
    {
      dataIndex: 'last_used_at',
      title: I18n.t('last_used_time'),
      width: 200,
      render: (text: string) => (
        <Typography.Text style={{ fontSize: 'inherit' }}>
          {text ? formatTimestampToString(text) : '-'}
        </Typography.Text>
      ),
    },
    {
      title: I18n.t('operation'),
      key: 'action',
      dataIndex: 'action',
      width: 160,
      align: 'left',
      fixed: 'right',
      render: (_: unknown, row: TokenItem) => (
        <TableColActions
          actions={[
            {
              label: I18n.t('edit'),
              onClick: () => setEditData(row),
            },
            {
              label: I18n.t('delete'),
              type: 'danger',
              onClick: () => {
                Modal.confirm({
                  title: I18n.t('confirm_delete_token'),
                  okText: I18n.t('delete'),
                  cancelText: I18n.t('cancel'),
                  okButtonProps: { color: 'red' },
                  onOk: () => deleteService.run(row.id || ''),
                });
              },
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PrimaryPage
        pageTitle={I18n.t('api_auth')}
        titleSlot={
          <Button onClick={() => setCreateVisible(true)}>
            {I18n.t('create_token')}
          </Button>
        }
      >
        <div className="w-full h-full overflow-hidden flex flex-1 flex-col">
          <TableWithPagination<TokenItem>
            heightFull
            service={listService}
            tableProps={{
              rowKey: 'id',
              columns: columns as any,
              sticky: { top: 0 },
            }}
          />
        </div>
      </PrimaryPage>

      <Modal
        visible={createVisible}
        title={I18n.t('create_token')}
        width={480}
        footer={null}
        onCancel={() => setCreateVisible(false)}
      >
        <Form onSubmit={v => createService.run(v)} labelWidth={100}>
          <FormInput
            field="name"
            label={I18n.t('name')}
            required
            placeholder={I18n.t('please_input_token_name')}
            rules={[
              { required: true, message: I18n.t('please_input_token_name') },
            ]}
          />
          <FormSelect
            field="duration_day"
            label={I18n.t('expire_duration')}
            placeholder={I18n.t('please_select')}
            optionList={DURATION_OPTIONS}
            style={{ width: '100%' }}
            rules={[{ required: true }]}
          />
          <div className="flex justify-end gap-2 mt-4">
            <Button color="primary" onClick={() => setCreateVisible(false)}>
              {I18n.t('cancel')}
            </Button>
            <Button htmlType="submit" loading={createService.loading}>
              {I18n.t('confirm')}
            </Button>
          </div>
        </Form>
      </Modal>

      <Modal
        visible={!!editData}
        title={I18n.t('edit_token')}
        width={480}
        footer={null}
        onCancel={() => setEditData(null)}
      >
        <Form onSubmit={v => handleUpdate(v)} labelWidth={100}>
          <FormInput
            field="name"
            label={I18n.t('name')}
            required
            initValue={editData?.name}
            placeholder={I18n.t('please_input_token_name')}
            rules={[
              { required: true, message: I18n.t('please_input_token_name') },
            ]}
          />
          <div className="flex justify-end gap-2 mt-4">
            <Button color="primary" onClick={() => setEditData(null)}>
              {I18n.t('cancel')}
            </Button>
            <Button htmlType="submit" loading={updateService.loading}>
              {I18n.t('confirm')}
            </Button>
          </div>
        </Form>
      </Modal>
    </>
  );
}
