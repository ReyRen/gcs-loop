// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"
	stdjson "encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/bytedance/gg/gptr"
	"gorm.io/gorm"

	"github.com/coze-dev/coze-loop/backend/infra/db"
	"github.com/coze-dev/coze-loop/backend/infra/idgen"
	"github.com/coze-dev/coze-loop/backend/infra/middleware/session"
	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/evaluation/expt"
	promptdto "github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/prompt/domain/prompt"
	evaluatorconvertor "github.com/coze-dev/coze-loop/backend/modules/evaluation/application/convertor/evaluator"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/component/rpc"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/entity"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/service"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/pkg/errno"
	"github.com/coze-dev/coze-loop/backend/pkg/errorx"
	"github.com/coze-dev/coze-loop/backend/pkg/lang/goroutine"
	"github.com/coze-dev/coze-loop/backend/pkg/logs"
)

const (
	promptOptimizationMaxSamples = 20
	promptOptimizationWorkers    = 2
	optimizerEvaluatorID         = "evaluation_prompt_optimizer"
)

type promptOptimizationRequestSnapshot struct {
	Samples              []promptOptimizationSampleRefSnapshot `json:"samples"`
	VariableMappings     map[string]string                     `json:"variable_mappings"`
	ModelAnswerField     string                                `json:"model_answer_field"`
	ReferenceAnswerField string                                `json:"reference_answer_field"`
	Mode                 string                                `json:"mode"`
	RequestedName        string                                `json:"requested_name,omitempty"`
	MaxIterations        int32                                 `json:"max_iterations"`
}

type promptOptimizationSampleRefSnapshot struct {
	ItemID int64 `json:"item_id"`
	TurnID int64 `json:"turn_id,omitempty"`
}

type promptOptimizationExecutor struct {
	store            *promptOptimizationStore
	idgen            idgen.IIDGenerator
	manager          service.IExptManager
	resultSvc        service.ExptResultService
	evaluatorService service.EvaluatorService
	llm              rpc.ILLMProvider
	prompt           rpc.IPromptRPCAdapter
	sem              chan struct{}
	mu               sync.Mutex
	running          map[int64]context.CancelFunc
}

func newPromptOptimizationExecutor(provider db.Provider, idgen idgen.IIDGenerator, manager service.IExptManager,
	resultSvc service.ExptResultService, evaluatorService service.EvaluatorService, llm rpc.ILLMProvider,
	prompt rpc.IPromptRPCAdapter,
) *promptOptimizationExecutor {
	return &promptOptimizationExecutor{
		store: newPromptOptimizationStore(provider), idgen: idgen, manager: manager, resultSvc: resultSvc,
		evaluatorService: evaluatorService, llm: llm, prompt: prompt,
		sem: make(chan struct{}, promptOptimizationWorkers), running: make(map[int64]context.CancelFunc),
	}
}

// attachPromptOptimization is a Wire decorator. Keeping the original
// NewExperimentApplication constructor unchanged avoids disrupting the large
// existing application test surface.
func attachPromptOptimization(ctx context.Context, app *experimentApplication, provider db.Provider,
	llm rpc.ILLMProvider, prompt rpc.IPromptRPCAdapter,
) *experimentApplication {
	app.promptOptimization = newPromptOptimizationExecutor(provider, app.idgen, app.manager, app.resultSvc, app.evaluatorService, llm, prompt)
	app.promptOptimization.recover(ctx)
	return app
}

func (p *promptOptimizationExecutor) recover(ctx context.Context) {
	ids, err := p.store.markRunningForRecovery(ctx)
	if err != nil {
		logs.CtxError(ctx, "recover prompt optimization tasks failed: %v", err)
		return
	}
	for _, taskID := range ids {
		p.enqueue(taskID)
	}
}

func (p *promptOptimizationExecutor) enqueue(taskID int64) {
	p.mu.Lock()
	if _, ok := p.running[taskID]; ok {
		p.mu.Unlock()
		return
	}
	taskCtx, cancel := context.WithCancel(context.Background())
	p.running[taskID] = cancel
	p.mu.Unlock()
	goroutine.Go(taskCtx, func() {
		select {
		case p.sem <- struct{}{}:
		case <-taskCtx.Done():
			p.mu.Lock()
			delete(p.running, taskID)
			p.mu.Unlock()
			return
		}
		defer func() {
			<-p.sem
			cancel()
			p.mu.Lock()
			delete(p.running, taskID)
			p.mu.Unlock()
		}()
		p.run(taskCtx, taskID)
	})
}

func (p *promptOptimizationExecutor) cancelRunning(taskID int64) {
	p.mu.Lock()
	cancel := p.running[taskID]
	p.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (e *experimentApplication) PreparePromptOptimization(ctx context.Context, req *expt.PreparePromptOptimizationRequest) (*expt.PreparePromptOptimizationResponse, error) {
	if e.promptOptimization == nil {
		return nil, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("prompt optimization service is not initialized"))
	}
	return e.promptOptimization.prepare(ctx, req)
}

func (e *experimentApplication) CreatePromptOptimization(ctx context.Context, req *expt.CreatePromptOptimizationRequest) (*expt.CreatePromptOptimizationResponse, error) {
	if e.promptOptimization == nil {
		return nil, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("prompt optimization service is not initialized"))
	}
	return e.promptOptimization.create(ctx, req)
}

func (e *experimentApplication) GetPromptOptimization(ctx context.Context, req *expt.GetPromptOptimizationRequest) (*expt.GetPromptOptimizationResponse, error) {
	if e.promptOptimization == nil {
		return nil, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("prompt optimization service is not initialized"))
	}
	return e.promptOptimization.get(ctx, req)
}

func (e *experimentApplication) ListPromptOptimizations(ctx context.Context, req *expt.ListPromptOptimizationsRequest) (*expt.ListPromptOptimizationsResponse, error) {
	if e.promptOptimization == nil {
		return nil, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("prompt optimization service is not initialized"))
	}
	return e.promptOptimization.list(ctx, req)
}

func (e *experimentApplication) CancelPromptOptimization(ctx context.Context, req *expt.CancelPromptOptimizationRequest) (*expt.CancelPromptOptimizationResponse, error) {
	if e.promptOptimization == nil {
		return nil, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("prompt optimization service is not initialized"))
	}
	return e.promptOptimization.cancel(ctx, req)
}

func (e *experimentApplication) ApplyPromptOptimizationToDraft(ctx context.Context, req *expt.ApplyPromptOptimizationToDraftRequest) (*expt.ApplyPromptOptimizationToDraftResponse, error) {
	if e.promptOptimization == nil {
		return nil, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("prompt optimization service is not initialized"))
	}
	return e.promptOptimization.apply(ctx, req)
}

