import type { Metadata } from "next";
import LocalMenuPreview from "./preview-client";

export const metadata: Metadata = {
  title: "메뉴 미리보기",
  robots: { index: false, follow: false },
};

export default function AdminPreviewPage() {
  return <LocalMenuPreview />;
}
