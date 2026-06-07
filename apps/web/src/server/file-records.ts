import { createHash, randomUUID } from 'node:crypto';

export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sourcePdfStorageKey(workspaceId: string, sourcePdfId: string): string {
  return `workspaces/${workspaceId}/source_pdfs/${sourcePdfId}.pdf`;
}

export function savedItemFileStorageKey(workspaceId: string, savedItemFileId: string): string {
  return `workspaces/${workspaceId}/saved_item_files/${savedItemFileId}.pdf`;
}

export function pagePreviewStorageKey(workspaceId: string, sourcePageId: string): string {
  return `workspaces/${workspaceId}/page_previews/${sourcePageId}.webp`;
}

export function logoStorageKey(workspaceId: string, filename: string): string {
  return `workspaces/${workspaceId}/logos/${randomUUID()}-${safeFilename(filename)}`;
}

export function isWorkspaceStorageKey(workspaceId: string, key: string): boolean {
  return key.startsWith(`workspaces/${workspaceId}/`);
}

function safeFilename(filename: string): string {
  const safe = filename
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-');
  return safe && safe.length > 0 ? safe : 'upload';
}
