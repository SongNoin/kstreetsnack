import type { Metadata } from "next";
import AdminDashboard from "../admin-dashboard";

export const metadata: Metadata = {
  title: "운영자 관리",
  description: "K STREET SNACK 운영자 승인과 권한 관리",
  robots: { index: false, follow: false },
};

export default function AdminOperatorsPage() {
  return <AdminDashboard view="operators" />;
}
