import type { Metadata } from "next";
import DisplayBoard from "../display-board";

export const metadata: Metadata = {
  title: "K-Cafe TV Menu",
  robots: { index: false, follow: false },
};

export default function CafeDisplayPage() {
  return <DisplayBoard kind="cafe" />;
}
