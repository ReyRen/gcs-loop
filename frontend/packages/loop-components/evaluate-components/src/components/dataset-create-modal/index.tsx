// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { I18n } from '@cozeloop/i18n-adapter';
import { Modal } from '@coze-arch/coze-design';

import { DatasetCreateForm } from '../dataset-create-form';

export interface DatasetCreateModalProps {
  visible: boolean;
  onCancel: () => void;
  onCreateSuccess: (evaluationSetId: string) => void;
}

export const DatasetCreateModal = ({
  visible,
  onCancel,
  onCreateSuccess,
}: DatasetCreateModalProps) => (
  <Modal
    visible={visible}
    onCancel={onCancel}
    title={I18n.t('new_evaluation_set')}
    width={960}
    height="fill"
    footer={null}
    hasScroll={false}
  >
    <DatasetCreateForm header={null} onCreateSuccess={onCreateSuccess} />
  </Modal>
);
