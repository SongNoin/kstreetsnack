"use client";

import { useEffect } from "react";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? "";

type AvailabilityRow = {
  menu_item_id: string;
  is_available: boolean;
};

let availabilityRequest: Promise<AvailabilityRow[] | null> | null = null;

function parseAvailabilityRows(value: unknown): AvailabilityRow[] | null {
  if (!Array.isArray(value)) return null;

  const rows: AvailabilityRow[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.menu_item_id !== "string" || typeof row.is_available !== "boolean") return null;
    rows.push({ menu_item_id: row.menu_item_id, is_available: row.is_available });
  }
  return rows;
}

async function loadAvailability(): Promise<AvailabilityRow[] | null> {
  if (!supabaseUrl || !supabasePublicKey) return null;

  try {
    const endpoint = new URL("/rest/v1/menu_availability", supabaseUrl);
    endpoint.searchParams.set("select", "menu_item_id,is_available");
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabasePublicKey,
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return parseAvailabilityRows(await response.json());
  } catch {
    return null;
  }
}

function applyAvailability(rows: AvailabilityRow[]) {
  const menuItems = new Map<string, HTMLElement>();
  document.querySelectorAll<HTMLElement>("[data-menu-item-id]").forEach((element) => {
    const itemId = element.dataset.menuItemId;
    if (itemId) menuItems.set(itemId, element);
  });

  // A successful response is authoritative for the current draft. An item
  // still present in an older static release but absent from availability was
  // deleted/restored in the draft and must never remain orderable while the
  // replacement release is waiting for Pages deployment.
  menuItems.forEach((menuItem) => {
    menuItem.dataset.availability = "sold_out";
    const badge = menuItem.querySelector<HTMLElement>("[data-sold-out-badge]");
    if (badge) badge.hidden = false;
  });

  rows.forEach((row) => {
    const menuItem = menuItems.get(row.menu_item_id);
    if (!menuItem) return;

    const isSoldOut = !row.is_available;
    menuItem.dataset.availability = isSoldOut ? "sold_out" : "available";
    const badge = menuItem.querySelector<HTMLElement>("[data-sold-out-badge]");
    if (badge) badge.hidden = !isSoldOut;
  });
}

export default function MenuAvailabilitySync() {
  useEffect(() => {
    availabilityRequest ??= loadAvailability();
    void availabilityRequest.then((rows) => {
      if (rows) applyAvailability(rows);
    });
  }, []);

  return null;
}
