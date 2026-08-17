import type { Metadata } from "next";
import Image from "next/image";
import { fullMenuGroups, localized, localizedPrice, menuUi } from "./menu-data";
import type { Lang } from "./page";

const INSTAGRAM_URL = "https://www.instagram.com/k_snack_pol/";
const MAPS_URL = "https://maps.app.goo.gl/vUGe4Hz7eJxEa6so7";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://songnoin.github.io/kstreetsnack").replace(/\/$/, "");

const menuCopy = {
  pl: {
    home: "Strona główna",
    visit: "Jak dojechać",
    eyebrow: "K Street Snack · Wrocław",
    lead: "Jedzenie, kawa i koreańskie napoje — wszystko w jednym miejscu.",
    instagram: "Nowości i sezonowe menu na Instagramie",
  },
  en: {
    home: "Home",
    visit: "Get directions",
    eyebrow: "K Street Snack · Wrocław",
    lead: "Food, coffee and Korean drinks — everything in one place.",
    instagram: "New dishes and seasonal menus on Instagram",
  },
  ko: {
    home: "메인으로",
    visit: "길 찾기",
    eyebrow: "K Street Snack · 브로츠와프",
    lead: "분식부터 커피와 한국 음료까지, 전체 메뉴를 한곳에서 확인하세요.",
    instagram: "신메뉴와 계절 메뉴는 Instagram에서",
  },
} as const;

const menuSeo = {
  pl: {
    title: "Menu i ceny | K Street Snack Wrocław",
    description: "Pełne menu K Street Snack we Wrocławiu: kimbap, tteokbokki, koreański kurczak, self ramen, słodkości, kawa i napoje.",
    path: "/menu",
  },
  en: {
    title: "Full Menu & Prices | K Street Snack Wrocław",
    description: "Explore the full K Street Snack menu in Wrocław: gimbap, tteokbokki, Korean fried chicken, self ramen, desserts, coffee and drinks.",
    path: "/en/menu",
  },
  ko: {
    title: "전체 메뉴와 가격 | K Street Snack 브로츠와프",
    description: "브로츠와프 K Street Snack의 김밥, 떡볶이, 한국식 치킨, 셀프 라면, 디저트, 커피와 음료 메뉴를 확인하세요.",
    path: "/ko/menu",
  },
} as const;

const homePath = (lang: Lang) => lang === "pl" ? `${basePath}/` : `${basePath}/${lang}/`;
const menuPath = (lang: Lang) => lang === "pl" ? `${basePath}/menu/` : `${basePath}/${lang}/menu/`;

export function getMenuMetadata(lang: Lang): Metadata {
  const current = menuSeo[lang];
  const canonical = `${siteUrl}${current.path}/`;

  return {
    title: current.title,
    description: current.description,
    alternates: {
      canonical,
      languages: {
        "pl-PL": `${siteUrl}/menu/`,
        en: `${siteUrl}/en/menu/`,
        ko: `${siteUrl}/ko/menu/`,
        "x-default": `${siteUrl}/menu/`,
      },
    },
    openGraph: {
      title: current.title,
      description: current.description,
      url: canonical,
      locale: lang === "pl" ? "pl_PL" : lang === "en" ? "en_GB" : "ko_KR",
    },
  };
}

export default function MenuView({ lang }: { lang: Lang }) {
  const ui = menuUi[lang];
  const t = menuCopy[lang];

  return (
    <main className={`site menu-page lang-${lang}`} lang={lang}>
      <a className="skip-link" href="#full-menu">{ui.kicker}</a>

      <header className="topbar">
        <a className="mini-logo" href={homePath(lang)} aria-label="K Street Snack — home">
          <Image src={`${basePath}/brand/logo.png`} alt="K Street Snack" width={760} height={963} sizes="(max-width: 760px) 40px, 46px" priority />
        </a>
        <nav aria-label="Primary navigation">
          <a href={homePath(lang)}>{t.home}</a>
          <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer">Instagram ↗</a>
          <a href={MAPS_URL} target="_blank" rel="noreferrer">{t.visit}</a>
        </nav>
        <div className="language-switcher" aria-label="Language">
          {(["pl", "en", "ko"] as Lang[]).map((item) => (
            <a
              key={item}
              href={menuPath(item)}
              className={lang === item ? "active" : ""}
              hrefLang={item === "pl" ? "pl-PL" : item}
              aria-current={lang === item ? "page" : undefined}
            >
              {item === "ko" ? "한" : item.toUpperCase()}
            </a>
          ))}
        </div>
      </header>

      <section className="menu-page-hero">
        <div>
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>{ui.kicker}</h1>
        </div>
        <p>{t.lead}</p>
        <Image src={`${basePath}/menu/chicken-ai.webp`} alt="" width={1254} height={1254} sizes="(max-width: 760px) 220px, 360px" aria-hidden="true" priority />
      </section>

      <section className="full-menu-section" id="full-menu">
        <div className="full-menu-heading">
          <p className="eyebrow">{ui.kicker}</p>
          <h2>{ui.title}</h2>
          <p>{ui.intro}</p>
        </div>

        {fullMenuGroups.map((group, groupIndex) => (
          <div className="full-menu-group" key={ui.groups[groupIndex]}>
            <div className="full-menu-group-title">
              <span>0{groupIndex + 1}</span>
              <h3>{ui.groups[groupIndex]}</h3>
            </div>
            <div className="full-menu-grid">
              {group.map((category, categoryIndex) => (
                <details
                  className={`full-menu-card tone-${(categoryIndex + groupIndex) % 4} ${category.cover ? "cover-photo" : "ai-photo"}`}
                  key={category.id}
                  open={groupIndex === 0 && categoryIndex === 0}
                >
                  <summary aria-label={`${ui.open}: ${localized(category.title, lang)}`}>
                    <span className="full-menu-photo">
                      <Image
                        src={`${basePath}/menu/${category.image}`}
                        alt=""
                        width={1254}
                        height={1254}
                        sizes="(max-width: 760px) 100vw, 50vw"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="full-menu-summary-copy">
                      <small>{localized(category.subtitle, lang)}</small>
                      <strong>{localized(category.title, lang)}</strong>
                      <em>{category.items.length} {ui.items}</em>
                    </span>
                    <span className="full-menu-toggle" aria-hidden="true">+</span>
                  </summary>
                  <div className="full-menu-list">
                    {category.items.map((menuItem) => (
                      <article key={`${category.id}-${menuItem.name[0]}`}>
                        <div>
                          <h4>{localized(menuItem.name, lang)}</h4>
                          {menuItem.tag && <span>{ui.tags[menuItem.tag]}</span>}
                        </div>
                        <strong>{localizedPrice(menuItem.price, lang)}</strong>
                      </article>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </div>
        ))}

        <p className="full-menu-note">{ui.priceNote}</p>
      </section>

      <section className="menu-instagram-strip">
        <p>{t.instagram}</p>
        <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer">@k_snack_pol ↗</a>
      </section>

      <footer>
        <div className="footer-logo">K-STREET <strong>SNACK</strong></div>
        <div className="footer-links">
          <a href={homePath(lang)}>{t.home} ←</a>
          <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer">Instagram ↗</a>
          <a href={MAPS_URL} target="_blank" rel="noreferrer">Google Maps ↗</a>
        </div>
        <p>© {new Date().getFullYear()} K Street Snack</p>
      </footer>
    </main>
  );
}