func (p *promptOptimizationExecutor) prepare(ctx context.Context, req *expt.PreparePromptOptimizationRequest) (*expt.PreparePromptOptimizationResponse, error) {
	experiment, source, promptDO, err := p.loadSource(ctx, req.GetWorkspaceID(), req.GetExptID(), entity.NewSession(ctx))
	if err != nil {
		return nil, err
	}
	result, err := p.resultSvc.MGetExperimentResult(ctx, &entity.MGetExperimentResultParam{
		SpaceID: req.GetWorkspaceID(), ExptIDs: []int64{req.GetExptID()}, Page: entity.NewPage(0, 1),
	})
	if err != nil {
		return nil, err
	}
	datasetFields := make([]string, 0, len(result.ColumnEvalSetFields))
	for _, field := range result.ColumnEvalSetFields {
		if field != nil && strings.TrimSpace(gptr.Indirect(field.Key)) != "" {
			datasetFields = append(datasetFields, gptr.Indirect(field.Key))
		}
	}
	targetFields := make([]string, 0)
	for _, columns := range result.ExptColumnsEvalTarget {
		if columns == nil || columns.ExptID != req.GetExptID() {
			continue
		}
		for _, column := range columns.Columns {
			if column == nil {
				continue
			}
			name := strings.TrimSpace(column.Name)
			if name == "" {
				name = strings.TrimSpace(column.DisplayName)
			}
			if name != "" {
				targetFields = append(targetFields, name)
			}
		}
	}
	vars := make([]*expt.PromptOptimizationVariable, 0)
	suggested := make(map[string]string)
	if promptDO.PromptCommit != nil && promptDO.PromptCommit.Detail != nil && promptDO.PromptCommit.Detail.PromptTemplate != nil {
		for _, variable := range promptDO.PromptCommit.Detail.PromptTemplate.VariableDefs {
			if variable == nil || strings.TrimSpace(gptr.Indirect(variable.Key)) == "" {
				continue
			}
			key := gptr.Indirect(variable.Key)
			vars = append(vars, &expt.PromptOptimizationVariable{Key: key, Type: variable.Type, TypeTags: append([]string(nil), variable.TypeTags...), Description: variable.Desc})
			if containsString(datasetFields, key) {
				suggested[key] = key
			} else if len(datasetFields) == 1 {
				suggested[key] = datasetFields[0]
			}
		}
	}
	modelField := chooseField(targetFields, []string{"actual_output", "output", "answer"})
	referenceField := chooseField(datasetFields, []string{"reference_output", "reference_answer", "expected_output"})
	modeEffect, modeCost := expt.PromptOptimizationModeEffectFirst, expt.PromptOptimizationModeCostEffective
	return &expt.PreparePromptOptimizationResponse{
		Eligible: gptr.Of(true), ExperimentID: gptr.Of(experiment.ID), ExperimentName: gptr.Of(experiment.Name),
		PromptID: gptr.Of(source.PromptID), PromptKey: gptr.Of(source.PromptKey), PromptName: gptr.Of(source.Name),
		SourcePromptVersion: gptr.Of(source.Version), PromptVariables: vars, DatasetFields: datasetFields,
		TargetOutputFields: targetFields, Evaluators: evaluatorconvertor.ConvertEvaluatorDOList2DTO(experiment.Evaluators),
		SuggestedVariableMappings: suggested, SuggestedModelAnswerField: optionalString(modelField),
		SuggestedReferenceAnswerField: optionalString(referenceField), MaxSampleCount: gptr.Of(int32(promptOptimizationMaxSamples)),
		DefaultSampleCount: gptr.Of(int32(promptOptimizationMaxSamples)),
		ModeOptions: []*expt.PromptOptimizationModeOption{
			{Mode: modeEffect, DisplayName: "效果优先", Description: gptr.Of("使用更多迭代，优先提升评估器得分"), DefaultMaxIterations: gptr.Of(int32(8))},
			{Mode: modeCost, DisplayName: "性价比优先", Description: gptr.Of("使用更少迭代，在效果与模型消耗之间平衡"), DefaultMaxIterations: gptr.Of(int32(3))},
		},
	}, nil
}

func (p *promptOptimizationExecutor) create(ctx context.Context, req *expt.CreatePromptOptimizationRequest) (*expt.CreatePromptOptimizationResponse, error) {
	userID := session.UserIDInCtxOrEmpty(ctx)
	if userID == "" {
		return nil, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("user session is required"))
	}
	if len(req.GetSamples()) == 0 || len(req.GetSamples()) > promptOptimizationMaxSamples {
		return nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("samples must contain 1 to 20 experiment rows"))
	}
	experiment, source, promptDO, err := p.loadSource(ctx, req.GetWorkspaceID(), req.GetExptID(), entity.NewSession(ctx))
	if err != nil {
		return nil, err
	}
	_ = experiment
	if len(req.GetVariableMappings()) == 0 && promptDO.PromptCommit != nil && promptDO.PromptCommit.Detail != nil &&
		promptDO.PromptCommit.Detail.PromptTemplate != nil && len(promptDO.PromptCommit.Detail.PromptTemplate.VariableDefs) > 0 {
		return nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("variable_mappings is required for a Prompt with variables"))
	}
	if err := validateOptimizationVariableMappings(promptDO.PromptCommit.Detail.PromptTemplate, req.GetVariableMappings()); err != nil {
		return nil, err
	}
	mode := req.GetMode()
	if mode == "" {
		mode = expt.PromptOptimizationModeEffectFirst
	}
	if mode != expt.PromptOptimizationModeEffectFirst && mode != expt.PromptOptimizationModeCostEffective {
		return nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("unsupported optimization mode"))
	}
	maxIterations := req.GetMaxIterations()
	if maxIterations == 0 {
		if mode == expt.PromptOptimizationModeCostEffective {
			maxIterations = 3
		} else {
			maxIterations = 8
		}
	}
	seen := make(map[string]struct{}, len(req.GetSamples()))
	snapshot := promptOptimizationRequestSnapshot{
		VariableMappings: copyStringMap(req.GetVariableMappings()), ModelAnswerField: strings.TrimSpace(req.GetModelAnswerField()),
		ReferenceAnswerField: strings.TrimSpace(req.GetReferenceAnswerField()), Mode: string(mode),
		RequestedName: strings.TrimSpace(req.GetName()), MaxIterations: maxIterations,
	}
	for _, sample := range req.GetSamples() {
		if sample == nil || sample.GetItemID() <= 0 {
			return nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("sample item_id must be positive"))
		}
		key := fmt.Sprintf("%d:%d", sample.GetItemID(), sample.GetTurnID())
		if _, ok := seen[key]; ok {
			return nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("duplicate optimization sample"))
		}
		seen[key] = struct{}{}
		snapshot.Samples = append(snapshot.Samples, promptOptimizationSampleRefSnapshot{ItemID: sample.GetItemID(), TurnID: sample.GetTurnID()})
	}
	requestData, _ := stdjson.Marshal(snapshot)
	idempotencyKey := strings.TrimSpace(req.GetIdempotencyKey())
	if idempotencyKey != "" {
		existing, getErr := p.store.getTaskByIdempotency(ctx, req.GetWorkspaceID(), userID, idempotencyKey)
		if getErr == nil {
			if string(existing.RequestData) != string(requestData) || existing.ExperimentID != req.GetExptID() {
				return nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("idempotency_key was reused with a different optimization request"))
			}
			return &expt.CreatePromptOptimizationResponse{Task: p.taskPOToDTO(ctx, existing, false, false)}, nil
		}
		if !isPromptOptimizationNotFound(getErr) {
			return nil, getErr
		}
	}
	taskID, err := p.idgen.GenID(ctx)
	if err != nil {
		return nil, err
	}
	name := snapshot.RequestedName
	if name == "" {
		name = fmt.Sprintf("%s%s_优化%s", source.Name, source.Version, time.Now().Format("20060102_1504"))
	}
	originalDTO := promptTemplateRPCToDTO(promptDO.PromptCommit.Detail.PromptTemplate)
	originalData, _ := stdjson.Marshal(originalDTO)
	var idem *string
	if idempotencyKey != "" {
		idem = gptr.Of(idempotencyKey)
	}
	row := &promptOptimizationTaskPO{
		ID: taskID, SpaceID: req.GetWorkspaceID(), ExperimentID: req.GetExptID(), PromptID: source.PromptID,
		PromptKey: source.PromptKey, SourcePromptVersion: source.Version, Name: name, Mode: string(mode),
		Status: string(expt.PromptOptimizationStatusQueued), Stage: string(expt.PromptOptimizationStagePreparing),
		RequestData: requestData, OriginalPromptTemplate: originalData, IdempotencyKey: idem, CreatedBy: userID,
	}
	if err := p.store.createTask(ctx, row); err != nil {
		if idempotencyKey != "" && (err == gorm.ErrDuplicatedKey || strings.Contains(strings.ToLower(err.Error()), "duplicate")) {
			existing, getErr := p.store.getTaskByIdempotency(ctx, req.GetWorkspaceID(), userID, idempotencyKey)
			if getErr == nil {
				if string(existing.RequestData) != string(requestData) || existing.ExperimentID != req.GetExptID() {
					return nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("idempotency_key was reused with a different optimization request"))
				}
				return &expt.CreatePromptOptimizationResponse{Task: p.taskPOToDTO(ctx, existing, false, false)}, nil
			}
		}
		return nil, err
	}
	p.enqueue(taskID)
	return &expt.CreatePromptOptimizationResponse{Task: p.taskPOToDTO(ctx, row, false, false)}, nil
}

