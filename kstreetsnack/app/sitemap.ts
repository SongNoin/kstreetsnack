import type { MetadataRoute } from "next";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://songnoin.github.io/kstreetsnack").replace(/\/$/, "");

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const languages = {
    "pl-PL": `${siteUrl}/`,
    en: `${siteUrl}/en/`,
    ko: `${siteUrl}/ko/`,
    "x-default": `${siteUrl}/`,
  };

  return [
    { url: `${siteUrl}/`, changeFrequency: "weekly", priority: 1, alternates: { languages } },
    { url: `${siteUrl}/en/`, changeFrequency: "weekly", priority: 0.8, alternates: { languages } },
    { url: `${siteUrl}/ko/`, changeFrequency: "weekly", priority: 0.7, alternates: { languages } },
  ];
}
