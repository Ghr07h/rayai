import {
  Action,
  ActionPanel,
  Clipboard,
  Icon,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { useState } from "react";
import { ImageAttachmentForm } from "./components/ImageAttachmentForm";
import { ModelDropdown } from "./components/ModelDropdown";
import { SettingsRequired } from "./components/SettingsRequired";
import { useChatSession } from "./hooks/useChatSession";
import { markdownToPlainText, unwrapMarkdownFence } from "./lib/markdown";
import { getSelectedModel, isConfigured } from "./lib/settings";
import type { ChatMessage } from "./types";

export default function ChatCommand() {
  const [query, setQuery] = useState("");
  const session = useChatSession("chat");

  if (session.isLoading || !session.settings) return <List isLoading />;
  if (!isConfigured(session.settings)) {
    return <SettingsRequired onConfigured={session.applySettings} />;
  }

  const selectedModel = getSelectedModel(session.settings);
  const canSend = Boolean(query.trim() || session.attachments.length);

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
      setQuery("");
      await session.send(prompt);
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
      setQuery("");
      await session.send(prompt, true);
    } else {
      await session.reset();
    }
  }

  const commonActions = (message?: ChatMessage) => (
    <ActionPanel>
      {session.isStreaming ? (
        <Action title="终止当前回答" icon={Icon.Stop} onAction={session.stop} />
      ) : canSend ? (
        <Action
          title="发送消息"
          icon={Icon.ArrowRight}
          onAction={() => {
            const prompt = query;
            setQuery("");
            void session.send(prompt);
          }}
        />
      ) : message ? (
        <Action.CopyToClipboard
          title="复制渲染结果"
          content={markdownToPlainText(renderedContent(message))}
        />
      ) : null}
      {message ? (
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

  return (
    <List
      isLoading={session.isStreaming}
      isShowingDetail
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
      actions={commonActions()}
    >
      {session.messages.length ? (
        [...session.messages].reverse().map((message) => (
          <List.Item
            key={message.id}
            id={message.id}
            icon={message.role === "assistant" ? Icon.Stars : Icon.Person}
            title={
              message.role === "assistant" ? selectedModel?.name || "AI" : "你"
            }
            subtitle={summary(renderedContent(message))}
            accessories={
              message.images?.length
                ? [{ icon: Icon.Image, text: String(message.images.length) }]
                : undefined
            }
            detail={
              <List.Item.Detail
                markdown={renderedContent(message) || "正在生成…"}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label
                      title="角色"
                      text={message.role === "assistant" ? "AI" : "用户"}
                    />
                    <List.Item.Detail.Metadata.Label
                      title="时间"
                      text={new Date(message.createdAt).toLocaleTimeString()}
                    />
                    {message.images?.length ? (
                      <List.Item.Detail.Metadata.Label
                        title="图片"
                        text={`${message.images.length} 张`}
                      />
                    ) : null}
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={commonActions(message)}
          />
        ))
      ) : (
        <List.EmptyView
          icon={Icon.Message}
          title="开始一段新对话"
          description="在搜索栏输入消息并按回车。"
        />
      )}
    </List>
  );
}

function summary(content: string): string {
  const plain = markdownToPlainText(content).replace(/\s+/g, " ");
  return plain.length > 90 ? `${plain.slice(0, 90)}…` : plain || "正在生成…";
}

function renderedContent(message: ChatMessage): string {
  return message.role === "assistant"
    ? unwrapMarkdownFence(message.content)
    : message.content;
}
