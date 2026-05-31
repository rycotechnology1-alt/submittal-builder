import { describe, expect, test, vi } from 'vitest';

import {
  MAX_UPLOAD_BATCH_FILES,
  MAX_UPLOAD_FILE_BYTES,
  partitionUploadBatch,
  putFileWithProgress,
} from '@/lib/upload';
import {
  getPackageStatusPollingInterval,
  isCancelableProcessingStatus,
  isTerminalProcessingStatus,
} from '@/app/(dashboard)/packages/[id]/_components/processing-status';
import type { PackageStatusResponse } from '@submittal/shared/api';

function pdfFile(name = 'sample.pdf', size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' });
}

describe('partitionUploadBatch', () => {
  test('accepts pdfs and keeps invalid files as row-level errors', () => {
    const files = [
      pdfFile('valid.pdf'),
      new File(['not a pdf'], 'notes.txt', { type: 'text/plain' }),
      pdfFile('too-large.pdf', MAX_UPLOAD_FILE_BYTES + 1),
    ];

    const rows = partitionUploadBatch(files);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ status: 'queued', file: files[0] });
    expect(rows[1]).toMatchObject({
      status: 'error',
      file: files[1],
      error: 'Only PDF files can be uploaded.',
    });
    expect(rows[2]).toMatchObject({
      status: 'error',
      file: files[2],
      error: 'Files must be 50 MB or smaller.',
    });
  });

  test('marks files beyond the 20-file batch limit as row-level errors', () => {
    const rows = partitionUploadBatch(
      Array.from({ length: MAX_UPLOAD_BATCH_FILES + 1 }, (_, i) => pdfFile(`${i}.pdf`)),
    );

    expect(rows.filter((row) => row.status === 'queued')).toHaveLength(MAX_UPLOAD_BATCH_FILES);
    expect(rows[MAX_UPLOAD_BATCH_FILES]).toMatchObject({
      status: 'error',
      error: 'Upload up to 20 files at a time.',
    });
  });
});

describe('putFileWithProgress', () => {
  test('sends required headers and reports upload progress', async () => {
    const progress = vi.fn();
    const sentHeaders: Record<string, string> = {};
    const send = vi.fn();

    class FakeXHR {
      upload = {} as XMLHttpRequestUpload;
      status = 204;
      responseText = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      open(method: string, url: string) {
        expect(method).toBe('PUT');
        expect(url).toBe('https://uploads.example.com/file.pdf');
      }

      setRequestHeader(key: string, value: string) {
        sentHeaders[key] = value;
      }

      send(file: File) {
        send(file);
        const onprogress = this.upload.onprogress as
          | ((event: ProgressEvent) => void)
          | null;
        onprogress?.({ lengthComputable: true, loaded: 512, total: 1024 } as ProgressEvent);
        this.onload?.();
      }
    }

    vi.stubGlobal('XMLHttpRequest', FakeXHR);

    await putFileWithProgress({
      file: pdfFile(),
      uploadUrl: 'https://uploads.example.com/file.pdf',
      requiredHeaders: {
        'content-type': 'application/pdf',
        'x-amz-server-side-encryption': 'AES256',
      },
      onProgress: progress,
    });

    expect(sentHeaders).toEqual({
      'content-type': 'application/pdf',
      'x-amz-server-side-encryption': 'AES256',
    });
    expect(send).toHaveBeenCalledWith(expect.any(File));
    expect(progress).toHaveBeenCalledWith(50);
  });

  test('reports the page origin when the browser blocks the storage request', async () => {
    class FakeXHR {
      upload = {} as XMLHttpRequestUpload;
      status = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      open() {}
      setRequestHeader() {}
      send() {
        this.onerror?.();
      }
    }

    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    vi.stubGlobal('location', { origin: 'http://localhost:3100' });

    await expect(
      putFileWithProgress({
        file: pdfFile(),
        uploadUrl: 'https://uploads.example.com/file.pdf',
        requiredHeaders: { 'content-type': 'application/pdf' },
      }),
    ).rejects.toThrow(
      'Upload was blocked before reaching storage from http://localhost:3100 to https://uploads.example.com.',
    );
  });
});

describe('package processing status helpers', () => {
  const baseStatus = {
    status: 'processing',
    jobs_summary: { queued: 0, running: 0, failed: 0 },
    processing_state: 'active',
    has_active_processing: true,
    has_errors: false,
    can_cancel: true,
    terminal_counts: { extracted: 0, error: 0, cancelled: 0 },
  } satisfies Omit<PackageStatusResponse, 'source_pdfs'>;

  test('continues polling when one source PDF errors while another is active', () => {
    const status: PackageStatusResponse = {
      ...baseStatus,
      has_errors: true,
      source_pdfs: [
        { id: crypto.randomUUID(), processing_status: 'error', processing_error: 'S3 denied', original_filename: 'a.pdf', byte_size: null, page_count: null },
        { id: crypto.randomUUID(), processing_status: 'classifying', processing_error: null, original_filename: 'b.pdf', byte_size: null, page_count: null },
      ],
    };

    expect(getPackageStatusPollingInterval(status, true)).toBe(2000);
  });

  test('stops polling once every source PDF is terminal', () => {
    const status: PackageStatusResponse = {
      ...baseStatus,
      processing_state: 'blocked',
      has_active_processing: false,
      has_errors: true,
      can_cancel: false,
      terminal_counts: { extracted: 1, error: 1, cancelled: 0 },
      source_pdfs: [
        { id: crypto.randomUUID(), processing_status: 'extracted', processing_error: null, original_filename: 'a.pdf', byte_size: null, page_count: null },
        { id: crypto.randomUUID(), processing_status: 'error', processing_error: 'S3 denied', original_filename: 'a.pdf', byte_size: null, page_count: null },
      ],
    };

    expect(getPackageStatusPollingInterval(status, true)).toBe(false);
  });

  test('treats extracted, error, and cancelled as terminal statuses', () => {
    expect(isTerminalProcessingStatus('extracted')).toBe(true);
    expect(isTerminalProcessingStatus('error')).toBe(true);
    expect(isTerminalProcessingStatus('cancelled')).toBe(true);
    expect(isTerminalProcessingStatus('extracting')).toBe(false);
  });

  test('allows row-level cancellation only for active processing statuses', () => {
    expect(isCancelableProcessingStatus('ocr_running')).toBe(true);
    expect(isCancelableProcessingStatus('classifying')).toBe(true);
    expect(isCancelableProcessingStatus('extracting')).toBe(true);
    expect(isCancelableProcessingStatus('extracted')).toBe(false);
    expect(isCancelableProcessingStatus('error')).toBe(false);
    expect(isCancelableProcessingStatus('cancelled')).toBe(false);
  });
});
