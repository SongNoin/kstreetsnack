import type { Metadata } from "next";
import Image from "next/image";

export type Lang = "pl" | "en" | "ko";

const INSTAGRAM_URL = "https://www.instagram.com/k_snack_pol/";
const MAPS_URL = "https://maps.app.goo.gl/vUGe4Hz7eJxEa6so7";

const copy = {
  pl: {
    nav: { menu: "Menu", story: "O nas", visit: "Wrocław" },
    hero: {
      eyebrow: "Koreański street food · Wrocław",
      title: "Seul jest bliżej, niż myślisz.",
      body: "Prawdziwy koreański bunsik, chrupiące przekąski i kawa — przygotowywane przez Koreańczyków w sercu Wrocławia.",
      menuCta: "Zobacz menu",
      routeCta: "Jak dojechać",
      note: "Dobrze ostre. Zawsze świeże.",
    },
    marquee: "TASTE THE SEOUL STREET VIBES! · 한국의 맛, 폴란드의 거리 ·",
    menu: {
      kicker: "Co dziś jemy?",
      title: "Klasyki koreańskiej ulicy",
      intro: "Na szybki lunch, wieczorny comfort food albo słodką przerwę. Zamów przy ladzie i dobierz poziom ostrości.",
      onsite: "Sprawdź pełne menu i aktualne ceny",
    },
    products: [
      ["Gimbap", "Koreańska rolka ryżowa", "Ryż, świeże dodatki i morski aromat gim — zawinięte na jeden idealny kęs."],
      ["Tteokbokki", "Pikantne kluski ryżowe", "Sprężyste tteok w gęstym, słodko-pikantnym sosie. Seoul comfort food numer jeden."],
      ["K-Corn Dog", "Chrupiący na zewnątrz", "Kiełbasa, mozzarella albo mix w złocistej panierce. Wybierz swój ulubiony."],
      ["K-Chicken", "Koreański kurczak", "Soczysty kurczak bez kości: original, sweet & spicy albo soy — zawsze porządnie chrupiący."],
      ["Ramen", "Gorący i konkretny", "Original, Buldak dla odważnych lub Chapaghetti z sosem z czarnej fasoli."],
      ["Hodu gwaja", "Orzechowe ciasteczka", "Ciepłe ciasteczka w kształcie orzecha z czerwoną fasolą, kremem albo Nutellą."],
      ["Bungeoppang", "Słodki street classic", "Ciepłe ciastko w kształcie ryby z pastą z czerwonej fasoli, kremem lub Nutellą."],
      ["K-Coffee", "Kawa po naszemu", "Od espresso i yuja tea po matcha latte, ade i kremowe shake’i."],
    ],
    story: {
      kicker: "Korea → Polska",
      title: "Z Korei, na polską ulicę.",
      body: "K Street Snack prowadzą Koreańczycy, którzy chcieli podzielić się codziennym jedzeniem ze swojej ulicy — bez skrótów i bez udawania. Gotujemy smaki, które znamy z domu, i podajemy je po swojemu: świeżo, konkretnie i z energią koreańskiej ulicy.",
      quote: "Nie kopiujemy Seulu. Przywozimy jego energię.",
    },
    values: [
      ["01", "Koreańskie korzenie", "Smaki, które znamy z domu i naprawdę chcemy jeść sami."],
      ["02", "Uliczna energia", "Szybko, kolorowo i bez niepotrzebnego nadęcia."],
      ["03", "Po prostu wpadaj", "Na szybki lunch, kawę, coś słodkiego albo porządnie pikantną kolację."],
    ],
    instagram: {
      kicker: "Prosto z naszej kuchni",
      title: "Nowości najpierw na Instagramie.",
      body: "Nowe dania, sezonowe smaki, kulisy i wyjątkowe dni otwarcia publikujemy na bieżąco.",
      cta: "Obserwuj @k_snack_pol",
    },
    visit: {
      kicker: "Wpadnij do nas",
      title: "Czekamy we Wrocławiu",
      addressLabel: "Adres",
      address: "Wyścigowa 56G, 53-012 Wrocław",
      contactLabel: "Kontakt",
      phone: "+48 508 828 282",
      hoursLabel: "Godziny otwarcia",
      hours: "Wt–Nd · 11:00–21:00",
      closed: "Poniedziałek zamknięte",
      route: "Otwórz w Google Maps",
      call: "Zadzwoń teraz",
      instagram: "Obserwuj na Instagramie",
    },
    footer: "Koreański street food, made in Wrocław.",
  },
  en: {
    nav: { menu: "Menu", story: "Our story", visit: "Visit" },
    hero: {
      eyebrow: "Korean street food · Wrocław",
      title: "Seoul is closer than you think.",
      body: "Real Korean bunsik, crunchy snacks and coffee — made by Koreans in the heart of Wrocław.",
      menuCta: "See the menu",
      routeCta: "Get directions",
      note: "Properly spicy. Always fresh.",
    },
    marquee: "TASTE THE SEOUL STREET VIBES! · 한국의 맛, 폴란드의 거리 ·",
    menu: {
      kicker: "What are we eating?",
      title: "Korean street classics",
      intro: "A quick lunch, evening comfort food or a sweet break. Order at the counter and pick your heat level.",
      onsite: "See the full menu and current prices",
    },
    products: [
      ["Gimbap", "Korean rice roll", "Rice, fresh fillings and the ocean taste of gim — rolled into one perfect bite."],
      ["Tteokbokki", "Spicy rice cakes", "Bouncy tteok in a thick, sweet-spicy sauce. Seoul’s number one comfort food."],
      ["K-Corn Dog", "Crunchy on the outside", "Sausage, mozzarella or a mix in a golden crust. Pick your favourite."],
      ["K-Chicken", "Korean fried chicken", "Juicy boneless chicken: original, sweet & spicy, or soy — always properly crunchy."],
      ["Ramen", "Hot and satisfying", "Original, Buldak for the brave, or Chapaghetti with black bean sauce."],
      ["Hodu-gwaja", "Warm walnut pastries", "Walnut-shaped bites filled with red bean, custard or Nutella."],
      ["Bungeoppang", "The sweet street classic", "Warm fish-shaped pastry with red bean paste, cream or Nutella."],
      ["K-Coffee", "Coffee, our way", "From espresso and yuja tea to matcha latte, ade and creamy shakes."],
    ],
    story: {
      kicker: "Korea → Poland",
      title: "From Korea to your street.",
      body: "K Street Snack is run by Koreans who wanted to share the everyday food of their own streets — without shortcuts or pretending. We cook the flavours we know from home and serve them our way: fresh, generous and full of Korean street energy.",
      quote: "We don’t copy Seoul. We bring its energy.",
    },
    values: [
      ["01", "Korean roots", "The flavours we grew up with and genuinely want to eat ourselves."],
      ["02", "Street energy", "Fast, colourful and free from unnecessary fuss."],
      ["03", "Come as you are", "Drop in for a quick lunch, coffee, something sweet or a properly spicy dinner."],
    ],
    instagram: {
      kicker: "Fresh from our kitchen",
      title: "See it first on Instagram.",
      body: "New dishes, seasonal flavours, behind-the-scenes moments and special opening days — posted as they happen.",
      cta: "Follow @k_snack_pol",
    },
    visit: {
      kicker: "Come say annyeong",
      title: "Find us in Wrocław",
      addressLabel: "Address",
      address: "Wyścigowa 56G, 53-012 Wrocław",
      contactLabel: "Contact",
      phone: "+48 508 828 282",
      hoursLabel: "Opening hours",
      hours: "Tue–Sun · 11:00–21:00",
      closed: "Closed on Monday",
      route: "Open in Google Maps",
      call: "Call us",
      instagram: "Follow on Instagram",
    },
    footer: "Korean street food, made in Wrocław.",
  },
  ko: {
    nav: { menu: "메뉴", story: "우리 이야기", visit: "오시는 길" },
    hero: {
      eyebrow: "한국 스트리트 푸드 · 브로츠와프",
      title: "생각보다 가까운 서울의 맛.",
      body: "한국인이 직접 만드는 진짜 분식, 바삭한 간식과 커피를 폴란드 브로츠와프에서 만나보세요.",
      menuCta: "메뉴 보기",
      routeCta: "길 찾기",
      note: "제대로 맵고, 언제나 신선하게.",
    },
    marquee: "TASTE THE SEOUL STREET VIBES! · 한국의 맛, 폴란드의 거리 ·",
    menu: {
      kicker: "오늘 뭐 먹지?",
      title: "한국 길거리 음식의 정석",
      intro: "빠른 점심부터 든든한 저녁, 달콤한 휴식까지. 카운터에서 주문하고 원하는 매운맛을 골라보세요.",
      onsite: "전체 메뉴와 최신 가격 보기",
    },
    products: [
      ["김밥", "한 끼를 꽉 채운 롤", "밥과 신선한 속재료, 김의 풍미를 한입에 담았습니다."],
      ["떡볶이", "매콤달콤 쫄깃하게", "쫀득한 떡에 진한 매콤달콤 소스. 서울의 대표적인 소울푸드입니다."],
      ["K-핫도그", "겉은 바삭, 속은 든든", "소시지, 모짜렐라 또는 믹스를 황금빛 반죽에 바삭하게 튀겼습니다."],
      ["한국식 치킨", "바삭하고 촉촉하게", "오리지널, 매콤달콤 양념, 간장 맛 순살치킨을 제대로 바삭하게 준비합니다."],
      ["라면", "뜨겁고 확실한 한 그릇", "오리지널, 불닭, 짜파게티 중 오늘의 취향을 골라보세요."],
      ["호두과자", "따뜻한 한입 간식", "팥, 커스터드, 누텔라를 채운 따뜻한 호두 모양 과자입니다."],
      ["붕어빵", "따뜻한 길거리 디저트", "팥, 크림, 누텔라를 채운 바삭하고 따뜻한 붕어빵입니다."],
      ["K-커피", "우리 방식의 카페 메뉴", "에스프레소와 유자차부터 말차라테, 에이드, 셰이크까지 준비했어요."],
    ],
    story: {
      kicker: "한국 → 폴란드",
      title: "한국에서 폴란드 거리로.",
      body: "K Street Snack은 우리가 매일 먹고 자라온 길거리 음식을 나누고 싶은 한국인들이 운영합니다. 집에서부터 익숙한 맛을 바탕으로, 언제나 신선하고 든든하게 한국 거리의 활력을 담아냅니다.",
      quote: "우리가 자란 거리의 맛과 활기를 그대로 담았습니다.",
    },
    values: [
      ["01", "한국의 뿌리", "우리가 집에서 먹고 자란, 스스로 매일 찾게 되는 맛입니다."],
      ["02", "거리의 에너지", "빠르고, 다채롭고, 군더더기 없이 즐겁게 만듭니다."],
      ["03", "편하게 들러요", "빠른 점심, 커피와 디저트, 제대로 매운 저녁이 생각날 때 찾아오세요."],
    ],
    instagram: {
      kicker: "주방에서 바로 전하는 소식",
      title: "새로운 소식은 인스타그램에서 먼저.",
      body: "신메뉴, 계절 메뉴, 만드는 모습과 특별 영업일을 가장 빠르게 알려드립니다.",
      cta: "@k_snack_pol 팔로우",
    },
    visit: {
      kicker: "놀러 오세요",
      title: "브로츠와프에서 만나요",
      addressLabel: "주소",
      address: "Wyścigowa 56G, 53-012 Wrocław",
      contactLabel: "연락처",
      phone: "+48 508 828 282",
      hoursLabel: "영업시간",
      hours: "화–일 · 11:00–21:00",
      closed: "월요일 휴무",
      route: "Google Maps에서 보기",
      call: "전화하기",
      instagram: "Instagram 팔로우",
    },
    footer: "브로츠와프에서 만드는 한국 스트리트 푸드.",
  },
} as const;

