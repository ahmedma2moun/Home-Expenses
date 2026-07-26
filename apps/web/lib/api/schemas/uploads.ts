import { z } from "zod";

// BR-1: camera/scanner/photo-library output, HEIC converted client-side before this point.
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image after client-side compression
const MAX_FILES = 10;

export const UploadFileSchema = z.object({
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  bytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
});

export const UploadTokenRequestSchema = z.object({
  files: z.array(UploadFileSchema).min(1).max(MAX_FILES),
});
export type UploadTokenRequest = z.infer<typeof UploadTokenRequestSchema>;
