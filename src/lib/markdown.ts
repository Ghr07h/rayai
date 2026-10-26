export function markdownToPlainText(markdown: string): string {
  return unwrapMarkdownFence(markdown)
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-+*]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function unwrapMarkdownFence(markdown: string): string {
  const opening = markdown.match(
    /^\s*(`{3,}|~{3,})[ \t]*(?:markdown|md)[ \t]*(?:\r?\n|$)/i,
  );
  if (!opening) return markdown;

  const fence = opening[1];
  const marker = escapeRegExp(fence[0]);
  const fenceLine = new RegExp(`^[ \\t]*${marker}{${fence.length},}`);
  const fenceCount = markdown
    .split(/\r?\n/)
    .filter((line) => fenceLine.test(line)).length;
  let content = markdown.slice(opening[0].length);

  // An odd count means streaming has only reached an inner closing fence.
  if (fenceCount % 2 === 0) {
    const closing = new RegExp(
      `(?:\\r?\\n)?[ \\t]*${marker}{${fence.length},}[ \\t]*$`,
    );
    content = content.replace(closing, "");
  }

  return content;
}

export function formatAssistantMarkdown(
  reasoning: string,
  content: string,
): string {
  const normalized = normalizeAssistantResponse(reasoning, content);
  if (!normalized.reasoning) return normalized.content;
  const answer = unwrapMarkdownFence(normalized.content);

  const quote = normalized.reasoning
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return answer ? `${quote}\n\n${answer}` : quote;
}

export function normalizeAssistantResponse(
  reasoning: string,
  content: string,
): { reasoning: string; content: string } {
  const embedded = extractLeadingThinkBlock(content);
  const combinedReasoning = [reasoning, embedded.reasoning]
    .filter(Boolean)
    .join("\n")
    .replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, "");
  return { reasoning: combinedReasoning, content: embedded.content };
}

function extractLeadingThinkBlock(content: string): {
  reasoning: string;
  content: string;
} {
  const opening = content.match(/^\s*<think>/i);
  if (!opening) return { reasoning: "", content };

  const afterOpening = content.slice(opening[0].length);
  const closing = /<\/think>/i.exec(afterOpening);
  if (!closing) return { reasoning: afterOpening, content: "" };

  const answer = afterOpening
    .slice(closing.index + closing[0].length)
    .replace(/^\r?\n/, "");
  return {
    reasoning: afterOpening.slice(0, closing.index),
    content: answer,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
