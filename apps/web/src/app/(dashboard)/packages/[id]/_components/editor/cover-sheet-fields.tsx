'use client';

import { useEffect, useState } from 'react';

import type { CoverSheetField } from './cover-sheet-helpers';
import { hasChanged, isEmptyRequiredField, normalizeFieldValue } from './cover-sheet-helpers';

const fieldRowClass = 'grid grid-cols-[140px_1fr] items-start gap-3';
const labelClass = 'pt-2 text-sm font-medium text-muted-foreground';
const inputClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className={fieldRowClass}>
      <div className={labelClass}>{label}</div>
      <div className="min-w-0 pt-2 text-sm">
        {value ? value : <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

export function EditableTextField({
  label,
  field,
  value,
  disabled,
  onCommit,
  onInvalidEmpty,
}: {
  label: string;
  field: CoverSheetField;
  value: string | null;
  disabled?: boolean;
  onCommit: (next: string | null) => void;
  onInvalidEmpty: () => void;
}) {
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  function commit() {
    if (isEmptyRequiredField(field, draft)) {
      setDraft(value ?? '');
      onInvalidEmpty();
      return;
    }
    if (!hasChanged(field, draft, value)) return;
    onCommit(normalizeFieldValue(field, draft));
  }

  return (
    <div className={fieldRowClass}>
      <label className={labelClass} htmlFor={`cover-sheet-${field}`}>
        {label}
      </label>
      <div className="min-w-0">
        <input
          id={`cover-sheet-${field}`}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === 'Escape') {
              setDraft(value ?? '');
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={inputClass}
          placeholder="—"
        />
      </div>
    </div>
  );
}

const REVISION_OPTIONS = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'];

export function RevisionSelect({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (next: string) => void;
}) {
  const options = REVISION_OPTIONS.includes(value)
    ? REVISION_OPTIONS
    : [value, ...REVISION_OPTIONS];

  return (
    <div className={fieldRowClass}>
      <label className={labelClass} htmlFor="cover-sheet-revision">
        Revision
      </label>
      <div className="min-w-0">
        <select
          id="cover-sheet-revision"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value;
            if (next !== value) onCommit(next);
          }}
          className={inputClass}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function DateField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string | null;
  disabled?: boolean;
  onCommit: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  function commit(next: string) {
    const normalized = next === '' ? null : next;
    if (normalized === value) return;
    onCommit(normalized);
  }

  return (
    <div className={fieldRowClass}>
      <label className={labelClass} htmlFor="cover-sheet-date">
        {label}
      </label>
      <div className="min-w-0">
        <input
          id="cover-sheet-date"
          type="date"
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
          className={inputClass}
        />
      </div>
    </div>
  );
}
