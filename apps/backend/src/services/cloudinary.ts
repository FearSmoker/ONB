import { v2 as cloudinary } from "cloudinary";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.js";

if (config.cloudinary.enabled) {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret
  });
}

// local disk fallback directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

async function ensureUploadsDir() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

function localPublicId(filename: string): string {
  return `local_${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

export async function uploadAttachment(
  buffer: Buffer,
  filename: string
): Promise<{ url: string; publicId: string; bytes: number }> {
  if (config.cloudinary.enabled) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: "auto",
          folder: "onb-mail-attachments",
          public_id: `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
          overwrite: false
        },
        (error: unknown, result: { secure_url: string; public_id: string; bytes: number } | undefined) => {
          if (error || !result) return reject(error ?? new Error("Upload failed"));
          resolve({ url: result.secure_url, publicId: result.public_id, bytes: result.bytes });
        }
      );
      stream.end(buffer);
    });
  }

  // fallback to local disk
  await ensureUploadsDir();
  const publicId = localPublicId(filename);
  const filePath = path.join(UPLOADS_DIR, publicId);
  await fs.writeFile(filePath, buffer);
  const url = `${config.apiBaseUrl}/uploads/${publicId}`;
  return { url, publicId, bytes: buffer.length };
}

export async function deleteAttachment(publicId: string): Promise<void> {
  if (config.cloudinary.enabled) {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
    } catch {
      await cloudinary.uploader.destroy(publicId, { resource_type: "image" }).catch(() => {});
    }
    return;
  }

  if (publicId.startsWith("local_")) {
    const filePath = path.join(UPLOADS_DIR, publicId);
    await fs.unlink(filePath).catch(() => {});
  }
}