const menuImages = [
  "gimbap-ai.webp",
  "tteokbokki-ai.webp",
  "corndog-ai.webp",
  "chicken-ai.webp",
  "ramen-self-ai.webp",
  "hodu-gwaja-ai.webp",
  "bungeoppang-ai.webp",
  "drinks-ai.webp",
];

const menuColors = ["yellow", "orange", "cream", "red", "olive", "yellow", "orange", "cream"];
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://songnoin.github.io/kstreetsnack").replace(/\/$/, "");

const seo = {
  pl: {
    title: "Koreański street food we Wrocławiu | K Street Snack",
    description:
      "Koreański street food prowadzony przez Koreańczyków we Wrocławiu. Spróbuj gimbapu, tteokbokki, koreańskich corn dogów, ramenu i bungeoppang.",
    path: "",
  },
  en: {
    title: "Korean Street Food in Wrocław | K Street Snack",
    description:
      "Authentic Korean street food made by Koreans in Wrocław, Poland. Discover gimbap, tteokbokki, Korean corn dogs, ramen and bungeoppang.",
    path: "/en",
  },
  ko: {
    title: "브로츠와프 한국 분식 맛집 | K Street Snack",
    description:
      "폴란드 브로츠와프에서 한국인이 직접 만드는 김밥, 떡볶이, 한국식 핫도그, 라면과 붕어빵을 만나보세요.",
    path: "/ko",
  },
} as const;

