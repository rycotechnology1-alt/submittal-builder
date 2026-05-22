'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  GripVertical,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { PackageItemResponse } from '@submittal/shared/api';

import { AttributeField } from './attribute-field';
import type { CitationTarget } from './citation-drawer';
import { ConfirmDeleteDialog } from './confirm-delete-dialog';
import { DocTypeMenu } from './doc-type-menu';
import { DOC_TYPE_LABELS, type DocType } from './doc-types';
import { itemNeedsReview } from './item-helpers';
import { SourcePdfList } from './source-pdf-list';

type Attribute = PackageItemResponse['attributes'][number];

export function ItemRow({
  item,
  expanded,
  disabled,
  onToggleExpanded,
  onChangeDocType,
  onChangeTitle,
  onSaveAttribute,
  onRevertAttribute,
  onDelete,
  onOpenCitation,
  onRowFocus,
  rowIndex,
}: {
  item: PackageItemResponse;
  expanded: boolean;
  disabled?: boolean;
  onToggleExpanded: () => void;
  onChangeDocType: (next: DocType) => void;
  onChangeTitle: (next: string) => void;
  onSaveAttribute: (key: Attribute['key'], value: string | null) => void;
  onRevertAttribute: (key: Attribute['key']) => void;
  onDelete: () => Promise<void>;
  onOpenCitation: (target: CitationTarget) => void;
  onRowFocus: (rowIndex: number) => void;
  rowIndex: number;
}) {
  const { attributes: dragAttrs, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.item.id, disabled: disabled || expanded });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const rowRef = useRef<HTMLDivElement | null>(null);
  const [titleDraft, setTitleDraft] = useState(item.item.title);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setTitleDraft(item.item.title);
  }, [item.item.title]);

  const reviewCount = item.attributes.filter(
    (a) => a.confidence != null && a.confidence < 0.7 && !a.edited_by_user_at,
  ).length;
  const showReviewBadge = reviewCount > 0;
  const _needsReview = itemNeedsReview(item);

  const manufacturer = item.attributes.find((a) => a.key === 'manufacturer')?.current_value ?? null;
  const modelNumber = item.attributes.find((a) => a.key === 'model_number')?.current_value ?? null;
  const specSectionAttr =
    item.attributes.find((a) => a.key === 'spec_section_ref')?.current_value ?? null;

  const summary = [manufacturer, modelNumber, `${item.source_pdfs.length} source PDF${item.source_pdfs.length === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' · ');

  async function confirmDelete() {
    setDeleting(true);
    try {
      await onDelete();
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  function commitTitle() {
    const next = titleDraft.trim();
    if (next === '' || next === item.item.title) {
      setTitleDraft(item.item.title);
      return;
    }
    onChangeTitle(next);
  }

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        rowRef.current = node;
      }}
      style={style}
      data-item-id={item.item.id}
      tabIndex={0}
      onFocus={() => onRowFocus(rowIndex)}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (target !== rowRef.current) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          onToggleExpanded();
        }
        if (e.key === 'Escape' && expanded) {
          e.preventDefault();
          onToggleExpanded();
        }
      }}
      className={cn(
        'rounded-lg border bg-card transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isDragging ? 'shadow-lg' : 'shadow-sm',
        expanded && 'ring-1 ring-ring/30',
      )}
    >
      <div className="flex items-start gap-3 px-3 py-3">
        <button
          type="button"
          aria-label="Drag to reorder"
          className="mt-0.5 cursor-grab touch-none rounded p-1 text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 active:cursor-grabbing"
          disabled={disabled || expanded}
          {...dragAttrs}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div
          className="min-w-0 flex-1 cursor-pointer"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[data-no-toggle]')) return;
            onToggleExpanded();
          }}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span data-no-toggle>
              <DocTypeMenu
                value={item.item.doc_type}
                disabled={disabled}
                onChange={onChangeDocType}
              />
            </span>
            {specSectionAttr ? (
              <span className="text-xs text-muted-foreground">{specSectionAttr}</span>
            ) : null}
            {showReviewBadge ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                <AlertTriangle className="h-3 w-3" />
                {reviewCount} field{reviewCount === 1 ? '' : 's'} need review
              </span>
            ) : null}
          </div>
          <h3 className="mt-1 truncate text-sm font-medium">{item.item.title}</h3>
          {summary ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{summary}</p>
          ) : (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {DOC_TYPE_LABELS[item.item.doc_type]}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1" data-no-toggle>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              disabled={disabled}
              aria-label="Item actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => setConfirmOpen(true)}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Delete item
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            aria-label={expanded ? 'Collapse item' : 'Expand item'}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent"
            onClick={onToggleExpanded}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t bg-muted/20 px-4 py-4">
          <div className="space-y-4">
            <div className="grid grid-cols-[140px_1fr] items-start gap-3">
              <label className="pt-2 text-sm font-medium text-muted-foreground">Title</label>
              <input
                value={titleDraft}
                disabled={disabled}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {item.attributes.map((attr) => (
              <AttributeField
                key={attr.key}
                attribute={attr}
                disabled={disabled}
                onSave={(value) => onSaveAttribute(attr.key, value)}
                onRevert={() => onRevertAttribute(attr.key)}
                onOpenCitation={() => {
                  if (!attr.source_page_id) return;
                  const sourcePdf = item.source_pdfs[0];
                  onOpenCitation({
                    sourcePageId: attr.source_page_id,
                    sourcePdfFilename: sourcePdf?.original_filename ?? 'Source PDF',
                    pageCount: sourcePdf?.page_count ?? null,
                  });
                }}
              />
            ))}

            <div className="grid grid-cols-[140px_1fr] items-start gap-3">
              <label className="pt-2 text-sm font-medium text-muted-foreground">
                Source PDFs
              </label>
              <SourcePdfList sourcePdfs={item.source_pdfs} />
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={disabled}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Delete item
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDeleteDialog
        open={confirmOpen}
        itemTitle={item.item.title}
        isDeleting={deleting}
        onConfirm={confirmDelete}
        onCancel={() => (!deleting ? setConfirmOpen(false) : null)}
      />
    </div>
  );
}