func (p *promptOptimizationExecutor) get(ctx context.Context, req *expt.GetPromptOptimizationRequest) (*expt.GetPromptOptimizationResponse, error) {
	if _, _, _, err := p.loadSource(ctx, req.GetWorkspaceID(), req.GetExptID(), entity.NewSession(ctx)); err != nil {
		return nil, err
	}
	row, err := p.store.getTask(ctx, req.GetWorkspaceID(), req.GetExptID(), req.GetOptimizationID())
	if err != nil {
		return nil, promptOptimizationStoreError(err)
	}
	return &expt.GetPromptOptimizationResponse{Task: p.taskPOToDTO(ctx, row, req.GetWithIterations(), req.GetWithSampleResults())}, nil
}

func (p *promptOptimizationExecutor) list(ctx context.Context, req *expt.ListPromptOptimizationsRequest) (*expt.ListPromptOptimizationsResponse, error) {
	if _, _, _, err := p.loadSource(ctx, req.GetWorkspaceID(), req.GetExptID(), entity.NewSession(ctx)); err != nil {
		return nil, err
	}
	page, size := req.GetPageNumber(), req.GetPageSize()
	if page <= 0 {
		page = 1
	}
	if size <= 0 {
		size = 20
	}
	statuses := make([]string, 0, len(req.GetStatuses()))
	for _, status := range req.GetStatuses() {
		statuses = append(statuses, string(status))
	}
	rows, total, err := p.store.listTasks(ctx, req.GetWorkspaceID(), req.GetExptID(), page, size, statuses)
	if err != nil {
		return nil, err
	}
	tasks := make([]*expt.PromptOptimizationTask, 0, len(rows))
	for _, row := range rows {
		tasks = append(tasks, p.taskPOToDTO(ctx, row, false, false))
	}
	return &expt.ListPromptOptimizationsResponse{Tasks: tasks, Total: gptr.Of(total)}, nil
}

func (p *promptOptimizationExecutor) cancel(ctx context.Context, req *expt.CancelPromptOptimizationRequest) (*expt.CancelPromptOptimizationResponse, error) {
	row, err := p.store.getTask(ctx, req.GetWorkspaceID(), req.GetExptID(), req.GetOptimizationID())
	if err != nil {
		return nil, promptOptimizationStoreError(err)
	}
	if row.CreatedBy != session.UserIDInCtxOrEmpty(ctx) {
		return nil, errorx.NewByCode(errno.CommonNoPermissionCode, errorx.WithExtraMsg("only the task creator can cancel this optimization"))
	}
	if row.Status == string(expt.PromptOptimizationStatusQueued) || row.Status == string(expt.PromptOptimizationStatusRunning) {
		canceled, cancelErr := p.store.tryCancelTask(ctx, row.ID)
		if cancelErr != nil {
			return nil, cancelErr
		}
		if canceled {
			p.cancelRunning(row.ID)
		}
		row, err = p.store.getTask(ctx, req.GetWorkspaceID(), req.GetExptID(), req.GetOptimizationID())
		if err != nil {
			return nil, err
		}
	}
	return &expt.CancelPromptOptimizationResponse{Task: p.taskPOToDTO(ctx, row, false, false)}, nil
}

func (p *promptOptimizationExecutor) apply(ctx context.Context, req *expt.ApplyPromptOptimizationToDraftRequest) (*expt.ApplyPromptOptimizationToDraftResponse, error) {
	row, err := p.store.getTask(ctx, req.GetWorkspaceID(), req.GetExptID(), req.GetOptimizationID())
	if err != nil {
		return nil, promptOptimizationStoreError(err)
	}
	if row.CreatedBy != session.UserIDInCtxOrEmpty(ctx) {
		return nil, errorx.NewByCode(errno.CommonNoPermissionCode, errorx.WithExtraMsg("only the task creator can apply this optimization"))
	}
	if row.Status != string(expt.PromptOptimizationStatusSucceeded) || len(row.OptimizedPromptTemplate) == 0 {
		return nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("only a succeeded optimization can be applied"))
	}
	var candidate promptdto.PromptTemplate
	if err := stdjson.Unmarshal(row.OptimizedPromptTemplate, &candidate); err != nil {
		return nil, err
	}
	if err := p.prompt.ApplyPromptTemplateToDraft(ctx, row.SpaceID, row.PromptID, row.SourcePromptVersion,
		promptTemplateDTOToRPC(&candidate), req.GetOverwriteExistingDraft()); err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	if err := p.store.updateTask(ctx, row.ID, map[string]any{"applied_at": now}); err != nil {
		return nil, err
	}
	return &expt.ApplyPromptOptimizationToDraftResponse{
		PromptID: gptr.Of(row.PromptID), SourcePromptVersion: gptr.Of(row.SourcePromptVersion),
		DraftBaseVersion: gptr.Of(row.SourcePromptVersion), NextAction: gptr.Of("open_prompt_editor_and_submit_new_version"),
	}, nil
}

