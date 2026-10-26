import { LocalStorage } from "@raycast/api";
import type {
  ChatHistoryItem,
  ChatMessage,
  ContextKind,
  ModelConfig,
  StoredContext,
} from "../types";

const contextKey = (kind: ContextKind) => `rayai.context.${kind}.v1`;
const historyKey = (kind: ContextKind) => `rayai.history.${kind}.v1`;
const MAX_HISTORY_ITEMS = 30;

interface SaveContextOptions {
  sessionId?: string;
  modelId?: string;
  modelName?: string;
  modelOverrideId?: string;
}

export async function loadContext(
  kind: ContextKind,
  ttlMinutes: number,
): Promise<StoredContext | undefined> {
  const context = await readCurrentContext(kind);
  if (!context) return undefined;

  const expiresAfter = ttlMinutes * 60_000;
  if (Date.now() - context.activeAt > expiresAfter) {
    await archiveContext(kind, context);
    await clearContext(kind);
    return undefined;
  }
  return context;
}

export async function saveContext(
  kind: ContextKind,
  messages: ChatMessage[],
  options: SaveContextOptions = {},
): Promise<StoredContext> {
  const existing = await readCurrentContext(kind);
  const now = Date.now();
  if (existing && options.sessionId && existing.id !== options.sessionId) {
    const displacedContext: StoredContext = {
      id: options.sessionId,
      messages,
      createdAt: messages[0]?.createdAt ?? now,
      updatedAt: now,
      activeAt: now,
      modelId: options.modelId,
      modelName: options.modelName,
      modelOverrideId: options.modelOverrideId,
    };
    await archiveContext(kind, displacedContext);
    return displacedContext;
  }

  const sameSession =
    existing && (!options.sessionId || existing.id === options.sessionId)
      ? existing
      : undefined;
  const context: StoredContext = {
    id: options.sessionId ?? sameSession?.id ?? crypto.randomUUID(),
    messages,
    createdAt: sameSession?.createdAt ?? messages[0]?.createdAt ?? now,
    updatedAt: now,
    activeAt: now,
    modelId: options.modelId ?? sameSession?.modelId,
    modelName: options.modelName ?? sameSession?.modelName,
    modelOverrideId:
      "modelOverrideId" in options
        ? options.modelOverrideId
        : sameSession?.modelOverrideId,
  };
  await LocalStorage.setItem(contextKey(kind), JSON.stringify(context));
  return context;
}

export async function archiveCurrentContext(kind: ContextKind): Promise<void> {
  const context = await readCurrentContext(kind);
  if (context?.messages.length) await archiveContext(kind, context);
  await clearContext(kind);
}

export async function updateContextModelOverride(
  kind: ContextKind,
  modelOverrideId?: string,
): Promise<StoredContext | undefined> {
  const context = await readCurrentContext(kind);
  if (!context) return undefined;
  const updated = {
    ...context,
    activeAt: Date.now(),
    modelOverrideId,
  };
  await LocalStorage.setItem(contextKey(kind), JSON.stringify(updated));
  return updated;
}

export async function preserveContextModelMetadata(
  kind: ContextKind,
  model: ModelConfig,
): Promise<void> {
  const [current, history] = await Promise.all([
    readCurrentContext(kind),
    readHistory(kind),
  ]);
  const preservedCurrent = current
    ? preserveModelMetadata(current, model)
    : undefined;
  const preservedHistory = history.map((context) =>
    preserveModelMetadata(context, model),
  );

  const writes: Promise<void>[] = [];
  if (current && preservedCurrent !== current) {
    writes.push(
      LocalStorage.setItem(contextKey(kind), JSON.stringify(preservedCurrent)),
    );
  }
  if (preservedHistory.some((context, index) => context !== history[index])) {
    writes.push(writeHistory(kind, preservedHistory));
  }
  await Promise.all(writes);
}

