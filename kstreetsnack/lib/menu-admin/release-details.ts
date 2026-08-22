import type {
  MenuTag,
  PublicMenuCategory,
  PublicMenuItem,
  PublishedMenuPayload,
} from "./types";

const MENU_TAGS = new Set<Exclude<MenuTag, "">>([
  "spicy",
  "mild-spicy",
  "very-spicy",
  "hot",
  "ice",
]);

type JsonRecord = Record<string, unknown>;
type LocalizedTuple = readonly [string, string, string];

export type ReleaseItemSummary = {
  id: string;
  nameKo: string;
  pricePl: string;
  availability: "available" | "sold_out";
  hasImage: boolean;
};

export type ReleaseCategorySummary = {
  id: string;
  nameKo: string;
  soldOutCount: number;
  items: ReleaseItemSummary[];
};

export type ReleasePayloadSummary = {
  itemCount: number;
  categoryCount: number;
  availableCount: number;
  soldOutCount: number;
  categories: ReleaseCategorySummary[];
};

export type ReleasePayloadDiff = {
  added: string[];
  removed: string[];
  edited: string[];
  statusChanged: string[];
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}

function localizedTuple(value: unknown, requireContent: boolean): LocalizedTuple | undefined {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((part) => typeof part === "string")) {
    return undefined;
  }
  if (requireContent && value.some((part) => !part.trim())) return undefined;
  return [value[0], value[1], value[2]];
}

function normalizeItem(value: unknown): PublicMenuItem | undefined {
  if (!isRecord(value)) return undefined;
  const id = nonEmptyString(value.id);
  const name = localizedTuple(value.name, true);
  const price = localizedTuple(value.price, true);
  if (!id || !name || !price) return undefined;

  const availability = value.availability === undefined ? "available" : value.availability;
  if (availability !== "available" && availability !== "sold_out") return undefined;

  let tag: Exclude<MenuTag, ""> | undefined;
  if (value.tag !== undefined) {
    if (typeof value.tag !== "string" || !MENU_TAGS.has(value.tag as Exclude<MenuTag, "">)) {
      return undefined;
    }
    tag = value.tag as Exclude<MenuTag, "">;
  }

  let image: string | undefined;
  if (value.image !== undefined) {
    image = nonEmptyString(value.image);
    if (!image) return undefined;
  }

  return {
    id,
    name,
    price,
    ...(tag ? { tag } : {}),
    availability,
    ...(image ? { image } : {}),
  };
}

function normalizeCategory(value: unknown): PublicMenuCategory | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined;
  const id = nonEmptyString(value.id);
  const title = localizedTuple(value.title, true);
  const subtitle = localizedTuple(value.subtitle, false);
  const image = nonEmptyString(value.image);
  if (!id || !title || !subtitle || !image) return undefined;

  let orderNote: LocalizedTuple | undefined;
  if (value.orderNote !== undefined) {
    orderNote = localizedTuple(value.orderNote, true);
    if (!orderNote) return undefined;
  }
  if (value.cover !== undefined && typeof value.cover !== "boolean") return undefined;

  const items: PublicMenuItem[] = [];
  for (const candidate of value.items) {
    const item = normalizeItem(candidate);
    if (!item) return undefined;
    items.push(item);
  }

  return {
    id,
    title,
    subtitle,
    ...(orderNote ? { orderNote } : {}),
    image,
    ...(value.cover === undefined ? {} : { cover: value.cover }),
    items,
  };
}

/**
 * Converts both the local camelCase payload and the SQL snake_case snapshot to
 * the one public release shape used by the admin UI. Unknown fields are dropped.
 */
