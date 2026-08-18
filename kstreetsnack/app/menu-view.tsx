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
    eyebrow: "K Street Snack Wrocław · Koreańskie jedzenie",
    lead: "Pełne menu koreańskiego street foodu we Wrocławiu — od gimbapu i tteokbokki po self ramen, kawę i koreańskie napoje.",
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
    title: "Menu K Street Snack Wrocław | Koreańskie jedzenie i ceny",
    description: "Menu K Street Snack we Wrocławiu: gimbap, tteokbokki, koreański kurczak, corn dogi, self ramen, słodkości, kawa i napoje. Sprawdź ceny.",
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
    title: { absolute: current.title },
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
      images: [
        {
          url: `${siteUrl}/og-logo.png`,
          width: 1200,
          height: 630,
          alt: "K Street Snack logo",
        },
      ],
    },
  };
}

export default function MenuView({ lang }: { lang: Lang }) {
  const ui = menuUi[lang];
  const t = menuCopy[lang];
  const menuUrl = `${siteUrl}${menuSeo[lang].path}/`;
  const menuStructuredData = {
    "@context": "https://schema.org",
    "@type": "Menu",
    "@id": `${menuUrl}#menu`,
    name: lang === "pl" ? "Menu K Street Snack Wrocław" : lang === "en" ? "K Street Snack Wrocław Menu" : "K Street Snack 브로츠와프 메뉴",
    url: menuUrl,
    inLanguage: lang === "pl" ? "pl-PL" : lang === "en" ? "en" : "ko-KR",
    mainEntityOfPage: menuUrl,
    hasMenuSection: fullMenuGroups.map((group, groupIndex) => ({
      "@type": "MenuSection",
      name: ui.groups[groupIndex],
      hasMenuItem: group.flatMap((category) => category.items.map((menuItem) => ({
        "@type": "MenuItem",
        name: localized(menuItem.name, lang),
        description: localized(category.subtitle, lang),
      }))),
    })),
  };

  return (
    <main className={`site menu-page lang-${lang}`} lang={lang}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(menuStructuredData) }}
      />
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
        <Image
          className="menu-hero-logo"
          src={`${basePath}/brand/wordmark-inverse.svg`}
          alt=""
          width={20}
          height={12}
          sizes="(max-width: 760px) 210px, 380px"
          aria-hidden="true"
          priority
        />
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
                        alt={`${localized(category.title, lang)} — K Street Snack Wrocław`}
                        width={1254}
                        height={1254}
                        sizes="(max-width: 760px) 100vw, 50vw"
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
                    {category.orderNote && (
                      <p className="full-menu-order-note">{localized(category.orderNote, lang)}</p>
                    )}
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
        <div className="menu-instagram-message">
          <svg className="menu-instagram-logo" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.67 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.69-4.92-4.92-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16ZM12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.63 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95C23.73 2.69 21.3.27 16.95.07 15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z" />
          </svg>
          <p>{t.instagram}</p>
        </div>
        <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer">@k_snack_pol ↗</a>
      </section>

      <footer>
        <a className="footer-brand" href={homePath(lang)} aria-label="K Street Snack — home">
          <Image className="footer-logo" src={`${basePath}/brand/logo.png`} alt="K Street Snack" width={760} height={963} sizes="(max-width: 760px) 104px, 118px" />
        </a>
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