func (p *promptOptimizationExecutor) loadSource(ctx context.Context, spaceID, exptID int64, userSession *entity.Session) (*entity.Experiment, *entity.LoopPrompt, *rpc.LoopPrompt, error) {
	experiment, err := p.manager.GetDetail(ctx, exptID, spaceID, userSession)
	if err != nil {
		return nil, nil, nil, err
	}
	if experiment == nil || experiment.Status != entity.ExptStatus_Success {
		return nil, nil, nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("the experiment must finish successfully before Prompt optimization"))
	}
	if experiment.TargetType != entity.EvalTargetTypeLoopPrompt || experiment.Target == nil || experiment.Target.EvalTargetVersion == nil || experiment.Target.EvalTargetVersion.Prompt == nil {
		return nil, nil, nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("the experiment target is not a committed Prompt"))
	}
	for _, evaluator := range experiment.Evaluators {
		if evaluator != nil && evaluator.IsAsync() {
			return nil, nil, nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("asynchronous agent evaluators are not supported by Prompt optimization"))
		}
	}
	source := experiment.Target.EvalTargetVersion.Prompt
	version := source.Version
	promptDO, err := p.prompt.GetPrompt(ctx, spaceID, source.PromptID, rpc.GetPromptParams{CommitVersion: &version})
	if err != nil {
		return nil, nil, nil, err
	}
	if promptDO == nil || promptDO.PromptCommit == nil || promptDO.PromptCommit.Detail == nil || promptDO.PromptCommit.Detail.PromptTemplate == nil {
		return nil, nil, nil, errorx.NewByCode(errno.ResourceNotFoundCode, errorx.WithExtraMsg("the source Prompt version is unavailable"))
	}
	if promptDO.PromptCommit.Detail.PromptTemplate.HasSnippet {
		return nil, nil, nil, errorx.NewByCode(errno.CommonInvalidParamCode,
			errorx.WithExtraMsg("Prompt optimization does not support snippet-based templates yet"))
	}
	return experiment, source, promptDO, nil
}

type optimizerSample struct {
	ItemID           int64
	TurnID           int64
	Variables        map[string]*entity.Content
	DisplayVariables map[string]string
	Reference        string
	OriginalAnswer   string
	EvaluatorRecords map[int64]*entity.EvaluatorRecord
}

func (p *promptOptimizationExecutor) run(ctx context.Context, taskID int64) {
	row, err := p.store.getTaskByID(ctx, taskID)
	if err != nil {
		logs.CtxError(ctx, "load prompt optimization task %d failed: %v", taskID, err)
		return
	}
	ctx = session.WithCtxUser(ctx, &session.User{ID: row.CreatedBy})
	started, err := p.store.tryStartTask(ctx, taskID)
	if err != nil || !started {
		return
	}
	if err := p.runStartedTask(ctx, row); err != nil {
		msg := errorx.ErrorWithoutStack(err)
		if len(msg) > 2000 {
			msg = msg[:2000]
		}
		updated, updateErr := p.store.updateTaskIfStatus(ctx, taskID, string(expt.PromptOptimizationStatusRunning), map[string]any{
			"status": string(expt.PromptOptimizationStatusFailed), "error_message": msg, "ended_at": time.Now().UnixMilli(),
		})
		if updateErr != nil {
			logs.CtxError(ctx, "mark prompt optimization task %d failed: %v", taskID, updateErr)
		}
		if updated {
			logs.CtxError(ctx, "prompt optimization task %d failed: %v", taskID, err)
		}
	}
}

func (p *promptOptimizationExecutor) runStartedTask(ctx context.Context, row *promptOptimizationTaskPO) error {
	var request promptOptimizationRequestSnapshot
	if err := stdjson.Unmarshal(row.RequestData, &request); err != nil {
		return err
	}
	experiment, _, promptDO, err := p.loadSource(ctx, row.SpaceID, row.ExperimentID, &entity.Session{UserID: row.CreatedBy})
	if err != nil {
		return err
	}
	if promptDO.PromptCommit.Detail.ModelConfig == nil || promptDO.PromptCommit.Detail.ModelConfig.ModelID <= 0 {
		return errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("the source Prompt has no usable model configuration"))
	}
	_ = p.store.updateTask(ctx, row.ID, map[string]any{"stage": string(expt.PromptOptimizationStageAnalyzing), "progress": 5})
	samples, err := p.loadSamples(ctx, row, request)
	if err != nil {
		return err
	}
	baselineMetrics, baselineResults := baselineOptimizationMetrics(samples)
	baselineData, _ := stdjson.Marshal(baselineMetrics)
	if err := p.store.updateTask(ctx, row.ID, map[string]any{"baseline_metrics": baselineData, "best_metrics": baselineData, "progress": 10}); err != nil {
		return err
	}
	original := promptDO.PromptCommit.Detail.PromptTemplate
	best := cloneRPCPromptTemplate(original)
	bestMetrics := baselineMetrics
	bestResults := baselineResults
	noImprovement := 0
	var totalInputTokens, totalOutputTokens int64
	for iteration := int32(1); iteration <= request.MaxIterations; iteration++ {
		if canceled, checkErr := p.isCanceled(ctx, row.ID); checkErr != nil || canceled {
			if checkErr != nil {
				return checkErr
			}
			return nil
		}
		progress := int32(10 + int(iteration-1)*80/int(request.MaxIterations))
		_ = p.store.updateTask(ctx, row.ID, map[string]any{"stage": string(expt.PromptOptimizationStageOptimizing), "progress": progress})
		candidate, rationale, inTokens, outTokens, genErr := p.generateCandidate(ctx, row, promptDO, best, samples, bestResults, iteration)
		totalInputTokens += inTokens
		totalOutputTokens += outTokens
		if genErr != nil {
			return genErr
		}
		if canceled, checkErr := p.isCanceled(ctx, row.ID); checkErr != nil || canceled {
			if checkErr != nil {
				return checkErr
			}
			return nil
		}
		_ = p.store.updateTask(ctx, row.ID, map[string]any{"stage": string(expt.PromptOptimizationStageEvaluating)})
		metrics, results, evaluationInputTokens, evaluationOutputTokens := p.evaluateCandidate(ctx, row, request, experiment, candidate, samples)
		totalInputTokens += evaluationInputTokens
		totalOutputTokens += evaluationOutputTokens
		metrics.InputTokens = gptr.Of(totalInputTokens)
		metrics.OutputTokens = gptr.Of(totalOutputTokens)
		candidateDTO := promptTemplateRPCToDTO(candidate)
		candidateData, _ := stdjson.Marshal(candidateDTO)
		metricsData, _ := stdjson.Marshal(metrics)
		resultsData, _ := stdjson.Marshal(results)
		iterationID, idErr := p.idgen.GenID(ctx)
		if idErr != nil {
			return idErr
		}
		if err := p.store.createIteration(ctx, &promptOptimizationIterationPO{
			ID: iterationID, TaskID: row.ID, IterationNo: iteration, CandidateTemplate: candidateData,
			Rationale: rationale, Metrics: metricsData, SampleResults: resultsData,
			InputTokens: inTokens + evaluationInputTokens, OutputTokens: outTokens + evaluationOutputTokens,
		}); err != nil {
			return err
		}
		if betterOptimizationMetrics(metrics, bestMetrics) {
			best, bestMetrics, bestResults = candidate, metrics, results
			bestData, _ := stdjson.Marshal(promptTemplateRPCToDTO(best))
			bestMetricsData, _ := stdjson.Marshal(bestMetrics)
			if err := p.store.updateTask(ctx, row.ID, map[string]any{"optimized_prompt_template": bestData, "best_metrics": bestMetricsData}); err != nil {
				return err
			}
			noImprovement = 0
		} else {
			noImprovement++
		}
		if gptr.Indirect(bestMetrics.AverageScore) >= 0.999 || noImprovement >= 3 {
			break
		}
	}
	_ = p.store.updateTask(ctx, row.ID, map[string]any{"stage": string(expt.PromptOptimizationStageFinalizing), "progress": 95})
	bestData, _ := stdjson.Marshal(promptTemplateRPCToDTO(best))
	bestMetrics.InputTokens = gptr.Of(totalInputTokens)
	bestMetrics.OutputTokens = gptr.Of(totalOutputTokens)
	bestMetricsData, _ := stdjson.Marshal(bestMetrics)
	now := time.Now().UnixMilli()
	_, err = p.store.updateTaskIfStatus(ctx, row.ID, string(expt.PromptOptimizationStatusRunning), map[string]any{
		"status": string(expt.PromptOptimizationStatusSucceeded), "stage": string(expt.PromptOptimizationStageCompleted),
		"progress": 100, "optimized_prompt_template": bestData, "best_metrics": bestMetricsData, "ended_at": now,
	})
	return err
}

