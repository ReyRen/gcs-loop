// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0

package application

import (
	"context"
	stdjson "encoding/json"
	"fmt"
	"math"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/bytedance/gg/gptr"
	"golang.org/x/sync/errgroup"

	"github.com/coze-dev/coze-loop/backend/infra/db"
	"github.com/coze-dev/coze-loop/backend/infra/idgen"
	"github.com/coze-dev/coze-loop/backend/infra/middleware/session"
	"github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/evaluation/expt"
	promptdto "github.com/coze-dev/coze-loop/backend/kitex_gen/coze/loop/prompt/domain/prompt"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/component/rpc"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/entity"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/domain/service"
	"github.com/coze-dev/coze-loop/backend/modules/evaluation/pkg/errno"
	"github.com/coze-dev/coze-loop/backend/pkg/errorx"
	"github.com/coze-dev/coze-loop/backend/pkg/lang/goroutine"
	"github.com/coze-dev/coze-loop/backend/pkg/logs"
)

const (
	promptOptimizationMinSamples               = 20
	promptOptimizationMaxSamples               = 500
	promptOptimizationDefaultWorkers           = 2
	promptOptimizationMaxWorkers               = 32
	promptOptimizationWorkersEnv               = "COZE_LOOP_PROMPT_OPTIMIZATION_WORKERS"
	promptOptimizationSampleConcurrencyEnv     = "COZE_LOOP_PROMPT_OPTIMIZATION_SAMPLE_CONCURRENCY"
	promptOptimizationDefaultSampleConcurrency = 4
	optimizerEvaluatorID                       = "evaluation_prompt_optimizer"
	promptOptimizerModelIDEnv                  = "COZE_LOOP_PROMPT_OPTIMIZER_MODEL_ID"
	promptOptimizerMaxTokens                   = int32(16384)
)

type promptOptimizationRequestSnapshot struct {
	Samples              []promptOptimizationSampleRefSnapshot `json:"samples"`
	VariableMappings     map[string]string                     `json:"variable_mappings"`
	ModelAnswerField     string                                `json:"model_answer_field"`
	ReferenceAnswerField string                                `json:"reference_answer_field"`
	Mode                 string                                `json:"mode"`
	MaxIterations        int32                                 `json:"max_iterations"`
	EvalSetID            int64                                 `json:"eval_set_id"`
	EvalSetVersionID     int64                                 `json:"eval_set_version_id"`
	TargetMappings       []promptOptimizeFieldMappingSnapshot  `json:"eval_set_to_target"`
	ReferenceMapping     *promptOptimizeFieldMappingSnapshot   `json:"eval_set_to_reference,omitempty"`
	ActualOutputMapping  *promptOptimizeFieldMappingSnapshot   `json:"eval_set_to_actual_output,omitempty"`
	Engine               string                                `json:"engine"`
	OptimizeFactor       float64                               `json:"optimize_factor"`
	OptimizeTaskType     string                                `json:"optimize_task_type"`
	MinResourceUsage     int64                                 `json:"min_resource_usage"`
	MaxResourceUsage     int64                                 `json:"max_resource_usage"`
}

type promptOptimizeFieldMappingSnapshot struct {
	FromFieldName string `json:"from_field_name"`
	FieldName     string `json:"field_name"`
	ConstValue    string `json:"const_value,omitempty"`
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
	workerCount := promptOptimizationWorkerCount()
	logs.Info("prompt optimization worker count is %d, sample concurrency is %d", workerCount, promptOptimizationSampleConcurrency())
	return &promptOptimizationExecutor{
		store: newPromptOptimizationStore(provider), idgen: idgen, manager: manager, resultSvc: resultSvc,
		evaluatorService: evaluatorService, llm: llm, prompt: prompt,
		sem: make(chan struct{}, workerCount), running: make(map[int64]context.CancelFunc),
	}
}

func promptOptimizationWorkerCount() int {
	return promptOptimizationConcurrency(promptOptimizationWorkersEnv, promptOptimizationDefaultWorkers)
}

func promptOptimizationSampleConcurrency() int {
	return promptOptimizationConcurrency(promptOptimizationSampleConcurrencyEnv, promptOptimizationDefaultSampleConcurrency)
}

func promptOptimizationConcurrency(envName string, defaultValue int) int {
	configured := strings.TrimSpace(os.Getenv(envName))
	if configured == "" {
		return defaultValue
	}
	workerCount, err := strconv.Atoi(configured)
	if err != nil || workerCount < 1 || workerCount > promptOptimizationMaxWorkers {
		logs.Warn("%s must be an integer between 1 and %d, fallback to %d",
			envName, promptOptimizationMaxWorkers, defaultValue)
		return defaultValue
	}
	return workerCount
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

func (e *experimentApplication) EstimatePromptOptimizeTaskResourceUsage(ctx context.Context, req *expt.EstimatePromptOptimizeTaskRequest) (*expt.EstimatePromptOptimizeTaskResponse, error) {
	if e.promptOptimization == nil {
		return nil, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("prompt optimization service is not initialized"))
	}
	return e.promptOptimization.estimate(ctx, req)
}

func (e *experimentApplication) CreatePromptOptimizeTask(ctx context.Context, req *expt.CreatePromptOptimizeTaskRequest) (*expt.CreatePromptOptimizeTaskResponse, error) {
	if e.promptOptimization == nil {
		return nil, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("prompt optimization service is not initialized"))
	}
	return e.promptOptimization.create(ctx, req)
}

func (e *experimentApplication) GetPromptOptimizeTask(ctx context.Context, req *expt.GetPromptOptimizeTaskRequest) (*expt.GetPromptOptimizeTaskResponse, error) {
	if e.promptOptimization == nil {
		return nil, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("prompt optimization service is not initialized"))
	}
	return e.promptOptimization.get(ctx, req)
}

func (e *experimentApplication) TerminatePromptOptimizeTask(ctx context.Context, req *expt.TerminatePromptOptimizeTaskRequest) (*expt.TerminatePromptOptimizeTaskResponse, error) {
	if e.promptOptimization == nil {
		return nil, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("prompt optimization service is not initialized"))
	}
	return e.promptOptimization.terminate(ctx, req)
}

func (e *experimentApplication) ListPromptOptimizeTasks(ctx context.Context, req *expt.ListPromptOptimizeTasksRequest) (*expt.ListPromptOptimizeTasksResponse, error) {
	if e.promptOptimization == nil {
		return nil, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("prompt optimization service is not initialized"))
	}
	return e.promptOptimization.listByPrompt(ctx, req)
}

