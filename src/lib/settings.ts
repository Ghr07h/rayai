import { LocalStorage } from "@raycast/api";
import type { ModelConfig, RayAISettings } from "../types";

const SETTINGS_KEY = "rayai.settings.v1";

export const DEFAULT_SETTINGS: RayAISettings = {
  baseUrl: "",
  token: "",
  models: [],
  selectedModel: "",
  requestOptions: {},
  contextTtlMinutes: 5,
};

export async function loadSettings(): Promise<RayAISettings> {
  const raw = await LocalStorage.getItem<string>(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;

  try {
    const saved = JSON.parse(raw) as Partial<RayAISettings>;
    const settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      models: Array.isArray(saved.models) ? saved.models : [],
      requestOptions: isPlainObject(saved.requestOptions)
        ? saved.requestOptions
        : {},
      contextTtlMinutes: normalizeTtl(saved.contextTtlMinutes),
    };
    if (!settings.models.some((model) => model.id === settings.selectedModel)) {
      settings.selectedModel = settings.models[0]?.id ?? "";
    }
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: RayAISettings): Promise<void> {
  const serialized = JSON.stringify(settings);
  await LocalStorage.setItem(SETTINGS_KEY, serialized);
  const stored = await LocalStorage.getItem<string>(SETTINGS_KEY);
  if (stored !== serialized) throw new Error("配置写入后校验失败");
}

export async function saveModelSettings(
  models: ModelConfig[],
  preferredModelId: string,
): Promise<RayAISettings> {
  const saved = await loadSettings();
  const selectedModel = models.some((model) => model.id === preferredModelId)
    ? preferredModelId
    : (models[0]?.id ?? "");
  const next = { ...saved, models, selectedModel };
  await saveSettings(next);
  return next;
}

export function parseModelsJson(input: string): ModelConfig[] {
  const parsed: unknown = input.trim() ? JSON.parse(input) : [];
  if (!Array.isArray(parsed)) throw new Error("模型配置必须是 JSON 数组");

  const seen = new Set<string>();
  return parsed.map((value, index) => {
    if (!isPlainObject(value))
      throw new Error(`第 ${index + 1} 个模型必须是对象`);
    if (typeof value.id !== "string" || !value.id.trim()) {
      throw new Error(`第 ${index + 1} 个模型缺少非空 id`);
    }
    if (typeof value.multimodal !== "boolean") {
      throw new Error(`模型 ${value.id} 必须填写 multimodal: true 或 false`);
    }

    const id = value.id.trim();
    if (seen.has(id)) throw new Error(`模型 id 重复：${id}`);
    seen.add(id);

    if (value.name !== undefined && typeof value.name !== "string") {
      throw new Error(`模型 ${id} 的 name 必须是字符串`);
    }

    return {
      id,
      name:
        typeof value.name === "string" && value.name.trim()
          ? value.name.trim()
          : id,
      multimodal: value.multimodal,
    };
  });
}

export function parseRequestOptionsJson(
  input: string,
): Record<string, unknown> {
  const parsed: unknown = input.trim() ? JSON.parse(input) : {};
  if (!isPlainObject(parsed)) throw new Error("请求参数必须是 JSON 对象");
  return parsed;
}

export function validateBaseUrl(input: string): string {
  const value = input.trim();
  if (!value) return "";

  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("服务 URL 仅支持 http 或 https");
  }
  return value.replace(/\/$/, "");
}

export function normalizeTtl(value: unknown): number {
  const ttl = typeof value === "number" ? value : Number(value);
  return Number.isFinite(ttl) && ttl >= 1 ? Math.floor(ttl) : 5;
}

export function isConfigured(settings: RayAISettings): boolean {
  return Boolean(
    settings.baseUrl && settings.models.length && settings.selectedModel,
  );
}

export function getSelectedModel(
  settings: RayAISettings,
): ModelConfig | undefined {
  return (
    settings.models.find((model) => model.id === settings.selectedModel) ??
    settings.models[0]
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