func (p *promptOptimizationExecutor) loadSamples(ctx context.Context, row *promptOptimizationTaskPO, request promptOptimizationRequestSnapshot) ([]optimizerSample, error) {
	itemIDs := make([]int64, 0, len(request.Samples))
	selected := make(map[string]struct{}, len(request.Samples))
	for _, sample := range request.Samples {
		itemIDs = append(itemIDs, sample.ItemID)
		selected[fmt.Sprintf("%d:%d", sample.ItemID, sample.TurnID)] = struct{}{}
	}
	loadFull := true
	report, err := p.resultSvc.MGetExperimentResult(ctx, &entity.MGetExperimentResultParam{
		SpaceID: row.SpaceID, ExptIDs: []int64{row.ExperimentID}, ItemIDs: itemIDs,
		Page: entity.NewPage(0, promptOptimizationMaxSamples), ExportFullContent: true,
		LoadEvaluatorFullContent: &loadFull, LoadEvalTargetFullContent: &loadFull,
	})
	if err != nil {
		return nil, err
	}
	result := make([]optimizerSample, 0, len(request.Samples))
	for _, item := range report.ItemResults {
		if item == nil {
			continue
		}
		for _, turn := range item.TurnResults {
			if turn == nil {
				continue
			}
			if _, exact := selected[fmt.Sprintf("%d:%d", item.ItemID, turn.TurnID)]; !exact {
				if _, itemOnly := selected[fmt.Sprintf("%d:0", item.ItemID)]; !itemOnly {
					continue
				}
			}
			for _, experimentResult := range turn.ExperimentResults {
				if experimentResult == nil || experimentResult.ExperimentID != row.ExperimentID || experimentResult.Payload == nil {
					continue
				}
				payload := experimentResult.Payload
				sample := optimizerSample{ItemID: item.ItemID, TurnID: turn.TurnID, Variables: map[string]*entity.Content{}, DisplayVariables: map[string]string{}, EvaluatorRecords: map[int64]*entity.EvaluatorRecord{}}
				if payload.EvalSet != nil && payload.EvalSet.Turn != nil {
					for _, field := range payload.EvalSet.Turn.FieldDataList {
						if field == nil {
							continue
						}
						sample.Variables[field.Key] = field.Content
						sample.DisplayVariables[field.Key] = contentToDisplayString(field.Content)
					}
				}
				if request.ReferenceAnswerField != "" {
					sample.Reference = contentToDisplayString(sample.Variables[request.ReferenceAnswerField])
				}
				if payload.TargetOutput != nil && payload.TargetOutput.EvalTargetRecord != nil && payload.TargetOutput.EvalTargetRecord.EvalTargetOutputData != nil {
					outputs := payload.TargetOutput.EvalTargetRecord.EvalTargetOutputData.OutputFields
					if request.ModelAnswerField != "" {
						sample.OriginalAnswer = contentToDisplayString(outputs[request.ModelAnswerField])
					}
					if sample.OriginalAnswer == "" {
						for _, content := range outputs {
							sample.OriginalAnswer = contentToDisplayString(content)
							if sample.OriginalAnswer != "" {
								break
							}
						}
					}
				}
				if payload.EvaluatorOutput != nil {
					for evaluatorVersionID, record := range payload.EvaluatorOutput.EvaluatorRecords {
						sample.EvaluatorRecords[evaluatorVersionID] = record
					}
				}
				result = append(result, sample)
			}
		}
	}
	if len(result) != len(request.Samples) {
		return nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg(fmt.Sprintf("only %d of %d selected experiment rows are available", len(result), len(request.Samples))))
	}
	return result, nil
}

