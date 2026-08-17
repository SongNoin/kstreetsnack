export type MenuLanguage = "pl" | "en" | "ko";

type Localized = readonly [string, string, string];
type MenuTag = "spicy" | "mild-spicy" | "very-spicy" | "hot" | "ice";

export type FullMenuItem = {
  name: Localized;
  price: string;
  tag?: MenuTag;
};

export type FullMenuCategory = {
  id: string;
  title: Localized;
  subtitle: Localized;
  image: string;
  imported?: boolean;
  items: readonly FullMenuItem[];
};

const item = (name: Localized, price: string, tag?: MenuTag): FullMenuItem => ({ name, price, tag });

export const menuUi = {
  pl: {
    kicker: "Pełne menu",
    title: "Wszystko, na co masz ochotę",
    intro: "Aktualne menu i ceny. Otwórz kategorię, aby zobaczyć wszystkie pozycje.",
    groups: ["Jedzenie", "Cafe & napoje"],
    open: "Otwórz kategorię",
    items: "pozycji",
    priceNote: "Ceny podane są w złotych. Dostępność może zmieniać się w ciągu dnia.",
    tags: { spicy: "ostre", "mild-spicy": "lekko ostre", "very-spicy": "bardzo ostre", hot: "hot", ice: "ice" },
  },
  en: {
    kicker: "Full menu",
    title: "Everything you’re craving",
    intro: "Current menu and prices. Open a category to see every item.",
    groups: ["Food", "Cafe & drinks"],
    open: "Open category",
    items: "items",
    priceNote: "Prices are in Polish złoty. Availability may change during the day.",
    tags: { spicy: "spicy", "mild-spicy": "mildly spicy", "very-spicy": "very spicy", hot: "hot", ice: "iced" },
  },
  ko: {
    kicker: "전체 메뉴",
    title: "오늘 먹고 싶은 모든 것",
    intro: "현재 메뉴와 가격입니다. 카테고리를 열어 전체 항목을 확인하세요.",
    groups: ["음식", "카페 & 음료"],
    open: "카테고리 열기",
    items: "개 메뉴",
    priceNote: "가격은 폴란드 즈워티 기준이며, 당일 재고에 따라 달라질 수 있습니다.",
    tags: { spicy: "매움", "mild-spicy": "약간 매움", "very-spicy": "매우 매움", hot: "따뜻하게", ice: "차갑게" },
  },
} as const;

