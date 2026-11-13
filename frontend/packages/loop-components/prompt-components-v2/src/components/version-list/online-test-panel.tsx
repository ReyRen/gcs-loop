// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
/* eslint-disable max-lines -- 在线测试面板包含变量表单、用户提问与结果展示 */
/* eslint-disable max-lines-per-function -- 变量表单、提问与结果展示集中在同一面板 */
/* eslint-disable @coze-arch/max-line-per-function -- 同上 */
/* eslint-disable @coze-arch/use-error-in-catch -- 变量值属于敏感数据，不记录异常内容 */
import { useEffect, useRef, useState } from 'react';

import { I18n } from '@cozeloop/i18n-adapter';
import { handleCopy } from '@cozeloop/components';
import { type Message, Role } from '@cozeloop/api-schema/prompt';
import { StonePromptApi } from '@cozeloop/api-schema';
import { IconCozCopy } from '@coze-arch/coze-design/icons';
import {
  Button,
  Input,
  Tag,
  TextArea,
  Typography,
} from '@coze-arch/coze-design';

import {
  type InvokeInfo,
  type InvokeParam,
  type InvokeVariableValue,
} from './invoke-types';

/** 请求层通用错误码，无用户可读信息 */
const GENERIC_ERROR_MESSAGES = new Set([
  'NetworkError',
  'TimeoutError',
  'InternalServerError',
  'BadGateway',
  'RateLimitError',
  'Invalid JSON error',
  'AuthenticationError',
  'Unknown error',
]);

/** 用户提问状态：必填 / 选填 / 无法确认（Placeholder 或消息结构未知） */
type UserQueryMode = 'required' | 'optional' | 'unknown';

interface TestResult {
  ok: boolean;
  httpStatus: number;
  code?: number;
  msg?: string;
  resolvedVersion?: string;
  versionMismatch: boolean;
  truncated: boolean;
  elapsedMs: number;
  traceId?: string;
  answer?: string;
  toolCalls?: {
    name?: string;
    function?: { name?: string; arguments?: string };
  }[];
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
  raw: string;
}

const codeBlockStyle: React.CSSProperties = {
  background: 'rgb(247, 247, 252)',
  borderRadius: 4,
  padding: '8px 40px 8px 12px',
  fontSize: 12,
  fontFamily: 'monospace',
  overflow: 'auto',
  maxHeight: 240,
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

/** 变量取值字段：value / placeholder_messages / multi_part_values */
function getValueField(param: InvokeParam) {
  return param.value_field || 'value';
}

/** 消息是否有有效文本内容（空文本、空内容片段不算有效输入） */
function hasTextContent(message: {
  content?: string;
  parts?: { text?: string }[];
}) {
  if (String(message?.content ?? '').trim()) {
    return true;
  }
  return Boolean(message?.parts?.some(part => String(part?.text ?? '').trim()));
}

/** 判断 Placeholder 变量当前填写值是否包含有效 User 消息，undefined 表示无法确认 */
function parsePlaceholderUser(raw?: string): boolean | undefined {
  if (!raw || !raw.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed.some(
      item =>
        String(item?.role ?? '') === Role.User &&
        hasTextContent(
          item as { content?: string; parts?: { text?: string }[] },
        ),
    );
  } catch {
    return undefined;
  }
}

/** 用后端返回的 request_body 初始化变量输入，示例值需要用户替换 */
function buildInitialValues(invokeInfo: InvokeInfo): Record<string, string> {
  const values: Record<string, string> = {};
  for (const param of invokeInfo.parameters ?? []) {
    if (param.key) {
      values[param.key] = '';
    }
  }
  try {
    const body = JSON.parse(invokeInfo.request_body || '{}');
    const variableVals = (body.variable_vals ?? []) as Record<
      string,
      unknown
    >[];
    for (const item of variableVals) {
      const key = String(item.key ?? '');
      if (!key) {
        continue;
      }
      if (item.placeholder_messages !== undefined) {
        values[key] = JSON.stringify(item.placeholder_messages, null, 2);
      } else if (item.multi_part_values !== undefined) {
        values[key] = JSON.stringify(item.multi_part_values, null, 2);
      } else {
        values[key] = item.value === undefined ? '' : String(item.value);
      }
    }
    // request_body 解析失败时退回空值，不记录异常内容以免泄露变量值
    // eslint-disable-next-line @coze-arch/no-empty-catch -- 保留空值即可，异常内容含变量值不应记录
  } catch {
    // 保留空值，页面仍可手工填写
  }
  return values;
}

function resolveErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  return message && !GENERIC_ERROR_MESSAGES.has(message) ? message : fallback;
}

