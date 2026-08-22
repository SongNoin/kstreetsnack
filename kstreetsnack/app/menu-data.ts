export type MenuLanguage = "pl" | "en" | "ko";

type Localized = readonly [string, string, string];
type MenuTag = "spicy" | "mild-spicy" | "very-spicy" | "hot" | "ice";

export type FullMenuItem = {
  id?: string;
  name: Localized;
  price: string;
  tag?: MenuTag;
};

export type FullMenuCategory = {
  id: string;
  title: Localized;
  subtitle: Localized;
  orderNote?: Localized;
  image: string;
  cover?: boolean;
  items: readonly FullMenuItem[];
};

const item = (name: Localized, price: string, tag?: MenuTag): FullMenuItem => ({ name, price, tag });

export const menuUi = {
  pl: {
    kicker: "Pełne menu",
    title: "Wszystko, na co masz ochotę",
    intro: "Menu koreańskiego street foodu we Wrocławiu z aktualnymi cenami. Otwórz kategorię, aby zobaczyć wszystkie pozycje.",
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
    title: "입맛대로 골라보세요",
    intro: "현재 메뉴와 가격입니다. 카테고리를 열어 전체 항목을 확인하세요.",
    groups: ["음식", "카페 & 음료"],
    open: "카테고리 열기",
    items: "개 메뉴",
    priceNote: "가격은 폴란드 즈워티 기준이며, 당일 재고에 따라 달라질 수 있습니다.",
    tags: { spicy: "매움", "mild-spicy": "약간 매움", "very-spicy": "매우 매움", hot: "따뜻하게", ice: "차갑게" },
  },
} as const;

