// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { I18n } from '@cozeloop/i18n-adapter';
import {
  Button,
  Loading,
  Modal,
  Space,
  Typography,
} from '@coze-arch/coze-design';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';

interface PromptOptimizeDialogProps {
  visible: boolean;
  promptContent: string;
  messageRole: string;
  spaceID: string;
  promptID?: string;
  promptName?: string;
  promptKey?: string;
  promptDesc?: string;
  /** 当前 message 完整对象 */
  originalMessage?: Record<string, unknown>;
  /** 全部消息列表，用于提取 assistant/user 消息 */
  messageList?: Array<Record<string, unknown>>;
  /** 变量值列表 */
  variableVals?: Array<{ key: string; value: string }>;
  onClose: () => void;
  onAccept?: (optimizedContent: string) => Promise<void>;
}

const SSE_DATA_PREFIX = 'data:';
const SSE_DATA_PREFIX_LEN = SSE_DATA_PREFIX.length;

const cmBaseExtensions = [
  EditorView.editable.of(false),
  EditorView.theme({
    '&': { height: '100%' },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-content': {
      padding: '8px 12px',
      fontSize: '13px',
      fontFamily: 'monospace',
    },
    '.cm-gutters': { display: 'none' },
  }),
];

interface ParsedSSEResult {
  result: string;
  remainder: string;
  recordId?: string;
}

function parseSSELines(buffer: string): ParsedSSEResult {
  const lines = buffer.split('\n');
  const remainder = lines.pop() || '';
  let result = '';
  let recordId: string | undefined;
  for (const line of lines) {
    if (!line.startsWith(SSE_DATA_PREFIX)) {
      continue;
    }
    const data = line.slice(SSE_DATA_PREFIX_LEN).trim();
    if (!data || data === '[DONE]') {
      continue;
    }
    try {
      const parsed: Record<string, unknown> = JSON.parse(data);
      if (!recordId && parsed.record_id) {
        recordId = String(parsed.record_id);
      }
      const delta = parsed.delta as Record<string, unknown> | undefined;
      const text =
        (delta?.content as string) ||
        (delta?.reasoning_content as string) ||
        '';
      if (text) {
        result += String(text);
      }
      // eslint-disable-next-line @coze-arch/use-error-in-catch -- 非JSON数据直接追加文本
    } catch {
      result += data;
    }
  }

  return { result, remainder, recordId };
}

interface UseOptimizeStreamParams {
  promptContent: string;
  messageRole: string;
  spaceID: string;
  promptID?: string;
  promptName?: string;
  promptKey?: string;
  promptDesc?: string;
  originalMessage?: Record<string, unknown>;
  messageList?: Array<Record<string, unknown>>;
  variableVals?: Array<{ key: string; value: string }>;
}

function findMessageByRole(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 消息列表动态类型
  list: Array<Record<string, any>> | undefined,
  role: string,
) {
  return list?.find(m => m.role === role);
}

function buildRequestBody(params: UseOptimizeStreamParams) {
  const {
    promptContent,
    messageRole,
    spaceID,
    promptID,
    promptName,
    promptKey,
    promptDesc,
    originalMessage,
    messageList,
    variableVals,
  } = params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 从父组件传入的消息列表
  const msgList = messageList as Array<Record<string, any>> | undefined;
  const assistantMsg = findMessageByRole(msgList, 'assistant');
  const userMsg = findMessageByRole(msgList, 'user');
  return {
    original_prompt_message: originalMessage || {
      role: messageRole || 'system',
      content: promptContent,
    },
    generate_prompt_type: 'one_step_optimize',
    space_id: spaceID,
    prompt_id: promptID,
    prompt_name: promptName,
    prompt_key: promptKey,
    prompt_desc: promptDesc,
    ...(assistantMsg && { assistant_message: assistantMsg }),
    ...(userMsg && { user_message: userMsg }),
    ...(variableVals?.length && { variable_vals: variableVals }),
  };
}

async function readStreamToEnd(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onText: (text: string) => void,
  onRecordId?: (id: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';
  let streamDone = false;

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) {
      streamDone = true;
    }
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const { result, remainder, recordId } = parseSSELines(buffer);
      buffer = remainder;
      if (recordId) {
        onRecordId?.(recordId);
      }
      if (result) {
        onText(result);
      }
    }
  }
}

const flexColumnStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  border: '1px solid #f0f0f7',
};

const labelStyle: React.CSSProperties = { marginBottom: 8, display: 'block' };

const loadingOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(255,255,255,0.7)',
};

interface CodeMirrorPanelProps {
  label: string;
  content: string;
  loading?: boolean;
  labelBg?: boolean;
}

