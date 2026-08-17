import type { Metadata } from "next";
import { Anton, Black_Han_Sans } from "next/font/google";
import "./globals.css";
import ScrollReveal from "./scroll-reveal";

const blackHanSans = Black_Han_Sans({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-black-han-sans",
});

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-anton",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://songnoin.github.io/kstreetsnack";
const assetUrl = (path: string) => `${siteUrl.replace(/\/$/, "")}${path}`;
const rootUrl = siteUrl.replace(/\/$/, "");
const restaurantId = `${rootUrl}/#restaurant`;
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${rootUrl}/#website`,
      url: `${rootUrl}/`,
      name: "K Street Snack",
      alternateName: "K-Street K-Snack",
      inLanguage: ["pl-PL", "en", "ko-KR"],
      publisher: { "@id": restaurantId },
    },
    {
      "@type": "Restaurant",
      "@id": restaurantId,
      name: "K-Street K-Snack",
      alternateName: ["K Street Snack", "K Snack Wrocław", "케이 스트리트 스낵"],
      description:
        "Koreański street food prowadzony przez Koreańczyków we Wrocławiu: gimbap, tteokbokki, K-corn dog, ramen i bungeoppang.",
      slogan: "Taste the Seoul street vibes",
      image: [assetUrl("/og.png"), assetUrl("/store-interior.webp")],
      logo: assetUrl("/brand/logo.png"),
      url: `${rootUrl}/`,
      telephone: "+48 508 828 282",
      servesCuisine: ["Korean", "Korean street food", "Bunsik"],
      priceRange: "PLN",
      currenciesAccepted: "PLN",
      hasMenu: { "@id": `${rootUrl}/menu/#menu` },
      hasMap: "https://maps.app.goo.gl/vUGe4Hz7eJxEa6so7",
      geo: {
        "@type": "GeoCoordinates",
        latitude: 51.0641882,
        longitude: 17.0043556,
      },
      openingHoursSpecification: {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        opens: "11:00",
        closes: "21:00",
      },
      address: {
        "@type": "PostalAddress",
        streetAddress: "Wyścigowa 56G",
        postalCode: "53-012",
        addressLocality: "Wrocław",
        addressRegion: "dolnośląskie",
        addressCountry: "PL",
      },
      areaServed: {
        "@type": "City",
        name: "Wrocław",
      },
      sameAs: [
        "https://www.instagram.com/k_snack_pol/",
        "https://maps.app.goo.gl/vUGe4Hz7eJxEa6so7",
      ],
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "K Street Snack — Korean Street Food in Wrocław",
    template: "%s · K Street Snack",
  },
  description:
    "Koreański street food prowadzony przez Koreańczyków we Wrocławiu. Gimbap, tteokbokki, K-corn dog, ramen, bungeoppang i K-coffee.",
  keywords: [
    "korean street food Wrocław",
    "koreańskie jedzenie Wrocław",
    "koreańska restauracja Wrocław",
    "tteokbokki Wrocław",
    "gimbap Wrocław",
    "korean corn dog Wrocław",
    "bunsik Wrocław",
    "떡볶이",
    "김밥",
    "K Street Snack",
  ],
  authors: [{ name: "K Street Snack" }],
  creator: "K Street Snack",
  category: "Korean restaurant, Korean street food, Bunsik",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "pl_PL",
    alternateLocale: ["en_GB", "ko_KR"],
    url: siteUrl,
    siteName: "K Street Snack",
    title: "K Street Snack — Taste the Seoul Street Vibes",
    description:
      "Prawdziwy koreański street food, przygotowywany przez Koreańczyków we Wrocławiu.",
    images: [
      {
        url: assetUrl("/og.png"),
        width: 1200,
        height: 630,
        alt: "K Street Snack — Taste the Seoul Street Vibes",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "K Street Snack — Taste the Seoul Street Vibes",
    description: "Korean street food, made in Wrocław.",
    images: [assetUrl("/og.png")],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl" className={`${blackHanSans.variable} ${anton.variable}`}>
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <ScrollReveal />
        {children}
      </body>
    </html>
  );
}