type promptOptimizeParams struct {
	WorkspaceID            int64
	PromptID               int64
	TargetType             string
	TargetVersion          string
	DatasetType            string
	RelatedEvalSetID       int64
	RelatedEvalSetVersion  int64
	RelatedExptID          int64
	SelectedItemIDs        []int64
	TargetMappings         []*expt.PromptOptimizeFieldMapping
	ReferenceMapping       *expt.PromptOptimizeFieldMapping
	ActualOutputMapping    *expt.PromptOptimizeFieldMapping
	Engine                 string
	OptimizeFactor         float64
	OptimizeFactorProvided bool
	OptimizeTaskType       string
}

func (p *promptOptimizationExecutor) estimate(ctx context.Context, req *expt.EstimatePromptOptimizeTaskRequest) (*expt.EstimatePromptOptimizeTaskResponse, error) {
	params := promptOptimizeParams{
		WorkspaceID: req.GetWorkspaceID(), PromptID: req.GetPromptID(), TargetType: req.GetTargetType(),
		TargetVersion: req.GetTargetVersion(), DatasetType: req.GetDatasetType(), RelatedEvalSetID: req.GetRelatedEvalSetID(),
		RelatedEvalSetVersion: req.GetRelatedEvalSetVersionID(), RelatedExptID: req.GetRelatedExptID(),
		SelectedItemIDs: req.GetSelectedItemIDList(), TargetMappings: req.GetEvalSetToTarget(),
		ReferenceMapping: req.GetEvalSetToReference(), ActualOutputMapping: req.GetEvalSetToActualOutput(),
		Engine: req.GetEngine(), OptimizeFactor: req.GetOptimizeFactor(), OptimizeFactorProvided: req.OptimizeFactor != nil,
		OptimizeTaskType: req.GetOptimizeTaskType(),
	}
	_, _, _, _, _, maxIterations, err := p.validatePromptOptimizeParams(ctx, params)
	if err != nil {
		return nil, err
	}
	minUsage, maxUsage := promptOptimizeResourceUsage(len(params.SelectedItemIDs), maxIterations)
	return &expt.EstimatePromptOptimizeTaskResponse{
		MinTotalResourceUsage: gptr.Of(minUsage), MaxTotalResourceUsage: gptr.Of(maxUsage),
	}, nil
}

func (p *promptOptimizationExecutor) create(ctx context.Context, req *expt.CreatePromptOptimizeTaskRequest) (*expt.CreatePromptOptimizeTaskResponse, error) {
	userID := session.UserIDInCtxOrEmpty(ctx)
	if userID == "" {
		return nil, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("user session is required"))
	}
	params := promptOptimizeParams{
		WorkspaceID: req.GetWorkspaceID(), PromptID: req.GetPromptID(), TargetType: req.GetTargetType(),
		TargetVersion: req.GetTargetVersion(), DatasetType: req.GetDatasetType(), RelatedEvalSetID: req.GetRelatedEvalSetID(),
		RelatedEvalSetVersion: req.GetRelatedEvalSetVersionID(), RelatedExptID: req.GetRelatedExptID(),
		SelectedItemIDs: req.GetSelectedItemIDList(), TargetMappings: req.GetEvalSetToTarget(),
		ReferenceMapping: req.GetEvalSetToReference(), ActualOutputMapping: req.GetEvalSetToActualOutput(),
		Engine: req.GetEngine(), OptimizeFactor: req.GetOptimizeFactor(), OptimizeFactorProvided: req.OptimizeFactor != nil,
		OptimizeTaskType: req.GetOptimizeTaskType(),
	}
	experiment, source, promptDO, variableMappings, mode, maxIterations, err := p.validatePromptOptimizeParams(ctx, params)
	if err != nil {
		return nil, err
	}
	minUsage, maxUsage := promptOptimizeResourceUsage(len(params.SelectedItemIDs), maxIterations)
	if usage := req.GetEstimateResourceUsage(); usage != nil {
		minUsage, maxUsage = usage.GetMinCreditUsage(), usage.GetMaxCreditUsage()
	}
	snapshot := promptOptimizationRequestSnapshot{
		VariableMappings: variableMappings, ModelAnswerField: strings.TrimSpace(params.ActualOutputMapping.GetFromFieldName()),
		Mode: mode, MaxIterations: maxIterations, EvalSetID: params.RelatedEvalSetID,
		EvalSetVersionID: params.RelatedEvalSetVersion, Engine: normalizeOptimizeEngine(params.Engine),
		OptimizeFactor:   normalizeOptimizeFactor(params.OptimizeFactor, params.OptimizeFactorProvided),
		OptimizeTaskType: normalizeOptimizeTaskType(params.OptimizeTaskType), MinResourceUsage: minUsage, MaxResourceUsage: maxUsage,
	}
	if params.ReferenceMapping != nil {
		snapshot.ReferenceAnswerField = strings.TrimSpace(params.ReferenceMapping.GetFromFieldName())
		snapshot.ReferenceMapping = promptOptimizeFieldMappingToSnapshot(params.ReferenceMapping)
	}
	snapshot.ActualOutputMapping = promptOptimizeFieldMappingToSnapshot(params.ActualOutputMapping)
	for _, mapping := range params.TargetMappings {
		if mapped := promptOptimizeFieldMappingToSnapshot(mapping); mapped != nil {
			snapshot.TargetMappings = append(snapshot.TargetMappings, *mapped)
		}
	}
	for _, itemID := range params.SelectedItemIDs {
		snapshot.Samples = append(snapshot.Samples, promptOptimizationSampleRefSnapshot{ItemID: itemID})
	}
	requestData, _ := stdjson.Marshal(snapshot)
	taskID, err := p.idgen.GenID(ctx)
	if err != nil {
		return nil, err
	}
	name := fmt.Sprintf("%s%s_优化%s", source.Name, source.Version, time.Now().Format("20060102_1504"))
	originalData, _ := stdjson.Marshal(promptTemplateRPCToDTO(promptDO.PromptCommit.Detail.PromptTemplate))
	row := &promptOptimizationTaskPO{
		ID: taskID, SpaceID: params.WorkspaceID, ExperimentID: experiment.ID, PromptID: source.PromptID,
		PromptKey: source.PromptKey, SourcePromptVersion: source.Version, Name: name, Mode: mode,
		Status: string(expt.PromptOptimizationStatusQueued), Stage: string(expt.PromptOptimizationStagePreparing),
		RequestData: requestData, OriginalPromptTemplate: originalData, CreatedBy: userID,
	}
	if err := p.store.createTask(ctx, row); err != nil {
		return nil, err
	}
	p.enqueue(taskID)
	task := p.taskPOToDTO(ctx, row, false, false)
	p.enrichPromptOptimizationTasks(ctx, params.WorkspaceID, []*promptOptimizationTaskPO{row}, []*expt.PromptOptimizeTask{task})
	return &expt.CreatePromptOptimizeTaskResponse{OptimizeTask: task}, nil
}

