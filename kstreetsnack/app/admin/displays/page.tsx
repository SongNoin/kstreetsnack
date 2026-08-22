import type { Metadata } from "next";
import AdminDashboard from "../admin-dashboard";

export const metadata: Metadata = {
  title: "매장 메뉴판",
  description: "K STREET SNACK TV용 음식·카페 메뉴판",
  robots: { index: false, follow: false },
};

export default function AdminDisplaysPage() {
  return <AdminDashboard view="displays" />;
}
