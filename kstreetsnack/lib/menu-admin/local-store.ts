import { createSeedState } from "./seed";
import type {
  AdminCategory,
  AdminMenuItem,
  AdminRelease,
  MenuAdminState,
  PublishResult,
  PublishedMenuPayload,
} from "./types";
import { toLocalizedTuple } from "./types";
import { normalizeReleasePayload, summarizeReleasePayload } from "./release-details";

const STATE_KEY = "ksnack.menu-admin.state.v1";
const MAX_LOCAL_RELEASES = 5;

function makeId(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function isMenuAdminState(value: unknown): value is MenuAdminState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MenuAdminState>;
  return candidate.schemaVersion === 1
    && Array.isArray(candidate.sections)
    && Array.isArray(candidate.categories)
    && Array.isArray(candidate.items)
    && Array.isArray(candidate.releases);
}

function normalizeStoredRelease(value: unknown): AdminRelease | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const release = value as Record<string, unknown>;
  if (typeof release.id !== "string" || !release.id.trim()) return undefined;
  if (typeof release.createdAt !== "string" || Number.isNaN(Date.parse(release.createdAt))) return undefined;

  const payload = normalizeReleasePayload(release.payload, release.createdAt);
  const storedItemCount = typeof release.itemCount === "number"
    && Number.isSafeInteger(release.itemCount)
    && release.itemCount >= 0
    ? release.itemCount
    : 0;
  const version = typeof release.version === "number"
    && Number.isSafeInteger(release.version)
    && release.version > 0
    ? release.version
    : undefined;

  return {
    id: release.id,
    ...(version ? { version } : {}),
    createdAt: release.createdAt,
    itemCount: payload ? summarizeReleasePayload(payload).itemCount : storedItemCount,
    deploymentTriggered: false,
    ...(payload ? { payload } : {}),
  };
}

export function loadLocalState(): MenuAdminState {
  try {
    const saved = window.localStorage.getItem(STATE_KEY);
    if (!saved) return createSeedState();
    const parsed: unknown = JSON.parse(saved);
    return isMenuAdminState(parsed)
      ? { ...parsed, releases: parsed.releases.flatMap((release) => normalizeStoredRelease(release) ?? []) }
      : createSeedState();
  } catch {
    return createSeedState();
  }
}

export function saveLocalState(state: MenuAdminState) {
  window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export function newLocalItem(
  input: Omit<AdminMenuItem, "id" | "slug" | "updatedAt">,
): AdminMenuItem {
  const id = makeId("custom");
  return {
    ...input,
    id,
    slug: id,
    updatedAt: new Date().toISOString(),
  };
}

export function newLocalCategory(
  input: Omit<AdminCategory, "id" | "slug">,
): AdminCategory {
  const id = makeId("category");
  return {
    ...input,
    id,
    slug: id,
  };
}

function publicCategoryImage(path: string) {
  if (path.startsWith("static:")) return path.slice("static:".length);
  return path.startsWith("/menu/") ? path.slice("/menu/".length) : path;
}

function publicItemImage(path: string) {
  if (path.startsWith("static:")) return `/menu/${path.slice("static:".length)}`;
  return path;
}

export function buildPublishedPayload(state: MenuAdminState): PublishedMenuPayload {
  const publishedAt = new Date().toISOString();
  const activeItems = state.items.filter((item) => item.archivedAt === null);
  const groups = state.sections
    .filter((section) => section.archivedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((section) => state.categories
      .filter((category) => category.sectionId === section.id && category.archivedAt === null)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) => {
        const orderNote = Object.values(category.orderNote).every((value) => value.trim())
          ? toLocalizedTuple(category.orderNote)
          : undefined;
        return {
          id: category.slug,
          title: toLocalizedTuple(category.name),
          subtitle: [
            category.description.pl.trim() || category.name.pl,
            category.description.en.trim() || category.name.en,
            category.description.ko.trim() || category.name.ko,
          ] as const,
          ...(orderNote ? { orderNote } : {}),
          image: publicCategoryImage(category.imagePath),
          ...(category.cover ? { cover: true } : {}),
          items: activeItems
            .filter((item) => item.categoryId === category.id)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((item) => ({
              id: item.id,
              name: toLocalizedTuple(item.name),
              price: toLocalizedTuple(item.price),
              ...(item.tag ? { tag: item.tag } : {}),
              availability: item.isAvailable ? "available" as const : "sold_out" as const,
              ...(item.imagePath ? { image: publicItemImage(item.imagePath) } : {}),
            })),
        };
      }));

  return { schemaVersion: 1, publishedAt, groups };
}

export function publishLocalState(state: MenuAdminState): {
  state: MenuAdminState;
  result: PublishResult;
} {
  const payload = buildPublishedPayload(state);
  const summary = summarizeReleasePayload(payload);
  const release: AdminRelease = {
    id: makeId("local-release"),
    createdAt: payload.publishedAt,
    itemCount: summary.itemCount,
    deploymentTriggered: false,
    payload,
  };
  const nextState = {
    ...state,
    releases: [release, ...state.releases].slice(0, MAX_LOCAL_RELEASES),
  };
  saveLocalState(nextState);
  return {
    state: nextState,
    result: {
      releaseId: release.id,
      publishedAt: release.createdAt,
      deploymentTriggered: false,
    },
  };
}

export function resetLocalState() {
  const state = createSeedState();
  saveLocalState(state);
  return state;
}

export async function optimizeImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일만 업로드할 수 있습니다.");
  if (file.size > 10 * 1024 * 1024) throw new Error("이미지는 10MB 이하여야 합니다.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), "image/webp", 0.82);
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}