func (p *promptOptimizationExecutor) generateCandidate(ctx context.Context, row *promptOptimizationTaskPO, promptDO *rpc.LoopPrompt,
	best *rpc.PromptTemplate, samples []optimizerSample, previousResults []*expt.PromptOptimizationSampleEvaluation, iteration int32,
) (*rpc.PromptTemplate, string, int64, int64, error) {
	type sampleForOptimizer struct {
		Variables       map[string]string  `json:"variables"`
		Reference       string             `json:"reference_answer,omitempty"`
		OriginalAnswer  string             `json:"original_answer"`
		CurrentAnswer   string             `json:"current_answer,omitempty"`
		EvaluatorScores map[string]float64 `json:"evaluator_scores"`
		Reasons         map[string]string  `json:"evaluator_reasons"`
	}
	data := make([]sampleForOptimizer, 0, len(samples))
	for i, sample := range samples {
		entry := sampleForOptimizer{Variables: sample.DisplayVariables, Reference: sample.Reference, OriginalAnswer: sample.OriginalAnswer, EvaluatorScores: map[string]float64{}, Reasons: map[string]string{}}
		for evaluatorVersionID, record := range sample.EvaluatorRecords {
			if record == nil {
				continue
			}
			key := strconv.FormatInt(evaluatorVersionID, 10)
			if score := record.GetScore(); score != nil {
				entry.EvaluatorScores[key] = *score
			}
			entry.Reasons[key] = record.GetReasoning()
		}
		if i < len(previousResults) && previousResults[i] != nil {
			entry.CurrentAnswer = gptr.Indirect(previousResults[i].OptimizedAnswer)
			if previousResults[i].OptimizedEvaluatorScores != nil {
				entry.EvaluatorScores = previousResults[i].OptimizedEvaluatorScores
			}
			if previousResults[i].OptimizedEvaluatorReasons != nil {
				entry.Reasons = previousResults[i].OptimizedEvaluatorReasons
			}
		}
		data = append(data, entry)
	}
	payload, _ := stdjson.Marshal(map[string]any{
		"iteration": iteration, "mode": row.Mode, "current_prompt": best.Messages, "variable_definitions": best.VariableDefs,
		"experiment_samples": data,
	})
	systemText := "你是 Prompt 优化专家。请根据评测实验样本、模型回答、参考答案、评估器得分和原因，改写 Prompt 以提升真实评测得分。必须保留所有原变量占位符及语义，不得针对单条样本泄露答案，不得新增不存在的业务事实。只输出严格 JSON：{\"messages\":[{\"role\":\"system|user|assistant\",\"content\":\"...\"}],\"rationale\":\"...\"}。"
	model := promptDO.PromptCommit.Detail.ModelConfig
	maxTokens := model.MaxTokens
	if maxTokens <= 0 || maxTokens > 8192 {
		maxTokens = 4096
	}
	temperature := 0.2
	topP := 0.9
	reply, err := p.llm.Call(ctx, &entity.LLMCallParam{
		SpaceID: row.SpaceID, EvaluatorID: optimizerEvaluatorID, UserID: gptr.Of(row.CreatedBy), Scenario: entity.ScenarioEvaluator,
		Messages: []*entity.Message{
			{Role: entity.RoleSystem, Content: textContent(systemText)},
			{Role: entity.RoleUser, Content: textContent(string(payload))},
		},
		ModelConfig: &entity.ModelConfig{ModelID: gptr.Of(model.ModelID), MaxTokens: gptr.Of(maxTokens), Temperature: &temperature, TopP: &topP},
	})
	if err != nil {
		return nil, "", 0, 0, err
	}
	if reply == nil || strings.TrimSpace(gptr.Indirect(reply.Content)) == "" {
		return nil, "", 0, 0, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("optimizer model returned an empty result"))
	}
	var decoded struct {
		Messages  []struct{ Role, Content string } `json:"messages"`
		Rationale string                           `json:"rationale"`
	}
	raw := strings.TrimSpace(gptr.Indirect(reply.Content))
	if strings.HasPrefix(raw, "```") {
		raw = strings.TrimPrefix(raw, "```json")
		raw = strings.TrimPrefix(raw, "```")
		raw = strings.TrimSuffix(strings.TrimSpace(raw), "```")
	}
	if err := stdjson.Unmarshal([]byte(raw), &decoded); err != nil {
		return nil, "", 0, 0, errorx.Wrapf(err, "parse optimizer model JSON")
	}
	if len(decoded.Messages) == 0 {
		return nil, "", 0, 0, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("optimizer model did not produce Prompt messages"))
	}
	candidate := cloneRPCPromptTemplate(best)
	candidate.Messages = make([]*rpc.PromptMessage, 0, len(decoded.Messages))
	for _, message := range decoded.Messages {
		role := strings.ToLower(strings.TrimSpace(message.Role))
		if role != "system" && role != "user" && role != "assistant" {
			return nil, "", 0, 0, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("optimizer model produced an unsupported message role"))
		}
		if strings.TrimSpace(message.Content) == "" {
			continue
		}
		candidate.Messages = append(candidate.Messages, &rpc.PromptMessage{Role: role, Content: message.Content})
	}
	if len(candidate.Messages) == 0 {
		return nil, "", 0, 0, errorx.NewByCode(errno.CommonInternalErrorCode,
			errorx.WithExtraMsg("optimizer model produced only empty Prompt messages"))
	}
	for _, variable := range best.VariableDefs {
		if variable == nil || variable.Key == nil {
			continue
		}
		if promptTemplateReferencesVariable(best, *variable.Key) && !promptTemplateReferencesVariable(candidate, *variable.Key) {
			return nil, "", 0, 0, errorx.NewByCode(errno.CommonInternalErrorCode,
				errorx.WithExtraMsg("optimizer model removed required variable {{"+*variable.Key+"}}"))
		}
	}
	var inputTokens, outputTokens int64
	if reply.TokenUsage != nil {
		inputTokens, outputTokens = reply.TokenUsage.InputTokens, reply.TokenUsage.OutputTokens
	}
	return candidate, decoded.Rationale, inputTokens, outputTokens, nil
}

func (p *promptOptimizationExecutor) evaluateCandidate(ctx context.Context, row *promptOptimizationTaskPO,
	request promptOptimizationRequestSnapshot, experiment *entity.Experiment, candidate *rpc.PromptTemplate, samples []optimizerSample,
) (*expt.PromptOptimizationMetrics, []*expt.PromptOptimizationSampleEvaluation, int64, int64) {
	evaluatorByVersion := make(map[int64]*entity.Evaluator)
	for _, evaluator := range experiment.Evaluators {
		if evaluator != nil {
			evaluatorByVersion[evaluator.GetEvaluatorVersionID()] = evaluator
		}
	}
	results := make([]*expt.PromptOptimizationSampleEvaluation, 0, len(samples))
	var inputTokens, outputTokens int64
	for _, sample := range samples {
		result := &expt.PromptOptimizationSampleEvaluation{
			ItemID: gptr.Of(sample.ItemID), TurnID: gptr.Of(sample.TurnID), Variables: copyStringMap(sample.DisplayVariables),
			ReferenceAnswer: optionalString(sample.Reference), OriginalAnswer: optionalString(sample.OriginalAnswer),
			OriginalEvaluatorScores: map[string]float64{}, OptimizedEvaluatorScores: map[string]float64{},
			OriginalEvaluatorReasons: map[string]string{}, OptimizedEvaluatorReasons: map[string]string{},
		}
		variables := make([]*entity.VariableVal, 0, len(request.VariableMappings))
		for promptKey, datasetKey := range request.VariableMappings {
			content := sample.Variables[datasetKey]
			key := promptKey
			value := contentToDisplayString(content)
			variable := &entity.VariableVal{Key: &key, Value: &value}
			if content != nil && content.GetContentType() != entity.ContentTypeText {
				variable.Content = content
			}
			variables = append(variables, variable)
		}
		sort.Slice(variables, func(i, j int) bool { return gptr.Indirect(variables[i].Key) < gptr.Indirect(variables[j].Key) })
		execResult, execErr := p.prompt.ExecutePrompt(ctx, row.SpaceID, &rpc.ExecutePromptParam{
			PromptID: row.PromptID, PromptVersion: row.SourcePromptVersion, Variables: variables, OverridePromptTemplate: candidate,
		})
		if execErr != nil || execResult == nil {
			message := "Prompt execution returned no result"
			if execErr != nil {
				message = errorx.ErrorWithoutStack(execErr)
			}
			result.ErrorMessage = &message
			results = append(results, result)
			continue
		}
		if execResult.TokenUsage != nil {
			inputTokens += execResult.TokenUsage.InputTokens
			outputTokens += execResult.TokenUsage.OutputTokens
		}
		answer := gptr.Indirect(execResult.Content)
		if answer == "" && execResult.MultiContent != nil {
			answer = contentToDisplayString(execResult.MultiContent)
		}
		result.OptimizedAnswer = &answer
		for evaluatorVersionID, originalRecord := range sample.EvaluatorRecords {
			key := strconv.FormatInt(evaluatorVersionID, 10)
			if originalRecord != nil {
				if score := originalRecord.GetScore(); score != nil {
					result.OriginalEvaluatorScores[key] = *score
				}
				result.OriginalEvaluatorReasons[key] = originalRecord.GetReasoning()
			}
			evaluator := evaluatorByVersion[evaluatorVersionID]
			if evaluator == nil || originalRecord == nil || originalRecord.EvaluatorInputData == nil {
				continue
			}
			input := cloneEvaluatorInput(originalRecord.EvaluatorInputData)
			if input.EvaluateTargetOutputFields == nil {
				input.EvaluateTargetOutputFields = make(map[string]*entity.Content)
			}
			field := request.ModelAnswerField
			if field == "" {
				field = "actual_output"
			}
			answerContent := textContent(answer)
			input.EvaluateTargetOutputFields[field] = answerContent
			if input.InputFields == nil {
				input.InputFields = make(map[string]*entity.Content)
			}
			input.InputFields[field] = answerContent
			output, evalErr := p.evaluatorService.DebugEvaluator(ctx, evaluator, input, nil, row.SpaceID)
			if evalErr != nil || output == nil || output.EvaluatorResult == nil {
				continue
			}
			if output.EvaluatorUsage != nil {
				inputTokens += output.EvaluatorUsage.InputTokens
				outputTokens += output.EvaluatorUsage.OutputTokens
			}
			score := output.EvaluatorResult.Score
			if output.EvaluatorResult.Correction != nil && output.EvaluatorResult.Correction.Score != nil {
				score = output.EvaluatorResult.Correction.Score
			}
			if score != nil {
				result.OptimizedEvaluatorScores[key] = *score
			}
			reason := output.EvaluatorResult.Reasoning
			if output.EvaluatorResult.Correction != nil {
				reason = output.EvaluatorResult.Correction.Explain
			}
			result.OptimizedEvaluatorReasons[key] = reason
		}
		originalScore, optimizedScore := averageMap(result.OriginalEvaluatorScores), averageMap(result.OptimizedEvaluatorScores)
		result.OriginalScore, result.OptimizedScore = &originalScore, &optimizedScore
		results = append(results, result)
	}
	return optimizationMetricsFromResults(results), results, inputTokens, outputTokens
}