export const fullMenuGroups: readonly (readonly FullMenuCategory[])[] = [
  [
    {
      id: "kimbap",
      title: ["Kimbap", "Gimbap", "김밥"],
      subtitle: ["Koreański street roll", "Korean street roll", "한국식 라이스롤"],
      image: "gimbap-ai.webp",
      items: [
        item(["Oryginalny", "Original", "기본"], "25 zł"),
        item(["Tuńczyk z majonezem", "Tuna mayo", "참치마요"], "38 zł"),
        item(["Bulgogi", "Bulgogi", "불고기"], "40 zł"),
      ],
    },
    {
      id: "corn-dog",
      title: ["Corn dog", "Korean corn dog", "K-핫도그"],
      subtitle: ["Chrupiący i ciągnący", "Crunchy and cheesy", "바삭하고 쭉 늘어나는 맛"],
      image: "corndog-ai.webp",
      items: [
        item(["Z parówką", "Sausage", "소시지"], "18 zł"),
        item(["Z mozzarellą", "Mozzarella", "모짜렐라"], "20 zł"),
        item(["Mix", "Sausage + mozzarella", "소시지 + 모짜렐라"], "20 zł"),
        item(["Ziemniaczany z parówką", "Potato & sausage", "감자 소시지"], "22 zł"),
      ],
    },
    {
      id: "tteokbokki",
      title: ["Tteokbokki", "Tteokbokki", "떡볶이"],
      subtitle: ["Koreańskie kluski ryżowe", "Korean rice cakes", "쫄깃한 한국 떡"],
      image: "tteokbokki-ai.webp",
      items: [
        item(["Oryginalne", "Original", "오리지널"], "40 zł", "spicy"),
        item(["Kremowe", "Creamy", "크림"], "45 zł", "mild-spicy"),
      ],
    },
    {
      id: "chicken",
      title: ["Kurczak", "Korean fried chicken", "한국식 치킨"],
      subtitle: ["M 200 g · L 400 g", "M 200 g · L 400 g", "M 200g · L 400g"],
      image: "imported/chicken.webp",
      imported: true,
      items: [
        item(["Smażony", "Original fried", "후라이드"], "M 35 zł · L 60 zł"),
        item(["Słodko-ostry", "Sweet & spicy", "양념"], "M 39 zł · L 65 zł", "spicy"),
        item(["Sojowy", "Soy", "간장"], "M 39 zł · L 65 zł"),
      ],
    },
    {
      id: "self-ramen",
      title: ["Self ramen", "Self ramen", "셀프 라면"],
      subtitle: ["Ugotuj na miejscu · każda sztuka 19 zł", "Cook it here · 19 zł each", "매장에서 직접 조리 · 모두 19 zł"],
      image: "ramen-self-ai.webp",
      items: [
        item(["Jin Ramen Spicy", "Jin Ramen Spicy", "진라면 매운맛"], "19 zł", "spicy"),
        item(["Jin Ramen Mild", "Jin Ramen Mild", "진라면 순한맛"], "19 zł"),
        item(["Soon Ramen", "Soon Ramen", "순라면"], "19 zł"),
        item(["Shin Ramen", "Shin Ramen", "신라면"], "19 zł", "spicy"),
        item(["Shin Ramen Kimchi", "Shin Ramen Kimchi", "신라면 김치"], "19 zł", "spicy"),
        item(["Neoguri Spicy", "Neoguri Spicy", "너구리 매운맛"], "19 zł", "spicy"),
        item(["Neoguri Mild", "Neoguri Mild", "너구리 순한맛"], "19 zł"),
        item(["Buldak", "Buldak", "불닭볶음면"], "19 zł", "very-spicy"),
        item(["Carbonara Buldak", "Carbonara Buldak", "까르보 불닭"], "19 zł", "spicy"),
        item(["Shin Ramen Toomba", "Shin Ramen Toomba", "신라면 툼바"], "19 zł", "spicy"),
        item(["Jjapagetti", "Jjapagetti", "짜파게티"], "19 zł"),
      ],
    },
    {
      id: "food-extras",
      title: ["Dodatki do dań", "Food add-ons", "음식 추가"],
      subtitle: ["Ramen toppings & sides", "Ramen toppings & sides", "라면 토핑과 사이드"],
      image: "ramen-self-ai.webp",
      items: [
        item(["Jajko", "Egg", "계란"], "+3 zł"),
        item(["Ser", "Cheese", "치즈"], "+3 zł"),
        item(["Kiełbasa", "Sausage", "소시지"], "+3 zł"),
        item(["Kimchi", "Kimchi", "김치"], "3 zł"),
        item(["Danmuji", "Pickled radish", "단무지"], "3 zł"),
        item(["Ryż", "Rice", "밥"], "8 zł"),
      ],
    },
    {
      id: "hodu-gwaja",
      title: ["Hodu gwaja", "Hodu-gwaja", "호두과자"],
      subtitle: ["Ciasteczko z orzechem · 3 / 5 szt.", "Walnut pastry · 3 / 5 pcs", "호두 모양 과자 · 3 / 5개"],
      image: "imported/hodu-gwaja.webp",
      imported: true,
      items: [
        item(["Czerwona fasola", "Red bean", "팥"], "3 szt. 7 zł · 5 szt. 10 zł"),
        item(["Krem budyniowy", "Custard", "커스터드"], "3 szt. 7 zł · 5 szt. 10 zł"),
        item(["Nutella", "Nutella", "누텔라"], "3 szt. 9 zł · 5 szt. 12 zł"),
        item(["Mix", "Mixed fillings", "믹스"], "3 szt. 8 zł · 5 szt. 11 zł"),
      ],
    },
    {
      id: "bungeoppang",
      title: ["Bungeoppang", "Bungeoppang", "붕어빵"],
      subtitle: ["Koreańskie ciastko · 1 / 3 / 5 szt.", "Fish-shaped pastry · 1 / 3 / 5 pcs", "물고기 모양 과자 · 1 / 3 / 5개"],
      image: "bungeoppang-ai.webp",
      items: [
        item(["Czerwona fasola", "Red bean", "팥"], "1 szt. 5 zł · 3 szt. 13 zł · 5 szt. 21 zł"),
        item(["Krem budyniowy", "Custard", "커스터드"], "1 szt. 5 zł · 3 szt. 13 zł · 5 szt. 21 zł"),
        item(["Nutella", "Nutella", "누텔라"], "1 szt. 6 zł · 3 szt. 16 zł · 5 szt. 25 zł"),
        item(["Mix", "Mixed fillings", "믹스"], "3 szt. 15 zł"),
      ],
    },
  ],
  [
    {
      id: "best-drinks",
      title: ["Best menu", "Best sellers", "인기 메뉴"],
      subtitle: ["Najczęściej wybierane", "Most popular", "가장 많이 찾는 메뉴"],
      image: "drinks-ai.webp",
      items: [
        item(["Espresso con panna", "Espresso con panna", "에스프레소 콘 파나"], "11 zł", "hot"),
        item(["Affogato", "Affogato", "아포가토"], "12 zł"),
        item(["K-Kawa", "K-Coffee", "K-커피"], "13 zł", "hot"),
        item(["Latte karmelowe", "Caramel latte", "카라멜 라테"], "19 zł", "hot"),
        item(["Mokka", "Cafe mocha", "카페 모카"], "19 zł", "hot"),
        item(["Matcha latte", "Matcha latte", "말차 라테"], "18 zł", "hot"),
      ],
    },
    {
      id: "classic-coffee",
      title: ["Kawa klasyczna", "Classic coffee", "클래식 커피"],
      subtitle: ["Coffee classics", "Coffee classics", "기본에 충실한 커피"],
      image: "drinks-ai.webp",
      items: [
        item(["Espresso", "Espresso", "에스프레소"], "9 zł", "hot"),
        item(["Americano", "Americano", "아메리카노"], "13 zł", "hot"),
        item(["Cafe latte", "Cafe latte", "카페 라테"], "15 zł", "hot"),
        item(["Cappuccino", "Cappuccino", "카푸치노"], "15 zł", "hot"),
        item(["Flat white", "Flat white", "플랫화이트"], "13 zł", "hot"),
      ],
    },
    {
      id: "cold-sweet",
      title: ["Zimne i słodkie", "Cold & sweet", "차갑고 달콤하게"],
      subtitle: ["Shakes, lemoniady & mojito", "Shakes, lemonade & mojito", "셰이크, 레모네이드 & 모히토"],
      image: "drinks-ai.webp",
      items: [
        item(["Shake waniliowy", "Vanilla shake", "바닐라 셰이크"], "20 zł", "ice"),
        item(["Shake czekoladowy", "Chocolate shake", "초콜릿 셰이크"], "20 zł", "ice"),
        item(["Shake truskawkowy", "Strawberry shake", "딸기 셰이크"], "20 zł", "ice"),
        item(["Lemoniada", "Lemonade", "레모네이드"], "16 zł", "ice"),
        item(["Lemoniada ananasowa", "Pineapple lemonade", "파인애플 레모네이드"], "16 zł", "ice"),
        item(["Lemoniada mango", "Mango lemonade", "망고 레모네이드"], "16 zł", "ice"),
        item(["Lemoniada malinowa", "Raspberry lemonade", "라즈베리 레모네이드"], "16 zł", "ice"),
        item(["Lemoniada truskawkowa", "Strawberry lemonade", "딸기 레모네이드"], "16 zł", "ice"),
        item(["Mojito", "Mojito", "모히토"], "16 zł", "ice"),
        item(["Mojito ananasowe", "Pineapple mojito", "파인애플 모히토"], "16 zł", "ice"),
      ],
    },
    {
      id: "tea-chocolate",
      title: ["Herbata & czekolada", "Tea & chocolate", "차 & 초콜릿"],
      subtitle: ["Bez kawy", "No coffee needed", "커피 없이 즐기는 메뉴"],
      image: "drinks-ai.webp",
      items: [
        item(["Herbata", "Tea", "차"], "15 zł", "hot"),
        item(["Herbata yuzu", "Yuja tea", "유자차"], "18 zł", "hot"),
        item(["Musująca mrożona herbata brzoskwiniowa", "Sparkling peach iced tea", "탄산 복숭아 아이스티"], "15 zł", "ice"),
        item(["Czekolada", "Hot chocolate", "핫초콜릿"], "17 zł", "hot"),
      ],
    },
    {
      id: "bottled-drinks",
      title: ["Napoje butelkowane", "Bottled drinks", "병음료"],
      subtitle: ["Schłodzone napoje", "Served chilled", "시원하게 즐기는 음료"],
      image: "imported/bottled-drinks.webp",
      imported: true,
      items: [
        item(["Coca-Cola", "Coca-Cola", "코카콜라"], "9 zł"),
        item(["Coca-Cola Zero", "Coca-Cola Zero", "코카콜라 제로"], "9 zł"),
        item(["Fanta", "Fanta", "환타"], "9 zł"),
        item(["Sprite", "Sprite", "스프라이트"], "9 zł"),
        item(["Woda gazowana", "Sparkling water", "탄산수"], "7 zł"),
        item(["Woda mineralna", "Still water", "생수"], "7 zł"),
        item(["Sok owocowy", "Fruit juice", "과일주스"], "8 zł"),
        item(["Koreański sok gruszkowy", "Korean pear juice", "한국 배주스"], "15 zł"),
      ],
    },
    {
      id: "drink-extras",
      title: ["Dodatki", "Extras", "음료 추가"],
      subtitle: ["Extras", "Make it your way", "취향에 맞게 더하기"],
      image: "drinks-ai.webp",
      items: [
        item(["Bita śmietanka", "Whipped cream", "휘핑크림"], "+2 zł"),
        item(["Mleko bez laktozy", "Lactose-free milk", "락토프리 우유"], "+1,5 zł"),
        item(["Mleko owsiane", "Oat milk", "오트밀크"], "+3 zł"),
        item(["1 shot espresso", "1 espresso shot", "에스프레소 샷 1회"], "+3 zł"),
        item(["2 shot espresso", "2 espresso shots", "에스프레소 샷 2회"], "+4 zł"),
      ],
    },
    {
      id: "alcohol",
      title: ["Alkohol", "Alcohol", "주류"],
      subtitle: ["Tylko dla osób 18+", "For guests aged 18+", "만 18세 이상"],
      image: "imported/bottled-drinks.webp",
      imported: true,
      items: [
        item(["Soonhari Apple", "Soonhari Apple", "순하리 애플"], "45 zł"),
        item(["Soonhari Mango", "Soonhari Mango", "순하리 망고"], "45 zł"),
        item(["Chamisul Fresh", "Chamisul Fresh", "참이슬 후레쉬"], "45 zł"),
        item(["Chamisul Green Grape", "Chamisul Green Grape", "참이슬 청포도"], "45 zł"),
        item(["Piwo", "Beer", "맥주"], "10 zł"),
      ],
    },
  ],
] as const;

export function localized(value: Localized, lang: MenuLanguage) {
  return value[lang === "pl" ? 0 : lang === "en" ? 1 : 2];
}

export function localizedPrice(price: string, lang: MenuLanguage) {
  if (lang === "en") return price.replaceAll("szt.", "pcs");
  if (lang === "ko") return price.replaceAll("szt.", "개");
  return price;
}
