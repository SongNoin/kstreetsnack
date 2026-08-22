export type AdminLanguage = "pl" | "en" | "ko";
export type AdminRole = "owner" | "manager" | "staff";
export type DeploymentStatus = "not_requested" | "queued" | "running" | "succeeded" | "failed";

export type LocalizedText = Record<AdminLanguage, string>;

export type MenuTag = "" | "spicy" | "mild-spicy" | "very-spicy" | "hot" | "ice";

export type AdminSection = {
  id: string;
  slug: string;
  name: LocalizedText;
  description: LocalizedText;
  sortOrder: number;
  archivedAt: string | null;
};

export type AdminCategory = {
  id: string;
  sectionId: string;
  slug: string;
  name: LocalizedText;
  description: LocalizedText;
  orderNote: LocalizedText;
  imagePath: string;
  cover: boolean;
  sortOrder: number;
  archivedAt: string | null;
};

export type AdminMenuItem = {
  id: string;
  categoryId: string;
  slug: string;
  name: LocalizedText;
  description: LocalizedText;
  price: LocalizedText;
  imagePath: string;
  tag: MenuTag;
  sortOrder: number;
  isAvailable: boolean;
  archivedAt: string | null;
  updatedAt: string;
};

export type PublicMenuItem = {
  id: string;
  name: readonly [string, string, string];
  price: readonly [string, string, string];
  tag?: Exclude<MenuTag, "">;
  availability: "available" | "sold_out";
  image?: string;
};

export type PublicMenuCategory = {
  id: string;
  title: readonly [string, string, string];
  subtitle: readonly [string, string, string];
  orderNote?: readonly [string, string, string];
  image: string;
  cover?: boolean;
  items: PublicMenuItem[];
};

export type PublishedMenuPayload = {
  schemaVersion: 1;
  publishedAt: string;
  groups: PublicMenuCategory[][];
};

export type AdminRelease = {
  id: string;
  version?: number;
  createdAt: string;
  itemCount: number;
  deploymentTriggered: boolean;
  deploymentStatus?: DeploymentStatus;
  deploymentRequestedAt?: string;
  deploymentStartedAt?: string;
  deploymentFinishedAt?: string;
  deploymentError?: string;
  deploymentRunUrl?: string;
  payload?: PublishedMenuPayload;
};

export type MenuAdminState = {
  schemaVersion: 1;
  sections: AdminSection[];
  categories: AdminCategory[];
  items: AdminMenuItem[];
  releases: AdminRelease[];
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  userId: string;
};

export type PublishResult = {
  releaseId: string;
  publishedAt: string;
  deploymentTriggered: false;
};

export type MenuRestoreStatus = {
  baselineKey: string;
  capturedAt: string;
  baselineSourceReleaseId: string;
  baselineSourceReleaseVersion: number;
  baselineItemCount: number;
  currentReleaseId: string;
  currentReleaseVersion: number;
  draftRevision: number;
  isDraftAtBaseline: boolean;
  isPublishedAtBaseline: boolean;
};

export type MenuRestoreResult = {
  requestId: string;
  restoredReleaseId: string;
  restoredAt: string;
  draftRevision: number;
  baselineSourceReleaseId: string;
  restoredItemCount: number;
};

export type DeploymentRequestResult = {
  releaseId: string;
  requestId: string;
  status: "queued";
};

export const emptyLocalizedText = (): LocalizedText => ({ pl: "", en: "", ko: "" });

export const toLocalizedTuple = (value: LocalizedText): readonly [string, string, string] => [
  value.pl,
  value.en,
  value.ko,
];
