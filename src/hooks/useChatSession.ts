import { showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  archiveCurrentContext,
  loadContext,
  saveContext,
  updateContextModelOverride,
} from "../lib/context";
import { streamChat } from "../lib/openai";
import { getSelectedModel, loadSettings } from "../lib/settings";
import type {
  ChatMessage,
  ContextKind,
  ImageAttachment,
  RayAISettings,
} from "../types";

export interface LiveAnswerSnapshot {
  content: string;
  isStreaming: boolean;
}

export interface LiveAnswerStore {
  getSnapshot: () => LiveAnswerSnapshot;
  subscribe: (listener: () => void) => () => void;
}

interface MutableLiveAnswerStore extends LiveAnswerStore {
  update: (snapshot: LiveAnswerSnapshot) => void;
}

export function useChatSession(kind: ContextKind) {
  const [settings, setSettings] = useState<RayAISettings>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveAnswerStore] = useState(createLiveAnswerStore);
  const abortController = useRef<AbortController | undefined>(undefined);
  const messagesRef = useRef<ChatMessage[]>([]);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const sessionActiveAtRef = useRef<number | undefined>(undefined);
  const defaultModelIdRef = useRef("");
  const modelOverrideIdRef = useRef<string | undefined>(undefined);

  const replaceMessages = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  useEffect(() => {
    let active = true;
    void loadSettings().then(async (loadedSettings) => {
      const storedContext = await loadContext(
        kind,
        loadedSettings.contextTtlMinutes,
      );
      if (!active) return;
      defaultModelIdRef.current = loadedSettings.selectedModel;
      const modelOverrideId = storedContext?.modelOverrideId;
      const hasConfiguredOverride = loadedSettings.models.some(
        (model) => model.id === modelOverrideId,
      );
      modelOverrideIdRef.current = hasConfiguredOverride
        ? modelOverrideId
        : undefined;
      setSettings(
        hasConfiguredOverride
          ? { ...loadedSettings, selectedModel: modelOverrideId ?? "" }
          : loadedSettings,
      );
      sessionIdRef.current = storedContext?.id;
      sessionActiveAtRef.current = storedContext?.activeAt;
      replaceMessages(storedContext?.messages ?? []);
      setIsLoading(false);
    });
    return () => {
      active = false;
      abortController.current?.abort();
    };
  }, [kind, replaceMessages]);

  const send = useCallback(
    async (input: string, newSession = false) => {
      if (isStreaming || abortController.current || !settings) return;
      liveAnswerStore.update({ content: "", isStreaming: true });
      setIsStreaming(true);
      const controller = new AbortController();
      abortController.current = controller;

      const prompt =
        input.trim() || (attachments.length ? "请描述这些图片。" : "");
      if (!prompt) {
        abortController.current = undefined;
        setIsStreaming(false);
        liveAnswerStore.update({ content: "", isStreaming: false });
        return;
      }

      const expiresAfter = settings.contextTtlMinutes * 60_000;
      const contextExpired =
        sessionActiveAtRef.current !== undefined &&
        Date.now() - sessionActiveAtRef.current > expiresAfter;
      const startsNewSession = newSession || contextExpired;
      let sessionSettings = settings;
      if (startsNewSession) {
        if (sessionIdRef.current) await archiveCurrentContext(kind);
        sessionIdRef.current = undefined;
        sessionActiveAtRef.current = undefined;
        modelOverrideIdRef.current = undefined;
        const defaultModelId = defaultModelIdRef.current;
        if (sessionSettings.selectedModel !== defaultModelId) {
          sessionSettings = {
            ...sessionSettings,
            selectedModel: defaultModelId,
          };
          setSettings(sessionSettings);
        }
      }

      const model = getSelectedModel(sessionSettings);
      if (!sessionSettings.baseUrl || !model) {
        abortController.current = undefined;
        setIsStreaming(false);
        liveAnswerStore.update({ content: "", isStreaming: false });
        await showToast({
          style: Toast.Style.Failure,
          title: "请先完成 RayAI 配置",
        });
        return;
      }

      if (attachments.length && !model.multimodal) {
        abortController.current = undefined;
        setIsStreaming(false);
        liveAnswerStore.update({ content: "", isStreaming: false });
        await showToast({
          style: Toast.Style.Failure,
          title: "当前模型不支持图片",
        });
        return;
      }

      const baseMessages = startsNewSession ? [] : messagesRef.current;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt,
        images: attachments.length ? attachments : undefined,
        createdAt: Date.now(),
      };
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      };

      let currentMessages = [...baseMessages, userMessage, assistantMessage];
      let assistantContent = "";
      let renderTimer: ReturnType<typeof setTimeout> | undefined;
      const persist = async () => {
        const savedContext = await saveContext(kind, currentMessages, {
          sessionId: sessionIdRef.current,
          modelId: model.id,
          modelName: model.name,
          modelOverrideId: modelOverrideIdRef.current,
        });
        sessionIdRef.current = savedContext.id;
        sessionActiveAtRef.current = savedContext.activeAt;
      };
      const flushRender = () => {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = undefined;
        currentMessages = currentMessages.map((message) =>
          message.id === assistantMessage.id
            ? { ...message, content: assistantContent }
            : message,
        );
        replaceMessages(currentMessages);
        liveAnswerStore.update({
          content: assistantContent,
          isStreaming: true,
        });
      };
      replaceMessages(currentMessages);
      setAttachments([]);

      try {
        await streamChat({
          settings: sessionSettings,
          messages: [...baseMessages, userMessage],
          signal: controller.signal,
          onDelta: (chunk) => {
            assistantContent += chunk;
            if (!renderTimer) renderTimer = setTimeout(flushRender, 150);
          },
        });
        flushRender();
        await persist();
      } catch (error) {
        flushRender();
        const aborted = error instanceof Error && error.name === "AbortError";
        const hasPartialAnswer = currentMessages.some(
          (message) =>
            message.id === assistantMessage.id && Boolean(message.content),
        );
        if (!hasPartialAnswer) {
          currentMessages = currentMessages.filter(
            (message) => message.id !== assistantMessage.id,
          );
          replaceMessages(currentMessages);
        }
        await persist();
        await showToast({
          style: aborted ? Toast.Style.Success : Toast.Style.Failure,
          title: aborted ? "已终止当前回答" : "请求失败",
          message: aborted
            ? undefined
            : error instanceof Error
              ? error.message
              : String(error),
        });
      } finally {
        if (renderTimer) clearTimeout(renderTimer);
        abortController.current = undefined;
        setIsStreaming(false);
        liveAnswerStore.update({
          content: assistantContent,
          isStreaming: false,
        });
      }
    },
    [
      attachments,
      isStreaming,
      kind,
      liveAnswerStore,
      replaceMessages,
      settings,
    ],
  );

  const reset = useCallback(async () => {
    abortController.current?.abort();
    await archiveCurrentContext(kind);
    sessionIdRef.current = undefined;
    sessionActiveAtRef.current = undefined;
    modelOverrideIdRef.current = undefined;
    replaceMessages([]);
    setAttachments([]);
    setSettings((current) =>
      current
        ? { ...current, selectedModel: defaultModelIdRef.current }
        : current,
    );
    liveAnswerStore.update({ content: "", isStreaming: false });
    await showToast({ style: Toast.Style.Success, title: "当前对话已归档" });
  }, [kind, liveAnswerStore, replaceMessages]);

  const stop = useCallback(() => abortController.current?.abort(), []);

  const selectModel = useCallback(
    async (modelId: string) => {
      if (!settings) return;
      const next = { ...settings, selectedModel: modelId };
      setSettings(next);
      if (!next.models.find((model) => model.id === modelId)?.multimodal)
        setAttachments([]);
      const modelOverrideId =
        modelId === defaultModelIdRef.current ? undefined : modelId;
      modelOverrideIdRef.current = modelOverrideId;
      if (sessionIdRef.current) {
        const updated = await updateContextModelOverride(kind, modelOverrideId);
        sessionActiveAtRef.current = updated?.activeAt;
      }
    },
    [kind, settings],
  );

  const applySettings = useCallback((next: RayAISettings) => {
    defaultModelIdRef.current = next.selectedModel;
    modelOverrideIdRef.current = undefined;
    setSettings(next);
  }, []);

  return {
    settings,
    messages,
    attachments,
    setAttachments,
    isLoading,
    isStreaming,
    liveAnswerStore,
    send,
    reset,
    stop,
    selectModel,
    applySettings,
  };
}

function createLiveAnswerStore(): MutableLiveAnswerStore {
  let snapshot: LiveAnswerSnapshot = { content: "", isStreaming: false };
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (next) => {
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
}