const menuGroupsWithoutItemIds: readonly (readonly FullMenuCategory[])[] = [
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
      subtitle: ["Chrupiący kurczak bez kości", "Crispy boneless chicken", "바삭하게 튀긴 순살치킨"],
      orderNote: ["Rozmiary: M 200 g · L 400 g", "Sizes: M 200 g · L 400 g", "사이즈: M 200g · L 400g"],
      image: "chicken-ai.webp",
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
      subtitle: ["Ciepłe ciasteczka z nadzieniem", "Warm walnut-shaped pastries", "따뜻한 호두 모양 과자"],
      orderNote: ["Porcje: 3 lub 5 szt.", "Order: 3 or 5 pcs", "주문 수량: 3개 또는 5개"],
      image: "hodu-gwaja-ai.webp",
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
      subtitle: ["Ciepłe ciastko w kształcie ryby", "Warm fish-shaped pastry", "따뜻한 물고기 모양 과자"],
      orderNote: ["Porcje: 1, 3 lub 5 szt.", "Order: 1, 3 or 5 pcs", "주문 수량: 1개, 3개 또는 5개"],
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
      image: "cafe-classic-ai.webp",
      cover: true,
      items: [
        item(["Espresso", "Espresso", "에스프레소"], "9 zł", "hot"),
        item(["Americano", "Americano", "아메리카노"], "13 zł", "hot"),
        item(["Cafe latte", "Cafe latte", "카페 라테"], "15 zł", "hot"),
        item(["Cappuccino", "Cappuccino", "카푸치노"], "15 zł", "hot"),
        item(["Flat white", "Flat white", "플랫화이트"], "13 zł", "hot"),
        item(["Bita śmietanka", "Whipped cream", "휘핑크림"], "+2 zł"),
        item(["Mleko bez laktozy", "Lactose-free milk", "락토프리 우유"], "+1,5 zł"),
        item(["Mleko owsiane", "Oat milk", "오트밀크"], "+3 zł"),
        item(["1 shot espresso", "1 espresso shot", "에스프레소 샷 1회"], "+3 zł"),
        item(["2 shot espresso", "2 espresso shots", "에스프레소 샷 2회"], "+4 zł"),
      ],
    },
    {
      id: "cold-sweet",
      title: ["Zimne i słodkie", "Cold & sweet", "차갑고 달콤하게"],
      subtitle: ["Shakes, lemoniady & mojito", "Shakes, lemonade & mojito", "셰이크, 레모네이드 & 모히토"],
      image: "cafe-cold-ai.webp",
      cover: true,
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
      image: "cafe-tea-ai.webp",
      cover: true,
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
      image: "cafe-bottled-ai.webp",
      cover: true,
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
      id: "alcohol",
      title: ["Alkohol", "Alcohol", "주류"],
      subtitle: ["Tylko dla osób 18+", "For guests aged 18+", "만 18세 이상"],
      image: "cafe-alcohol-ai.webp",
      cover: true,
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

// These UUIDs are the exact v5-shaped values produced by the original
// SHA-256 seed contract (`ksnack-menu-v1:item:<category>:<number>`). Keeping
// the generated values in browser-safe source gives the checked-in fallback
// menu the same item identity as Supabase without shipping Node's crypto API.
const seedMenuItemIds: Readonly<Record<string, string>> = {
  "kimbap-1": "dd55a804-8b80-57bc-9876-f90e186d73b4",
  "kimbap-2": "420f7bb3-0f33-57dd-a458-8583d210f542",
  "kimbap-3": "7f35a522-f771-5730-a931-3e4cd4ab57d4",
  "corn-dog-1": "83fa3850-e651-529d-8426-34f700031126",
  "corn-dog-2": "aaef3555-697f-59bd-8791-9ba47b850dc7",
  "corn-dog-3": "0f11f781-e167-51a5-afd7-50d5268fad92",
  "corn-dog-4": "06341096-e00b-5953-b55a-950f55a12e35",
  "tteokbokki-1": "43f7bee8-063c-5e0b-8844-2695d68251c0",
  "tteokbokki-2": "c232fd62-0289-56cb-acfe-e57a5b2c8e6a",
  "chicken-1": "a2088504-c865-5f3d-b571-e19e8a3039f4",
  "chicken-2": "7dc31903-0867-5f5f-a0b8-0142c63920b6",
  "chicken-3": "428e5290-c2c2-523b-834a-0148fd86a75b",
  "self-ramen-1": "3033f4c2-a899-57d0-a349-9bc564d15fa5",
  "self-ramen-2": "ecbb7012-5b8a-565d-93c3-e67714a5ccbb",
  "self-ramen-3": "262dd996-f893-5784-9722-f30f85dae2a9",
  "self-ramen-4": "2d807bd6-b9fc-599a-98ad-70b9b7259256",
  "self-ramen-5": "6c1f4a8d-5d17-508f-acde-3bff838cc3ae",
  "self-ramen-6": "36187c7e-76aa-5c8e-b248-6d48073ea8c7",
  "self-ramen-7": "7d448c87-6222-5afa-b442-11dbdfe112e7",
  "self-ramen-8": "b6dbd48f-b000-5a54-ad4b-540f1109191d",
  "self-ramen-9": "d69f078b-a947-52eb-9b02-4017a57cbc48",
  "self-ramen-10": "beccfcb0-00c8-5495-9969-c31d98741c4d",
  "self-ramen-11": "83838558-ddd6-5d3d-a6cf-dfa0a550ac2b",
  "self-ramen-12": "308d23a9-62db-5599-8cf3-3e8195537660",
  "self-ramen-13": "d4fc52c8-9153-5fca-9be6-39ce251b51a0",
  "self-ramen-14": "3bfcd7e4-b2dc-5306-a32c-426e23c7a6d3",
  "self-ramen-15": "072656b7-59da-59e3-9678-088c2c17d80a",
  "self-ramen-16": "7f6719ef-817d-5d61-8893-f534f1e0df28",
  "self-ramen-17": "aa157752-8d04-5c56-a8f9-af5c9c819dce",
  "hodu-gwaja-1": "6ed1d208-7869-546f-83ae-00534cbd6b31",
  "hodu-gwaja-2": "e369cd5b-ae75-5195-8e11-18d0722214af",
  "hodu-gwaja-3": "33cbed80-8eca-5c60-9f71-6158d875bb8b",
  "hodu-gwaja-4": "df519172-0d15-59cb-a3af-a7e305b6dcaf",
  "bungeoppang-1": "b4901a5e-9d5b-523e-94fd-1b3de4bd723a",
  "bungeoppang-2": "b42f20f2-6403-59a0-a7d7-840402ccc7c5",
  "bungeoppang-3": "5261c2c4-1e36-5933-aa48-acf719075901",
  "bungeoppang-4": "d78814e5-fe71-542f-a607-e307422b5c5d",
  "best-drinks-1": "c71aa13f-6d67-57c1-9d2c-22ae564e0c2e",
  "best-drinks-2": "7ade26ca-e9b0-56ed-bd76-423f67d7b005",
  "best-drinks-3": "05d99176-10fe-5541-9f79-cf542ae35a79",
  "best-drinks-4": "454ea0aa-02de-5fb4-a812-5986f0f1b45f",
  "best-drinks-5": "4798eec5-2e7d-5790-8c66-010323accae9",
  "best-drinks-6": "81564b53-02db-58d8-a5f4-e15714dd0757",
  "classic-coffee-1": "d87d96ef-2b03-5974-86eb-fffd82806ec6",
  "classic-coffee-2": "177b73f9-2d90-5457-826b-7b8d4ea6d20c",
  "classic-coffee-3": "2f301801-963f-598b-9cf6-4bccbfd1db48",
  "classic-coffee-4": "a0df4ed0-d135-5455-ae00-ad7447628a29",
  "classic-coffee-5": "d27af1d4-4df3-5999-924a-23ebec4ebc13",
  "classic-coffee-6": "2105df34-0e79-514c-81e2-0db5ed6c155e",
  "classic-coffee-7": "c77fee8c-9fad-511f-8c5e-88d417119fa0",
  "classic-coffee-8": "8463955d-74fb-5dac-8386-3708e26702df",
  "classic-coffee-9": "f1c50c52-63e0-5531-8a84-fc32d61d211b",
  "classic-coffee-10": "d0d0754b-8bdb-5e5e-81bd-76ecdf37a5bf",
  "cold-sweet-1": "665523f6-01ba-5c11-a11c-3c938f370d5f",
  "cold-sweet-2": "fe260fca-5894-5ff8-b37a-5ca49b889f88",
  "cold-sweet-3": "000a3eb2-1c55-5a20-8904-f8b0a117df8c",
  "cold-sweet-4": "f3cec2b2-76a1-58a4-978a-6f030191fc20",
  "cold-sweet-5": "a93cec08-0a47-5e03-838f-6f7731968932",
  "cold-sweet-6": "a9c75a01-e3ab-575c-b287-f092798f5744",
  "cold-sweet-7": "56ae25eb-d6e1-5a59-927e-74a45b7c10bf",
  "cold-sweet-8": "8c51fe67-5f70-5dca-9323-20719a89c661",
  "cold-sweet-9": "640229b3-9b32-5e45-981d-8fdda8ed75e2",
  "cold-sweet-10": "1731aeb2-a94f-51d4-ae78-256e1995af32",
  "tea-chocolate-1": "730adbce-c060-58fb-9581-95e25acff0f4",
  "tea-chocolate-2": "3f9623b8-7237-5852-abf1-ae296f7ca1ee",
  "tea-chocolate-3": "e0d023f9-d274-50b8-a6a0-5898d180a108",
  "tea-chocolate-4": "9bbe9584-dd05-55e5-9d98-e74bc20c7c05",
  "bottled-drinks-1": "68edbf9f-9684-597d-8776-259429a8a386",
  "bottled-drinks-2": "53bc8183-ee12-5d92-a449-95b50d436105",
  "bottled-drinks-3": "3b8c2873-7d41-5e83-b14a-55624ecb66d7",
  "bottled-drinks-4": "97b8d69e-7e5d-5a60-98f5-bdcef778ea3d",
  "bottled-drinks-5": "4e1f4d1c-acac-57e9-87c1-c847b1cc8b00",
  "bottled-drinks-6": "24bbf12b-9647-5e77-b1c7-599169cddab1",
  "bottled-drinks-7": "e52a025f-0596-531d-bb9d-938ea680a766",
  "bottled-drinks-8": "47b09ecb-f9d8-5510-812c-b30fbafe08cd",
  "alcohol-1": "01eaf921-ac60-5fcd-8b29-bbc402d9bdb0",
  "alcohol-2": "55d7337f-85ba-56f0-a6d9-079fa6a99c41",
  "alcohol-3": "5cc769b6-acfa-5442-89d1-f8858a3a1574",
  "alcohol-4": "3008b4aa-5875-53e5-9b6d-35811054119f",
  "alcohol-5": "c3180e22-d060-5dcc-bcba-4575e5042ff0",
};

export function seedMenuItemId(categoryId: string, itemNumber: number): string {
  const key = `${categoryId}-${itemNumber}`;
  const id = seedMenuItemIds[key];
  if (!id) throw new Error(`Missing stable seed menu item ID for ${key}.`);
  return id;
}

export const fullMenuGroups: readonly (readonly FullMenuCategory[])[] =
  menuGroupsWithoutItemIds.map((group) => group.map((category) => ({
    ...category,
    items: category.items.map((menuItem, itemIndex) => ({
      ...menuItem,
      id: seedMenuItemId(category.id, itemIndex + 1),
    })),
  })));

export function localized(value: Localized, lang: MenuLanguage) {
  return value[lang === "pl" ? 0 : lang === "en" ? 1 : 2];
}

export function localizedPrice(price: string, lang: MenuLanguage) {
  if (lang === "en") return price.replaceAll("szt.", "pcs");
  if (lang === "ko") return price.replaceAll("szt.", "개");
  return price;
}
