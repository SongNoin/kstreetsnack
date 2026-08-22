import type { Metadata } from "next";
import AdminDashboard from "./admin-dashboard";

export const metadata: Metadata = {
  title: "운영 대시보드",
  description: "K STREET SNACK 운영 현황 대시보드",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminDashboard view="dashboard" />;
}
