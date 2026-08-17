import type { MetadataRoute } from "next";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://songnoin.github.io/kstreetsnack").replace(/\/$/, "");

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const homeLanguages = {
    "pl-PL": `${siteUrl}/`,
    en: `${siteUrl}/en/`,
    ko: `${siteUrl}/ko/`,
    "x-default": `${siteUrl}/`,
  };
  const menuLanguages = {
    "pl-PL": `${siteUrl}/menu/`,
    en: `${siteUrl}/en/menu/`,
    ko: `${siteUrl}/ko/menu/`,
    "x-default": `${siteUrl}/menu/`,
  };

  return [
    { url: `${siteUrl}/`, lastModified, changeFrequency: "weekly", priority: 1, alternates: { languages: homeLanguages } },
    { url: `${siteUrl}/en/`, lastModified, changeFrequency: "weekly", priority: 0.8, alternates: { languages: homeLanguages } },
    { url: `${siteUrl}/ko/`, lastModified, changeFrequency: "weekly", priority: 0.7, alternates: { languages: homeLanguages } },
    { url: `${siteUrl}/menu/`, lastModified, changeFrequency: "weekly", priority: 0.9, alternates: { languages: menuLanguages } },
    { url: `${siteUrl}/en/menu/`, lastModified, changeFrequency: "weekly", priority: 0.75, alternates: { languages: menuLanguages } },
    { url: `${siteUrl}/ko/menu/`, lastModified, changeFrequency: "weekly", priority: 0.7, alternates: { languages: menuLanguages } },
  ];
}