func (p *promptOptimizationExecutor) get(ctx context.Context, req *expt.GetPromptOptimizeTaskRequest) (*expt.GetPromptOptimizeTaskResponse, error) {
	if _, err := p.prompt.GetPrompt(ctx, req.GetWorkspaceID(), req.GetPromptID(), rpc.GetPromptParams{}); err != nil {
		return nil, err
	}
	row, err := p.store.getTaskByPrompt(ctx, req.GetWorkspaceID(), req.GetPromptID(), req.GetTaskID())
	if err != nil {
		return nil, promptOptimizationStoreError(err)
	}
	task := p.taskPOToDTO(ctx, row, true, true)
	p.enrichPromptOptimizationTasks(ctx, req.GetWorkspaceID(), []*promptOptimizationTaskPO{row}, []*expt.PromptOptimizeTask{task})
	return &expt.GetPromptOptimizeTaskResponse{OptimizeTask: task}, nil
}

func (p *promptOptimizationExecutor) terminate(ctx context.Context, req *expt.TerminatePromptOptimizeTaskRequest) (*expt.TerminatePromptOptimizeTaskResponse, error) {
	if _, err := p.prompt.GetPrompt(ctx, req.GetWorkspaceID(), req.GetPromptID(), rpc.GetPromptParams{}); err != nil {
		return nil, err
	}
	row, err := p.store.getTaskByPrompt(ctx, req.GetWorkspaceID(), req.GetPromptID(), req.GetTaskID())
	if err != nil {
		return nil, promptOptimizationStoreError(err)
	}
	if row.Status != string(expt.PromptOptimizationStatusCanceled) {
		terminated, terminateErr := p.store.tryCancelTask(ctx, row.ID)
		if terminateErr != nil {
			return nil, terminateErr
		}
		if !terminated {
			return nil, errorx.NewByCode(errno.CommonInvalidParamCode,
				errorx.WithExtraMsg("only Created or Running optimize tasks can be terminated"))
		}
	}
	p.cancelRunning(row.ID)
	row, err = p.store.getTaskByPrompt(ctx, req.GetWorkspaceID(), req.GetPromptID(), req.GetTaskID())
	if err != nil {
		return nil, promptOptimizationStoreError(err)
	}
	task := p.taskPOToDTO(ctx, row, true, true)
	p.enrichPromptOptimizationTasks(ctx, req.GetWorkspaceID(), []*promptOptimizationTaskPO{row}, []*expt.PromptOptimizeTask{task})
	return &expt.TerminatePromptOptimizeTaskResponse{OptimizeTask: task}, nil
}

func (p *promptOptimizationExecutor) listByPrompt(ctx context.Context, req *expt.ListPromptOptimizeTasksRequest) (*expt.ListPromptOptimizeTasksResponse, error) {
	if _, err := p.prompt.GetPrompt(ctx, req.GetWorkspaceID(), req.GetPromptID(), rpc.GetPromptParams{}); err != nil {
		return nil, err
	}
	page, size := req.GetPageNum(), req.GetPageSize()
	if page <= 0 {
		page = 1
	}
	if size <= 0 {
		size = 20
	}
	statuses := make([]string, 0, len(req.GetStatus()))
	for _, status := range req.GetStatus() {
		dbStatus, ok := promptOptimizeStatusToDB(status)
		if !ok {
			return nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("unsupported optimize task status "+status))
		}
		statuses = append(statuses, dbStatus)
	}
	rows, total, err := p.store.listTasksByPrompt(ctx, req.GetWorkspaceID(), req.GetPromptID(), page, size, statuses, strings.TrimSpace(req.GetName()))
	if err != nil {
		return nil, err
	}
	tasks := make([]*expt.PromptOptimizeTask, 0, len(rows))
	for _, row := range rows {
		task := p.taskPOToDTO(ctx, row, false, false)
		if task.OptimizeResult_ != nil {
			task.OptimizeResult_.OptimizedPromptMessageList = nil
			task.OptimizeResult_.OptimizedToolList = nil
		}
		tasks = append(tasks, task)
	}
	p.enrichPromptOptimizationTasks(ctx, req.GetWorkspaceID(), rows, tasks)
	return &expt.ListPromptOptimizeTasksResponse{OptimizeTasks: tasks, Total: gptr.Of(total)}, nil
}

func (p *promptOptimizationExecutor) validatePromptOptimizeParams(ctx context.Context, params promptOptimizeParams) (*entity.Experiment, *entity.LoopPrompt, *rpc.LoopPrompt, map[string]string, string, int32, error) {
	if targetType := strings.TrimSpace(params.TargetType); targetType != "" && targetType != "Prompt" {
		return nil, nil, nil, nil, "", 0, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("target_type must be Prompt"))
	}
	if params.DatasetType != "Experiment" {
		return nil, nil, nil, nil, "", 0, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("only dataset_type=Experiment is supported"))
	}
	if len(params.SelectedItemIDs) < promptOptimizationMinSamples || len(params.SelectedItemIDs) > promptOptimizationMaxSamples {
		return nil, nil, nil, nil, "", 0, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("selected_item_id_list must contain 20 to 500 experiment rows"))
	}
	seen := make(map[int64]struct{}, len(params.SelectedItemIDs))
	for _, itemID := range params.SelectedItemIDs {
		if itemID <= 0 {
			return nil, nil, nil, nil, "", 0, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("selected experiment item IDs must be positive"))
		}
		if _, exists := seen[itemID]; exists {
			return nil, nil, nil, nil, "", 0, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("selected_item_id_list contains duplicate IDs"))
		}
		seen[itemID] = struct{}{}
	}
	if engine := normalizeOptimizeEngine(params.Engine); engine != "Ark" {
		return nil, nil, nil, nil, "", 0, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("engine must be Ark"))
	}
	if taskType := normalizeOptimizeTaskType(params.OptimizeTaskType); taskType != "Score" {
		return nil, nil, nil, nil, "", 0, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("optimize_task_type must be Score"))
	}
	factor := normalizeOptimizeFactor(params.OptimizeFactor, params.OptimizeFactorProvided)
	if factor < 0 || factor > 1 {
		return nil, nil, nil, nil, "", 0, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("optimize_factor must be between 0 and 1"))
	}
	experiment, source, promptDO, err := p.loadSource(ctx, params.WorkspaceID, params.RelatedExptID, entity.NewSession(ctx))
	if err != nil {
		return nil, nil, nil, nil, "", 0, err
	}
	if source.PromptID != params.PromptID || source.Version != params.TargetVersion {
		return nil, nil, nil, nil, "", 0, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("the selected experiment does not use this Prompt version"))
	}
	if !experimentContainsEvalSet(experiment, params.RelatedEvalSetID, params.RelatedEvalSetVersion) {
		return nil, nil, nil, nil, "", 0, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("the evaluation set does not belong to the selected experiment"))
	}
	template := promptDO.PromptCommit.Detail.PromptTemplate
	if strings.EqualFold(template.TemplateType, "jinja2") {
		return nil, nil, nil, nil, "", 0, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("Jinja2 Prompt templates are not supported"))
	}
	if len(template.VariableDefs) == 0 {
		return nil, nil, nil, nil, "", 0, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("the Prompt must contain at least one variable"))
	}
	variableMappings := make(map[string]string, len(params.TargetMappings))
	for _, mapping := range params.TargetMappings {
		if mapping == nil {
			continue
		}
		variableMappings[strings.TrimSpace(mapping.GetFieldName())] = strings.TrimSpace(mapping.GetFromFieldName())
	}
	if err := validateOptimizationVariableMappings(template, variableMappings); err != nil {
		return nil, nil, nil, nil, "", 0, err
	}
	if params.ActualOutputMapping == nil || strings.TrimSpace(params.ActualOutputMapping.GetFromFieldName()) == "" {
		return nil, nil, nil, nil, "", 0, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("eval_set_to_actual_output.from_field_name is required"))
	}
	mode := string(expt.PromptOptimizationModeCostEffective)
	if factor >= 0.5 {
		mode = string(expt.PromptOptimizationModeEffectFirst)
	}
	maxIterations := int32(3 + math.Round(factor*5))
	return experiment, source, promptDO, variableMappings, mode, maxIterations, nil
}