export function normalizeReleasePayload(
  raw: unknown,
  publishedAt: string,
): PublishedMenuPayload | undefined {
  const normalizedPublishedAt = nonEmptyString(publishedAt);
  if (!isRecord(raw) || !normalizedPublishedAt || !Array.isArray(raw.groups)) return undefined;

  const camelVersion = raw.schemaVersion;
  const snakeVersion = raw.schema_version;
  if (camelVersion === undefined && snakeVersion === undefined) return undefined;
  if ((camelVersion !== undefined && camelVersion !== 1)
    || (snakeVersion !== undefined && snakeVersion !== 1)) return undefined;

  const groups: PublicMenuCategory[][] = [];
  const categoryIds = new Set<string>();
  const itemIds = new Set<string>();

  for (const candidateGroup of raw.groups) {
    if (!Array.isArray(candidateGroup)) return undefined;
    const group: PublicMenuCategory[] = [];
    for (const candidateCategory of candidateGroup) {
      const category = normalizeCategory(candidateCategory);
      if (!category || categoryIds.has(category.id)) return undefined;
      categoryIds.add(category.id);
      for (const item of category.items) {
        if (itemIds.has(item.id)) return undefined;
        itemIds.add(item.id);
      }
      group.push(category);
    }
    groups.push(group);
  }

  return { schemaVersion: 1, publishedAt: normalizedPublishedAt, groups };
}

export function summarizeReleasePayload(payload: PublishedMenuPayload): ReleasePayloadSummary {
  const categories: ReleaseCategorySummary[] = [];
  let itemCount = 0;
  let availableCount = 0;
  let soldOutCount = 0;

  for (const group of payload.groups) {
    for (const category of group) {
      const items = category.items.map((item) => ({
        id: item.id,
        nameKo: item.name[2],
        pricePl: item.price[0],
        availability: item.availability,
        hasImage: Boolean(item.image),
      }));
      const categorySoldOutCount = items.filter((item) => item.availability === "sold_out").length;
      itemCount += items.length;
      soldOutCount += categorySoldOutCount;
      availableCount += items.length - categorySoldOutCount;
      categories.push({
        id: category.id,
        nameKo: category.title[2],
        soldOutCount: categorySoldOutCount,
        items,
      });
    }
  }

  return {
    itemCount,
    categoryCount: categories.length,
    availableCount,
    soldOutCount,
    categories,
  };
}

type ComparableItem = {
  categoryId: string;
  item: PublicMenuItem;
};

function comparableItems(payload: PublishedMenuPayload) {
  const items = new Map<string, ComparableItem>();
  for (const group of payload.groups) {
    for (const category of group) {
      for (const item of category.items) items.set(item.id, { categoryId: category.id, item });
    }
  }
  return items;
}

function sameTuple(left: LocalizedTuple, right: LocalizedTuple) {
  return left.every((value, index) => value === right[index]);
}

function canonicalImageRef(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return "";
  if (normalized.startsWith("static:")) {
    const staticPath = normalized.slice("static:".length).replace(/^\/menu\//, "");
    return `static-menu:${staticPath}`;
  }
  if (normalized.startsWith("/menu/")) return `static-menu:${normalized.slice("/menu/".length)}`;
  if (!normalized.includes("/") && !/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    return `static-menu:${normalized}`;
  }
  return `asset:${normalized}`;
}

function hasPublicEdit(current: ComparableItem, previous: ComparableItem) {
  return current.categoryId !== previous.categoryId
    || !sameTuple(current.item.name, previous.item.name)
    || !sameTuple(current.item.price, previous.item.price)
    || current.item.tag !== previous.item.tag
    || canonicalImageRef(current.item.image) !== canonicalImageRef(previous.item.image);
}

/** Compares menu-item public fields. Category-only edits are intentionally excluded. */
export function diffReleasePayloads(
  current: PublishedMenuPayload,
  previous: PublishedMenuPayload,
): ReleasePayloadDiff {
  const currentItems = comparableItems(current);
  const previousItems = comparableItems(previous);
  const added: string[] = [];
  const removed: string[] = [];
  const edited: string[] = [];
  const statusChanged: string[] = [];

  for (const [id, currentEntry] of currentItems) {
    const previousEntry = previousItems.get(id);
    if (!previousEntry) {
      added.push(currentEntry.item.name[2]);
      continue;
    }
    if (hasPublicEdit(currentEntry, previousEntry)) edited.push(currentEntry.item.name[2]);
    if (currentEntry.item.availability !== previousEntry.item.availability) {
      statusChanged.push(currentEntry.item.name[2]);
    }
  }

  for (const [id, previousEntry] of previousItems) {
    if (!currentItems.has(id)) removed.push(previousEntry.item.name[2]);
  }

  return { added, removed, edited, statusChanged };
}
