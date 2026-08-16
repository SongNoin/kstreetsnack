import { notFound } from "next/navigation";
import Home, { getPageMetadata, type Lang } from "../page";

const languages = ["en", "ko"] as const;

export function generateStaticParams() {
  return languages.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  if (!languages.includes(lang as (typeof languages)[number])) {
    return {};
  }

  return getPageMetadata(lang as Lang);
}

export default async function LanguagePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  if (!languages.includes(lang as (typeof languages)[number])) {
    notFound();
  }

  return <Home lang={lang as Lang} />;
}