func baselineOptimizationMetrics(samples []optimizerSample) (*expt.PromptOptimizationMetrics, []*expt.PromptOptimizationSampleEvaluation) {
	results := make([]*expt.PromptOptimizationSampleEvaluation, 0, len(samples))
	for _, sample := range samples {
		row := &expt.PromptOptimizationSampleEvaluation{
			ItemID: gptr.Of(sample.ItemID), TurnID: gptr.Of(sample.TurnID), Variables: copyStringMap(sample.DisplayVariables),
			ReferenceAnswer: optionalString(sample.Reference), OriginalAnswer: optionalString(sample.OriginalAnswer), OptimizedAnswer: optionalString(sample.OriginalAnswer),
			OriginalEvaluatorScores: map[string]float64{}, OptimizedEvaluatorScores: map[string]float64{},
			OriginalEvaluatorReasons: map[string]string{}, OptimizedEvaluatorReasons: map[string]string{},
		}
		for versionID, record := range sample.EvaluatorRecords {
			if record == nil {
				continue
			}
			key := strconv.FormatInt(versionID, 10)
			if score := record.GetScore(); score != nil {
				row.OriginalEvaluatorScores[key], row.OptimizedEvaluatorScores[key] = *score, *score
			}
			row.OriginalEvaluatorReasons[key], row.OptimizedEvaluatorReasons[key] = record.GetReasoning(), record.GetReasoning()
		}
		score := averageMap(row.OriginalEvaluatorScores)
		row.OriginalScore, row.OptimizedScore = &score, &score
		results = append(results, row)
	}
	return optimizationMetricsFromResults(results), results
}

func optimizationMetricsFromResults(results []*expt.PromptOptimizationSampleEvaluation) *expt.PromptOptimizationMetrics {
	metrics := &expt.PromptOptimizationMetrics{SampleCount: gptr.Of(int32(len(results))), EvaluatorAverageScores: map[string]float64{}}
	var sum float64
	var scored int
	evaluatorSums, evaluatorCounts := map[string]float64{}, map[string]int{}
	var full, improved, regressed, unchanged int32
	for _, result := range results {
		if result == nil || result.OptimizedScore == nil {
			continue
		}
		score := *result.OptimizedScore
		sum += score
		scored++
		if score >= 0.999 {
			full++
		}
		original := gptr.Indirect(result.OriginalScore)
		switch {
		case score > original+1e-9:
			improved++
		case score < original-1e-9:
			regressed++
		default:
			unchanged++
		}
		for key, value := range result.OptimizedEvaluatorScores {
			evaluatorSums[key] += value
			evaluatorCounts[key]++
		}
	}
	avg := 0.0
	if scored > 0 {
		avg = sum / float64(scored)
	}
	metrics.AverageScore, metrics.FullScoreCount = &avg, &full
	metrics.ImprovedCount, metrics.RegressedCount, metrics.UnchangedCount = &improved, &regressed, &unchanged
	for key, value := range evaluatorSums {
		metrics.EvaluatorAverageScores[key] = value / float64(evaluatorCounts[key])
	}
	return metrics
}

func betterOptimizationMetrics(candidate, current *expt.PromptOptimizationMetrics) bool {
	if candidate == nil {
		return false
	}
	if current == nil {
		return true
	}
	ca, cu := gptr.Indirect(candidate.AverageScore), gptr.Indirect(current.AverageScore)
	if ca > cu+1e-9 {
		return true
	}
	if math.Abs(ca-cu) <= 1e-9 {
		cf, uf := gptr.Indirect(candidate.FullScoreCount), gptr.Indirect(current.FullScoreCount)
		if cf != uf {
			return cf > uf
		}
		return gptr.Indirect(candidate.RegressedCount) < gptr.Indirect(current.RegressedCount)
	}
	return false
}

func (p *promptOptimizationExecutor) isCanceled(ctx context.Context, taskID int64) (bool, error) {
	row, err := p.store.getTaskByID(ctx, taskID)
	if err != nil {
		return false, err
	}
	return row.Status == string(expt.PromptOptimizationStatusCanceled), nil
}

