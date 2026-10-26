import type { ChatMessage, RayAISettings } from "../types";

interface StreamChatOptions {
  settings: RayAISettings;
  messages: ChatMessage[];
  signal: AbortSignal;
  onDelta: (delta: StreamChatDelta) => void;
}

export interface StreamChatDelta {
  content?: string;
  reasoning?: string;
}

interface ChatCompletionPayload {
  content?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
  reasoning_details?: unknown;
  thinking?: unknown;
  analysis?: unknown;
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: ChatCompletionPayload;
    message?: ChatCompletionPayload;
  }>;
  error?: { message?: string };
}

export async function streamChat({
  settings,
  messages,
  signal,
  onDelta,
}: StreamChatOptions): Promise<void> {
  const response = await fetch(chatCompletionsUrl(settings.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
    },
    body: JSON.stringify({
      ...settings.requestOptions,
      model: settings.selectedModel,
      messages: messages.map(toOpenAIMessage),
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `请求失败 (${response.status})${body ? `：${extractError(body)}` : ""}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await response.json()) as ChatCompletionChunk;
    const delta = extractDelta(data.choices?.[0]?.message);
    if (delta.content || delta.reasoning) onDelta(delta);
    else throw new Error(data.error?.message ?? "服务未返回内容");
    return;
  }

  if (!response.body) throw new Error("服务未返回响应流");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (parseSseLine(line, onDelta)) return;
    }
    if (done) break;
  }

  if (buffer) parseSseLine(buffer, onDelta);
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith("/chat/completions")
    ? trimmed
    : `${trimmed}/chat/completions`;
}

function toOpenAIMessage(message: ChatMessage) {
  if (message.role === "user" && message.images?.length) {
    return {
      role: message.role,
      content: [
        { type: "text", text: message.content },
        ...message.images.map((image) => ({
          type: "image_url",
          image_url: { url: image.dataUrl },
        })),
      ],
    };
  }
  return { role: message.role, content: message.content };
}

function parseSseLine(
  line: string,
  onDelta: (delta: StreamChatDelta) => void,
): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return false;

  const payload = trimmed.slice(5).trim();
  if (!payload) return false;
  if (payload === "[DONE]") return true;

  let data: ChatCompletionChunk;
  try {
    data = JSON.parse(payload) as ChatCompletionChunk;
  } catch {
    return false;
  }

  if (data.error?.message) throw new Error(data.error.message);
  const delta = extractDelta(data.choices?.[0]?.delta);
  if (delta.content || delta.reasoning) onDelta(delta);
  return false;
}

function extractDelta(payload?: ChatCompletionPayload): StreamChatDelta {
  if (!payload) return {};

  const content = extractContent(payload.content);
  const reasoning =
    firstText(
      payload.reasoning_content,
      payload.reasoning,
      payload.thinking,
      payload.analysis,
      payload.reasoning_details,
    ) || extractReasoningParts(payload.content);
  return {
    ...(content ? { content } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}

function extractContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      if (!isRecord(part) || isReasoningPart(part)) return "";
      return textFromRecord(part);
    })
    .join("");
}

function extractReasoningParts(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) =>
      isRecord(part) && isReasoningPart(part) ? textFromRecord(part) : "",
    )
    .join("");
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = extractText(value);
    if (text) return text;
  }
  return "";
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).join("");
  return isRecord(value) ? textFromRecord(value) : "";
}

function textFromRecord(value: Record<string, unknown>): string {
  for (const key of ["text", "thinking", "content", "summary"]) {
    const candidate = value[key];
    if (typeof candidate === "string") return candidate;
    if (Array.isArray(candidate)) {
      const text = extractText(candidate);
      if (text) return text;
    }
  }
  return "";
}

function isReasoningPart(value: Record<string, unknown>): boolean {
  return (
    typeof value.type === "string" &&
    /(?:reasoning|thinking|analysis)/i.test(value.type)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractError(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string };
      message?: string;
    };
    return parsed.error?.message ?? parsed.message ?? body;
  } catch {
    return body.slice(0, 500);
  }
}
