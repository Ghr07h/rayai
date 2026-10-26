import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Form,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { preserveContextModelMetadata } from "./lib/context";
import {
  loadSettings,
  normalizeTtl,
  parseRequestOptionsJson,
  saveModelSettings,
  saveSettings,
  validateBaseUrl,
} from "./lib/settings";
import type { ModelConfig, RayAISettings } from "./types";

interface Errors {
  baseUrl?: string;
  requestOptions?: string;
  contextTtlMinutes?: string;
}

interface Props {
  onSaved?: (settings: RayAISettings) => void;
}

interface ModelState {
  models: ModelConfig[];
  selectedModel: string;
}

interface SettingsFormValues {
  baseUrl: string;
  token: string;
  selectedModel: string;
  requestOptions: string;
  contextTtlMinutes: string;
}

const ADD_MODEL_VALUE = "__add_model__";
const NO_MODEL_VALUE = "__no_model__";
const SELECT_MODEL_PREFIX = "__select_model__:";

export default function SettingsForm({ onSaved }: Props) {
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [modelState, setModelState] = useState<ModelState>();
  const selectedModelRef = useRef("");
  const [requestOptionsJson, setRequestOptionsJson] = useState("");
  const [contextTtlMinutes, setContextTtlMinutes] = useState("5");
  const [errors, setErrors] = useState<Errors>({});
  const [isLoading, setIsLoading] = useState(true);
  const { pop, push } = useNavigation();
  const models = modelState?.models ?? [];
  const selectedModel = modelState?.selectedModel ?? "";

  useEffect(() => {
    void loadSettings().then((settings) => {
      setBaseUrl(settings.baseUrl);
      setToken(settings.token);
      selectedModelRef.current = settings.selectedModel;
      setModelState({
        models: settings.models,
        selectedModel: settings.selectedModel,
      });
      setRequestOptionsJson(
        Object.keys(settings.requestOptions).length
          ? JSON.stringify(settings.requestOptions, null, 2)
          : "",
      );
      setContextTtlMinutes(String(settings.contextTtlMinutes));
      setIsLoading(false);
    });
  }, []);

  async function submit(values: SettingsFormValues) {
    const nextErrors: Errors = {};
    let normalizedUrl = "";
    let requestOptions: Record<string, unknown> = {};

    try {
      normalizedUrl = validateBaseUrl(values.baseUrl);
    } catch (error) {
      nextErrors.baseUrl = messageOf(error);
    }
    try {
      requestOptions = parseRequestOptionsJson(values.requestOptions);
    } catch (error) {
      nextErrors.requestOptions = messageOf(error);
    }

    const ttl = Number(values.contextTtlMinutes);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 1440) {
      nextErrors.contextTtlMinutes = "请输入 1 到 1440 之间的整数";
    }

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      await showToast({ style: Toast.Style.Failure, title: "配置格式有误" });
      return;
    }

    const submittedModelId = values.selectedModel.startsWith(
      SELECT_MODEL_PREFIX,
    )
      ? values.selectedModel.slice(SELECT_MODEL_PREFIX.length)
      : "";
    const currentModelId = submittedModelId || selectedModelRef.current;
    const modelId = models.some((model) => model.id === currentModelId)
      ? currentModelId
      : (models[0]?.id ?? "");
    setIsLoading(true);
    try {
      const nextSettings: RayAISettings = {
        baseUrl: normalizedUrl,
        token: values.token.trim(),
        models,
        selectedModel: modelId,
        requestOptions,
        contextTtlMinutes: normalizeTtl(ttl),
      };
      await saveSettings(nextSettings);
      setBaseUrl(normalizedUrl);
      setToken(nextSettings.token);
      setRequestOptionsJson(
        Object.keys(requestOptions).length
          ? JSON.stringify(requestOptions, null, 2)
          : "",
      );
      setContextTtlMinutes(String(nextSettings.contextTtlMinutes));
      updateSelectedModel(modelId);
      setErrors({});
      await showToast({
        style: Toast.Style.Success,
        title: "RayAI 配置已保存",
      });
      if (onSaved) {
        onSaved(nextSettings);
        pop();
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function persistModels(
    nextModels: ModelConfig[],
    preferredModelId: string,
  ) {
    const saved = await saveModelSettings(nextModels, preferredModelId);
    selectedModelRef.current = saved.selectedModel;
    setModelState({
      models: nextModels,
      selectedModel: saved.selectedModel,
    });
  }

  async function addModel(model: ModelConfig) {
    await persistModels(
      [...models, model],
      selectedModelRef.current || model.id,
    );
  }

  async function editModel(previousId: string, model: ModelConfig) {
    const previousModel = models.find((item) => item.id === previousId);
    if (previousModel) {
      await preserveContextModelMetadata("chat", previousModel);
    }
    const nextModels = models.map((item) =>
      item.id === previousId ? model : item,
    );
    const nextSelectedModel =
      selectedModelRef.current === previousId
        ? model.id
        : selectedModelRef.current;
    await persistModels(nextModels, nextSelectedModel);
  }

  async function deleteModel(modelId: string): Promise<boolean> {
    const model = models.find((item) => item.id === modelId);
    if (!model) return false;

    const confirmed = await confirmAlert({
      title: `删除模型“${model.name}”？`,
      primaryAction: {
        title: "删除",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return false;

    const remaining = models.filter((item) => item.id !== modelId);
    const nextSelectedModel =
      selectedModelRef.current === modelId
        ? (remaining[0]?.id ?? "")
        : selectedModelRef.current;
    try {
      await preserveContextModelMetadata("chat", model);
      await persistModels(remaining, nextSelectedModel);
      await showToast({
        style: Toast.Style.Success,
        title: "模型已删除",
      });
      return true;
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "模型删除失败",
        message: messageOf(error),
      });
      return false;
    }
  }

  function updateSelectedModel(modelId: string) {
    selectedModelRef.current = modelId;
    setModelState((current) =>
      current ? { ...current, selectedModel: modelId } : current,
    );
  }

  if (!modelState) return <Form isLoading />;

  const selectedModelConfig = models.find(
    (model) => model.id === selectedModel,
  );
  const displayedModels = selectedModelConfig
    ? [
        selectedModelConfig,
        ...models.filter((model) => model.id !== selectedModelConfig.id),
      ]
    : models;

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm<SettingsFormValues>
            title="保存配置"
            icon={Icon.CheckCircle}
            shortcut={{ modifiers: [], key: "return" }}
            onSubmit={submit}
          />
          <ActionPanel.Section title="模型">
            <Action.Push
              title="新增模型"
              icon={Icon.Plus}
              target={
                <ModelEditorForm existingModels={models} onSave={addModel} />
              }
            />
            {selectedModelConfig ? (
              <Action.Push
                title="编辑当前模型"
                icon={Icon.Pencil}
                target={
                  <ModelEditorForm
                    model={selectedModelConfig}
                    existingModels={models}
                    onSave={(model) => editModel(selectedModelConfig.id, model)}
                  />
                }
              />
            ) : null}
            {models.length ? (
              <Action.Push
                title="删除模型"
                icon={Icon.Trash}
                target={
                  <ModelDeletionList models={models} onDelete={deleteModel} />
                }
              />
            ) : null}
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      <Form.TextField
        id="baseUrl"
        title="推理服务 URL"
        placeholder="https://api.openai.com/v1"
        value={baseUrl}
        error={errors.baseUrl}
        onChange={(value) => {
          setBaseUrl(value);
          setErrors((current) => ({ ...current, baseUrl: undefined }));
        }}
      />
      <Form.PasswordField
        id="token"
        title="Token"
        value={token}
        onChange={setToken}
      />
      <Form.Separator />
      <Form.Dropdown
        id="selectedModel"
        title="推理模型"
        value={
          models.length
            ? `${SELECT_MODEL_PREFIX}${selectedModel}`
            : NO_MODEL_VALUE
        }
        onChange={(value) => {
          if (value === ADD_MODEL_VALUE) {
            push(<ModelEditorForm existingModels={models} onSave={addModel} />);
            return;
          }
          if (value.startsWith(SELECT_MODEL_PREFIX)) {
            updateSelectedModel(value.slice(SELECT_MODEL_PREFIX.length));
          }
        }}
      >
        {models.length ? (
          displayedModels.map((model) => (
            <Form.Dropdown.Item
              key={model.id}
              title={`${model.name}${model.multimodal ? "（多模态）" : ""}`}
              value={`${SELECT_MODEL_PREFIX}${model.id}`}
            />
          ))
        ) : (
          <Form.Dropdown.Item value={NO_MODEL_VALUE} title="尚未添加模型" />
        )}
        <Form.Dropdown.Item
          value={ADD_MODEL_VALUE}
          title="新增模型"
          icon={Icon.Plus}
        />
      </Form.Dropdown>
      <Form.TextArea
        id="requestOptions"
        title="额外请求参数 JSON"
        placeholder={'{"temperature":0.7}'}
        value={requestOptionsJson}
        error={errors.requestOptions}
        onChange={(value) => {
          setRequestOptionsJson(value);
          setErrors((current) => ({ ...current, requestOptions: undefined }));
        }}
      />
      <Form.Description text="额外参数会传入 Chat Completions 请求；model、messages 和 stream 由 RayAI 管理。" />
      <Form.TextField
        id="contextTtlMinutes"
        title="上下文保存时间（分钟）"
        value={contextTtlMinutes}
        error={errors.contextTtlMinutes}
        onChange={(value) => {
          setContextTtlMinutes(value);
          setErrors((current) => ({
            ...current,
            contextTtlMinutes: undefined,
          }));
        }}
      />
    </Form>
  );
}

interface ModelDeletionListProps {
  models: ModelConfig[];
  onDelete: (modelId: string) => Promise<boolean>;
}

function ModelDeletionList({ models, onDelete }: ModelDeletionListProps) {
  const [visibleModels, setVisibleModels] = useState(models);
  const [isDeleting, setIsDeleting] = useState(false);

  async function deleteModel(modelId: string) {
    setIsDeleting(true);
    try {
      if (await onDelete(modelId)) {
        setVisibleModels((current) =>
          current.filter((model) => model.id !== modelId),
        );
      }
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <List isLoading={isDeleting}>
      {visibleModels.length ? (
        visibleModels.map((model) => (
          <List.Item
            key={model.id}
            title={model.name}
            subtitle={model.id}
            icon={model.multimodal ? Icon.Image : Icon.Message}
            actions={
              <ActionPanel>
                <Action
                  title={`删除 ${model.name}`}
                  icon={Icon.Trash}
                  onAction={() => void deleteModel(model.id)}
                />
              </ActionPanel>
            }
          />
        ))
      ) : (
        <List.EmptyView title="没有可删除的模型" />
      )}
    </List>
  );
}

interface ModelEditorProps {
  model?: ModelConfig;
  existingModels: ModelConfig[];
  onSave: (model: ModelConfig) => Promise<void>;
}

function ModelEditorForm({ model, existingModels, onSave }: ModelEditorProps) {
  const [id, setId] = useState(model?.id ?? "");
  const [name, setName] = useState(model?.name ?? "");
  const [multimodal, setMultimodal] = useState(model?.multimodal ?? false);
  const [idError, setIdError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const { pop } = useNavigation();

  async function submitModel(): Promise<boolean | void> {
    const normalizedId = id.trim();
    if (!normalizedId) {
      setIdError("模型 ID 不能为空");
      return;
    }
    if (
      existingModels.some(
        (item) => item.id === normalizedId && item.id !== model?.id,
      )
    ) {
      setIdError("模型 ID 已存在");
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        id: normalizedId,
        name: name.trim() || normalizedId,
        multimodal,
      });
      await showToast({
        style: Toast.Style.Success,
        title: model ? "模型已更新" : "模型已添加",
      });
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: model ? "模型更新失败" : "模型添加失败",
        message: messageOf(error),
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Form
      isLoading={isSaving}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={model ? "保存模型" : "新增模型"}
            icon={model ? Icon.CheckCircle : Icon.Plus}
            onSubmit={submitModel}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="modelId"
        title="模型 ID"
        placeholder="gpt-4o"
        value={id}
        error={idError}
        onChange={(value) => {
          setId(value);
          setIdError(undefined);
        }}
      />
      <Form.TextField
        id="modelName"
        title="显示名称"
        placeholder="GPT-4o"
        value={name}
        onChange={setName}
      />
      <Form.Checkbox
        id="multimodal"
        title="多模态"
        label="支持图片输入"
        value={multimodal}
        onChange={setMultimodal}
      />
    </Form>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
