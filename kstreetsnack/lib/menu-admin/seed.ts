import { fullMenuGroups, localizedPrice, menuUi } from "@/app/menu-data";
import type {
  AdminCategory,
  AdminMenuItem,
  AdminSection,
  LocalizedText,
  MenuAdminState,
  MenuTag,
} from "./types";

const localized = (value: readonly [string, string, string]): LocalizedText => ({
  pl: value[0],
  en: value[1],
  ko: value[2],
});

const blankLocalized = (): LocalizedText => ({ pl: "", en: "", ko: "" });

const sections: AdminSection[] = [
  {
    id: "food",
    slug: "food",
    name: {
      pl: menuUi.pl.groups[0],
      en: menuUi.en.groups[0],
      ko: menuUi.ko.groups[0],
    },
    description: blankLocalized(),
    sortOrder: 0,
    archivedAt: null,
  },
  {
    id: "cafe-drinks",
    slug: "cafe-drinks",
    name: {
      pl: menuUi.pl.groups[1],
      en: menuUi.en.groups[1],
      ko: menuUi.ko.groups[1],
    },
    description: blankLocalized(),
    sortOrder: 1,
    archivedAt: null,
  },
];

const categories: AdminCategory[] = fullMenuGroups.flatMap((group, groupIndex) =>
  group.map((category, categoryIndex) => ({
    id: category.id,
    sectionId: sections[groupIndex].id,
    slug: category.id,
    name: localized(category.title),
    description: localized(category.subtitle),
    orderNote: category.orderNote ? localized(category.orderNote) : blankLocalized(),
    imagePath: `static:${category.image}`,
    cover: category.cover ?? false,
    sortOrder: categoryIndex,
    archivedAt: null,
  })),
);

const items: AdminMenuItem[] = fullMenuGroups.flatMap((group) =>
  group.flatMap((category) =>
    category.items.map((menuItem, itemIndex) => ({
      id: `${category.id}-${itemIndex + 1}`,
      categoryId: category.id,
      slug: `${category.id}-${itemIndex + 1}`,
      name: localized(menuItem.name),
      description: blankLocalized(),
      price: {
        pl: menuItem.price,
        en: localizedPrice(menuItem.price, "en"),
        ko: localizedPrice(menuItem.price, "ko"),
      },
      // The current site has category photographs rather than individual item
      // photographs, so each initial item deliberately inherits its category image.
      imagePath: `static:${category.image}`,
      tag: (menuItem.tag ?? "") as MenuTag,
      sortOrder: itemIndex,
      isAvailable: true,
      archivedAt: null,
      updatedAt: "2026-08-19T00:00:00.000Z",
    })),
  ),
);

export function createSeedState(): MenuAdminState {
  return structuredClone({
    schemaVersion: 1,
    sections,
    categories,
    items,
    releases: [],
  });
}
