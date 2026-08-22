import type { Metadata } from "next";
import DisplayBoard from "../display-board";

export const metadata: Metadata = {
  title: "Bunsik TV Menu",
  robots: { index: false, follow: false },
};

export default function FoodDisplayPage() {
  return <DisplayBoard kind="food" />;
}
