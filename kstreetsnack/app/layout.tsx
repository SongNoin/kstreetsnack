import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://songnoin.github.io/kstreetsnack";
const assetUrl = (path: string) => `${siteUrl.replace(/\/$/, "")}${path}`;
const structuredData = {
  "@context": "https://schema.org",
  "@type": "Restaurant",
  name: "K-Street K-Snack",
  alternateName: ["K Street Snack", "K Snack Wrocław", "케이 스트리트 스낵"],
  description:
    "Koreański street food prowadzony przez Koreańczyków we Wrocławiu: gimbap, tteokbokki, K-corn dog, ramen i bungeoppang.",
  image: assetUrl("/og.png"),
  logo: assetUrl("/brand/logo.png"),
  url: siteUrl,
  telephone: "+48 508 828 282",
  servesCuisine: ["Korean", "Korean street food"],
  priceRange: "zł",
  hasMenu: `${siteUrl.replace(/\/$/, "")}/#menu`,
  openingHoursSpecification: {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    opens: "11:00",
    closes: "21:00",
  },
  address: {
    "@type": "PostalAddress",
    streetAddress: "Wyścigowa 56g",
    postalCode: "53-012",
    addressLocality: "Wrocław",
    addressCountry: "PL",
  },
  sameAs: [
    "https://www.instagram.com/k_snack_pol/",
    "https://maps.app.goo.gl/vUGe4Hz7eJxEa6so7",
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
  icons: {
    icon: assetUrl("/brand/symbol.png"),
    apple: assetUrl("/brand/symbol.png"),
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
    <html lang="pl">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
      </body>
    </html>
  );
}