function CodeMirrorPanel({
  label,
  content,
  loading,
  labelBg,
}: CodeMirrorPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // 初始化 CodeMirror 编辑器
  useEffect(() => {
    if (!containerRef.current || viewRef.current) {
      return;
    }
    const state = EditorState.create({
      doc: content,
      extensions: cmBaseExtensions,
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // content 变化时全量替换文档
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== content) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content,
        },
      });
    }
  }, [content]);

  return (
    <div style={flexColumnStyle}>
      <Typography.Text
        strong
        style={{
          ...labelStyle,
          ...(labelBg
            ? {
                background: '#f0f0f7',
                padding: '4px 8px',
                borderRadius: 4,
              }
            : {}),
        }}
      >
        {label}
      </Typography.Text>
      <div
        style={{
          position: 'relative',
          flex: 1,
          border: '1px solid var(--COZColorGray4)',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        <div ref={containerRef} style={{ height: '100%' }} />
        {loading ? (
          <div style={loadingOverlayStyle}>
            <Loading loading />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function useOptimizeStream(params: UseOptimizeStreamParams) {
  const {
    promptContent,
    messageRole,
    spaceID,
    promptID,
    promptName,
    promptKey,
    promptDesc,
    originalMessage,
    messageList,
    variableVals,
  } = params;
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const recordIdRef = useRef<string | undefined>(undefined);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setResult('');
    recordIdRef.current = undefined;
  }, []);

  const start = useCallback(async () => {
    if (!promptContent || !spaceID) {
      return;
    }
    setResult('');
    setLoading(true);
    recordIdRef.current = undefined;
    const abortController = new AbortController();
    abortRef.current = abortController;
    try {
      const baseUrl = process.env.API_SCHEMA_BASE_URL || '';
      const resp = await fetch(`${baseUrl}/api/prompt/v1/prompts/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Agw-Js-Conv': 'str' },
        body: JSON.stringify(buildRequestBody(params)),
        signal: abortController.signal,
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const reader = resp.body?.getReader();
      if (!reader) {
        throw new Error('No readable stream');
      }
      await readStreamToEnd(
        reader,
        text => {
          setResult(prev => prev + text);
        },
        id => {
          recordIdRef.current = id;
        },
      );
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return;
      }
      setResult(
        prev =>
          prev +
          (prev ? '\n\n' : '') +
          I18n.t('prompt_optimize_request_failed'),
      );
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [
    promptContent,
    spaceID,
    messageRole,
    promptID,
    promptName,
    promptKey,
    promptDesc,
    originalMessage,
    messageList,
    variableVals,
  ]);

  return { result, loading, recordIdRef, start, stop, reset };
}

export function PromptOptimizeDialog({
  visible,
  promptContent,
  messageRole,
  spaceID,
  promptID,
  promptName,
  promptKey,
  promptDesc,
  originalMessage,
  messageList,
  variableVals,
  onClose,
  onAccept,
}: PromptOptimizeDialogProps) {
  const streamParams = useMemo(
    () => ({
      promptContent,
      messageRole,
      spaceID,
      promptID,
      promptName,
      promptKey,
      promptDesc,
      originalMessage,
      messageList,
      variableVals,
    }),
    [
      promptContent,
      messageRole,
      spaceID,
      promptID,
      promptName,
      promptKey,
      promptDesc,
      originalMessage,
      messageList,
      variableVals,
    ],
  );
  const { result, loading, recordIdRef, start, stop, reset } =
    useOptimizeStream(streamParams);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleAccept = useCallback(async () => {
    const recordId = recordIdRef.current;
    if (!recordId || !promptID || !spaceID) {
      return;
    }
    try {
      const baseUrl = process.env.API_SCHEMA_BASE_URL || '';
      await fetch(
        `${baseUrl}/api/prompt/v1/prompts/generate/record/${recordId}/update`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Agw-Js-Conv': 'str' },
          body: JSON.stringify({
            prompt_id: promptID,
            space_id: spaceID,
            is_accepted: true,
          }),
        },
      );
      // 链式调用：采纳后保存草稿
      if (onAccept && result) {
        await onAccept(result);
      }
    } finally {
      handleClose();
    }
  }, [promptID, spaceID, recordIdRef, handleClose, onAccept, result]);

  useEffect(() => {
    if (visible) {
      start();
    }
  }, [visible, start]);

  const footerBtn = (
    <Space>
      <Button color="primary" onClick={handleClose}>
        {I18n.t('cancel')}
      </Button>
      {loading ? (
        <Button onClick={stop}>{I18n.t('prompt_stop_all_responses')}</Button>
      ) : null}
      <Button disabled={!recordIdRef.current || loading} onClick={handleAccept}>
        {I18n.t('prompt_optimize_accept')}
      </Button>
    </Space>
  );

  return (
    <Modal
      visible={visible}
      title={I18n.t('prompt_quick_optimize')}
      onCancel={handleClose}
      width={1100}
      footer={footerBtn}
    >
      <div
        style={{
          display: 'flex',
          gap: 16,
          minHeight: 400,
          maxHeight: '60vh',
        }}
      >
        <CodeMirrorPanel
          label={I18n.t('prompt_template')}
          content={promptContent}
          labelBg
        />
        <CodeMirrorPanel
          label={I18n.t('prompt_quick_optimize')}
          content={result}
          loading={loading}
          labelBg
        />
      </div>
    </Modal>
  );
}
