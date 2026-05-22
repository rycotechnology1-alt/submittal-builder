export const MAX_UPLOAD_BATCH_FILES = 20;
export const MAX_UPLOAD_FILE_BYTES = 50 * 1024 * 1024;

export type UploadBatchRow =
  | {
      id: string;
      status: 'queued';
      file: File;
      error?: never;
    }
  | {
      id: string;
      status: 'error';
      file: File;
      error: string;
    };

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function partitionUploadBatch(files: readonly File[]): UploadBatchRow[] {
  return files.map((file, index) => {
    const base = {
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      file,
    };

    if (index >= MAX_UPLOAD_BATCH_FILES) {
      return { ...base, status: 'error', error: 'Upload up to 20 files at a time.' };
    }
    if (!isPdfFile(file)) {
      return { ...base, status: 'error', error: 'Only PDF files can be uploaded.' };
    }
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      return { ...base, status: 'error', error: 'Files must be 50 MB or smaller.' };
    }
    if (file.size <= 0) {
      return { ...base, status: 'error', error: 'Files must not be empty.' };
    }

    return { ...base, status: 'queued' };
  });
}

export async function putFileWithProgress({
  file,
  uploadUrl,
  requiredHeaders,
  onProgress,
}: {
  file: File;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);

    for (const [key, value] of Object.entries(requiredHeaders)) {
      xhr.setRequestHeader(key, value);
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      const percent = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)));
      onProgress(percent);
    };

    xhr.onerror = () => {
      reject(new Error(blockedUploadMessage(uploadUrl)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      reject(new Error(`Upload failed with status ${xhr.status}.`));
    };

    xhr.send(file);
  });
}

function blockedUploadMessage(uploadUrl: string): string {
  const pageOrigin =
    typeof location !== 'undefined' && location.origin ? location.origin : 'this app origin';
  let storageOrigin = 'storage';
  try {
    storageOrigin = new URL(uploadUrl).origin;
  } catch {
    // Keep the generic storage label if the URL is not parseable.
  }
  return `Upload was blocked before reaching storage from ${pageOrigin} to ${storageOrigin}. Check the bucket CORS AllowedOrigins for this dev URL.`;
}
