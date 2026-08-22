import type {
  PublishedMenuCategory,
  PublishedMenuItem,
  PublishedMenuPrice,
} from "@/lib/menu/published-menu";

export type BoardKind = "food" | "cafe";

export type BoardCategorySlice = {
  category: PublishedMenuCategory;
  items: readonly PublishedMenuItem[];
  continuation: boolean;
};

export type BoardSlide = readonly BoardCategorySlice[];

export type PricePart = {
  label: string;
  value: string;
};

const POLISH_INDEX = 0;

/**
 * Packs whole categories onto a slide while limiting both menu rows and card
 * headers. A category is split only when it is larger than an empty slide.
 */
export function paginateCategories(
  categories: readonly PublishedMenuCategory[],
  itemCapacity: number,
  categoryCapacity = 4,
): readonly BoardSlide[] {
  if (
    !Number.isSafeInteger(itemCapacity)
    || itemCapacity < 1
    || !Number.isSafeInteger(categoryCapacity)
    || categoryCapacity < 1
  ) return [];

  const slides: BoardCategorySlice[][] = [];
  let current: BoardCategorySlice[] = [];
  let remaining = itemCapacity;

  const flush = () => {
    if (current.length === 0) return;
    slides.push(current);
    current = [];
    remaining = itemCapacity;
  };

  for (const category of categories) {
    const visibleItems = category.items.filter((item) => item.availability !== "hidden");
    if (visibleItems.length === 0) continue;

    if (visibleItems.length <= itemCapacity) {
      if (visibleItems.length > remaining || current.length >= categoryCapacity) flush();
      current.push({ category, items: visibleItems, continuation: false });
      remaining -= visibleItems.length;
      continue;
    }

    flush();
    for (let offset = 0; offset < visibleItems.length; offset += itemCapacity) {
      current.push({
        category,
        items: visibleItems.slice(offset, offset + itemCapacity),
        continuation: offset > 0,
      });
      remaining -= Math.min(itemCapacity, visibleItems.length - offset);
      if (remaining === 0) flush();
    }
  }

  flush();
  return slides;
}

function boardSliceWeight(slice: BoardCategorySlice): number {
  // A category heading and its artwork take about the space of two menu rows.
  return slice.items.length + (slice.continuation ? 1 : 2);
}

/**
 * Splits the ordered category list into contiguous, visually balanced columns.
 * Keeping each range contiguous makes the board read naturally from left to
 * right while avoiding a tall final column.
 */
export function partitionSlideColumns(
  slide: BoardSlide,
  requestedColumnCount: number,
): readonly BoardSlide[] {
  if (!Number.isSafeInteger(requestedColumnCount) || requestedColumnCount < 1) return [];
  if (slide.length === 0) {
    return Array.from({ length: requestedColumnCount }, () => [] as BoardCategorySlice[]);
  }

  const columnCount = Math.min(requestedColumnCount, slide.length);
  const prefixWeights = [0];
  for (const slice of slide) {
    prefixWeights.push(prefixWeights[prefixWeights.length - 1] + boardSliceWeight(slice));
  }

  const costs = Array.from(
    { length: columnCount + 1 },
    () => Array<number>(slide.length + 1).fill(Number.POSITIVE_INFINITY),
  );
  const splits = Array.from(
    { length: columnCount + 1 },
    () => Array<number>(slide.length + 1).fill(-1),
  );
  costs[0][0] = 0;

  for (let column = 1; column <= columnCount; column += 1) {
    for (let end = column; end <= slide.length; end += 1) {
      for (let start = column - 1; start < end; start += 1) {
        const previousCost = costs[column - 1][start];
        if (!Number.isFinite(previousCost)) continue;
        const segmentWeight = prefixWeights[end] - prefixWeights[start];
        const cost = Math.max(previousCost, segmentWeight);
        if (cost < costs[column][end]) {
          costs[column][end] = cost;
          splits[column][end] = start;
        }
      }
    }
  }

  const columns: BoardSlide[] = [];
  let end = slide.length;
  for (let column = columnCount; column >= 1; column -= 1) {
    const start = splits[column][end];
    columns.unshift(slide.slice(start, end));
    end = start;
  }
  while (columns.length < requestedColumnCount) columns.push([]);
  return columns;
}

/** Kept for the existing two-column utility contract. */
export function balanceSlideColumns(slide: BoardSlide): readonly [BoardSlide, BoardSlide] {
  const [left = [], right = []] = partitionSlideColumns(slide, 2);
  return [left, right];
}

export function polishText(value: readonly [string, string, string]): string {
  return value[POLISH_INDEX];
}

export function polishPrice(value: PublishedMenuPrice): string {
  return typeof value === "string" ? value : value[POLISH_INDEX];
}

/** Turns `1 szt. 5 zł · 3 szt. 13 zł` into scannable label/value pairs. */
export function splitPrice(value: PublishedMenuPrice): readonly PricePart[] {
  return polishPrice(value)
    .split(/\s*[·•]\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*?)([+]?\d+(?:[.,]\d+)?\s*zł)$/i);
      return match
        ? { label: match[1].trim(), value: match[2].trim() }
        : { label: "", value: part };
    });
}

export function boardTitle(kind: BoardKind): string {
  return kind === "food" ? "BUNSIK" : "K-CAFE";
}

export function boardSubtitle(kind: BoardKind): string {
  return kind === "food" ? "KOREAŃSKI STREET FOOD" : "KAWA · NAPOJE · DESERY";
}

export function boardSlideDuration(kind: BoardKind): number {
  return kind === "food" ? 13_000 : 12_000;
}
