import type { Metadata } from "next";
import MenuView, { getMenuMetadata } from "../menu-view";

export const metadata: Metadata = getMenuMetadata("pl");

export default function PolishMenuPage() {
  return <MenuView lang="pl" />;
}