func (p *promptOptimizationExecutor) enrichPromptOptimizationTasks(ctx context.Context, spaceID int64, rows []*promptOptimizationTaskPO, tasks []*expt.PromptOptimizeTask) {
	if len(rows) == 0 || len(rows) != len(tasks) {
		return
	}
	experimentIDs := make([]int64, 0, len(rows))
	seen := make(map[int64]struct{}, len(rows))
	for _, row := range rows {
		if row == nil {
			continue
		}
		if _, ok := seen[row.ExperimentID]; ok {
			continue
		}
		seen[row.ExperimentID] = struct{}{}
		experimentIDs = append(experimentIDs, row.ExperimentID)
	}
	experiments, err := p.manager.MGetDetail(ctx, experimentIDs, spaceID, entity.NewSession(ctx))
	if err != nil {
		// Optimization history remains usable even if an associated experiment
		// was removed or its detail can no longer be hydrated.
		logs.CtxWarn(ctx, "hydrate Prompt optimization task associations failed: %v", err)
		return
	}
	experimentByID := make(map[int64]*entity.Experiment, len(experiments))
	for _, experiment := range experiments {
		if experiment != nil {
			experimentByID[experiment.ID] = experiment
		}
	}
	for i, row := range rows {
		if row == nil || tasks[i] == nil {
			continue
		}
		experiment := experimentByID[row.ExperimentID]
		if experiment == nil {
			continue
		}
		if tasks[i].OptimizeTaskDataSet == nil {
			tasks[i].OptimizeTaskDataSet = &expt.PromptOptimizeTaskDataSet{}
		}
		if tasks[i].OptimizeTarget != nil && experiment.Target != nil && experiment.Target.EvalTargetVersion != nil && experiment.Target.EvalTargetVersion.Prompt != nil {
			tasks[i].OptimizeTarget.TargetName = optionalString(experiment.Target.EvalTargetVersion.Prompt.Name)
		}
		tasks[i].OptimizeTaskDataSet.RelatedExptName = optionalString(experiment.Name)
		infos := promptOptimizationEvalSetInfos(experiment)
		if len(infos) > 0 {
			if tasks[i].OptimizeTaskDataSet.RelatedEvalSetID == nil {
				tasks[i].OptimizeTaskDataSet.RelatedEvalSetID = infos[0].ID
			}
			if tasks[i].OptimizeTaskDataSet.RelatedEvalSetVersionID == nil {
				tasks[i].OptimizeTaskDataSet.RelatedEvalSetVersionID = infos[0].VersionID
			}
			tasks[i].OptimizeTaskDataSet.RelatedEvalSetName = infos[0].Name
			tasks[i].OptimizeTaskDataSet.RelatedEvalSetVersion = infos[0].Version
		}
	}
}

