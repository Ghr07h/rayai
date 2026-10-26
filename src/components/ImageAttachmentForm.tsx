import {
  Action,
  ActionPanel,
  Form,
  Icon,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useState } from "react";
import { loadImageAttachments } from "../lib/attachments";
import type { ImageAttachment } from "../types";

interface Props {
  onAttach: (images: ImageAttachment[]) => void;
}

export function ImageAttachmentForm({ onAttach }: Props) {
  const [files, setFiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { pop } = useNavigation();

  async function submit() {
    if (!files.length) {
      await showToast({
        style: Toast.Style.Failure,
        title: "请至少选择一张图片",
      });
      return;
    }

    setIsLoading(true);
    try {
      const images = await loadImageAttachments(files);
      onAttach(images);
      await showToast({
        style: Toast.Style.Success,
        title: `已添加 ${images.length} 张图片`,
      });
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "无法添加图片",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="添加图片"
            icon={Icon.Plus}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="images"
        title="图片"
        value={files}
        onChange={setFiles}
        allowMultipleSelection
        canChooseDirectories={false}
        canChooseFiles
      />
      <Form.Description text="支持 PNG、JPEG、GIF 和 WebP；每张图片最大 8 MB。" />
    </Form>
  );
}
