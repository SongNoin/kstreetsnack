import type { Metadata } from "next";
import { getPublishedMenuGroups } from "@/lib/menu/published-menu";
import MenuView, { getMenuMetadata } from "../menu-view";

export const metadata: Metadata = getMenuMetadata("pl");

export default async function PolishMenuPage() {
  const groups = await getPublishedMenuGroups();
  return <MenuView lang="pl" groups={groups} />;
}