func (p *promptOptimizationExecutor) taskPOToDTO(ctx context.Context, row *promptOptimizationTaskPO, withIterations, withSamples bool) *expt.PromptOptimizationTask {
	if row == nil {
		return nil
	}
	mode, status, stage := expt.PromptOptimizationMode(row.Mode), expt.PromptOptimizationStatus(row.Status), expt.PromptOptimizationStage(row.Stage)
	task := &expt.PromptOptimizationTask{
		ID: &row.ID, WorkspaceID: &row.SpaceID, ExperimentID: &row.ExperimentID, Name: &row.Name, PromptID: &row.PromptID,
		PromptKey: &row.PromptKey, SourcePromptVersion: &row.SourcePromptVersion, Mode: &mode, Status: &status, Stage: &stage,
		Progress: &row.Progress, ErrorMessage: optionalString(row.ErrorMessage), CreatedBy: &row.CreatedBy,
		CreatedAt: gptr.Of(row.CreatedAt.UnixMilli()), UpdatedAt: gptr.Of(row.UpdatedAt.UnixMilli()), StartedAt: optionalInt64(row.StartedAt),
		EndedAt: optionalInt64(row.EndedAt), AppliedToDraft: gptr.Of(row.AppliedAt > 0), AppliedAt: optionalInt64(row.AppliedAt),
	}
	_ = stdjson.Unmarshal(row.OriginalPromptTemplate, &task.OriginalPromptTemplate)
	_ = stdjson.Unmarshal(row.OptimizedPromptTemplate, &task.OptimizedPromptTemplate)
	_ = stdjson.Unmarshal(row.BaselineMetrics, &task.BaselineMetrics)
	_ = stdjson.Unmarshal(row.BestMetrics, &task.BestMetrics)
	if withIterations {
		iterations, err := p.store.listIterations(ctx, row.ID)
		if err == nil {
			for _, iteration := range iterations {
				item := &expt.PromptOptimizationIteration{Iteration: &iteration.IterationNo, Rationale: optionalString(iteration.Rationale), CreatedAt: gptr.Of(iteration.CreatedAt.UnixMilli())}
				_ = stdjson.Unmarshal(iteration.CandidateTemplate, &item.CandidatePromptTemplate)
				_ = stdjson.Unmarshal(iteration.Metrics, &item.Metrics)
				if withSamples {
					_ = stdjson.Unmarshal(iteration.SampleResults, &item.SampleResults)
				}
				task.Iterations = append(task.Iterations, item)
			}
		}
	}
	return task
}

func promptOptimizationStoreError(err error) error {
	if isPromptOptimizationNotFound(err) {
		return errorx.NewByCode(errno.ResourceNotFoundCode, errorx.WithExtraMsg("prompt optimization task not found"))
	}
	return err
}

func promptTemplateRPCToDTO(from *rpc.PromptTemplate) *promptdto.PromptTemplate {
	if from == nil {
		return nil
	}
	to := &promptdto.PromptTemplate{TemplateType: gptr.Of(promptdto.TemplateType(from.TemplateType)), HasSnippet: gptr.Of(from.HasSnippet)}
	for _, message := range from.Messages {
		if message == nil {
			continue
		}
		to.Messages = append(to.Messages, &promptdto.Message{Role: gptr.Of(promptdto.Role(message.Role)), Content: gptr.Of(message.Content), SkipRender: message.SkipRender})
	}
	for _, variable := range from.VariableDefs {
		if variable == nil {
			continue
		}
		to.VariableDefs = append(to.VariableDefs, &promptdto.VariableDef{Key: variable.Key, Desc: variable.Desc, Type: variable.Type, TypeTags: append([]string(nil), variable.TypeTags...)})
	}
	return to
}

func promptTemplateDTOToRPC(from *promptdto.PromptTemplate) *rpc.PromptTemplate {
	if from == nil {
		return nil
	}
	to := &rpc.PromptTemplate{TemplateType: string(from.GetTemplateType()), HasSnippet: from.GetHasSnippet()}
	for _, message := range from.GetMessages() {
		if message == nil {
			continue
		}
		to.Messages = append(to.Messages, &rpc.PromptMessage{Role: string(message.GetRole()), Content: message.GetContent(), SkipRender: message.SkipRender})
	}
	for _, variable := range from.GetVariableDefs() {
		if variable == nil {
			continue
		}
		to.VariableDefs = append(to.VariableDefs, &rpc.VariableDef{Key: variable.Key, Desc: variable.Desc, Type: variable.Type, TypeTags: append([]string(nil), variable.TypeTags...)})
	}
	return to
}

func cloneRPCPromptTemplate(from *rpc.PromptTemplate) *rpc.PromptTemplate {
	return promptTemplateDTOToRPC(promptTemplateRPCToDTO(from))
}

func promptTemplateReferencesVariable(template *rpc.PromptTemplate, key string) bool {
	if template == nil || strings.TrimSpace(key) == "" {
		return false
	}
	pattern := regexp.MustCompile(`\{\{\s*\.?\s*` + regexp.QuoteMeta(key) + `\s*\}\}`)
	for _, message := range template.Messages {
		if message != nil && pattern.MatchString(message.Content) {
			return true
		}
	}
	return false
}

func cloneEvaluatorInput(from *entity.EvaluatorInputData) *entity.EvaluatorInputData {
	if from == nil {
		return &entity.EvaluatorInputData{}
	}
	b, _ := stdjson.Marshal(from)
	var to entity.EvaluatorInputData
	_ = stdjson.Unmarshal(b, &to)
	return &to
}

func contentToDisplayString(content *entity.Content) string {
	if content == nil {
		return ""
	}
	if content.GetContentType() == entity.ContentTypeText {
		return content.GetText()
	}
	b, _ := stdjson.Marshal(content)
	return string(b)
}

func textContent(value string) *entity.Content {
	t := entity.ContentTypeText
	return &entity.Content{ContentType: &t, Text: &value}
}

func averageMap(values map[string]float64) float64 {
	if len(values) == 0 {
		return 0
	}
	var total float64
	for _, value := range values {
		total += value
	}
	return total / float64(len(values))
}

func copyStringMap(from map[string]string) map[string]string {
	if from == nil {
		return nil
	}
	to := make(map[string]string, len(from))
	for key, value := range from {
		to[key] = value
	}
	return to
}

func validateOptimizationVariableMappings(template *rpc.PromptTemplate, mappings map[string]string) error {
	defined := make(map[string]struct{})
	if template != nil {
		for _, variable := range template.VariableDefs {
			if variable == nil || variable.Key == nil || strings.TrimSpace(*variable.Key) == "" {
				continue
			}
			key := strings.TrimSpace(*variable.Key)
			defined[key] = struct{}{}
			if strings.TrimSpace(mappings[key]) == "" {
				return errorx.NewByCode(errno.CommonInvalidParamCode,
					errorx.WithExtraMsg("missing dataset field mapping for Prompt variable "+key))
			}
		}
	}
	for key, datasetField := range mappings {
		if _, ok := defined[strings.TrimSpace(key)]; !ok {
			return errorx.NewByCode(errno.CommonInvalidParamCode,
				errorx.WithExtraMsg("variable_mappings contains an unknown Prompt variable "+key))
		}
		if strings.TrimSpace(datasetField) == "" {
			return errorx.NewByCode(errno.CommonInvalidParamCode,
				errorx.WithExtraMsg("dataset field mapping cannot be empty for Prompt variable "+key))
		}
	}
	return nil
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func chooseField(fields, preferred []string) string {
	for _, want := range preferred {
		for _, field := range fields {
			if strings.EqualFold(field, want) {
				return field
			}
		}
	}
	if len(fields) > 0 {
		return fields[0]
	}
	return ""
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func optionalInt64(value int64) *int64 {
	if value == 0 {
		return nil
	}
	return &value
}
