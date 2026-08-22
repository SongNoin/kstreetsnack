import { fullMenuGroups } from "@/app/menu-data";
import type { FullMenuCategory, FullMenuItem } from "@/app/menu-data";

const MENU_TAGS = ["spicy", "mild-spicy", "very-spicy", "hot", "ice"] as const;
const MENU_AVAILABILITIES = ["available", "sold_out", "hidden"] as const;
const RELEASE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MenuAvailability = (typeof MENU_AVAILABILITIES)[number];
export type PublishedMenuPrice = string | readonly [string, string, string];

export type PublishedMenuItem = Omit<FullMenuItem, "price"> & {
  id?: string;
  image?: string;
  price: PublishedMenuPrice;
  availability?: MenuAvailability;
};

export type PublishedMenuCategory = Omit<FullMenuCategory, "items"> & {
  items: readonly PublishedMenuItem[];
};

export type PublishedMenuGroups = readonly (readonly PublishedMenuCategory[])[];

type PublishedMenuSnapshot = {
  groups: PublishedMenuGroups;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isLocalizedStrings(value: unknown): value is readonly [string, string, string] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((part) => typeof part === "string");
}

function isLocalized(value: unknown): value is readonly [string, string, string] {
  return isLocalizedStrings(value) && value.every((part) => part.trim().length > 0);
}

function isPublishedMenuItem(value: unknown): value is PublishedMenuItem {
  if (!isRecord(value) || !isLocalized(value.name)) return false;
  if (!isNonEmptyString(value.price) && !isLocalized(value.price)) return false;
  if (value.id !== undefined && !isNonEmptyString(value.id)) return false;
  if (value.image !== undefined && !isNonEmptyString(value.image)) return false;
  if (value.tag !== undefined && !MENU_TAGS.includes(value.tag as (typeof MENU_TAGS)[number])) return false;
  if (
    value.availability !== undefined
    && !MENU_AVAILABILITIES.includes(value.availability as MenuAvailability)
  ) return false;
  return true;
}

function isPublishedMenuCategory(value: unknown): value is PublishedMenuCategory {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || !isLocalized(value.title) || !isLocalizedStrings(value.subtitle)) return false;
  if (!isNonEmptyString(value.image) || !Array.isArray(value.items)) return false;
  if (value.orderNote !== undefined && !isLocalized(value.orderNote)) return false;
  if (value.cover !== undefined && typeof value.cover !== "boolean") return false;
  return value.items.every(isPublishedMenuItem);
}

function isPublishedMenuSnapshot(value: unknown): value is PublishedMenuSnapshot {
  if (!isRecord(value) || !Array.isArray(value.groups) || value.groups.length === 0) return false;
  return value.groups.every(
    (group) => Array.isArray(group) && group.every(isPublishedMenuCategory),
  );
}

function unwrapRpcResult(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1) return unwrapRpcResult(value[0]);
  if (isRecord(value) && "get_published_menu" in value) return value.get_published_menu;
  if (isRecord(value) && "get_deployable_published_menu" in value) {
    return value.get_deployable_published_menu;
  }
  if (isRecord(value) && "get_menu_release" in value) return value.get_menu_release;
  return value;
}

/**
 * Validates the public snapshot at runtime so malformed data never breaks the
 * statically generated menu. Extra snapshot fields are deliberately ignored.
 */
export function parsePublishedMenuSnapshot(value: unknown): PublishedMenuGroups | null {
  const snapshot = unwrapRpcResult(value);
  return isPublishedMenuSnapshot(snapshot) ? snapshot.groups : null;
}

/** Resolves both checked-in seed images and Supabase Storage object paths. */
export function resolvePublishedMenuImage(image: string, basePath = ""): string {
  if (/^(https?:\/\/|data:|blob:)/.test(image)) return image;
  if (image.startsWith("/")) return `${basePath}${image}`;

  if (image.startsWith("static:")) {
    return `${basePath}/menu/${image.slice("static:".length)}`;
  }

  // Existing fallback data predates the storage prefix and uses bare filenames.
  if (!image.includes("/")) return `${basePath}/menu/${image}`;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!supabaseUrl) return `${basePath}/menu/${image}`;
  return `${supabaseUrl}/storage/v1/object/public/menu-images/${image.replace(/^\/+/, "")}`;
}

async function fetchPublishedMenuGroups(): Promise<PublishedMenuGroups | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const requestedReleaseId = process.env.MENU_RELEASE_ID?.trim() ?? "";
  const requireRemoteMenu = process.env.REQUIRE_REMOTE_MENU === "1";
  const failClosed = Boolean(requestedReleaseId) || requireRemoteMenu;
  if (requestedReleaseId && !RELEASE_ID_PATTERN.test(requestedReleaseId)) {
    throw new Error("MENU_RELEASE_ID must be a canonical UUID.");
  }
  if (!supabaseUrl || !publicKey) {
    if (failClosed) {
      throw new Error("Supabase public build settings are required for a production menu build.");
    }
    return null;
  }

  try {
    const rpcName = requestedReleaseId
      ? "get_menu_release"
      : requireRemoteMenu
        ? "get_deployable_published_menu"
        : "get_published_menu";
    const endpoint = new URL(`/rest/v1/rpc/${rpcName}`, supabaseUrl);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: publicKey,
        "Content-Type": "application/json",
      },
      body: requestedReleaseId
        ? JSON.stringify({ p_release_id: requestedReleaseId })
        : "{}",
      cache: process.env.NODE_ENV === "development" ? "no-store" : "force-cache",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      if (failClosed) {
        throw new Error(`Required remote menu fetch failed (HTTP ${response.status}).`);
      }
      return null;
    }
    const groups = parsePublishedMenuSnapshot(await response.json());
    if (failClosed && !groups) {
      throw new Error("The required remote menu release is missing or invalid.");
    }
    return groups;
  } catch (error) {
    if (failClosed) throw error;
    return null;
  }
}

/**
 * Reads a menu snapshot during page generation. Local development may fall
 * back to checked-in data when Supabase is unavailable. Every GitHub Pages
 * build sets REQUIRE_REMOTE_MENU=1 and fails closed. Routine push/schedule
 * builds also refuse to deploy while an owner deployment callback is
 * unresolved; an admin-triggered build pins the exact immutable release
 * through MENU_RELEASE_ID and does not use that routine-build guard.
 */
export async function getPublishedMenuGroups(): Promise<PublishedMenuGroups> {
  return await fetchPublishedMenuGroups() ?? fullMenuGroups;
}
