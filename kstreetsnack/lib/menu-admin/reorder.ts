import type { MenuAdminState } from "./types";

export type ReorderKind = "category" | "item";
export type DropPosition = "before" | "after";

export type ReorderResult = {
  kind: ReorderKind;
  state: MenuAdminState;
  parentId: string;
  expectedIds: string[];
  orderedIds: string[];
  movedId: string;
  movedTo: number;
  changed: boolean;
};

export function withReorderBaseline(result: ReorderResult, expectedIds: readonly string[]): ReorderResult {
  const baseline = [...expectedIds];
  const changed = baseline.length !== result.orderedIds.length
    || baseline.some((id, index) => id !== result.orderedIds[index]);
  return { ...result, expectedIds: baseline, changed };
}

type SortableRecord = {
  id: string;
  sortOrder: number;
  archivedAt: string | null;
};

function sortStable<T extends SortableRecord>(records: T[]) {
  // loadRemoteState already supplies the database's canonical created_at/id
  // tie-break order. JavaScript sort is stable, so preserving input order here
  // keeps expectedIds identical even when legacy rows share a sort_order.
  return [...records].sort((a, b) => a.sortOrder - b.sortOrder);
}

function reorderedActiveIds<T extends SortableRecord>(
  scopedRecords: T[],
  sourceId: string,
  targetId: string,
  position: DropPosition,
) {
  const activeIds = sortStable(scopedRecords.filter((record) => record.archivedAt === null))
    .map((record) => record.id);
  const sourceIndex = activeIds.indexOf(sourceId);
  const targetIndex = activeIds.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) {
    throw new Error("운영 중인 항목끼리만 순서를 변경할 수 있습니다.");
  }
  if (sourceId === targetId) return activeIds;

  const next = activeIds.filter((id) => id !== sourceId);
  const nextTargetIndex = next.indexOf(targetId);
  const insertAt = position === "after" ? nextTargetIndex + 1 : nextTargetIndex;
  next.splice(insertAt, 0, sourceId);
  return next;
}

function completeOrder<T extends SortableRecord>(scopedRecords: T[], activeIds: string[]) {
  const archivedIds = sortStable(scopedRecords.filter((record) => record.archivedAt !== null))
    .map((record) => record.id);
  return [...activeIds, ...archivedIds];
}

function applyOrders<T extends SortableRecord>(records: T[], parentIds: Set<string>, orderedIds: string[]) {
  const orderById = new Map(orderedIds.map((id, index) => [id, index]));
  return records.map((record) => {
    if (!parentIds.has(record.id)) return record;
    const sortOrder = orderById.get(record.id);
    return sortOrder === undefined || sortOrder === record.sortOrder ? record : { ...record, sortOrder };
  });
}

export function reorderAdminState(
  state: MenuAdminState,
  kind: ReorderKind,
  sourceId: string,
  targetId: string,
  position: DropPosition,
): ReorderResult {
  if (kind === "category") {
    const source = state.categories.find((category) => category.id === sourceId);
    const target = state.categories.find((category) => category.id === targetId);
    if (!source || !target) throw new Error("카테고리를 찾지 못했습니다.");
    if (source.sectionId !== target.sectionId) {
      throw new Error("카테고리는 같은 메뉴 그룹 안에서만 순서를 변경할 수 있습니다.");
    }
    const scoped = state.categories.filter((category) => category.sectionId === source.sectionId);
    const previousActiveIds = sortStable(scoped.filter((category) => category.archivedAt === null))
      .map((category) => category.id);
    const previousIndex = previousActiveIds.indexOf(sourceId);
    const activeIds = reorderedActiveIds(scoped, sourceId, targetId, position);
    const expectedIds = completeOrder(scoped, previousActiveIds);
    const orderedIds = completeOrder(scoped, activeIds);
    return {
      kind,
      state: {
        ...state,
        categories: applyOrders(state.categories, new Set(scoped.map((category) => category.id)), orderedIds),
      },
      parentId: source.sectionId,
      expectedIds,
      orderedIds,
      movedId: sourceId,
      movedTo: activeIds.indexOf(sourceId),
      changed: previousIndex !== activeIds.indexOf(sourceId),
    };
  }

  const source = state.items.find((item) => item.id === sourceId);
  const target = state.items.find((item) => item.id === targetId);
  if (!source || !target) throw new Error("메뉴를 찾지 못했습니다.");
  if (source.categoryId !== target.categoryId) {
    throw new Error("메뉴는 같은 카테고리 안에서만 순서를 변경할 수 있습니다.");
  }
  const scoped = state.items.filter((item) => item.categoryId === source.categoryId);
  const previousActiveIds = sortStable(scoped.filter((item) => item.archivedAt === null))
    .map((item) => item.id);
  const previousIndex = previousActiveIds.indexOf(sourceId);
  const activeIds = reorderedActiveIds(scoped, sourceId, targetId, position);
  const expectedIds = completeOrder(scoped, previousActiveIds);
  const orderedIds = completeOrder(scoped, activeIds);
  return {
    kind,
    state: {
      ...state,
      items: applyOrders(state.items, new Set(scoped.map((item) => item.id)), orderedIds),
    },
    parentId: source.categoryId,
    expectedIds,
    orderedIds,
    movedId: sourceId,
    movedTo: activeIds.indexOf(sourceId),
    changed: previousIndex !== activeIds.indexOf(sourceId),
  };
}

export function reorderAdminStateByOffset(
  state: MenuAdminState,
  kind: ReorderKind,
  sourceId: string,
  offset: -1 | 1,
) {
  if (kind === "category") {
    const source = state.categories.find((category) => category.id === sourceId);
    if (!source || source.archivedAt !== null) return null;
    const ordered = sortStable(state.categories.filter((category) => (
      category.sectionId === source.sectionId && category.archivedAt === null
    )));
    const index = ordered.findIndex((record) => record.id === sourceId);
    const target = ordered[index + offset];
    if (!target) return null;
    return reorderAdminState(state, kind, sourceId, target.id, offset < 0 ? "before" : "after");
  }

  const source = state.items.find((item) => item.id === sourceId);
  if (!source || source.archivedAt !== null) return null;
  const ordered = sortStable(state.items.filter((item) => (
    item.categoryId === source.categoryId && item.archivedAt === null
  )));
  const index = ordered.findIndex((record) => record.id === sourceId);
  const target = ordered[index + offset];
  if (!target) return null;
  return reorderAdminState(state, kind, sourceId, target.id, offset < 0 ? "before" : "after");
}
