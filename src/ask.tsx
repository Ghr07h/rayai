import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  Icon,
  LaunchProps,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ImageAttachmentForm } from "./components/ImageAttachmentForm";
import { ModelDropdown } from "./components/ModelDropdown";
import { SettingsRequired } from "./components/SettingsRequired";
import { type LiveAnswerStore, useChatSession } from "./hooks/useChatSession";
import { markdownToPlainText, unwrapMarkdownFence } from "./lib/markdown";
import { getSelectedModel, isConfigured } from "./lib/settings";
import type { ChatMessage } from "./types";

export default function AskCommand(props: LaunchProps) {
  const [query, setQuery] = useState("");
  const initialPromptSent = useRef(false);
  const session = useChatSession("chat");
  const { push } = useNavigation();

  useEffect(() => {
    const initialPrompt = props.fallbackText?.trim();
    if (
      !initialPromptSent.current &&
      !session.isLoading &&
      session.settings &&
      initialPrompt
    ) {
      initialPromptSent.current = true;
      sendAndOpenAnswer(initialPrompt);
    }
  }, [props.fallbackText, session]);

  if (session.isLoading || !session.settings) {
    return (
      <List
        isLoading
        filtering={false}
        searchText={query}
        onSearchTextChange={setQuery}
      />
    );
  }
  if (!isConfigured(session.settings)) {
    return <SettingsRequired onConfigured={session.applySettings} />;
  }

  const selectedModel = getSelectedModel(session.settings);
  const canSend = Boolean(query.trim() || session.attachments.length);

  function sendAndOpenAnswer(prompt: string, newSession = false) {
    setQuery("");
    const request = session.send(prompt, newSession);
    push(
      <LiveAnswerDetail
        store={session.liveAnswerStore}
        onStop={session.stop}
      />,
    );
    void request;
  }

  async function sendFromClipboard() {
    try {
      const clipboard = (await Clipboard.readText()) ?? "";
      if (!clipboard.trim()) {
        await showToast({
          style: Toast.Style.Failure,
          title: "剪贴板中没有文本",
        });
        return;
      }
      const prompt = [query.trim(), clipboard.trim()]
        .filter(Boolean)
        .join("\n\n");
      sendAndOpenAnswer(prompt);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "无法读取剪贴板",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function startNewSession() {
    if (canSend) {
      const prompt = query;
      sendAndOpenAnswer(prompt, true);
    } else {
      await session.reset();
    }
  }

  const actions = (message?: ChatMessage) => {
    const rendered = message ? renderedContent(message) : "";
    return (
      <ActionPanel>
        {session.isStreaming ? (
          <Action
            title="终止当前回答"
            icon={Icon.Stop}
            onAction={session.stop}
          />
        ) : canSend ? (
          <Action
            title="发送消息"
            icon={Icon.ArrowRight}
            onAction={() => {
              const prompt = query;
              sendAndOpenAnswer(prompt);
            }}
          />
        ) : message?.role === "assistant" ? (
          <Action.Push
            title="查看完整回答"
            icon={Icon.Eye}
            target={<AnswerDetail content={message.content} />}
          />
        ) : message ? (
          <Action.CopyToClipboard title="复制消息" content={message.content} />
        ) : null}
        {message?.role === "assistant" ? (
          <Action.CopyToClipboard
            title="复制渲染结果"
            content={markdownToPlainText(rendered)}
          />
        ) : null}
        {message?.role === "assistant" ? (
          <Action.CopyToClipboard
            title="复制 Markdown 原文"
            content={message.content}
          />
        ) : null}
        {!session.isStreaming ? (
          <Action
            title="拼接剪贴板并发送"
            icon={Icon.Clipboard}
            onAction={() => void sendFromClipboard()}
          />
        ) : null}
        {selectedModel?.multimodal && !session.isStreaming ? (
          <Action.Push
            title="上传图片"
            icon={Icon.Image}
            target={
              <ImageAttachmentForm
                onAttach={(images) =>
                  session.setAttachments((current) => [...current, ...images])
                }
              />
            }
          />
        ) : null}
        {!session.isStreaming ? (
          <Action
            title={canSend ? "清空对话并发送" : "清空对话"}
            icon={Icon.Trash}
            onAction={() => void startNewSession()}
          />
        ) : null}
        {session.attachments.length ? (
          <Action
            title={`移除 ${session.attachments.length} 张待发送图片`}
            icon={Icon.XMarkCircle}
            onAction={() => session.setAttachments([])}
          />
        ) : null}
      </ActionPanel>
    );
  };

  return (
    <List
      isLoading={session.isStreaming}
      filtering={false}
      searchText={query}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="输入消息并按回车发送"
      searchBarAccessory={
        <ModelDropdown
          models={session.settings.models}
          value={session.settings.selectedModel}
          onChange={session.selectModel}
        />
      }
      actions={actions()}
    >
      {session.messages.length ? (
        [...session.messages]
          .reverse()
          .map((message) => (
            <List.Item
              key={message.id}
              id={message.id}
              icon={message.role === "assistant" ? Icon.Stars : Icon.Person}
              title={
                message.role === "assistant"
                  ? selectedModel?.name || "AI"
                  : "你"
              }
              subtitle={summary(
                renderedContent(message),
                session.isStreaming &&
                  message.id === session.messages.at(-1)?.id,
              )}
              accessories={messageAccessories(
                message,
                session.isStreaming,
                session.messages.at(-1)?.id,
              )}
              actions={actions(message)}
            />
          ))
      ) : (
        <List.EmptyView
          icon={Icon.Message}
          title="开始一段新对话"
          description="在输入框中输入消息并按回车。"
        />
      )}
    </List>
  );
}

function AnswerDetail({
  content,
  isLoading = false,
  onStop,
}: {
  content: string;
  isLoading?: boolean;
  onStop?: () => void;
}) {
  const { pop } = useNavigation();
  const rendered = unwrapMarkdownFence(content);
  return (
    <Detail
      navigationTitle="AI 回答"
      isLoading={isLoading}
      markdown={rendered || (isLoading ? "正在等待回答…" : "未收到回答。")}
      actions={
        <ActionPanel>
          {isLoading && onStop ? (
            <Action title="终止当前回答" icon={Icon.Stop} onAction={onStop} />
          ) : (
            <Action title="返回对话列表" icon={Icon.ArrowLeft} onAction={pop} />
          )}
          {content ? (
            <Action.CopyToClipboard
              title="复制渲染结果"
              content={markdownToPlainText(rendered)}
            />
          ) : null}
          {content ? (
            <Action.CopyToClipboard
              title="复制 Markdown 原文"
              content={content}
            />
          ) : null}
          {isLoading ? (
            <Action
              title="返回对话列表"
              icon={Icon.ArrowLeft}
              shortcut={{
                macOS: { modifiers: ["cmd"], key: "[" },
                Windows: { modifiers: ["alt"], key: "arrowLeft" },
              }}
              onAction={pop}
            />
          ) : null}
        </ActionPanel>
      }
    />
  );
}

function LiveAnswerDetail({
  store,
  onStop,
}: {
  store: LiveAnswerStore;
  onStop: () => void;
}) {
  const answer = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <AnswerDetail
      content={answer.content}
      isLoading={answer.isStreaming}
      onStop={onStop}
    />
  );
}

function renderedContent(message: ChatMessage): string {
  return message.role === "assistant"
    ? unwrapMarkdownFence(message.content)
    : message.content;
}

function summary(content: string, showLatest = false): string {
  const plain = markdownToPlainText(content).replace(/\s+/g, " ");
  if (plain.length <= 120) return plain || "正在生成…";
  return showLatest ? `…${plain.slice(-120)}` : `${plain.slice(0, 120)}…`;
}

function messageAccessories(
  message: ChatMessage,
  isStreaming: boolean,
  lastMessageId?: string,
) {
  const accessories: List.Item.Accessory[] = [];
  if (message.images?.length)
    accessories.push({ icon: Icon.Image, text: String(message.images.length) });
  if (isStreaming && message.id === lastMessageId)
    accessories.push({ text: "正在生成…" });
  else
    accessories.push({
      date: new Date(message.createdAt),
      tooltip: "发送时间",
    });
  return accessories;
}
