import * as React from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, defaultDropAnimationSideEffects, type DragMoveEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNotionThemeClass } from './ui/theme';

export type NotionDropPlacement = 'before' | 'after' | 'inside';
type SortState = { activeId: string | null; overId: string | null; placement: NotionDropPlacement; duration: number };
const SortStateContext = React.createContext<SortState>({ activeId: null, overId: null, placement: 'before', duration: 180 });

/** Shared pointer/keyboard sorting. The caller owns the accepted order and hierarchy. */
export function NotionSortList({ ids, label, children, preview, onDrop, onActiveChange, allowNesting = false, disabled = false, axis='vertical' }: {
  ids: string[]; label: string; children: React.ReactNode; preview: (id: string) => React.ReactNode;
  onDrop: (id: string, targetId: string, placement: NotionDropPlacement) => void;
  onActiveChange?: (id: string | null) => void; allowNesting?: boolean; disabled?: boolean;axis?:'vertical'|'free';
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const themeClass = useNotionThemeClass();
  const [state, setState] = React.useState<SortState>({ activeId: null, overId: null, placement: 'before', duration: 180 });
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  );
  React.useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener('change', update);
    const duration = Number.parseInt(getComputedStyle(ref.current!).getPropertyValue('--notion-motion-panel')) || 180;
    setState((current) => ({ ...current, duration }));
    return () => media.removeEventListener('change', update);
  }, []);
  function placement(event: DragMoveEvent): NotionDropPlacement {
    if (allowNesting && event.delta.x > 24) return 'inside';
    const from = ids.indexOf(String(event.active.id));
    const to = ids.indexOf(String(event.over?.id));
    return from < to ? 'after' : 'before';
  }
  function clear() {
    setState((current) => ({ ...current, activeId: null, overId: null }));
    onActiveChange?.(null);
  }
  return <div ref={ref} className="notion-sort-list" data-sorting={state.activeId ? 'true' : undefined}>
    <SortStateContext.Provider value={{ ...state, duration: reducedMotion ? 0 : state.duration }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={allowNesting||axis==='free' ? undefined : [({ transform }) => ({ ...transform, x: 0 })]}
        accessibility={{ screenReaderInstructions: { draggable: `${label}. Press Space to pick up, arrow keys to move, Space to drop, or Escape to cancel.` } }}
        onDragStart={({ active }) => { if (disabled) return; const id = String(active.id); setState((current) => ({ ...current, activeId: id, overId: id })); onActiveChange?.(id); }}
        onDragMove={(event) => setState((current) => ({ ...current, overId: event.over ? String(event.over.id) : null, placement: placement(event) }))}
        onDragCancel={clear}
        onDragEnd={(event) => {
          const { active, over } = event;
          const targetPlacement = placement(event);
          const bounds = ref.current?.getBoundingClientRect();
          const rect = active.rect.current.translated;
          const intersects = !bounds || !rect || (rect.bottom >= bounds.top && rect.top <= bounds.bottom && rect.right >= bounds.left && rect.left <= bounds.right);
          clear();
          if (!disabled && intersects && over && active.id !== over.id) onDrop(String(active.id), String(over.id), targetPlacement);
        }}>
        <SortableContext items={ids} strategy={axis==='free'?rectSortingStrategy:verticalListSortingStrategy} disabled={disabled}>{children}</SortableContext>
        {typeof document !== 'undefined' && createPortal(<DragOverlay dropAnimation={{ duration: reducedMotion ? 0 : state.duration, easing: 'ease', sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } }) }}>
          {state.activeId && <div data-ui-pack="notion" className={`notion-drag-preview ${themeClass}`}>{preview(state.activeId)}</div>}
        </DragOverlay>, document.body)}
      </DndContext>
    </SortStateContext.Provider>
  </div>;
}

type SortBindings = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners' | 'setActivatorNodeRef'>;

export function NotionSortItem({ id, disabled = false, children }: {
  id: string; disabled?: boolean; children: (bindings: SortBindings) => React.ReactNode;
}) {
  const state = React.useContext(SortStateContext);
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id, disabled, transition: { duration: state.duration, easing: 'ease' },
  });
  const insideTarget = state.placement === 'inside' && state.overId === id && state.activeId !== id;
  return <div ref={setNodeRef} className="notion-sort-item" data-sort-id={id} data-drag-slot={isDragging || undefined} data-nest-target={insideTarget || undefined}
    style={{ transform: CSS.Transform.toString(transform), transition }}>
    <div className="notion-sort-content">{children({ attributes, listeners, setActivatorNodeRef })}</div>
    {isDragging && <div className="notion-insertion-slot" aria-label="Insertion slot" />}
  </div>;
}
