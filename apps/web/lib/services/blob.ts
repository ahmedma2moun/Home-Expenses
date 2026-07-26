import { randomUUID } from "node:crypto";
import { issueSignedToken, presignUrl, get } from "@vercel/blob";
import { AppError } from "@/lib/api/envelope";
import type { UploadTokenRequest } from "@/lib/api/schemas/uploads";

const UPLOAD_URL_TTL_MS = 15 * 60 * 1000; // 15 min — long enough for a slow mobile upload
const READ_URL_TTL_MS = 15 * 60 * 1000;

export interface UploadTarget {
  blobKey: string;
  uploadUrl: string;
  expiresAt: string;
}

/**
 * Images are uploaded directly from the iOS client to blob storage (PROJECT_SPEC.md §2) — the
 * backend only ever issues a short-lived signed PUT URL per file and receives the resulting key.
 */
export async function createUploadTargets(
  userId: string,
  input: UploadTokenRequest,
): Promise<UploadTarget[]> {
  return Promise.all(
    input.files.map(async (file) => {
      const blobKey = `receipts/${userId}/${randomUUID()}`;
      const validUntil = Date.now() + UPLOAD_URL_TTL_MS;

      const signed = await issueSignedToken({
        pathname: blobKey,
        operations: ["put"],
        validUntil,
        allowedContentTypes: [file.mimeType],
        maximumSizeInBytes: file.bytes,
      });

      const { presignedUrl } = await presignUrl(signed, {
        operation: "put",
        pathname: blobKey,
        access: "private",
      });

      return { blobKey, uploadUrl: presignedUrl, expiresAt: new Date(validUntil).toISOString() };
    }),
  );
}

/** Blob reads go through short-lived signed URLs generated per request — blobs are private (§8). */
export async function getReadUrl(blobKey: string): Promise<string> {
  const validUntil = Date.now() + READ_URL_TTL_MS;
  const signed = await issueSignedToken({
    pathname: blobKey,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(signed, {
    operation: "get",
    pathname: blobKey,
    access: "private",
  });
  return presignedUrl;
}

/** Server-side read for the extraction call — the server holds the store's RW token directly. */
export async function fetchBlobBase64(blobKey: string): Promise<string> {
  const result = await get(blobKey, { access: "private" });
  if (result?.statusCode !== 200) {
    throw new AppError("NOT_FOUND", `Blob "${blobKey}" not found.`, 404);
  }
  const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
  return buffer.toString("base64");
}
