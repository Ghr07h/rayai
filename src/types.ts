export type MessageRole = "system" | "user" | "assistant";

export interface ModelConfig {
  id: string;
  name: string;
  multimodal: boolean;
}

export interface RayAISettings {
  baseUrl: string;
  token: string;
  models: ModelConfig[];
  selectedModel: string;
  requestOptions: Record<string, unknown>;
  contextTtlMinutes: number;
}

export interface ImageAttachment {
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  reasoning?: string;
  images?: ImageAttachment[];
  createdAt: number;
}

export interface StoredContext {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  activeAt: number;
  modelId?: string;
  modelName?: string;
  modelOverrideId?: string;
}

export interface ChatHistoryItem extends StoredContext {
  isCurrent: boolean;
}

export type ContextKind = "chat";
