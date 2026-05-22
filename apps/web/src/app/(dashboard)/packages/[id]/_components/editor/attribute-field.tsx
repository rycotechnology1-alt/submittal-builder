'use client';

import { AlertTriangle, ExternalLink, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import { ATTRIBUTE_LABELS } from './doc-types';
import { attributeNeedsReview } from './item-helpers';
import type { PackageItemResponse } from '@submittal/shared/api';

type Attribute = PackageItemResponse['attributes'][number];

export function AttributeField({
  attribute,
  disabled,
  onSave,
  onRevert,
  onOpenCitation,
}: {
  attribute: Attribute;
  disabled?: boolean;
  onSave: (value: string | null) => void;
  onRevert: () => void;
  onOpenCitation: () => void;
}) {
  const [draft, setDraft] = useState(attribute.current_value ?? '');

  useEffect(() => {
    setDraft(attribute.current_value ?? '');
  }, [attribute.current_value]);

  const isDescription = attribute.key === 'description';
  const needsReview = attributeNeedsReview(attribute);
  const canRevert =
    attribute.original_ai_value != null &&
    attribute.current_value !== attribute.original_ai_value;

  function commit() {
    const trimmed = draft.trim();
    const nextValue = trimmed === '' ? null : trimmed;
    if (nextValue === attribute.current_value) return;
    onSave(nextValue);
  }

  const InputEl = isDescription ? 'textarea' : 'input';
  const inputClass =
    'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3">
      <label className="pt-2 text-sm font-medium text-muted-foreground">
        {ATTRIBUTE_LABELS[attribute.key]}
      </label>
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <InputEl
              value={draft}
              disabled={disabled}
              rows={isDescription ? 3 : undefined}
              onChange={(e) =>
                setDraft((e.target as HTMLInputElement | HTMLTextAreaElement).value)
              }
              onBlur={commit}
              onKeyDown={(e) => {
                if (!isDescription && e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
                if (e.key === 'Escape') {
                  setDraft(attribute.current_value ?? '');
                  (e.target as HTMLElement).blur();
                }
              }}
              className={inputClass}
              placeholder="—"
            />
          </div>
          <div className="flex items-center gap-1 pt-2">
            {needsReview ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                <AlertTriangle className="h-3 w-3" />
                low
              </span>
            ) : null}
            {attribute.source_page_id ? (
              <button
                type="button"
                onClick={onOpenCitation}
                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Open citation"
              >
                Source
                <ExternalLink className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        </div>
        {canRevert && attribute.original_ai_value ? (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">
              ↳ AI suggested &ldquo;{attribute.original_ai_value}&rdquo;
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={onRevert}
              disabled={disabled}
            >
              <Undo2 className="h-3 w-3" />
              Revert
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
