'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { PackageItemResponse } from '@submittal/shared/api';

import type { CitationTarget } from './citation-drawer';
import type { DocType } from './doc-types';
import { ItemRow } from './item-row';

type Attribute = PackageItemResponse['attributes'][number];

export function ItemList({
  items,
  expandedItemId,
  disabled,
  onToggleExpanded,
  onChangeDocType,
  onChangeTitle,
  onSaveAttribute,
  onRevertAttribute,
  onDelete,
  onSaveCommon,
  onReorder,
  onOpenCitation,
  onRowFocus,
}: {
  items: PackageItemResponse[];
  expandedItemId: string | null;
  disabled?: boolean;
  onToggleExpanded: (itemId: string) => void;
  onChangeDocType: (itemId: string, next: DocType) => void;
  onChangeTitle: (itemId: string, next: string) => void;
  onSaveAttribute: (itemId: string, key: Attribute['key'], value: string | null) => void;
  onRevertAttribute: (itemId: string, key: Attribute['key']) => void;
  onDelete: (itemId: string) => Promise<void>;
  onSaveCommon: (itemId: string) => void;
  onReorder: (fromId: string, toId: string) => void;
  onOpenCitation: (target: CitationTarget) => void;
  onRowFocus: (rowIndex: number) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map((i) => i.item.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li key={item.item.id}>
              <ItemRow
                item={item}
                rowIndex={index}
                expanded={expandedItemId === item.item.id}
                disabled={disabled}
                onToggleExpanded={() => onToggleExpanded(item.item.id)}
                onChangeDocType={(next) => onChangeDocType(item.item.id, next)}
                onChangeTitle={(next) => onChangeTitle(item.item.id, next)}
                onSaveAttribute={(key, value) => onSaveAttribute(item.item.id, key, value)}
                onRevertAttribute={(key) => onRevertAttribute(item.item.id, key)}
                onDelete={() => onDelete(item.item.id)}
                onSaveCommon={() => onSaveCommon(item.item.id)}
                onOpenCitation={onOpenCitation}
                onRowFocus={onRowFocus}
              />
            </li>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