export async function loadContextHistory(
  kind: ContextKind,
  ttlMinutes: number,
): Promise<ChatHistoryItem[]> {
  await loadContext(kind, ttlMinutes);
  const [current, history] = await Promise.all([
    readCurrentContext(kind),
    readHistory(kind),
  ]);
  const items: ChatHistoryItem[] = history.map((context) => ({
    ...context,
    isCurrent: false,
  }));
  if (current?.messages.length) items.push({ ...current, isCurrent: true });
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function activateHistoryContext(
  kind: ContextKind,
  sessionId: string,
): Promise<StoredContext | undefined> {
  const current = await readCurrentContext(kind);
  if (current?.id === sessionId) {
    const activated = { ...current, activeAt: Date.now() };
    await LocalStorage.setItem(contextKey(kind), JSON.stringify(activated));
    return activated;
  }

  const history = await readHistory(kind);
  const selected = history.find((context) => context.id === sessionId);
  if (!selected) return undefined;

  const remaining = history.filter((context) => context.id !== sessionId);
  if (current?.messages.length) remaining.push(current);
  await writeHistory(kind, remaining);

  const activated = { ...selected, activeAt: Date.now() };
  await LocalStorage.setItem(contextKey(kind), JSON.stringify(activated));
  return activated;
}

export async function clearContext(kind: ContextKind): Promise<void> {
  await LocalStorage.removeItem(contextKey(kind));
}

export async function clearAllContexts(kind: ContextKind): Promise<void> {
  await Promise.all([
    LocalStorage.removeItem(contextKey(kind)),
    LocalStorage.removeItem(historyKey(kind)),
  ]);
}

async function archiveContext(
  kind: ContextKind,
  context: StoredContext,
): Promise<void> {
  if (!context.messages.length) return;
  const history = await readHistory(kind);
  await writeHistory(kind, [
    context,
    ...history.filter((item) => item.id !== context.id),
  ]);
}

async function readCurrentContext(
  kind: ContextKind,
): Promise<StoredContext | undefined> {
  const raw = await LocalStorage.getItem<string>(contextKey(kind));
  if (!raw) return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);
    const context = normalizeContext(parsed);
    if (!context) {
      await clearContext(kind);
      return undefined;
    }
    if (JSON.stringify(context) !== raw) {
      await LocalStorage.setItem(contextKey(kind), JSON.stringify(context));
    }
    return context;
  } catch {
    await clearContext(kind);
    return undefined;
  }
}

async function readHistory(kind: ContextKind): Promise<StoredContext[]> {
  const raw = await LocalStorage.getItem<string>(historyKey(kind));
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeContext)
      .filter((context): context is StoredContext => Boolean(context));
  } catch {
    return [];
  }
}

async function writeHistory(
  kind: ContextKind,
  contexts: StoredContext[],
): Promise<void> {
  const unique = new Map<string, StoredContext>();
  for (const context of contexts.sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (context.messages.length && !unique.has(context.id)) {
      unique.set(context.id, context);
    }
  }
  await LocalStorage.setItem(
    historyKey(kind),
    JSON.stringify(Array.from(unique.values()).slice(0, MAX_HISTORY_ITEMS)),
  );
}

function normalizeContext(value: unknown): StoredContext | undefined {
  if (!isRecord(value) || !Array.isArray(value.messages)) return undefined;

  const messages = value.messages.filter(isChatMessage);
  if (messages.length !== value.messages.length) return undefined;
  const fallbackTime = messages.at(-1)?.createdAt ?? Date.now();
  const updatedAt = finiteNumber(value.updatedAt) ?? fallbackTime;
  return {
    id:
      typeof value.id === "string" && value.id ? value.id : crypto.randomUUID(),
    messages,
    createdAt:
      finiteNumber(value.createdAt) ?? messages[0]?.createdAt ?? updatedAt,
    updatedAt,
    activeAt: finiteNumber(value.activeAt) ?? updatedAt,
    modelId: typeof value.modelId === "string" ? value.modelId : undefined,
    modelName:
      typeof value.modelName === "string" ? value.modelName : undefined,
    modelOverrideId:
      typeof value.modelOverrideId === "string"
        ? value.modelOverrideId
        : undefined,
  };
}

function preserveModelMetadata(
  context: StoredContext,
  model: ModelConfig,
): StoredContext {
  if (context.modelId === model.id) {
    return context.modelName ? context : { ...context, modelName: model.name };
  }
  if (!context.modelId && context.modelOverrideId === model.id) {
    return { ...context, modelId: model.id, modelName: model.name };
  }
  return context;
}

function isChatMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "system" ||
      value.role === "user" ||
      value.role === "assistant") &&
    typeof value.content === "string" &&
    typeof value.createdAt === "number"
  );
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
