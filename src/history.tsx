import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Icon,
  launchCommand,
  LaunchType,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import {
  activateHistoryContext,
  clearAllContexts,
  loadContextHistory,
} from "./lib/context";
import { loadSettings } from "./lib/settings";
import type { ChatHistoryItem, RayAISettings } from "./types";

const PREVIEW_LENGTH = 60;

export default function HistoryCommand() {
  const [items, setItems] = useState<ChatHistoryItem[]>([]);
  const [settings, setSettings] = useState<RayAISettings>();
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedSettings = await loadSettings();
      const history = await loadContextHistory(
        "chat",
        loadedSettings.contextTtlMinutes,
      );
      setSettings(loadedSettings);
      setItems(history);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "无法读取对话历史",
        message: messageOf(error),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function openConversation(item: ChatHistoryItem) {
    setIsLoading(true);
    try {
      const activated = await activateHistoryContext("chat", item.id);
      if (!activated) throw new Error("该对话已不存在");
      await launchCommand({ name: "ask", type: LaunchType.UserInitiated });
    } catch (error) {
      setIsLoading(false);
      await showToast({
        style: Toast.Style.Failure,
        title: "无法打开对话",
        message: messageOf(error),
      });
    }
  }

  async function clearHistory() {
    const confirmed = await confirmAlert({
      title: "清空全部历史会话？",
      message: "当前会话和所有归档会话都将被永久删除。",
      primaryAction: {
        title: "清空",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;

    setIsLoading(true);
    try {
      await clearAllContexts("chat");
      setItems([]);
      await showToast({
        style: Toast.Style.Success,
        title: "历史会话已清空",
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "无法清空历史会话",
        message: messageOf(error),
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <List
      isLoading={isLoading}
      navigationTitle="AI 对话历史"
      searchBarPlaceholder="搜索对话历史"
    >
      {items.length ? (
        items.map((item) => (
          <List.Item
            key={`${item.isCurrent ? "current" : "history"}-${item.id}`}
            icon={item.isCurrent ? Icon.Message : Icon.Clock}
            title={conversationPreview(item)}
            accessories={conversationAccessories(item, settings)}
            actions={
              <ActionPanel>
                <ActionPanel.Section>
                  <Action
                    title="进入对话"
                    icon={Icon.ArrowRight}
                    onAction={() => void openConversation(item)}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action
                    title="清空历史会话"
                    icon={Icon.Trash}
                    onAction={() => void clearHistory()}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        ))
      ) : (
        <List.EmptyView icon={Icon.Clock} title="暂无对话历史" />
      )}
    </List>
  );
}

function conversationPreview(item: ChatHistoryItem): string {
  const firstMessage =
    item.messages.find(
      (message) => message.role === "user" && message.content.trim(),
    ) ?? item.messages.find((message) => message.content.trim());
  const firstLine =
    firstMessage?.content
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? "无文字内容";
  const characters = Array.from(firstLine);
  return characters.length > PREVIEW_LENGTH
    ? `${characters.slice(0, PREVIEW_LENGTH).join("")}…`
    : firstLine;
}

function conversationAccessories(
  item: ChatHistoryItem,
  settings?: RayAISettings,
): List.Item.Accessory[] {
  const currentModelName = settings?.models.find(
    (model) => model.id === item.modelId,
  )?.name;
  const accessories: List.Item.Accessory[] = [];
  if (item.isCurrent) accessories.push({ tag: "当前" });
  accessories.push({
    text:
      item.modelName ??
      currentModelName ??
      item.modelId ??
      item.modelOverrideId ??
      "未知模型",
    tooltip: "使用的模型",
  });
  accessories.push({
    date: new Date(item.updatedAt),
    tooltip: "最后对话时间",
  });
  return accessories;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
