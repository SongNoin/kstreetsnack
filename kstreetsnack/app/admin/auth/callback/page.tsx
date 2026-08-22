import type { Metadata } from "next";
import GoogleAuthCallback from "./callback-client";

export const metadata: Metadata = {
  title: "Google 로그인 확인",
  description: "K STREET SNACK 메뉴 관리 Google 로그인 확인 화면",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function GoogleAuthCallbackPage() {
  return <GoogleAuthCallback />;
}
