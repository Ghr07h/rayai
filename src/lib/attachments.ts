import { readFile, stat } from "node:fs/promises";
import { extname, basename } from "node:path";
import type { ImageAttachment } from "../types";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function loadImageAttachments(
  paths: string[],
): Promise<ImageAttachment[]> {
  return Promise.all(
    paths.map(async (filePath) => {
      const extension = extname(filePath).toLowerCase();
      const mimeType = MIME_TYPES[extension];
      if (!mimeType)
        throw new Error(`${basename(filePath)} 不是支持的图片格式`);

      const info = await stat(filePath);
      if (!info.isFile()) throw new Error(`${basename(filePath)} 不是文件`);
      if (info.size > MAX_IMAGE_BYTES)
        throw new Error(`${basename(filePath)} 超过 8 MB`);

      const data = await readFile(filePath);
      return {
        name: basename(filePath),
        mimeType,
        dataUrl: `data:${mimeType};base64,${data.toString("base64")}`,
      };
    }),
  );
}