/** 版本记录 → 调用 → 在线测试 */
export function OnlineTestPanel({
  invokeInfo,
  visible,
  promptId,
  spaceID,
}: {
  invokeInfo: InvokeInfo;
  visible: boolean;
  promptId?: string;
  spaceID?: string;
}) {
  const [pat, setPat] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() =>
    buildInitialValues(invokeInfo),
  );
  const [userQuery, setUserQuery] = useState('');
  const [commitMessages, setCommitMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [sending, setSending] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<TestResult>();
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController>();
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  // 标记当前请求结果已被丢弃（关闭弹窗、切换版本或停止等待）
  const discardRef = useRef(false);

  const parameters = invokeInfo.parameters ?? [];

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
  };

  /** 读取当前提交版本的消息结构，用于判断是否需要用户提问 */
  const loadCommitMessages = async () => {
    const { version } = invokeInfo;
    if (!promptId || !spaceID || !version) {
      return;
    }
    setMessagesLoading(true);
    setMessagesError('');
    // 切换版本时先清空，避免用上一个版本的消息结构判断
    setCommitMessages([]);
    try {
      const res = await StonePromptApi.GetPrompt({
        prompt_id: promptId,
        workspace_id: spaceID,
        commit_version: version,
        with_commit: true,
      });
      setCommitMessages(
        res.prompt?.prompt_commit?.detail?.prompt_template?.messages ?? [],
      );
    } catch {
      // 读取失败时不沿用其他版本的缓存
      setCommitMessages([]);
      setMessagesError(I18n.t('prompt_online_test_user_query_load_failed'));
    } finally {
      setMessagesLoading(false);
    }
  };

  // 版本快照变化时重置变量、提问与结果，避免跨版本混用
  useEffect(() => {
    discardRef.current = true;
    abortRef.current?.abort();
    abortRef.current = undefined;
    clearTimer();
    setSending(false);
    setValues(buildInitialValues(invokeInfo));
    setUserQuery('');
    setResult(undefined);
    setError('');
  }, [invokeInfo]);

  // 按版本三元组重新读取消息结构
  useEffect(() => {
    loadCommitMessages();
  }, [promptId, spaceID, invokeInfo.version]);

  // 关闭弹窗后清空 PAT、结果与未完成的请求
  useEffect(() => {
    if (visible) {
      return;
    }
    discardRef.current = true;
    abortRef.current?.abort();
    abortRef.current = undefined;
    clearTimer();
    setSending(false);
    setPat('');
    setUserQuery('');
    setResult(undefined);
    setError('');
  }, [visible]);

  useEffect(
    () => () => {
      discardRef.current = true;
      abortRef.current?.abort();
      clearTimer();
    },
    [],
  );

  // 仅根据结构化 role 判断，不在前端渲染模板
  const templateHasUser = commitMessages.some(
    message => message?.role === Role.User && hasTextContent(message),
  );
  const placeholderParams = parameters.filter(
    param => getValueField(param) === 'placeholder_messages',
  );
  const placeholderStates = placeholderParams.map(param =>
    parsePlaceholderUser(values[param.key ?? ''] ?? ''),
  );
  const placeholderHasUser = placeholderStates.some(state => state === true);
  const placeholderUnconfirmed = placeholderStates.some(
    state => state === undefined,
  );
  const structureUnknown =
    messagesLoading || Boolean(messagesError) || placeholderUnconfirmed;

  let userQueryMode: UserQueryMode = 'required';
  if (templateHasUser || placeholderHasUser) {
    userQueryMode = 'optional';
  } else if (structureUnknown) {
    userQueryMode = 'unknown';
  }

  const parseVariableVals = ():
    | { variableVals: InvokeVariableValue[] }
    | { invalidKey: string } => {
    const variableVals: InvokeVariableValue[] = [];
    for (const param of parameters) {
      const key = param.key ?? '';
      const field = getValueField(param);
      const raw = values[key] ?? '';
      if (field === 'value') {
        // 非字符串类型也以字符串存放 JSON 文本，保持接口协议不变
        variableVals.push({ key, value: raw });
        continue;
      }
      let parsed: unknown[] = [];
      if (raw.trim()) {
        try {
          parsed = JSON.parse(raw) as unknown[];
        } catch {
          return { invalidKey: key };
        }
      }
      variableVals.push(
        field === 'placeholder_messages'
          ? { key, placeholder_messages: parsed }
          : { key, multi_part_values: parsed },
      );
    }
    return { variableVals };
  };

  /**
   * 生成真正发送的请求体：替换变量值，并在填写提问时追加一条 User 消息。
   * 每次新建对象，不污染后端返回的版本快照。
   */
  const buildRequestBody = ():
    | { body: Record<string, unknown> }
    | { invalidKey: string }
    | { invalidBody: true } => {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(invokeInfo.request_body || '');
    } catch {
      return { invalidBody: true };
    }
    const parsed = parseVariableVals();
    if ('invalidKey' in parsed) {
      return parsed;
    }
    body.variable_vals = parsed.variableVals;
    const question = userQuery.trim();
    if (question) {
      const existedMessages = Array.isArray(body.messages) ? body.messages : [];
      body.messages = [
        ...existedMessages,
        { role: Role.User, content: question, skip_render: true },
      ];
    }
    return { body };
  };

  const previewState = buildRequestBody();
  const previewJson =
    'body' in previewState ? JSON.stringify(previewState.body, null, 2) : '';

  const handleSend = async () => {
    if (sending) {
      return;
    }
    const token = pat.trim();
    if (!token || token.includes('*')) {
      setError(
        token
          ? I18n.t('prompt_online_test_pat_masked')
          : I18n.t('prompt_online_test_pat_required'),
      );
      return;
    }
    const built = buildRequestBody();
    if ('invalidBody' in built) {
      setError(I18n.t('prompt_online_test_failed'));
      return;
    }
    if ('invalidKey' in built) {
      setError(
        I18n.t('prompt_online_test_invalid_json', { key: built.invalidKey }),
      );
      return;
    }
    // 消息结构读取失败且未填写提问时先重试读取，避免无意义地调用模型
    if (messagesError && !userQuery.trim()) {
      setError(messagesError);
      return;
    }
    // 仅 System 且没有其他 User 消息时必填，避免无意义地调用模型
    if (userQueryMode === 'required' && !userQuery.trim()) {
      setError(I18n.t('prompt_online_test_user_query_required'));
      return;
    }

    const body = built.body as {
      prompt_identifier?: { prompt_key?: string; version?: string };
    };
    const promptIdentifier = body.prompt_identifier ?? {};
    const prefix = (process.env.API_SCHEMA_BASE_URL || '').replace(/\/$/, '');
    const endpoint = invokeInfo.execute_endpoint || '/v1/loop/prompts/execute';
    const controller = new AbortController();
    discardRef.current = false;
    abortRef.current = controller;
    setSending(true);
    setError('');
    setResult(undefined);
    setElapsedMs(0);
    const started = Date.now();
    timerRef.current = setInterval(
      () => setElapsedMs(Date.now() - started),
      200,
    );
    try {
      const response = await fetch(`${prefix}${endpoint}`, {
        method: 'POST',
        // 公共执行接口只使用输入的 PAT，不依赖登录 Cookie
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Agw-Js-Conv': 'str',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      if (discardRef.current) {
        return;
      }
      let payload: {
        code?: number;
        msg?: string;
        data?: {
          message?: {
            content?: string;
            tool_calls?: {
              name?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
          finish_reason?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
          trace_id?: string;
          prompt_key?: string;
          resolved_version?: string;
        };
      };
      try {
        payload = JSON.parse(raw);
      } catch {
        setError(
          I18n.t('prompt_online_test_not_json', { status: response.status }),
        );
        return;
      }
      const callOK = response.ok && payload.code === 0;
      const versionMismatch =
        callOK &&
        (payload.data?.prompt_key !== promptIdentifier.prompt_key ||
          payload.data?.resolved_version !== promptIdentifier.version);
      setResult({
        ok: callOK && !versionMismatch,
        httpStatus: response.status,
        code: payload.code,
        msg: payload.msg,
        resolvedVersion: payload.data?.resolved_version,
        versionMismatch,
        truncated: Boolean(callOK && payload.data?.finish_reason === 'length'),
        elapsedMs: Date.now() - started,
        traceId: payload.data?.trace_id,
        answer: payload.data?.message?.content,
        toolCalls: payload.data?.message?.tool_calls,
        inputTokens: payload.data?.usage?.input_tokens,
        outputTokens: payload.data?.usage?.output_tokens,
        finishReason: payload.data?.finish_reason,
        raw,
      });
    } catch (e: unknown) {
      if (discardRef.current) {
        return;
      }
      if (e instanceof DOMException && e.name === 'AbortError') {
        setError(I18n.t('prompt_online_test_stopped'));
      } else {
        setError(resolveErrorMessage(e, I18n.t('prompt_online_test_failed')));
      }
    } finally {
      clearTimer();
      if (!discardRef.current) {
        setSending(false);
      }
      abortRef.current = undefined;
    }
  };

  const handleStop = () => {
    discardRef.current = true;
    abortRef.current?.abort();
    abortRef.current = undefined;
    clearTimer();
    setSending(false);
    setError(I18n.t('prompt_online_test_stopped'));
  };

  const renderUserQueryHint = () => {
    if (messagesError) {
      return (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <Typography.Text type="danger">{messagesError}</Typography.Text>
          <Button size="small" onClick={loadCommitMessages}>
            {I18n.t('prompt_online_test_retry')}
          </Button>
        </div>
      );
    }
    if (userQueryMode === 'required') {
      return (
        <div className="mt-1">
          <Typography.Text type="danger" className="text-xs">
            {I18n.t('prompt_online_test_user_query_required')}
          </Typography.Text>
        </div>
      );
    }
    if (userQueryMode === 'optional') {
      return (
        <div className="mt-1 text-xs coz-fg-secondary">
          {templateHasUser
            ? I18n.t('prompt_online_test_user_query_append_tip')
            : I18n.t('prompt_online_test_user_query_placeholder_tip')}
        </div>
      );
    }
    return (
      <div className="mt-1 text-xs coz-fg-secondary">
        {I18n.t('prompt_online_test_user_query_unknown_tip')}
      </div>
    );
  };

  const renderResult = (testResult: TestResult) => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Tag color={testResult.ok ? 'green' : 'red'}>
          {testResult.ok
            ? I18n.t('prompt_online_test_success')
            : I18n.t('prompt_online_test_fail')}
        </Tag>
        {testResult.truncated ? (
          <Tag color="yellow">{I18n.t('prompt_online_test_truncated')}</Tag>
        ) : null}
      </div>
      {testResult.versionMismatch ? (
        <Typography.Text type="danger">
          {I18n.t('prompt_online_test_version_mismatch')}
        </Typography.Text>
      ) : null}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
        <div>
          {I18n.t('prompt_online_test_http_status')}: {testResult.httpStatus}
        </div>
        <div>
          {I18n.t('prompt_online_test_biz_status')}: {testResult.code ?? '-'}{' '}
          {testResult.msg || ''}
        </div>
        <div>
          {I18n.t('prompt_online_test_resolved_version')}:{' '}
          {testResult.resolvedVersion || '-'}
        </div>
        <div>
          {I18n.t('prompt_online_test_elapsed')}: {testResult.elapsedMs} ms
        </div>
        <div>
          {I18n.t('prompt_online_test_usage')}: {testResult.inputTokens ?? '-'}
          {' / '}
          {testResult.outputTokens ?? '-'}
        </div>
        <div>finish_reason: {testResult.finishReason || '-'}</div>
      </div>
      {testResult.traceId ? (
        <div className="flex items-center gap-1 text-[13px]">
          <span className="coz-fg-secondary">
            {I18n.t('prompt_online_test_trace_id')}:
          </span>
          <span className="font-mono">{testResult.traceId}</span>
          <IconCozCopy
            className="cursor-pointer"
            onClick={() => handleCopy(testResult.traceId || '')}
          />
        </div>
      ) : null}
      <div>
        <div className="mb-1 text-[13px] font-medium">
          {I18n.t('prompt_online_test_answer')}
        </div>
        <pre style={codeBlockStyle}>
          {testResult.answer || I18n.t('prompt_online_test_no_answer')}
        </pre>
      </div>
      {testResult.toolCalls?.length ? (
        <div>
          <div className="mb-1 text-[13px] font-medium">
            {I18n.t('prompt_online_test_tool_calls')}
          </div>
          {testResult.toolCalls.map((call, index) => (
            <pre key={index} style={codeBlockStyle}>
              {call?.function?.name || call?.name || '-'}
              {call?.function?.arguments ? ` ${call.function.arguments}` : ''}
            </pre>
          ))}
        </div>
      ) : null}
      <div>
        <div className="mb-1 flex items-center gap-1 text-[13px] font-medium">
          {I18n.t('prompt_online_test_raw')}
          <IconCozCopy
            className="cursor-pointer"
            onClick={() => handleCopy(testResult.raw)}
          />
        </div>
        <pre style={codeBlockStyle}>{testResult.raw}</pre>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[13px] coz-fg-secondary">
        {I18n.t('prompt_online_test_desc')}
      </div>

      <div>
        <div className="mb-1 text-[13px] font-medium">
          {I18n.t('prompt_online_test_pat')}
        </div>
        <Input
          password
          value={pat}
          placeholder={I18n.t('prompt_online_test_pat_placeholder')}
          onChange={setPat}
        />
        <div className="mt-1 text-xs coz-fg-secondary">
          {I18n.t('prompt_online_test_pat_tip')}
        </div>
      </div>

      <div>
        <div className="mb-1 text-[13px] font-medium">
          {I18n.t('prompt_online_test_variables')}
        </div>
        {parameters.length ? (
          <div className="flex flex-col gap-2">
            {parameters.map(param => {
              const key = param.key ?? '';
              const field = getValueField(param);
              return (
                <div key={key}>
                  <div className="mb-1 flex items-center gap-2 text-[13px]">
                    <span className="font-mono">{key}</span>
                    {param.type ? <Tag size="small">{param.type}</Tag> : null}
                    {field !== 'value' ? (
                      <Tag size="small" color="primary">
                        {field}
                      </Tag>
                    ) : null}
                    {param.description ? (
                      <span className="coz-fg-secondary">
                        {param.description}
                      </span>
                    ) : null}
                    {param.type_tags?.length ? (
                      <span className="coz-fg-secondary">
                        {param.type_tags.join(', ')}
                      </span>
                    ) : null}
                  </div>
                  <TextArea
                    value={values[key] ?? ''}
                    placeholder={param.example || ''}
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    onChange={v => setValues(prev => ({ ...prev, [key]: v }))}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-[13px] coz-fg-secondary">
            {I18n.t('prompt_online_test_no_variables')}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1 text-[13px] font-medium">
          {I18n.t('prompt_online_test_user_query')}
          {userQueryMode === 'required' ? (
            <span className="text-[rgb(var(--coze-red-5))]">*</span>
          ) : null}
        </div>
        <TextArea
          value={userQuery}
          placeholder={I18n.t('prompt_online_test_user_query_placeholder')}
          autoSize={{ minRows: 2, maxRows: 4 }}
          onChange={setUserQuery}
        />
        {renderUserQueryHint()}
      </div>

      <div className="flex items-center gap-2">
        <Button color="primary" loading={sending} onClick={handleSend}>
          {I18n.t('prompt_online_test_send')}
        </Button>
        {sending ? (
          <>
            <Button onClick={handleStop}>
              {I18n.t('prompt_online_test_stop')}
            </Button>
            <span className="text-[13px] coz-fg-secondary">
              {I18n.t('prompt_online_test_sending', {
                seconds: Math.floor(elapsedMs / 1000),
              })}
            </span>
          </>
        ) : null}
      </div>

      <details>
        <summary className="cursor-pointer text-[13px] coz-fg-secondary">
          {I18n.t('prompt_online_test_request_preview')}
        </summary>
        <div style={{ position: 'relative' }} className="mt-2">
          {previewJson ? (
            <IconCozCopy
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 1,
                cursor: 'pointer',
              }}
              onClick={() => handleCopy(previewJson)}
            />
          ) : null}
          <pre style={codeBlockStyle}>{previewJson || '-'}</pre>
        </div>
      </details>

      {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}

      {result ? renderResult(result) : null}
    </div>
  );
}
