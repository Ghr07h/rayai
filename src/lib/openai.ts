import type { ChatMessage, RayAISettings } from "../types";

interface StreamChatOptions {
  settings: RayAISettings;
  messages: ChatMessage[];
  signal: AbortSignal;
  onDelta: (chunk: string) => void;
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string | Array<{ text?: string }> };
    message?: { content?: string };
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
    const content = data.choices?.[0]?.message?.content;
    if (content) onDelta(content);
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

function parseSseLine(line: string, onDelta: (chunk: string) => void): boolean {
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
  const content = data.choices?.[0]?.delta?.content;
  if (typeof content === "string") onDelta(content);
  else if (Array.isArray(content))
    onDelta(content.map((part) => part.text ?? "").join(""));
  return false;
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
