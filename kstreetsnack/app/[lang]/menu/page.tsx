import { notFound } from "next/navigation";
import MenuView, { getMenuMetadata } from "../../menu-view";
import type { Lang } from "../../page";

const languages = ["en", "ko"] as const;

export function generateStaticParams() {
  return languages.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!languages.includes(lang as (typeof languages)[number])) return {};
  return getMenuMetadata(lang as Lang);
}

export default async function LanguageMenuPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!languages.includes(lang as (typeof languages)[number])) notFound();
  return <MenuView lang={lang as Lang} />;
}