export function getPageMetadata(lang: Lang): Metadata {
  const current = seo[lang];
  const canonical = `${siteUrl}${current.path}/`;

  return {
    title: current.title,
    description: current.description,
    alternates: {
      canonical,
      languages: {
        "pl-PL": `${siteUrl}/`,
        "en": `${siteUrl}/en/`,
        "ko": `${siteUrl}/ko/`,
        "x-default": `${siteUrl}/`,
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

export const metadata: Metadata = getPageMetadata("pl");

export default function Home({ lang = "pl" }: { lang?: Lang }) {
  const t = copy[lang];
  const menuPagePath = lang === "pl" ? `${basePath}/menu/` : `${basePath}/${lang}/menu/`;

  return (
    <main className={`site lang-${lang}`} lang={lang}>
      <a className="skip-link" href="#menu">
        {t.nav.menu}
      </a>

      <header className="topbar">
        <a className="mini-logo" href="#top" aria-label="K Street Snack — home">
          <Image src={`${basePath}/brand/logo.png`} alt="K Street Snack" width={760} height={963} sizes="(max-width: 760px) 40px, 46px" priority />
        </a>
        <nav aria-label="Primary navigation">
          <a href={menuPagePath}>{t.nav.menu}</a>
          <a href="#story">{t.nav.story}</a>
          <a href="#visit">{t.nav.visit}</a>
        </nav>
        <div className="language-switcher" aria-label="Language">
          {(["pl", "en", "ko"] as Lang[]).map((item) => (
            <a
              key={item}
              href={item === "pl" ? `${basePath}/` : `${basePath}/${item}/`}
              className={lang === item ? "active" : ""}
              hrefLang={item === "pl" ? "pl-PL" : item}
              aria-current={lang === item ? "page" : undefined}
            >
              {item === "ko" ? "한" : item.toUpperCase()}
            </a>
          ))}
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">{t.hero.eyebrow}</p>
          <h1>
            {lang === "pl" ? (
              <>
                <span className="hero-title-line">Seul jest bliżej,</span>{" "}
                <span className="hero-title-line">niż myślisz.</span>
              </>
            ) : t.hero.title}
          </h1>
          <p className="hero-body">{t.hero.body}</p>
          <div className="hero-actions">
            <a className="button button-dark" href={menuPagePath}>
              {t.hero.menuCta} <span aria-hidden="true">↘</span>
            </a>
            <a
              className="button button-ghost"
              href={MAPS_URL}
              target="_blank"
              rel="noreferrer"
            >
              {t.hero.routeCta} <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>

        <div className="hero-visual" aria-label="K Street Snack signature tteokbokki">
          <Image className="hero-store" src={`${basePath}/store-interior.webp`} alt="" width={1152} height={1536} sizes="(max-width: 760px) 1px, 52vw" priority aria-hidden="true" />
          <div className="sun-disc" aria-hidden="true" />
          <Image className="hero-logo" src={`${basePath}/brand/logo.png`} alt="K Street Snack" width={760} height={963} priority />
          <Image className="hero-food" src={`${basePath}/menu/tteokbokki-ai.webp`} alt="Tteokbokki" width={1254} height={1254} sizes="(max-width: 760px) 410px, min(38vw, 620px)" priority />
          <Image className="hero-corn" src={`${basePath}/menu/corndog-ai.webp`} alt="" width={1254} height={1254} sizes="(max-width: 760px) 245px, min(25vw, 390px)" priority aria-hidden="true" />
          <span className="sticker sticker-one">HOT<br />&amp;<br />HAPPY</span>
          <span className="sticker sticker-two">SEOUL<br />TO<br />WROCŁAW</span>
        </div>
        <p className="hero-note">{t.hero.note}</p>
      </section>

      <div className="marquee" aria-hidden="true">
        <div>
          {[0, 1, 2, 3].map((item) => (
            <span className="marquee-item" key={item}>
              <Image src={`${basePath}/brand/symbol-variant-01.svg`} alt="" width={100} height={32} />
              <b>{t.marquee}</b>
            </span>
          ))}
        </div>
      </div>

      <section className="menu-section" id="menu">
        <div className="section-heading">
          <p className="eyebrow">{t.menu.kicker}</p>
          <h2>{t.menu.title}</h2>
          <p>{t.menu.intro}</p>
        </div>

        <div className="menu-grid">
          {t.products.map((product, index) => (
            <article className={`menu-card ${menuColors[index]}`} key={product[0]}>
              <div className="menu-card-number">0{index + 1}</div>
              <div className="menu-image-wrap">
                <Image src={`${basePath}/menu/${menuImages[index]}`} alt={product[0]} width={1254} height={1254} sizes="(max-width: 760px) 92vw, (max-width: 1080px) 46vw, 31vw" />
              </div>
              <div className="menu-copy">
                <p>{product[1]}</p>
                <h3>{product[0]}</h3>
                <span>{product[2]}</span>
              </div>
            </article>
          ))}
        </div>
        <p className="menu-footnote">
          <a href={menuPagePath}>
            ✦ {t.menu.onsite} <span aria-hidden="true">→</span>
          </a>
        </p>
      </section>

      <section className="story-section" id="story">
        <div className="story-symbol" aria-hidden="true">
          <Image src={`${basePath}/brand/symbol.png`} alt="" width={560} height={613} />
        </div>
        <div className="story-copy">
          <p className="eyebrow">{t.story.kicker}</p>
          <h2>{t.story.title}</h2>
          <p>{t.story.body}</p>
          <blockquote>{t.story.quote}</blockquote>
        </div>
      </section>

      <section className="values" aria-label="K Street Snack values">
        {t.values.map((value, index) => (
          <article key={value[0]} className={`value-card value-${index + 1}`}>
            <span>{value[0]}</span>
            <h3>{value[1]}</h3>
            <p>{value[2]}</p>
          </article>
        ))}
      </section>

      <section className="instagram-section">
        <div className="instagram-copy">
          <p className="eyebrow">{t.instagram.kicker}</p>
          <h2>{t.instagram.title}</h2>
          <p>{t.instagram.body}</p>
        </div>
        <a className="instagram-card" href={INSTAGRAM_URL} target="_blank" rel="noreferrer">
          <span>Instagram</span>
          <svg className="instagram-logo" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.67 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.69-4.92-4.92-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16ZM12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.63 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95C23.73 2.69 21.3.27 16.95.07 15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z" />
          </svg>
          <strong>{t.instagram.cta}</strong>
          <em aria-hidden="true">↗</em>
        </a>
      </section>

      <section className="visit-section" id="visit">
        <div className="visit-title">
          <p className="eyebrow">{t.visit.kicker}</p>
          <h2>{t.visit.title}</h2>
        </div>
        <div className="visit-card">
          <div>
            <p>{t.visit.addressLabel}</p>
            <address>{t.visit.address}</address>
          </div>
          <div>
            <p>{t.visit.contactLabel}</p>
            <a href="tel:+48508828282">{t.visit.phone}</a>
          </div>
          <div className="visit-hours">
            <p>{t.visit.hoursLabel}</p>
            <strong>{t.visit.hours}</strong>
            <span>{t.visit.closed}</span>
          </div>
          <a
            className="button button-dark"
            href={MAPS_URL}
            target="_blank"
            rel="noreferrer"
          >
            {t.visit.route} <span aria-hidden="true">↗</span>
          </a>
          <a className="button button-light" href={INSTAGRAM_URL} target="_blank" rel="noreferrer">
            {t.visit.instagram} <span aria-hidden="true">↗</span>
          </a>
        </div>
        <Image className="visit-drinks" src={`${basePath}/menu/drinks-ai.webp`} alt="" width={1254} height={1254} sizes="(max-width: 760px) 150px, 230px" aria-hidden="true" />
      </section>

      <footer>
        <div className="footer-logo">K-STREET <strong>SNACK</strong></div>
        <div className="footer-links">
          <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer">Instagram ↗</a>
          <a href={MAPS_URL} target="_blank" rel="noreferrer">Google Maps ↗</a>
        </div>
        <p>© {new Date().getFullYear()} K Street Snack</p>
      </footer>
    </main>
  );
}