func promptOptimizationEvalSetInfos(experiment *entity.Experiment) []*expt.PromptOptimizationEvalSetInfo {
	if experiment == nil {
		return nil
	}
	infos := make([]*expt.PromptOptimizationEvalSetInfo, 0, len(experiment.EvalSetDetails))
	for _, detail := range experiment.EvalSetDetails {
		if detail == nil {
			continue
		}
		info := &expt.PromptOptimizationEvalSetInfo{
			ID: gptr.Of(detail.EvalSetID), VersionID: gptr.Of(detail.EvalSetVersionID),
			ItemCount: gptr.Of(int64(detail.ItemCount)), IsPrimary: gptr.Of(detail.IsPrimary),
		}
		if detail.EvalSet != nil {
			info.Name = optionalString(detail.EvalSet.Name)
			if detail.EvalSet.EvaluationSetVersion != nil {
				info.Version = optionalString(detail.EvalSet.EvaluationSetVersion.Version)
			}
		}
		infos = append(infos, info)
	}
	if len(infos) == 0 && experiment.EvalSet != nil {
		info := &expt.PromptOptimizationEvalSetInfo{
			ID: gptr.Of(experiment.EvalSetID), VersionID: gptr.Of(experiment.EvalSetVersionID), Name: optionalString(experiment.EvalSet.Name), IsPrimary: gptr.Of(true),
		}
		if experiment.EvalSet.EvaluationSetVersion != nil {
			info.Version = optionalString(experiment.EvalSet.EvaluationSetVersion.Version)
			info.ItemCount = gptr.Of(experiment.EvalSet.EvaluationSetVersion.ItemCount)
		} else {
			info.ItemCount = gptr.Of(experiment.EvalSet.ItemCount)
		}
		infos = append(infos, info)
	}
	return infos
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
	if len(experiment.Evaluators) == 0 {
		return nil, nil, nil, errorx.NewByCode(errno.CommonInvalidParamCode, errorx.WithExtraMsg("the experiment must configure at least one evaluator"))
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
	for _, variable := range promptDO.PromptCommit.Detail.PromptTemplate.VariableDefs {
		if variable == nil {
			continue
		}
		variableType := strings.TrimSpace(gptr.Indirect(variable.Type))
		if variableType != "" && !strings.EqualFold(variableType, "string") {
			return nil, nil, nil, errorx.NewByCode(errno.CommonInvalidParamCode,
				errorx.WithExtraMsg("Prompt optimization only supports text variables"))
		}
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
	optimizerModel, err := promptOptimizationModel(experiment)
	if err != nil {
		return err
	}
	_ = p.store.updateTask(ctx, row.ID, map[string]any{"stage": string(expt.PromptOptimizationStageAnalyzing), "progress": 5})
	samples, err := p.loadSamples(ctx, row, request)
	if err != nil {
		return err
	}
	baselineMetrics, baselineResults, err := baselineOptimizationMetrics(samples)
	if err != nil {
		return err
	}
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
		candidate, rationale, inTokens, outTokens, genErr := p.generateCandidate(ctx, row, optimizerModel, best, samples, bestResults, iteration)
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
		metrics, results, evaluationInputTokens, evaluationOutputTokens, evaluationErr := p.evaluateCandidate(
			ctx, row, request, experiment, candidate, samples, iteration, request.MaxIterations,
		)
		if evaluationErr != nil {
			return evaluationErr
		}
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

func promptOptimizationModel(experiment *entity.Experiment) (*entity.ModelConfig, error) {
	if configured := strings.TrimSpace(os.Getenv(promptOptimizerModelIDEnv)); configured != "" {
		modelID, err := strconv.ParseInt(configured, 10, 64)
		if err != nil || modelID <= 0 {
			return nil, errorx.NewByCode(errno.CommonInternalErrorCode,
				errorx.WithExtraMsg(promptOptimizerModelIDEnv+" must be a positive integer"))
		}
		return &entity.ModelConfig{ModelID: gptr.Of(modelID), MaxTokens: gptr.Of(promptOptimizerMaxTokens)}, nil
	}
	if experiment != nil {
		for _, evaluator := range experiment.Evaluators {
			if evaluator == nil {
				continue
			}
			model := evaluator.GetModelConfig()
			if model != nil && model.GetModelID() > 0 {
				return model, nil
			}
		}
	}
	return nil, errorx.NewByCode(errno.CommonInvalidParamCode,
		errorx.WithExtraMsg("prompt optimization requires at least one model-backed Prompt evaluator"))
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

func (p *promptOptimizationExecutor) generateCandidate(ctx context.Context, row *promptOptimizationTaskPO, model *entity.ModelConfig,
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
	const optimizerToolName = "submit_optimized_prompt"
	toolProperties := map[string]any{
		"rationale": map[string]any{"type": "string", "description": "本轮 Prompt 优化理由"},
	}
	requiredToolFields := make([]string, 0, len(best.Messages)+1)
	messageFieldIndexes := make(map[string]int, len(best.Messages))
	for index, message := range best.Messages {
		if message == nil {
			continue
		}
		field := fmt.Sprintf("message_%d", index)
		toolProperties[field] = map[string]any{
			"type":        "string",
			"description": fmt.Sprintf("优化后的第 %d 条 %s 消息正文；必须保留原变量占位符", index+1, message.Role),
		}
		requiredToolFields = append(requiredToolFields, field)
		messageFieldIndexes[field] = index
	}
	if len(messageFieldIndexes) == 0 {
		return nil, "", 0, 0, errorx.NewByCode(errno.CommonInvalidParamCode,
			errorx.WithExtraMsg("Prompt optimization requires at least one message"))
	}
	requiredToolFields = append(requiredToolFields, "rationale")
	optimizerToolSchemaData, err := stdjson.Marshal(map[string]any{
		"type":                 "object",
		"properties":           toolProperties,
		"required":             requiredToolFields,
		"additionalProperties": false,
	})
	if err != nil {
		return nil, "", 0, 0, errorx.Wrapf(err, "build optimizer tool schema")
	}
	optimizerToolSchema := string(optimizerToolSchemaData)
	systemText := "你是 Prompt 优化专家。请根据评测实验样本、模型回答、参考答案、评估器得分和原因，改写 Prompt 以提升真实评测得分。必须保留原 Prompt 的消息数量、顺序、角色、所有变量占位符及语义，不得针对单条样本泄露答案，不得新增不存在的业务事实。完成后必须且只能调用 submit_optimized_prompt 工具；将每条消息正文分别填写到对应的 message_N 字段，并填写 rationale。"
	maxTokens := gptr.Indirect(model.MaxTokens)
	if maxTokens < 8192 {
		maxTokens = 8192
	}
	if maxTokens > promptOptimizerMaxTokens {
		maxTokens = promptOptimizerMaxTokens
	}
	temperature := 0.2
	topP := 0.9
	reply, err := p.llm.Call(ctx, &entity.LLMCallParam{
		SpaceID: row.SpaceID, EvaluatorID: optimizerEvaluatorID, UserID: gptr.Of(row.CreatedBy), Scenario: entity.ScenarioEvaluator,
		Messages: []*entity.Message{
			{Role: entity.RoleSystem, Content: textContent(systemText)},
			{Role: entity.RoleUser, Content: textContent(string(payload))},
		},
		Tools: []*entity.Tool{{Function: &entity.Function{
			Name: optimizerToolName, Description: "提交优化后的 Prompt", Parameters: optimizerToolSchema,
		}}},
		ToolCallConfig: &entity.ToolCallConfig{ToolChoice: entity.ToolChoiceTypeRequired},
		ModelConfig:    &entity.ModelConfig{ModelID: gptr.Of(model.GetModelID()), MaxTokens: gptr.Of(maxTokens), Temperature: &temperature, TopP: &topP},
	})
	if err != nil {
		return nil, "", 0, 0, err
	}
	if reply == nil {
		return nil, "", 0, 0, errorx.NewByCode(errno.CommonInternalErrorCode, errorx.WithExtraMsg("optimizer model returned no result"))
	}
	var legacyDecoded struct {
		Messages  []struct{ Role, Content string } `json:"messages"`
		Rationale string                           `json:"rationale"`
	}
	raw := ""
	for _, toolCall := range reply.ToolCalls {
		if toolCall == nil || toolCall.FunctionCall == nil || toolCall.FunctionCall.Name != optimizerToolName {
			continue
		}
		raw = strings.TrimSpace(gptr.Indirect(toolCall.FunctionCall.Arguments))
		if raw != "" {
			break
		}
	}
	// Keep content parsing as a compatibility fallback for providers that ignore
	// required tool_choice but still return the requested JSON object.
	if raw == "" {
		raw = strings.TrimSpace(gptr.Indirect(reply.Content))
	}
	if raw == "" {
		return nil, "", 0, 0, errorx.NewByCode(errno.CommonInternalErrorCode,
			errorx.WithExtraMsg("optimizer model returned neither a tool result nor content, finish_reason="+reply.FinishReason))
	}
	if strings.HasPrefix(raw, "```") {
		raw = strings.TrimPrefix(raw, "```json")
		raw = strings.TrimPrefix(raw, "```")
		raw = strings.TrimSuffix(strings.TrimSpace(raw), "```")
	}
	var decoded map[string]stdjson.RawMessage
	if err := stdjson.Unmarshal([]byte(raw), &decoded); err != nil {
		return nil, "", 0, 0, errorx.Wrapf(err, "parse optimizer model JSON")
	}
	if rationale, ok := decoded["rationale"]; ok {
		if err := stdjson.Unmarshal(rationale, &legacyDecoded.Rationale); err != nil {
			return nil, "", 0, 0, errorx.Wrapf(err, "parse optimizer rationale")
		}
	}
	candidate := cloneRPCPromptTemplate(best)
	if legacyMessages, ok := decoded["messages"]; ok {
		if err := stdjson.Unmarshal(legacyMessages, &legacyDecoded.Messages); err != nil {
			return nil, "", 0, 0, errorx.Wrapf(err, "parse optimizer messages")
		}
		if len(legacyDecoded.Messages) == 0 {
			return nil, "", 0, 0, errorx.NewByCode(errno.CommonInternalErrorCode,
				errorx.WithExtraMsg("optimizer model did not produce Prompt messages"))
		}
		candidate.Messages = make([]*rpc.PromptMessage, 0, len(legacyDecoded.Messages))
		for _, message := range legacyDecoded.Messages {
			role := strings.ToLower(strings.TrimSpace(message.Role))
			if role != "system" && role != "user" && role != "assistant" {
				return nil, "", 0, 0, errorx.NewByCode(errno.CommonInternalErrorCode,
					errorx.WithExtraMsg("optimizer model produced an unsupported message role"))
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
	} else {
		for field, index := range messageFieldIndexes {
			contentJSON, ok := decoded[field]
			if !ok {
				return nil, "", 0, 0, errorx.NewByCode(errno.CommonInternalErrorCode,
					errorx.WithExtraMsg("optimizer model omitted required field "+field))
			}
			var content string
			if err := stdjson.Unmarshal(contentJSON, &content); err != nil {
				return nil, "", 0, 0, errorx.Wrapf(err, "parse optimizer field %s", field)
			}
			if strings.TrimSpace(content) == "" {
				return nil, "", 0, 0, errorx.NewByCode(errno.CommonInternalErrorCode,
					errorx.WithExtraMsg("optimizer model produced empty field "+field))
			}
			candidate.Messages[index].Content = content
		}
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
	return candidate, legacyDecoded.Rationale, inputTokens, outputTokens, nil
}

func (p *promptOptimizationExecutor) evaluateCandidate(ctx context.Context, row *promptOptimizationTaskPO,
	request promptOptimizationRequestSnapshot, experiment *entity.Experiment, candidate *rpc.PromptTemplate, samples []optimizerSample,
	iteration, maxIterations int32,
) (*expt.PromptOptimizationMetrics, []*expt.PromptOptimizationSampleEvaluation, int64, int64, error) {
	evaluatorByVersion := make(map[int64]*entity.Evaluator)
	for _, evaluator := range experiment.Evaluators {
		if evaluator != nil {
			evaluatorByVersion[evaluator.GetEvaluatorVersionID()] = evaluator
		}
	}
	results := make([]*expt.PromptOptimizationSampleEvaluation, len(samples))
	var inputTokens, outputTokens int64
	var mu sync.Mutex
	completed := 0
	group, sampleCtx := errgroup.WithContext(ctx)
	concurrency := promptOptimizationSampleConcurrency()
	group.SetLimit(concurrency)
	logs.CtxInfo(ctx, "prompt optimization task %d iteration %d evaluating %d samples, concurrency %d",
		row.ID, iteration, len(samples), concurrency)
	for sampleIndex, sample := range samples {
		if sampleCtx.Err() != nil {
			break
		}
		group.Go(func() (err error) {
			defer goroutine.Recover(sampleCtx, &err)
			if err := sampleCtx.Err(); err != nil {
				return err
			}
			started := time.Now()
			result, inTokens, outTokens, err := p.evaluateSample(sampleCtx, row, request, candidate, sample, evaluatorByVersion)
			mu.Lock()
			defer mu.Unlock()
			inputTokens += inTokens
			outputTokens += outTokens
			if err != nil {
				return err
			}
			if err := sampleCtx.Err(); err != nil {
				return err
			}
			results[sampleIndex] = result
			completed++
			// Serialize completed-count updates so out-of-order samples cannot regress progress.
			p.updateEvaluationProgress(sampleCtx, row.ID, iteration, maxIterations, completed, len(samples))
			logs.CtxInfo(ctx, "prompt optimization task %d iteration %d sample %d completed %d/%d, elapsed_ms=%d",
				row.ID, iteration, sample.ItemID, completed, len(samples), time.Since(started).Milliseconds())
			return nil
		})
	}
	if err := group.Wait(); err != nil {
		return nil, nil, inputTokens, outputTokens, err
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, inputTokens, outputTokens, err
	}
	return optimizationMetricsFromResults(results), results, inputTokens, outputTokens, nil
}

func (p *promptOptimizationExecutor) evaluateSample(ctx context.Context, row *promptOptimizationTaskPO,
	request promptOptimizationRequestSnapshot, candidate *rpc.PromptTemplate, sample optimizerSample,
	evaluatorByVersion map[int64]*entity.Evaluator,
) (*expt.PromptOptimizationSampleEvaluation, int64, int64, error) {
	var inputTokens, outputTokens int64
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
		PromptID: row.PromptID, PromptVersion: row.SourcePromptVersion, Variables: variables, OverridePromptTemplate: cloneRPCPromptTemplate(candidate),
	})
	if execErr != nil || execResult == nil {
		message := "Prompt execution returned no result"
		if execErr != nil {
			message = errorx.ErrorWithoutStack(execErr)
		}
		result.ErrorMessage = &message
		if ctx.Err() != nil {
			return nil, inputTokens, outputTokens, ctx.Err()
		}
		return result, inputTokens, outputTokens, nil
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
		if err := ctx.Err(); err != nil {
			return nil, inputTokens, outputTokens, err
		}
		// PreHandle injects tools and suffixes; each sample must own its evaluator.
		evaluatorData, err := stdjson.Marshal(evaluator)
		if err != nil {
			return nil, inputTokens, outputTokens, errorx.Wrapf(err, "clone evaluator %d", evaluatorVersionID)
		}
		var sampleEvaluator entity.Evaluator
		if err := stdjson.Unmarshal(evaluatorData, &sampleEvaluator); err != nil {
			return nil, inputTokens, outputTokens, errorx.Wrapf(err, "clone evaluator %d", evaluatorVersionID)
		}
		output, evalErr := p.evaluatorService.DebugEvaluator(ctx, &sampleEvaluator, input, nil, row.SpaceID)
		if evalErr != nil {
			return nil, inputTokens, outputTokens, errorx.Wrapf(evalErr,
				"evaluate candidate item %d with evaluator %d", sample.ItemID, evaluatorVersionID)
		}
		if output == nil || output.EvaluatorResult == nil {
			return nil, inputTokens, outputTokens, errorx.NewByCode(errno.CommonInternalErrorCode,
				errorx.WithExtraMsg(fmt.Sprintf("evaluator %d returned no result for candidate item %d", evaluatorVersionID, sample.ItemID)))
		}
		if output.EvaluatorUsage != nil {
			inputTokens += output.EvaluatorUsage.InputTokens
			outputTokens += output.EvaluatorUsage.OutputTokens
		}
		score := output.EvaluatorResult.Score
		if output.EvaluatorResult.Correction != nil && output.EvaluatorResult.Correction.Score != nil {
			score = output.EvaluatorResult.Correction.Score
		}
		if err := validateOptimizationScore(score, sample.ItemID, evaluatorVersionID); err != nil {
			return nil, inputTokens, outputTokens, err
		}
		result.OptimizedEvaluatorScores[key] = *score
		reason := output.EvaluatorResult.Reasoning
		if output.EvaluatorResult.Correction != nil {
			reason = output.EvaluatorResult.Correction.Explain
		}
		result.OptimizedEvaluatorReasons[key] = reason
	}
	originalScore, optimizedScore := averageMap(result.OriginalEvaluatorScores), averageMap(result.OptimizedEvaluatorScores)
	result.OriginalScore, result.OptimizedScore = &originalScore, &optimizedScore
	return result, inputTokens, outputTokens, nil
}

func (p *promptOptimizationExecutor) updateEvaluationProgress(ctx context.Context, taskID int64,
	iteration, maxIterations int32, completedSamples, totalSamples int,
) {
	if p.store == nil || maxIterations <= 0 || totalSamples <= 0 {
		return
	}
	iterationStart := int32(10) + (iteration-1)*80/maxIterations
	iterationEnd := int32(10) + iteration*80/maxIterations
	progress := iterationStart + (iterationEnd-iterationStart)*int32(completedSamples)/int32(totalSamples)
	_, _ = p.store.updateTaskIfStatus(ctx, taskID, string(expt.PromptOptimizationStatusRunning), map[string]any{
		"stage": string(expt.PromptOptimizationStageEvaluating), "progress": progress,
	})
}

func baselineOptimizationMetrics(samples []optimizerSample) (*expt.PromptOptimizationMetrics, []*expt.PromptOptimizationSampleEvaluation, error) {
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
			score := record.GetScore()
			if err := validateOptimizationScore(score, sample.ItemID, versionID); err != nil {
				return nil, nil, errorx.Wrapf(err, "source experiment has an invalid score; rerun the experiment before optimization")
			}
			row.OriginalEvaluatorScores[key], row.OptimizedEvaluatorScores[key] = *score, *score
			row.OriginalEvaluatorReasons[key], row.OptimizedEvaluatorReasons[key] = record.GetReasoning(), record.GetReasoning()
		}
		score := averageMap(row.OriginalEvaluatorScores)
		row.OriginalScore, row.OptimizedScore = &score, &score
		results = append(results, row)
	}
	return optimizationMetricsFromResults(results), results, nil
}

// Optimization compares normalized scores; custom evaluator scales remain unchanged elsewhere.
func validateOptimizationScore(score *float64, itemID, evaluatorVersionID int64) error {
	if score == nil || math.IsNaN(*score) || math.IsInf(*score, 0) || *score < 0 || *score > 1 {
		value := "missing"
		if score != nil {
			value = strconv.FormatFloat(*score, 'g', -1, 64)
		}
		return errorx.NewByCode(errno.InvalidOutputFromModelCode, errorx.WithExtraMsg(fmt.Sprintf(
			"candidate item %d evaluator %d must return a finite score between 0 and 1, got %v",
			itemID, evaluatorVersionID, value)))
	}
	return nil
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

func (p *promptOptimizationExecutor) taskPOToDTO(ctx context.Context, row *promptOptimizationTaskPO, withIterations, withSamples bool) *expt.PromptOptimizeTask {
	if row == nil {
		return nil
	}
	task := &expt.PromptOptimizeTask{
		ID: &row.ID, TaskName: &row.Name, Status: gptr.Of(promptOptimizeStatusFromDB(row.Status)),
		Stage: gptr.Of(promptOptimizeStageFromDB(row.Stage)), Progress: &row.Progress,
		ErrorMessage: optionalString(row.ErrorMessage), CreatedBy: &row.CreatedBy,
		CreatedAt: gptr.Of(row.CreatedAt.UnixMilli()), UpdatedAt: gptr.Of(row.UpdatedAt.UnixMilli()), StartedAt: optionalInt64(row.StartedAt),
		EndedAt: optionalInt64(row.EndedAt),
		OptimizeTarget: &expt.PromptOptimizeTarget{
			TargetID: &row.PromptID, TargetKey: &row.PromptKey, TargetVersion: &row.SourcePromptVersion, TargetType: gptr.Of("Prompt"),
		},
	}
	var request promptOptimizationRequestSnapshot
	if stdjson.Unmarshal(row.RequestData, &request) == nil {
		dataset := &expt.PromptOptimizeTaskDataSet{
			DatasetType: gptr.Of("Experiment"), RelatedExptID: &row.ExperimentID,
			RelatedEvalSetID: optionalPositiveInt64(request.EvalSetID), RelatedEvalSetVersionID: optionalPositiveInt64(request.EvalSetVersionID),
			EvalSetToReference:    promptOptimizeFieldMappingFromSnapshot(request.ReferenceMapping),
			EvalSetToActualOutput: promptOptimizeFieldMappingFromSnapshot(request.ActualOutputMapping),
			EstimateResourceUsage: &expt.PromptOptimizeResourceUsage{
				MinCreditUsage: gptr.Of(request.MinResourceUsage), MaxCreditUsage: gptr.Of(request.MaxResourceUsage),
			},
		}
		for _, sample := range request.Samples {
			dataset.SelectedItemIDList = append(dataset.SelectedItemIDList, sample.ItemID)
		}
		for i := range request.TargetMappings {
			mapping := request.TargetMappings[i]
			dataset.EvalSetToTarget = append(dataset.EvalSetToTarget, promptOptimizeFieldMappingFromSnapshot(&mapping))
		}
		if len(dataset.EvalSetToTarget) == 0 {
			for fieldName, fromFieldName := range request.VariableMappings {
				dataset.EvalSetToTarget = append(dataset.EvalSetToTarget, &expt.PromptOptimizeFieldMapping{
					FieldName: gptr.Of(fieldName), FromFieldName: gptr.Of(fromFieldName),
				})
			}
		}
		if dataset.EvalSetToReference == nil && request.ReferenceAnswerField != "" {
			dataset.EvalSetToReference = &expt.PromptOptimizeFieldMapping{FromFieldName: gptr.Of(request.ReferenceAnswerField), FieldName: gptr.Of("output")}
		}
		if dataset.EvalSetToActualOutput == nil && request.ModelAnswerField != "" {
			dataset.EvalSetToActualOutput = &expt.PromptOptimizeFieldMapping{FromFieldName: gptr.Of(request.ModelAnswerField), FieldName: gptr.Of("actual_output")}
		}
		task.OptimizeTaskDataSet = dataset
		factor := request.OptimizeFactor
		if request.Engine == "" {
			if request.Mode == string(expt.PromptOptimizationModeCostEffective) {
				factor = 0.2
			} else {
				factor = 0.8
			}
		}
		task.OptimizeEngineConfig = &expt.PromptOptimizeEngineConfig{
			Engine: gptr.Of(normalizeOptimizeEngine(request.Engine)), OptimizeFactor: gptr.Of(factor),
			BalanceMode: gptr.Of(promptOptimizeBalanceMode(factor)), OptimizeTaskType: gptr.Of(normalizeOptimizeTaskType(request.OptimizeTaskType)),
		}
	}
	hasOptimizationResult := len(row.OptimizedPromptTemplate) > 0 || len(row.BaselineMetrics) > 0 || len(row.BestMetrics) > 0
	canExposeOptimizationResult := row.Status == string(expt.PromptOptimizationStatusRunning) ||
		row.Status == string(expt.PromptOptimizationStatusSucceeded)
	if canExposeOptimizationResult && hasOptimizationResult {
		result := &expt.PromptOptimizeTaskResult_{}
		var optimizedTemplate promptdto.PromptTemplate
		if stdjson.Unmarshal(row.OptimizedPromptTemplate, &optimizedTemplate) == nil {
			result.OptimizedPromptMessageList = optimizedTemplate.Messages
		}
		_ = stdjson.Unmarshal(row.BaselineMetrics, &result.BaselineMetrics)
		_ = stdjson.Unmarshal(row.BestMetrics, &result.BestMetrics)
		task.OptimizeResult_ = result
	}
	if withIterations && task.OptimizeResult_ != nil {
		iterations, err := p.store.listIterations(ctx, row.ID)
		if err == nil {
			for _, iteration := range iterations {
				item := &expt.PromptOptimizationIteration{Iteration: &iteration.IterationNo, Rationale: optionalString(iteration.Rationale), CreatedAt: gptr.Of(iteration.CreatedAt.UnixMilli())}
				_ = stdjson.Unmarshal(iteration.CandidateTemplate, &item.CandidatePromptTemplate)
				_ = stdjson.Unmarshal(iteration.Metrics, &item.Metrics)
				if withSamples {
					_ = stdjson.Unmarshal(iteration.SampleResults, &item.SampleResults)
				}
				task.OptimizeResult_.Iterations = append(task.OptimizeResult_.Iterations, item)
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

func promptOptimizeFieldMappingToSnapshot(mapping *expt.PromptOptimizeFieldMapping) *promptOptimizeFieldMappingSnapshot {
	if mapping == nil {
		return nil
	}
	return &promptOptimizeFieldMappingSnapshot{
		FromFieldName: strings.TrimSpace(mapping.GetFromFieldName()),
		FieldName:     strings.TrimSpace(mapping.GetFieldName()),
		ConstValue:    mapping.GetConstValue(),
	}
}

func promptOptimizeFieldMappingFromSnapshot(mapping *promptOptimizeFieldMappingSnapshot) *expt.PromptOptimizeFieldMapping {
	if mapping == nil {
		return nil
	}
	return &expt.PromptOptimizeFieldMapping{
		FromFieldName: optionalString(mapping.FromFieldName), FieldName: optionalString(mapping.FieldName), ConstValue: optionalString(mapping.ConstValue),
	}
}

func normalizeOptimizeEngine(engine string) string {
	if strings.TrimSpace(engine) == "" {
		return "Ark"
	}
	return strings.TrimSpace(engine)
}

func normalizeOptimizeTaskType(taskType string) string {
	if strings.TrimSpace(taskType) == "" {
		return "Score"
	}
	return strings.TrimSpace(taskType)
}

func normalizeOptimizeFactor(factor float64, provided bool) float64 {
	if !provided {
		return 0.5
	}
	return factor
}

func promptOptimizeBalanceMode(factor float64) string {
	if factor >= 0.5 {
		return "EffectFirst"
	}
	return "CostEffectiveFirst"
}

func promptOptimizeResourceUsage(sampleCount int, maxIterations int32) (int64, int64) {
	// gcs-loop has no resource-point billing. These values estimate the number
	// of model calls: one candidate generation plus one evaluation per sample.
	perIteration := int64(sampleCount + 1)
	return perIteration, perIteration * int64(maxIterations)
}

func experimentContainsEvalSet(experiment *entity.Experiment, evalSetID, evalSetVersionID int64) bool {
	if experiment == nil {
		return false
	}
	if experiment.EvalSetID == evalSetID && experiment.EvalSetVersionID == evalSetVersionID {
		return true
	}
	for _, detail := range experiment.EvalSetDetails {
		if detail != nil && detail.EvalSetID == evalSetID && detail.EvalSetVersionID == evalSetVersionID {
			return true
		}
	}
	return false
}

func promptOptimizeStatusToDB(status string) (string, bool) {
	switch status {
	case "Created":
		return string(expt.PromptOptimizationStatusQueued), true
	case "Running":
		return string(expt.PromptOptimizationStatusRunning), true
	case "Success":
		return string(expt.PromptOptimizationStatusSucceeded), true
	case "Failed":
		return string(expt.PromptOptimizationStatusFailed), true
	case "Terminated":
		return string(expt.PromptOptimizationStatusCanceled), true
	default:
		return "", false
	}
}

func promptOptimizeStatusFromDB(status string) string {
	switch status {
	case string(expt.PromptOptimizationStatusQueued):
		return "Created"
	case string(expt.PromptOptimizationStatusRunning):
		return "Running"
	case string(expt.PromptOptimizationStatusSucceeded):
		return "Success"
	case string(expt.PromptOptimizationStatusFailed):
		return "Failed"
	case string(expt.PromptOptimizationStatusCanceled):
		return "Terminated"
	default:
		return status
	}
}

func promptOptimizeStageFromDB(stage string) string {
	switch stage {
	case string(expt.PromptOptimizationStagePreparing):
		return "Preparing"
	case string(expt.PromptOptimizationStageAnalyzing):
		return "Analyzing"
	case string(expt.PromptOptimizationStageOptimizing):
		return "Optimizing"
	case string(expt.PromptOptimizationStageEvaluating):
		return "Evaluating"
	case string(expt.PromptOptimizationStageFinalizing):
		return "Finalizing"
	case string(expt.PromptOptimizationStageCompleted):
		return "Completed"
	default:
		return stage
	}
}

func optionalPositiveInt64(value int64) *int64 {
	if value <= 0 {
		return nil
	}
	return &value
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
