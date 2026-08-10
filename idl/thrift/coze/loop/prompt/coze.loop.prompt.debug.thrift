namespace go coze.loop.prompt.debug

include "../../../base.thrift"
include "./domain/prompt.thrift"

service PromptDebugService {
    DebugStreamingResponse DebugStreaming(1: DebugStreamingRequest req) (api.post='/api/prompt/v1/prompts/:prompt_id/debug_streaming', streaming.mode='server')
    GeneratePromptResponse GeneratePrompt(1: GeneratePromptRequest req) (api.post='/api/prompt/v1/prompts/generate', streaming.mode='server')
    UpdateGenerateRecordResponse UpdateGenerateRecord(1: UpdateGenerateRecordRequest req) (api.post='/api/prompt/v1/prompts/generate/record/:record_id/update')
    SaveDebugContextResponse SaveDebugContext(1: SaveDebugContextRequest req) (api.post='/api/prompt/v1/prompts/:prompt_id/debug_context/save')
    GetDebugContextResponse GetDebugContext(1: GetDebugContextRequest req) (api.get='/api/prompt/v1/prompts/:prompt_id/debug_context/get')
    ListDebugHistoryResponse ListDebugHistory(1: ListDebugHistoryRequest req) (api.get='/api/prompt/v1/prompts/:prompt_id/debug_history/list')
}

struct DebugStreamingRequest {
    1: optional prompt.Prompt prompt (vt.not_nil="true")
    2: optional list<prompt.Message> messages
    3: optional list<prompt.VariableVal> variable_vals
    4: optional list<prompt.MockTool> mock_tools

    101: optional bool single_step_debug (vt.not_nil="true")
    102: optional string debug_trace_key

    255: optional base.Base Base
}

struct DebugStreamingResponse {
    1: optional prompt.Message delta
    2: optional string finish_reason
    3: optional prompt.TokenUsage usage
    4: optional i64 debug_id (api.js_conv='true', go.tag='json:"debug_id"')
    5: optional string debug_trace_key

    255: optional base.BaseResp BaseResp
}

typedef string GeneratePromptType (ts.enum="true")
const GeneratePromptType GeneratePromptTypeOneStepOptimize = "one_step_optimize"
const GeneratePromptType GeneratePromptTypeFeedbackOptimize = "feedback_optimize"

struct GeneratePromptRequest {
    1: optional GeneratePromptType generate_prompt_type (vt.not_nil='true', vt.min_size='1')
    2: optional i64 space_id (api.js_conv='true', vt.not_nil='true', vt.gt='0', go.tag='json:"space_id"')
    3: optional i64 prompt_id (api.js_conv='true', vt.not_nil='true', vt.gt='0', go.tag='json:"prompt_id"')
    4: optional string prompt_key
    5: optional string prompt_name
    6: optional string prompt_desc
    7: optional prompt.Message original_prompt_message (vt.not_nil='true')
    8: optional bool is_retry
    9: optional prompt.Message user_message
    10: optional prompt.Message assistant_message
    11: optional list<prompt.VariableVal> variable_vals
    12: optional string feedback

    255: optional base.Base Base
}

struct GeneratePromptResponse {
    1: optional prompt.Message delta
    2: optional prompt.TokenUsage usage
    3: optional i64 record_id (api.js_conv='true', go.tag='json:"record_id"')

    255: optional base.BaseResp BaseResp
}

struct UpdateGenerateRecordRequest {
    1: optional i64 record_id (api.path='record_id', api.js_conv='true', vt.not_nil='true', vt.gt='0', go.tag='json:"record_id"')
    2: optional i64 space_id (api.js_conv='true', vt.not_nil='true', vt.gt='0', go.tag='json:"space_id"')
    3: optional i64 prompt_id (api.js_conv='true', vt.not_nil='true', vt.gt='0', go.tag='json:"prompt_id"')
    4: optional bool is_liked
    5: optional bool is_disliked
    6: optional bool is_accepted
    7: optional bool is_canceled

    255: optional base.Base Base
}

struct UpdateGenerateRecordResponse {
    255: optional base.BaseResp BaseResp
}

struct SaveDebugContextRequest {
    1: optional i64 prompt_id (api.path='prompt_id', api.js_conv='true', vt.not_nil='true', vt.gt='0', go.tag='json:"prompt_id"')
    2: optional i64 workspace_id (api.js_conv='true', vt.not_nil='true', vt.gt='0', go.tag='json:"workspace_id"')
    3: optional prompt.DebugContext debug_context (vt.not_nil="true")

    255: optional base.Base Base
}

struct SaveDebugContextResponse {
    255: optional base.BaseResp BaseResp
}

struct GetDebugContextRequest {
    1: optional i64 prompt_id (api.path='prompt_id', api.js_conv='true', vt.not_nil='true', vt.gt='0', go.tag='json:"prompt_id"')
    2: optional i64 workspace_id (api.query='workspace_id', api.js_conv='true', vt.not_nil='true', vt.gt='0', go.tag='json:"workspace_id"')

    255: optional base.Base Base
}

struct GetDebugContextResponse {
    1: optional prompt.DebugContext debug_context

    255: optional base.BaseResp BaseResp
}

struct ListDebugHistoryRequest {
    1: optional i64 prompt_id (api.path='prompt_id', api.js_conv='true', vt.not_nil='true', vt.gt='0', go.tag='json:"prompt_id"')
    2: optional i64 workspace_id (api.query='workspace_id', api.js_conv='true', vt.not_nil='true', vt.gt='0', go.tag='json:"workspace_id"')
    3: optional i32 days_limit (api.query='days_limit', vt.not_nil='true', vt.gt='0')
    4: optional i32 page_size (api.query='page_size', vt.not_nil='true', vt.gt='0')
    5: optional string page_token (api.query='page_token')

    255: optional base.Base Base
}

struct ListDebugHistoryResponse {
    1: optional list<prompt.DebugLog> debug_history
    2: optional bool has_more
    3: optional string next_page_token

    255: optional base.BaseResp BaseResp
}
