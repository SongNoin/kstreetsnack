import type { Metadata } from "next";
import AdminDashboard from "../admin-dashboard";

export const metadata: Metadata = {
  title: "메뉴 관리",
  description: "K STREET SNACK 메뉴와 카테고리 관리",
  robots: { index: false, follow: false },
};

export default function AdminMenuPage() {
  return <AdminDashboard view="menu" />;
}
