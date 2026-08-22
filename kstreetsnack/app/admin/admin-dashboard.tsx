"use client";

/* Dynamic previews can be local data/blob URLs or a Supabase Storage URL, so
   the admin intentionally uses native img elements instead of fixed Next Image sources. */
/* eslint-disable @next/next/no-img-element */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import {
  blobToDataUrl,
  loadLocalState,
  newLocalCategory,
  newLocalItem,
  optimizeImage,
  publishLocalState,
  resetLocalState,
  saveLocalState,
} from "@/lib/menu-admin/local-store";
import {
  createRemoteCategory,
  createRemoteItem,
  deleteRemoteAdminAccess,
  deleteRemoteCategory,
  isSupabaseConfigured,
  loadRemoteAdminCandidates,
  loadRemoteMenuRestoreResult,
  loadRemoteMenuRestoreStatus,
  loadRemoteRole,
  loadRemoteState,
  publishRemoteMenu,
  requestRemoteDeployment,
  rejectRemoteAdminAccessRequest,
  remoteAdminAccessIsDeleted,
  remoteAdminAccessMatches,
  remoteAdminAccessRequestIsRejected,
  reorderRemoteCategories,
  reorderRemoteItems,
  resolveAdminImage,
  restoreRemotePretestMenu,
  restoreSession,
  SESSION_EXPIRED_EVENT,
  setRemoteArchived,
  setRemoteAdminAccess,
  setRemoteAvailability,
  setRemoteCategoryArchived,
  signInWithGoogle,
  signOut,
  updateRemoteItem,
  updateRemoteCategory,
  uploadRemoteCategoryImage,
  uploadRemoteImage,
  type AdminAccessCandidate,
} from "@/lib/menu-admin/supabase-rest";
import {
  reorderAdminState,
  reorderAdminStateByOffset,
  withReorderBaseline,
  type DropPosition,
  type ReorderKind,
  type ReorderResult,
} from "@/lib/menu-admin/reorder";
import {
  diffReleasePayloads,
  summarizeReleasePayload,
} from "@/lib/menu-admin/release-details";
import type {
  AdminCategory,
  AdminLanguage,
  AdminMenuItem,
  AdminRelease,
  AdminRole,
  AuthSession,
  DeploymentStatus,
  MenuAdminState,
  MenuRestoreResult,
  MenuRestoreStatus,
  MenuTag,
  PublishResult,
} from "@/lib/menu-admin/types";
import { emptyLocalizedText } from "@/lib/menu-admin/types";
import styles from "./admin.module.css";

type ViewFilter = "active" | "archived";
type AdminView = "dashboard" | "menu" | "displays" | "operators";
type AvailabilityFilter = "all" | "available" | "sold-out";
type Notice = { tone: "success" | "error" | "info"; text: string } | null;
type DragState = { kind: ReorderKind; id: string } | null;
type DropTarget = { kind: ReorderKind; id: string; position: DropPosition } | null;
type TouchDrag = {
  kind: ReorderKind;
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  target: DropTarget;
};
type KeyboardReorder = {
  kind: ReorderKind;
  id: string;
  originalState: MenuAdminState;
  lastResult: ReorderResult | null;
};
type DeploymentOutcome = {
  kind: "accepted" | "failed" | "uncertain";
  status?: DeploymentStatus;
  errorMessage?: string;
};

const languages: { id: AdminLanguage; label: string; hint: string }[] = [
  { id: "pl", label: "PL", hint: "폴란드어" },
  { id: "en", label: "EN", hint: "영어" },
  { id: "ko", label: "KO", hint: "한국어" },
];

const tagOptions: { value: MenuTag; label: string }[] = [
  { value: "", label: "태그 없음" },
  { value: "spicy", label: "매움" },
  { value: "mild-spicy", label: "약간 매움" },
  { value: "very-spicy", label: "매우 매움" },
  { value: "hot", label: "따뜻하게" },
  { value: "ice", label: "차갑게" },
];

const tagLabel = Object.fromEntries(tagOptions.map((tag) => [tag.value, tag.label]));
const roleLabel: Record<AdminRole, string> = {
  owner: "최고 관리자",
  manager: "메뉴 관리자",
  staff: "매장 직원",
};
const roleDescription: Record<AdminRole, string> = {
  owner: "메뉴와 운영자를 모두 관리합니다.",
  manager: "메뉴·카테고리·사진을 수정하고 확인용으로 저장합니다.",
  staff: "메뉴를 보고 판매 중·품절 상태만 바꿉니다.",
};
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const adminDashboardPath = `${basePath}/admin/`;
const adminMenuPath = `${basePath}/admin/menu/`;
const adminDisplaysPath = `${basePath}/admin/displays/`;
const adminFoodDisplayPath = `${basePath}/admin/displays/food/`;
const adminCafeDisplayPath = `${basePath}/admin/displays/cafe/`;
const adminOperatorsPath = `${basePath}/admin/operators/`;
const adminPreviewPath = `${basePath}/admin/preview/`;
const pendingRestoreRequestStorageKey = "kstreet-admin-pending-menu-restore-request-id";
const deploymentStatusLabel: Record<DeploymentStatus, string> = {
  not_requested: "사이트 공개 전",
  queued: "공개 대기 중",
  running: "사이트 공개 중",
  succeeded: "사이트 공개 완료",
  failed: "사이트 공개 실패",
};
const restoreConfirmationPhrase = "테스트 전 메뉴로 복구";
const deploymentRetryAfterMs = 45 * 60 * 1000;

function deploymentStatusOf(release?: AdminRelease): DeploymentStatus {
  if (!release) return "not_requested";
  return release.deploymentStatus ?? (release.deploymentTriggered ? "queued" : "not_requested");
}

function deploymentWasAccepted(status: DeploymentStatus) {
  return status === "queued" || status === "running" || status === "succeeded";
}

function deploymentRetryIsDue(release?: AdminRelease, now = Date.now()) {
  const status = deploymentStatusOf(release);
  if (!release || (status !== "queued" && status !== "running")) return false;
  const requestedAt = Date.parse(release.deploymentRequestedAt ?? "");
  return Number.isFinite(requestedAt) && requestedAt <= now - deploymentRetryAfterMs;
}

function deploymentStatusClass(status: DeploymentStatus) {
  if (status === "succeeded") return styles.deploymentSucceeded;
  if (status === "failed") return styles.deploymentFailed;
  if (status === "queued" || status === "running") return styles.deploymentProgress;
  return styles.deploymentNotRequested;
}

function restoreIsConfirmed(
  result: MenuRestoreResult,
  status: MenuRestoreStatus,
  nextState: MenuAdminState,
) {
  return result.restoredItemCount === 80
    && status.baselineItemCount === 80
    && status.currentReleaseId === result.restoredReleaseId
    && status.draftRevision === result.draftRevision
    && status.isDraftAtBaseline
    && status.isPublishedAtBaseline
    && nextState.releases.some((release) => (
      release.id === result.restoredReleaseId && release.itemCount === result.restoredItemCount
    ));
}

function priceLines(value: string) {
  return value.split(/\s*·\s*/).map((part) => part.trim()).filter(Boolean);
}

function blankDraft(state: MenuAdminState): AdminMenuItem {
  const firstCategory = state.categories.find((category) => category.archivedAt === null);
  const categoryId = firstCategory?.id ?? "";
  const lastOrder = state.items
    .filter((item) => item.categoryId === categoryId && item.archivedAt === null)
    .reduce((highest, item) => Math.max(highest, item.sortOrder), -1);
  return {
    id: "",
    categoryId,
    slug: "",
    name: emptyLocalizedText(),
    description: emptyLocalizedText(),
    price: emptyLocalizedText(),
    imagePath: firstCategory?.imagePath ?? "",
    tag: "",
    sortOrder: lastOrder + 1,
    isAvailable: true,
    archivedAt: null,
    updatedAt: "",
  };
}

function blankCategoryDraft(state: MenuAdminState): AdminCategory {
  const firstSection = state.sections
    .filter((section) => section.archivedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const sectionId = firstSection?.id ?? "";
  const lastOrder = state.categories
    .filter((category) => category.sectionId === sectionId && category.archivedAt === null)
    .reduce((highest, category) => Math.max(highest, category.sortOrder), -1);
  return {
    id: "",
    sectionId,
    slug: "",
    name: emptyLocalizedText(),
    description: emptyLocalizedText(),
    orderNote: emptyLocalizedText(),
    imagePath: "",
    cover: false,
    sortOrder: lastOrder + 1,
    archivedAt: null,
  };
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function itemInput(item: AdminMenuItem) {
  return {
    categoryId: item.categoryId,
    name: item.name,
    description: item.description,
    price: item.price,
    imagePath: item.imagePath,
    tag: item.tag,
    sortOrder: item.sortOrder,
    isAvailable: item.isAvailable,
    archivedAt: item.archivedAt,
  };
}

function categoryInput(category: AdminCategory) {
  return {
    sectionId: category.sectionId,
    name: category.name,
    description: category.description,
    orderNote: category.orderNote,
    imagePath: category.imagePath,
    cover: category.cover,
    sortOrder: category.sortOrder,
    archivedAt: category.archivedAt,
  };
}

export default function AdminDashboard({ view }: { view: AdminView }) {
  const remoteMode = isSupabaseConfigured;
  const [state, setState] = useState<MenuAdminState | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [role, setRole] = useState<AdminRole | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("active");
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [draft, setDraft] = useState<AdminMenuItem | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [categoryPanelOpen, setCategoryPanelOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<AdminCategory | null>(null);
  const [pendingCategoryImage, setPendingCategoryImage] = useState<File | null>(null);
  const [categoryPreviewUrl, setCategoryPreviewUrl] = useState("");
  const [lastPublish, setLastPublish] = useState<PublishResult | null>(null);
  const [highlightItemId, setHighlightItemId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [keyboardReorder, setKeyboardReorder] = useState<KeyboardReorder | null>(null);
  const [reorderPreviewState, setReorderPreviewState] = useState<MenuAdminState | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const [reorderSyncUncertain, setReorderSyncUncertain] = useState(false);
  const [operatorCandidates, setOperatorCandidates] = useState<AdminAccessCandidate[]>([]);
  const [operatorRoleDrafts, setOperatorRoleDrafts] = useState<Record<string, AdminRole>>({});
  const [operatorLoading, setOperatorLoading] = useState(false);
  const [operatorError, setOperatorError] = useState("");
  const [operatorBusyId, setOperatorBusyId] = useState<string | null>(null);
  const [operatorBusyAction, setOperatorBusyAction] = useState<"save" | "reject" | "delete" | null>(null);
  const [menuRestoreStatus, setMenuRestoreStatus] = useState<MenuRestoreStatus | null>(null);
  const [menuRestoreStatusLoading, setMenuRestoreStatusLoading] = useState(false);
  const [menuRestoreStatusError, setMenuRestoreStatusError] = useState("");
  const [restoringPretestMenu, setRestoringPretestMenu] = useState(false);
  const [pendingRestoreRequestId, setPendingRestoreRequestId] = useState<string | null>(null);
  const [pendingRestoreResult, setPendingRestoreResult] = useState<MenuRestoreResult | null>(null);
  const [deployingReleaseId, setDeployingReleaseId] = useState<string | null>(null);
  const [deploymentUncertainReleaseId, setDeploymentUncertainReleaseId] = useState<string | null>(null);
  const [publicationReloadRequired, setPublicationReloadRequired] = useState(false);
  const categoryDialogRef = useRef<HTMLElement | null>(null);
  const categoryReturnFocusRef = useRef<HTMLElement | null>(null);
  const categoryInitialDraftRef = useRef<AdminCategory | null>(null);
  const pendingItemCreateRequestIdRef = useRef<string | null>(null);
  const pendingCategoryCreateRequestIdRef = useRef<string | null>(null);
  const pendingItemUploadedPathRef = useRef<string | null>(null);
  const pendingCategoryUploadedPathRef = useRef<string | null>(null);
  const categoryCurrentDraftRef = useRef<AdminCategory | null>(categoryDraft);
  const pendingCategoryImageRef = useRef<File | null>(pendingCategoryImage);
  const busyRef = useRef(busy);
  const touchDragRef = useRef<TouchDrag | null>(null);
  const suppressHandleClickRef = useRef(false);
  const keyboardReorderRef = useRef<KeyboardReorder | null>(keyboardReorder);
  const operatorRequestRef = useRef(false);
  const operatorBusyIdRef = useRef<string | null>(null);
  const categoryPanelView = categoryDraft ? (categoryDraft.id ? "edit" : "new") : "list";
  categoryCurrentDraftRef.current = categoryDraft;
  pendingCategoryImageRef.current = pendingCategoryImage;
  keyboardReorderRef.current = keyboardReorder;

  useEffect(() => {
    if (!remoteMode) return;
    const handleSessionExpired = () => {
      setSession(null);
      setRole(null);
      setState(null);
      setBooting(false);
      setBusy(false);
      setDraft(null);
      setPendingImage(null);
      setPreviewUrl("");
      setCategoryPanelOpen(false);
      setCategoryDraft(null);
      setPendingCategoryImage(null);
      setCategoryPreviewUrl("");
      setLastPublish(null);
      setDragging(null);
      setDropTarget(null);
      setKeyboardReorder(null);
      setReorderPreviewState(null);
      setReorderSyncUncertain(false);
      setOperatorCandidates([]);
      setOperatorRoleDrafts({});
      setOperatorLoading(false);
      setOperatorError("");
      setOperatorBusyId(null);
      setOperatorBusyAction(null);
      setMenuRestoreStatus(null);
      setMenuRestoreStatusLoading(false);
      setMenuRestoreStatusError("");
      setRestoringPretestMenu(false);
      setPendingRestoreRequestId(null);
      setPendingRestoreResult(null);
      setDeployingReleaseId(null);
      setDeploymentUncertainReleaseId(null);
      setPublicationReloadRequired(false);
      setNotice({ tone: "error", text: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요." });
      categoryInitialDraftRef.current = null;
      pendingItemCreateRequestIdRef.current = null;
      pendingCategoryCreateRequestIdRef.current = null;
      pendingItemUploadedPathRef.current = null;
      pendingCategoryUploadedPathRef.current = null;
      categoryReturnFocusRef.current = null;
      operatorRequestRef.current = false;
      operatorBusyIdRef.current = null;
      touchDragRef.current = null;
      keyboardReorderRef.current = null;
      busyRef.current = false;
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [remoteMode]);

  useEffect(() => {
    let active = true;
    async function boot() {
      if (!remoteMode) {
        if (active) {
          setState(loadLocalState());
          setBooting(false);
        }
        return;
      }
      try {
        const restored = await restoreSession();
        if (!active) return;
        if (restored) {
          const restoredRole = await loadRemoteRole(restored);
          const restoredState = await loadRemoteState(restored);
          if (!active) return;
          setSession(restored);
          setRole(restoredRole);
          setState(restoredState);
        }
      } catch (error) {
        if (active) setNotice({ tone: "error", text: error instanceof Error ? error.message : "데이터를 불러오지 못했습니다." });
      } finally {
        if (active) setBooting(false);
      }
    }
    void boot();
    return () => { active = false; };
  }, [remoteMode]);

  useEffect(() => {
    if (!remoteMode || !session || role !== "owner" || operatorRequestRef.current) return;
    let active = true;
    operatorRequestRef.current = true;
    setOperatorLoading(true);
    setOperatorError("");
    void loadRemoteAdminCandidates(session)
      .then((candidates) => {
        if (!active) return;
        setOperatorCandidates(candidates);
        setOperatorRoleDrafts(Object.fromEntries(
          candidates.map((candidate) => [candidate.userId, candidate.role ?? "staff"]),
        ));
      })
      .catch((error) => {
        if (active) setOperatorError(error instanceof Error ? error.message : "운영자 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        operatorRequestRef.current = false;
        if (active) setOperatorLoading(false);
      });
    return () => { active = false; };
  }, [remoteMode, role, session]);

  useEffect(() => {
    if (!remoteMode || !session || role !== "owner" || pendingRestoreRequestId) return;
    try {
      const storedRequestId = window.sessionStorage.getItem(pendingRestoreRequestStorageKey);
      if (storedRequestId) setPendingRestoreRequestId(storedRequestId);
    } catch {
      // The UI can still reconcile during this page visit when session storage is unavailable.
    }
  }, [pendingRestoreRequestId, remoteMode, role, session]);

  useEffect(() => {
    if (!remoteMode || !session || role !== "owner" || view !== "menu" || !state) {
      if (role !== "owner") {
        setMenuRestoreStatus(null);
        setMenuRestoreStatusError("");
      }
      return;
    }
    let active = true;
    setMenuRestoreStatusLoading(true);
    void loadRemoteMenuRestoreStatus(session)
      .then((status) => {
        if (!active) return;
        setMenuRestoreStatus(status);
        setMenuRestoreStatusError("");
      })
      .catch((error) => {
        if (!active) return;
        setMenuRestoreStatusError(error instanceof Error ? error.message : "복구 기준점을 확인하지 못했습니다.");
      })
      .finally(() => {
        if (active) setMenuRestoreStatusLoading(false);
      });
    return () => { active = false; };
  }, [remoteMode, role, session, state, view]);

  const deploymentPollingActive = Boolean(state?.releases.some((release) => {
    const status = deploymentStatusOf(release);
    return status === "queued" || status === "running";
  }));

  useEffect(() => {
    if (!remoteMode || !session || !deploymentPollingActive) return;
    let active = true;
    let timeout: number | undefined;

    const scheduleDeploymentPoll = () => {
      timeout = window.setTimeout(() => {
        void loadRemoteState(session)
          .then((nextState) => {
            if (!active) return;
            setState(nextState);
            const stillInProgress = nextState.releases.some((release) => {
              const status = deploymentStatusOf(release);
              return status === "queued" || status === "running";
            });
            if (stillInProgress) scheduleDeploymentPoll();
          })
          .catch(() => {
            // Keep polling after a transient network/RLS failure so the owner
            // still sees terminal state and the persisted 45-minute retry.
            if (active) scheduleDeploymentPoll();
          });
      }, 4500);
    };

    scheduleDeploymentPoll();
    return () => {
      active = false;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [deploymentPollingActive, remoteMode, session]);

  useEffect(() => {
    if (!pendingRestoreResult || !state) return;
    const restoredRelease = state.releases.find((release) => release.id === pendingRestoreResult.restoredReleaseId);
    if (restoredRelease && deploymentStatusOf(restoredRelease) === "succeeded") {
      setPendingRestoreResult(null);
    }
  }, [pendingRestoreResult, state]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => () => {
    if (categoryPreviewUrl) URL.revokeObjectURL(categoryPreviewUrl);
  }, [categoryPreviewUrl]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(
      () => setNotice((current) => current === notice ? null : current),
      notice.tone === "error" ? 6000 : 3200,
    );
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (view !== "menu") return;
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get("view");
    const requestedStatus = params.get("status");
    if (requestedView === "archived") {
      setViewFilter("archived");
      setAvailabilityFilter("all");
    } else if (requestedStatus === "sold-out" || requestedStatus === "available") {
      setViewFilter("active");
      setAvailabilityFilter(requestedStatus);
    }
    if (window.location.hash === "#saved-menu-records") {
      window.requestAnimationFrame(() => {
        document.getElementById("saved-menu-records")?.scrollIntoView({ block: "start" });
      });
    }
  }, [view]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!categoryPanelOpen) return;
    const dialog = categoryDialogRef.current;
    if (!dialog) return;

    const focusInitialControl = window.requestAnimationFrame(() => {
      const initialControl = categoryPanelView !== "list"
        ? dialog.querySelector<HTMLElement>("select, input:not([type='file'])")
        : dialog.querySelector<HTMLElement>("[data-category-primary]");
      (initialControl ?? dialog).focus();
    });

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (busyRef.current) return;
        if (keyboardReorderRef.current?.kind === "category") {
          event.preventDefault();
          setReorderPreviewState(null);
          setKeyboardReorder(null);
          setReorderAnnouncement("저장하지 않은 카테고리 순서 변경을 취소했습니다.");
          return;
        }
        const currentDraft = categoryCurrentDraftRef.current;
        const initialDraft = categoryInitialDraftRef.current;
        const hasUnsavedChanges = currentDraft !== null && (
          pendingCategoryImageRef.current !== null
          || initialDraft === null
          || JSON.stringify(currentDraft) !== JSON.stringify(initialDraft)
        );
        if (hasUnsavedChanges && !window.confirm("저장하지 않은 카테고리 변경사항이 있습니다. 입력 내용을 버릴까요?")) return;
        event.preventDefault();
        setCategoryPanelOpen(false);
        setCategoryDraft(null);
        setPendingCategoryImage(null);
        setCategoryPreviewUrl("");
        categoryInitialDraftRef.current = null;
        const returnTarget = categoryReturnFocusRef.current;
        categoryReturnFocusRef.current = null;
        window.requestAnimationFrame(() => returnTarget?.focus());
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      )).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(focusInitialControl);
      dialog.removeEventListener("keydown", handleDialogKeyDown);
    };
  }, [categoryPanelOpen, categoryPanelView]);

  const displayState = reorderPreviewState ?? state;
  const activeSections = useMemo(
    () => state?.sections.filter((section) => section.archivedAt === null).sort((a, b) => a.sortOrder - b.sortOrder) ?? [],
    [state],
  );
  const sectionOrder = useMemo(
    () => new Map(activeSections.map((section, index) => [section.id, index])),
    [activeSections],
  );
  const categories = useMemo(
    () => displayState?.categories
      .filter((category) => category.archivedAt === null)
      .sort((a, b) => (sectionOrder.get(a.sectionId) ?? Number.MAX_SAFE_INTEGER) - (sectionOrder.get(b.sectionId) ?? Number.MAX_SAFE_INTEGER)
        || a.sortOrder - b.sortOrder) ?? [],
    [displayState, sectionOrder],
  );
  const archivedCategories = useMemo(
    () => displayState?.categories
      .filter((category) => category.archivedAt !== null)
      .sort((a, b) => (sectionOrder.get(a.sectionId) ?? Number.MAX_SAFE_INTEGER) - (sectionOrder.get(b.sectionId) ?? Number.MAX_SAFE_INTEGER)
        || a.sortOrder - b.sortOrder) ?? [],
    [displayState, sectionOrder],
  );
  const categoryMap = useMemo(
    () => new Map((displayState?.categories ?? []).map((category) => [category.id, category])),
    [displayState],
  );
  const sectionMap = useMemo(
    () => new Map((state?.sections ?? []).map((section) => [section.id, section])),
    [state],
  );
  const activeItems = state?.items.filter((item) => item.archivedAt === null) ?? [];
  const soldOutItems = activeItems.filter((item) => !item.isAvailable);
  const archivedItems = state?.items.filter((item) => item.archivedAt !== null) ?? [];
  const canManageContent = (!remoteMode || role === "owner" || role === "manager") && !reorderSyncUncertain;
  const filteredItems = useMemo(() => {
    if (!displayState) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return displayState.items
      .filter((item) => viewFilter === "active" ? item.archivedAt === null : item.archivedAt !== null)
      .filter((item) => categoryFilter === "all" || item.categoryId === categoryFilter)
      .filter((item) => availabilityFilter === "all"
        || (availabilityFilter === "available" ? item.isAvailable : !item.isAvailable))
      .filter((item) => !normalizedQuery || Object.values(item.name).some((name) => name.toLocaleLowerCase().includes(normalizedQuery)))
      .sort((a, b) => {
        const aCategory = categoryMap.get(a.categoryId);
        const bCategory = categoryMap.get(b.categoryId);
        const sectionRank = (sectionOrder.get(aCategory?.sectionId ?? "") ?? Number.MAX_SAFE_INTEGER)
          - (sectionOrder.get(bCategory?.sectionId ?? "") ?? Number.MAX_SAFE_INTEGER);
        const categoryOrder = (aCategory?.sortOrder ?? 0) - (bCategory?.sortOrder ?? 0);
        return sectionRank || categoryOrder || a.sortOrder - b.sortOrder;
      });
  }, [availabilityFilter, categoryFilter, categoryMap, displayState, query, sectionOrder, viewFilter]);
  const menuReorderEnabled = canManageContent
    && viewFilter === "active"
    && categoryFilter !== "all"
    && !query.trim()
    && availabilityFilter === "all"
    && categoryMap.get(categoryFilter)?.archivedAt === null;
  const menuReorderHint = viewFilter !== "active"
    ? "보관한 메뉴는 순서를 바꿀 수 없습니다."
    : categoryFilter === "all"
      ? "메뉴 순서를 바꾸려면 왼쪽에서 카테고리를 하나 선택하세요."
      : query.trim()
        ? "검색 중에는 순서를 변경할 수 없습니다. 검색어를 지워 주세요."
        : availabilityFilter !== "all"
          ? "전체 상태 목록에서만 순서를 변경할 수 있습니다."
          : "순서 버튼을 끌거나 키보드 방향키로 같은 카테고리 안에서 순서를 바꾸세요.";

  useEffect(() => {
    if (keyboardReorder?.kind !== "item") return;
    const sourceItem = keyboardReorder.originalState.items.find((item) => item.id === keyboardReorder.id);
    if (menuReorderEnabled && sourceItem?.categoryId === categoryFilter) return;
    setReorderPreviewState(null);
    setKeyboardReorder(null);
    setReorderAnnouncement("검색 조건이 바뀌어 저장하지 않은 메뉴 순서 변경을 취소했습니다.");
  }, [categoryFilter, keyboardReorder, menuReorderEnabled]);

  useEffect(() => {
    if (keyboardReorder?.kind !== "item") return;
    const activeReorder = keyboardReorder;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busyRef.current) return;
      event.preventDefault();
      setReorderPreviewState(null);
      setKeyboardReorder(null);
      const label = (reorderPreviewState ?? state)?.items.find((item) => item.id === activeReorder.id)?.name.ko ?? "메뉴";
      setReorderAnnouncement(`‘${label}’ 순서 변경을 취소했습니다.`);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [keyboardReorder, reorderPreviewState, state]);

  async function reloadRemoteWithFallback(fallback: MenuAdminState, auth = session) {
    if (!auth) {
      setState(fallback);
      return { reloaded: false, errorMessage: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요." };
    }
    try {
      setState(await loadRemoteState(auth));
      return { reloaded: true, errorMessage: "" };
    } catch (error) {
      setState(fallback);
      return {
        reloaded: false,
        errorMessage: error instanceof Error ? error.message : "온라인 목록을 다시 불러오지 못했습니다.",
      };
    }
  }

  function hasUnsavedCategoryChanges() {
    const current = categoryCurrentDraftRef.current;
    const initial = categoryInitialDraftRef.current;
    if (!current) return false;
    return pendingCategoryImageRef.current !== null
      || initial === null
      || JSON.stringify(current) !== JSON.stringify(initial);
  }

  function confirmDiscardCategoryChanges() {
    return !hasUnsavedCategoryChanges()
      || window.confirm("저장하지 않은 카테고리 변경사항이 있습니다. 입력 내용을 버릴까요?");
  }

  function commitLocal(next: MenuAdminState) {
    saveLocalState(next);
    setState(next);
  }

  function reorderLabel(kind: ReorderKind, id: string, sourceState = displayState) {
    if (!sourceState) return kind === "category" ? "카테고리" : "메뉴";
    return kind === "category"
      ? sourceState.categories.find((category) => category.id === id)?.name.ko ?? "카테고리"
      : sourceState.items.find((item) => item.id === id)?.name.ko ?? "메뉴";
  }

  function sameReorderParent(sourceState: MenuAdminState, kind: ReorderKind, sourceId: string, targetId: string) {
    if (kind === "category") {
      const source = sourceState.categories.find((category) => category.id === sourceId);
      const target = sourceState.categories.find((category) => category.id === targetId);
      return Boolean(source && target && source.archivedAt === null && target.archivedAt === null && source.sectionId === target.sectionId);
    }
    const source = sourceState.items.find((item) => item.id === sourceId);
    const target = sourceState.items.find((item) => item.id === targetId);
    return Boolean(source && target && source.archivedAt === null && target.archivedAt === null && source.categoryId === target.categoryId);
  }

  function canStartReorder(kind: ReorderKind) {
    return !busy && !keyboardReorder && canManageContent && (kind === "category" || menuReorderEnabled);
  }

  function clearPointerReorder() {
    setDragging(null);
    setDropTarget(null);
    touchDragRef.current = null;
  }

  function focusReorderHandle(kind: ReorderKind, id: string) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const card = Array.from(document.querySelectorAll<HTMLElement>("[data-reorder-kind][data-reorder-id]"))
        .find((candidate) => candidate.dataset.reorderKind === kind && candidate.dataset.reorderId === id);
      const handle = card?.querySelector<HTMLElement>("[data-reorder-handle]");
      if (handle) handle.focus();
      else if (kind === "category") categoryDialogRef.current?.focus();
    }));
  }

  async function persistReorder(result: ReorderResult, previousState: MenuAdminState, restoreHandleFocus = false) {
    if (!result.changed) {
      setReorderPreviewState(null);
      setKeyboardReorder(null);
      clearPointerReorder();
      if (restoreHandleFocus) focusReorderHandle(result.kind, result.movedId);
      return;
    }
    if (state !== previousState) {
      setReorderPreviewState(null);
      setKeyboardReorder(null);
      clearPointerReorder();
      const message = "목록이 변경되어 저장하지 않은 순서 변경을 취소했습니다. 최신 목록에서 다시 시도해 주세요.";
      setReorderAnnouncement(message);
      setNotice({ tone: "info", text: message });
      if (restoreHandleFocus) focusReorderHandle(result.kind, result.movedId);
      return;
    }
    const label = reorderLabel(result.kind, result.movedId, result.state);
    const kind = result.kind;
    setBusy(true);
    setState(result.state);
    setReorderPreviewState(null);
    setKeyboardReorder(null);
    clearPointerReorder();
    try {
      let refreshFailed = false;
      if (remoteMode) {
        if (!session) throw new Error("로그인이 만료되었습니다.");
        if (kind === "category") await reorderRemoteCategories(result.parentId, result.expectedIds, result.orderedIds, session);
        else await reorderRemoteItems(result.parentId, result.expectedIds, result.orderedIds, session);
        const reloadResult = await reloadRemoteWithFallback(result.state, session);
        refreshFailed = !reloadResult.reloaded;
      } else {
        commitLocal(result.state);
      }
      setReorderSyncUncertain(false);
      const message = `‘${label}’ 순서를 ${result.movedTo + 1}번째로 변경했습니다. 확인용 저장 후 사이트에 공개하면 손님 화면에 반영됩니다.`;
      setReorderAnnouncement(message);
      setNotice(refreshFailed
        ? { tone: "info", text: `${message} 온라인 목록을 다시 불러오지 못해 저장 결과를 현재 화면에 그대로 두었습니다.` }
        : { tone: "success", text: message });
    } catch (error) {
      let recovered = false;
      let resultUnknown = false;
      if (remoteMode && session) {
        try {
          setState(await loadRemoteState(session));
          recovered = true;
        } catch {
          setState(result.state);
          setReorderSyncUncertain(true);
          resultUnknown = true;
        }
      } else {
        setState(previousState);
      }
      const detail = error instanceof Error ? error.message : "순서를 저장하지 못했습니다.";
      const message = resultUnknown
        ? `온라인 저장 결과를 확인하지 못해 수정을 잠시 막았습니다. 최신 목록을 다시 불러와 주세요. ${detail}`
        : recovered
        ? `순서를 저장하지 못해 최신 목록을 다시 불러왔습니다. ${detail}`
        : `순서를 저장하지 못했습니다. ${detail}`;
      setReorderAnnouncement(message);
      setNotice({ tone: "error", text: message });
    } finally {
      setBusy(false);
      if (restoreHandleFocus) focusReorderHandle(kind, result.movedId);
    }
  }

  async function retryReorderSync() {
    if (!session || busy) return;
    setBusy(true);
    try {
      setState(await loadRemoteState(session));
      setReorderSyncUncertain(false);
      setNotice({ tone: "success", text: "온라인에 저장된 최신 메뉴를 다시 불러왔습니다." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "최신 목록을 불러오지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  function applyDrop(kind: ReorderKind, sourceId: string, target: DropTarget) {
    if (!state || !target || target.kind !== kind || sourceId === target.id) {
      clearPointerReorder();
      return;
    }
    try {
      const result = reorderAdminState(state, kind, sourceId, target.id, target.position);
      void persistReorder(result, state);
    } catch (error) {
      clearPointerReorder();
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "순서를 변경하지 못했습니다." });
    }
  }

  function nativeDragStart(event: ReactDragEvent<HTMLButtonElement>, kind: ReorderKind, id: string) {
    if (!canStartReorder(kind)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${kind}:${id}`);
    const card = event.currentTarget.closest<HTMLElement>("[data-reorder-id]");
    if (card) event.dataTransfer.setDragImage(card, 24, 24);
    suppressHandleClickRef.current = true;
    setDragging({ kind, id });
    setDropTarget(null);
  }

  function nativeDragEnd() {
    clearPointerReorder();
    window.setTimeout(() => { suppressHandleClickRef.current = false; }, 0);
  }

  function dragOverCard(event: ReactDragEvent<HTMLElement>, kind: ReorderKind, targetId: string) {
    if (!state || !dragging || dragging.kind !== kind || !sameReorderParent(state, kind, dragging.id, targetId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    setDropTarget({ kind, id: targetId, position: event.clientY < rect.top + rect.height / 2 ? "before" : "after" });
  }

  function dropOnCard(event: ReactDragEvent<HTMLElement>, kind: ReorderKind, targetId: string) {
    event.preventDefault();
    if (!dragging || dragging.kind !== kind) return clearPointerReorder();
    const rect = event.currentTarget.getBoundingClientRect();
    applyDrop(kind, dragging.id, {
      kind,
      id: targetId,
      position: event.clientY < rect.top + rect.height / 2 ? "before" : "after",
    });
  }

  function touchPointerDown(event: ReactPointerEvent<HTMLButtonElement>, kind: ReorderKind, id: string) {
    if ((event.pointerType !== "touch" && event.pointerType !== "pen") || !canStartReorder(kind)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    touchDragRef.current = {
      kind,
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      target: null,
    };
  }

  function touchPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const touch = touchDragRef.current;
    if (!touch || touch.pointerId !== event.pointerId || !state) return;
    const distance = Math.hypot(event.clientX - touch.startX, event.clientY - touch.startY);
    if (!touch.active && distance < 8) return;
    event.preventDefault();
    if (!touch.active) {
      touch.active = true;
      suppressHandleClickRef.current = true;
      setDragging({ kind: touch.kind, id: touch.id });
    }
    const pointedElement = document.elementFromPoint(event.clientX, event.clientY);
    const scrollContainer = pointedElement?.closest<HTMLElement>("[data-reorder-scroll]");
    const scrollBounds = scrollContainer?.getBoundingClientRect();
    const edgeSize = 56;
    if (scrollContainer && scrollBounds) {
      if (event.clientY < scrollBounds.top + edgeSize) scrollContainer.scrollTop -= 18;
      else if (event.clientY > scrollBounds.bottom - edgeSize) scrollContainer.scrollTop += 18;
    } else if (event.clientY < edgeSize) {
      window.scrollBy(0, -18);
    } else if (event.clientY > window.innerHeight - edgeSize) {
      window.scrollBy(0, 18);
    }
    const element = pointedElement?.closest<HTMLElement>("[data-reorder-kind]");
    const targetKind = element?.dataset.reorderKind;
    const targetId = element?.dataset.reorderId;
    if (targetKind !== touch.kind || !targetId || !sameReorderParent(state, touch.kind, touch.id, targetId)) {
      touch.target = null;
      setDropTarget(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    const target: DropTarget = {
      kind: touch.kind,
      id: targetId,
      position: event.clientY < rect.top + rect.height / 2 ? "before" : "after",
    };
    touch.target = target;
    setDropTarget(target);
  }

  function touchPointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    const touch = touchDragRef.current;
    if (!touch || touch.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (touch.active) applyDrop(touch.kind, touch.id, touch.target);
    else clearPointerReorder();
    window.setTimeout(() => { suppressHandleClickRef.current = false; }, 0);
  }

  function touchPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    const touch = touchDragRef.current;
    if (!touch || touch.pointerId !== event.pointerId) return;
    clearPointerReorder();
    window.setTimeout(() => { suppressHandleClickRef.current = false; }, 0);
  }

  function reorderCardClass(kind: ReorderKind, id: string) {
    return [
      dragging?.kind === kind && dragging.id === id ? styles.isDragging : "",
      dropTarget?.kind === kind && dropTarget.id === id ? styles.dropTarget : "",
      dropTarget?.kind === kind && dropTarget.id === id && dropTarget.position === "before" ? styles.dropTargetBefore : "",
      dropTarget?.kind === kind && dropTarget.id === id && dropTarget.position === "after" ? styles.dropTargetAfter : "",
      keyboardReorder?.kind === kind && keyboardReorder.id === id ? styles.keyboardMoving : "",
    ].filter(Boolean).join(" ");
  }

  function activeSiblings(sourceState: MenuAdminState, kind: ReorderKind, id: string) {
    if (kind === "category") {
      const source = sourceState.categories.find((category) => category.id === id);
      return sourceState.categories
        .filter((category) => source && category.sectionId === source.sectionId && category.archivedAt === null)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    }
    const source = sourceState.items.find((item) => item.id === id);
    return sourceState.items
      .filter((item) => source && item.categoryId === source.categoryId && item.archivedAt === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function cancelKeyboardReorder(kind: ReorderKind, id: string) {
    if (keyboardReorder?.kind !== kind || keyboardReorder.id !== id) return;
    setReorderPreviewState(null);
    setKeyboardReorder(null);
    setReorderAnnouncement(`‘${reorderLabel(kind, id)}’ 순서 변경을 취소했습니다.`);
  }

  function toggleKeyboardReorder(kind: ReorderKind, id: string) {
    if (!canManageContent || (kind === "item" && !menuReorderEnabled) || busy || !state) return;
    if (!keyboardReorder) {
      setKeyboardReorder({ kind, id, originalState: state, lastResult: null });
      setReorderPreviewState(state);
      setReorderAnnouncement(`‘${reorderLabel(kind, id)}’ 순서 변경을 시작했습니다. 방향키나 이동 버튼으로 옮기고 다시 선택해 저장하세요.`);
    } else if (keyboardReorder.kind === kind && keyboardReorder.id === id) {
      if (keyboardReorder.lastResult?.changed) void persistReorder(keyboardReorder.lastResult, keyboardReorder.originalState, true);
      else {
        setReorderPreviewState(null);
        setKeyboardReorder(null);
      }
    }
  }

  function handleReorderClick(kind: ReorderKind, id: string) {
    if (suppressHandleClickRef.current) {
      suppressHandleClickRef.current = false;
      return;
    }
    toggleKeyboardReorder(kind, id);
  }

  function keyboardMove(event: ReactKeyboardEvent<HTMLButtonElement>, kind: ReorderKind, id: string) {
    if (!canManageContent || (kind === "item" && !menuReorderEnabled) || busy) return;
    const isToggleKey = event.key === " " || event.key === "Enter";
    if (event.key === "Escape" && keyboardReorder?.kind === kind && keyboardReorder.id === id) {
      event.preventDefault();
      event.stopPropagation();
      cancelKeyboardReorder(kind, id);
      return;
    }
    if (isToggleKey) {
      event.preventDefault();
      toggleKeyboardReorder(kind, id);
      return;
    }
    if (!keyboardReorder || keyboardReorder.kind !== kind || keyboardReorder.id !== id) return;
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const sourceState = reorderPreviewState ?? keyboardReorder.originalState;
    let result: ReorderResult | null = null;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      result = reorderAdminStateByOffset(sourceState, kind, id, event.key === "ArrowUp" ? -1 : 1);
    } else {
      const siblings = activeSiblings(sourceState, kind, id);
      const target = event.key === "Home" ? siblings[0] : siblings.at(-1);
      if (target && target.id !== id) {
        result = reorderAdminState(sourceState, kind, id, target.id, event.key === "Home" ? "before" : "after");
      }
    }
    if (!result) return;
    const sessionResult = withReorderBaseline(result, keyboardReorder.lastResult?.expectedIds ?? result.expectedIds);
    setReorderPreviewState(sessionResult.state);
    setKeyboardReorder({ ...keyboardReorder, lastResult: sessionResult });
    setReorderAnnouncement(`‘${reorderLabel(kind, id, sessionResult.state)}’ 순서를 ${sessionResult.movedTo + 1}번째로 옮겼습니다. Enter로 저장하거나 Esc로 취소하세요.`);
  }

  function moveWithTouchControls(kind: ReorderKind, id: string, offset: -1 | 1) {
    if (!state || busy || (kind === "item" && !menuReorderEnabled)) return;
    if (keyboardReorder) {
      if (keyboardReorder.kind !== kind || keyboardReorder.id !== id) return;
      const sourceState = reorderPreviewState ?? keyboardReorder.originalState;
      const previewResult = reorderAdminStateByOffset(sourceState, kind, id, offset);
      if (!previewResult) return;
      const sessionResult = withReorderBaseline(previewResult, keyboardReorder.lastResult?.expectedIds ?? previewResult.expectedIds);
      setReorderPreviewState(sessionResult.state);
      setKeyboardReorder({ ...keyboardReorder, lastResult: sessionResult });
      setReorderAnnouncement(`‘${reorderLabel(kind, id, sessionResult.state)}’ 순서를 ${sessionResult.movedTo + 1}번째로 옮겼습니다. 순서 변경 버튼을 다시 선택해 저장하세요.`);
      return;
    }
    const result = reorderAdminStateByOffset(state, kind, id, offset);
    if (result) void persistReorder(result, state);
  }

  async function handleGoogleLogin() {
    setBusy(true);
    setNotice(null);
    try {
      await signInWithGoogle();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Google 로그인을 시작하지 못했습니다." });
      setBusy(false);
    }
  }

  async function handleLogout() {
    if (!session) return;
    setBusy(true);
    let logoutError = "";
    try {
      await signOut(session);
    } catch (error) {
      logoutError = error instanceof Error ? error.message : "온라인 로그아웃 응답을 확인하지 못했습니다.";
    } finally {
      setSession(null);
      setRole(null);
      setState(null);
      setDraft(null);
      setPendingImage(null);
      setPreviewUrl("");
      setCategoryPanelOpen(false);
      setCategoryDraft(null);
      setPendingCategoryImage(null);
      setCategoryPreviewUrl("");
      setLastPublish(null);
      setDragging(null);
      setDropTarget(null);
      setKeyboardReorder(null);
      setReorderPreviewState(null);
      setReorderSyncUncertain(false);
      setOperatorCandidates([]);
      setOperatorRoleDrafts({});
      setOperatorLoading(false);
      setOperatorError("");
      setOperatorBusyId(null);
      setOperatorBusyAction(null);
      setMenuRestoreStatus(null);
      setMenuRestoreStatusLoading(false);
      setMenuRestoreStatusError("");
      setRestoringPretestMenu(false);
      setPendingRestoreRequestId(null);
      setPendingRestoreResult(null);
      setDeployingReleaseId(null);
      setDeploymentUncertainReleaseId(null);
      setNotice(logoutError
        ? { tone: "info", text: `이 브라우저에서는 로그아웃했습니다. ${logoutError}` }
        : null);
      categoryInitialDraftRef.current = null;
      categoryReturnFocusRef.current = null;
      operatorRequestRef.current = false;
      operatorBusyIdRef.current = null;
      touchDragRef.current = null;
      keyboardReorderRef.current = null;
      setBusy(false);
    }
  }

  async function refreshOperatorCandidates(auth: AuthSession) {
    if (operatorRequestRef.current) return;
    operatorRequestRef.current = true;
    setOperatorLoading(true);
    setOperatorError("");
    try {
      const candidates = await loadRemoteAdminCandidates(auth);
      replaceOperatorCandidates(candidates);
    } catch (error) {
      setOperatorError(error instanceof Error ? error.message : "운영자 목록을 불러오지 못했습니다.");
    } finally {
      operatorRequestRef.current = false;
      setOperatorLoading(false);
    }
  }

  function replaceOperatorCandidates(candidates: AdminAccessCandidate[]) {
    setOperatorCandidates(candidates);
    setOperatorRoleDrafts(Object.fromEntries(
      candidates.map((candidate) => [candidate.userId, candidate.role ?? "staff"]),
    ));
  }

  function showOperatorAccessSuccess(
    candidate: AdminAccessCandidate,
    nextRole: AdminRole,
    nextActive: boolean,
  ) {
    setNotice({
      tone: "success",
      text: nextActive
        ? `${candidate.email} 계정을 ${roleLabel[nextRole]} 권한으로 저장했습니다.`
        : `${candidate.email} 계정의 이용을 중지했습니다.`,
    });
  }

  function showOperatorReconciliationError(listReloaded: boolean) {
    const message = listReloaded
      ? "변경 결과를 확인할 수 없어 목록을 새로 불러왔습니다. 상태를 확인한 후 다시 시도해 주세요."
      : "변경 결과와 최신 목록을 확인할 수 없습니다. 인터넷 연결을 확인한 뒤 목록을 새로고침해 주세요.";
    setOperatorError(message);
    setNotice({ tone: "error", text: message });
  }

  async function changeOperatorAccess(
    candidate: AdminAccessCandidate,
    nextRole: AdminRole,
    nextActive: boolean,
  ) {
    if (!session || role !== "owner" || candidate.userId === session.userId || operatorRequestRef.current) return;
    const action = candidate.role === null
      ? `${roleLabel[nextRole]} 권한으로 승인`
      : !candidate.isActive && nextActive
        ? `${roleLabel[nextRole]} 권한으로 다시 사용하도록 허용`
        : candidate.isActive && !nextActive
          ? "이용 중지"
          : `${roleLabel[nextRole]} 권한으로 변경`;
    const extra = nextRole === "owner" && nextActive
      ? "\n최고 관리자는 메뉴를 수정하고, 운영자를 승인·거절하며, 다른 운영자의 권한과 이용 여부를 바꿀 수 있습니다."
      : candidate.isActive && !nextActive
        ? "\n즉시 메뉴 관리에 들어올 수 없게 되며 Google 계정은 삭제되지 않습니다."
        : "";
    if (!window.confirm(`${candidate.email} 계정을 ${action}할까요?${extra}`)) return;

    operatorRequestRef.current = true;
    operatorBusyIdRef.current = candidate.userId;
    setOperatorBusyId(candidate.userId);
    setOperatorBusyAction("save");
    setOperatorError("");
    try {
      const updated = await setRemoteAdminAccess(candidate, nextRole, nextActive, session);
      setOperatorCandidates((current) => current.map((entry) => entry.userId === updated.userId ? updated : entry));
      setOperatorRoleDrafts((current) => ({ ...current, [updated.userId]: updated.role ?? nextRole }));
      showOperatorAccessSuccess(updated, nextRole, nextActive);
    } catch {
      try {
        const candidates = await loadRemoteAdminCandidates(session);
        replaceOperatorCandidates(candidates);
        const reconciled = candidates.find((entry) => entry.userId === candidate.userId);
        if (reconciled && remoteAdminAccessMatches(candidates, candidate.userId, nextRole, nextActive)) {
          setOperatorError("");
          showOperatorAccessSuccess(reconciled, nextRole, nextActive);
        } else {
          showOperatorReconciliationError(true);
        }
      } catch {
        replaceOperatorCandidates([]);
        showOperatorReconciliationError(false);
      }
    } finally {
      operatorRequestRef.current = false;
      operatorBusyIdRef.current = null;
      setOperatorBusyId(null);
      setOperatorBusyAction(null);
    }
  }

  async function rejectOperatorRequest(candidate: AdminAccessCandidate) {
    if (!session || role !== "owner" || candidate.userId === session.userId || !candidate.requestedAt || operatorRequestRef.current) return;
    const rejectionResult = candidate.role === null
      ? "거절하면 이 계정은 메뉴 관리에 들어올 수 없습니다. Google로 다시 로그인하면 새 요청을 보낼 수 있습니다."
      : "거절해도 계정은 이용 중지 상태로 남습니다. Google로 다시 로그인하면 다시 요청할 수 있습니다.";
    if (!window.confirm(`${candidate.email} 계정의 운영자 요청을 거절할까요?\n${rejectionResult}`)) return;

    operatorRequestRef.current = true;
    operatorBusyIdRef.current = candidate.userId;
    setOperatorBusyId(candidate.userId);
    setOperatorBusyAction("reject");
    setOperatorError("");
    try {
      await rejectRemoteAdminAccessRequest(candidate, session);
      setOperatorCandidates((current) => candidate.role === null
        ? current.filter((entry) => entry.userId !== candidate.userId)
        : current.map((entry) => entry.userId === candidate.userId ? { ...entry, requestedAt: null } : entry));
      setNotice({ tone: "success", text: `${candidate.email} 계정의 운영자 요청을 거절했습니다.` });
    } catch {
      try {
        const candidates = await loadRemoteAdminCandidates(session);
        replaceOperatorCandidates(candidates);
        if (remoteAdminAccessRequestIsRejected(candidates, candidate.userId)) {
          setOperatorError("");
          setNotice({ tone: "success", text: `${candidate.email} 계정의 운영자 요청을 거절했습니다.` });
        } else {
          showOperatorReconciliationError(true);
        }
      } catch {
        replaceOperatorCandidates([]);
        showOperatorReconciliationError(false);
      }
    } finally {
      operatorRequestRef.current = false;
      operatorBusyIdRef.current = null;
      setOperatorBusyId(null);
      setOperatorBusyAction(null);
    }
  }

  async function deleteOperatorAccess(candidate: AdminAccessCandidate) {
    if (
      !session
      || role !== "owner"
      || candidate.userId === session.userId
      || candidate.role === null
      || candidate.isActive
      || operatorRequestRef.current
    ) return;

    const confirmed = window.confirm(
      `${candidate.email} 계정을 운영자 목록에서 삭제할까요?\n\n`
      + "운영툴 이용 권한과 다시 사용 요청만 삭제됩니다. Google 계정은 삭제되지 않습니다. "
      + "이 계정으로 다시 로그인하면 운영자 사용 요청을 다시 보낼 수 있습니다.",
    );
    if (!confirmed) return;

    operatorRequestRef.current = true;
    operatorBusyIdRef.current = candidate.userId;
    setOperatorBusyId(candidate.userId);
    setOperatorBusyAction("delete");
    setOperatorError("");

    const showSuccess = () => {
      setOperatorCandidates((current) => current.filter((entry) => entry.userId !== candidate.userId));
      setOperatorRoleDrafts((current) => {
        const next = { ...current };
        delete next[candidate.userId];
        return next;
      });
      setOperatorError("");
      setNotice({ tone: "success", text: `${candidate.email} 계정을 운영자 목록에서 삭제했습니다.` });
    };

    try {
      await deleteRemoteAdminAccess(candidate, session);
      showSuccess();
    } catch {
      try {
        const candidates = await loadRemoteAdminCandidates(session);
        replaceOperatorCandidates(candidates);
        if (remoteAdminAccessIsDeleted(candidates, candidate.userId)) {
          showSuccess();
        } else {
          showOperatorReconciliationError(true);
        }
      } catch {
        showOperatorReconciliationError(false);
      }
    } finally {
      operatorRequestRef.current = false;
      operatorBusyIdRef.current = null;
      setOperatorBusyId(null);
      setOperatorBusyAction(null);
    }
  }

  function openAdd() {
    if (!state || !canManageContent) return;
    setPendingImage(null);
    setPreviewUrl("");
    pendingItemCreateRequestIdRef.current = crypto.randomUUID();
    pendingItemUploadedPathRef.current = null;
    setDraft(blankDraft(state));
  }

  function openEdit(item: AdminMenuItem) {
    if (!canManageContent) return;
    setPendingImage(null);
    setPreviewUrl("");
    pendingItemCreateRequestIdRef.current = null;
    pendingItemUploadedPathRef.current = null;
    setDraft(structuredClone(item));
  }

  function closeEditor() {
    if (busy) return;
    setDraft(null);
    setPendingImage(null);
    setPreviewUrl("");
    pendingItemCreateRequestIdRef.current = null;
    pendingItemUploadedPathRef.current = null;
  }

  function chooseImage(file: File | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingImage(file);
    setPreviewUrl(file ? URL.createObjectURL(file) : "");
    pendingItemUploadedPathRef.current = null;
  }

  function openCategoryManager() {
    if (!state || !canManageContent || keyboardReorder) return;
    categoryReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDraft(null);
    setCategoryDraft(null);
    setPendingCategoryImage(null);
    setCategoryPreviewUrl("");
    categoryInitialDraftRef.current = null;
    pendingCategoryCreateRequestIdRef.current = null;
    pendingCategoryUploadedPathRef.current = null;
    setCategoryPanelOpen(true);
  }

  function openCategoryAdd() {
    if (!state || !canManageContent) return;
    const nextDraft = blankCategoryDraft(state);
    setPendingCategoryImage(null);
    setCategoryPreviewUrl("");
    pendingCategoryCreateRequestIdRef.current = crypto.randomUUID();
    pendingCategoryUploadedPathRef.current = null;
    categoryInitialDraftRef.current = structuredClone(nextDraft);
    setCategoryDraft(nextDraft);
    setCategoryPanelOpen(true);
  }

  function openCategoryEdit(category: AdminCategory) {
    if (!canManageContent) return;
    const nextDraft = structuredClone(category);
    setPendingCategoryImage(null);
    setCategoryPreviewUrl("");
    pendingCategoryCreateRequestIdRef.current = null;
    pendingCategoryUploadedPathRef.current = null;
    categoryInitialDraftRef.current = structuredClone(nextDraft);
    setCategoryDraft(nextDraft);
    setCategoryPanelOpen(true);
  }

  function closeCategoryPanel() {
    if (busy) return;
    if (!confirmDiscardCategoryChanges()) return;
    setCategoryPanelOpen(false);
    setCategoryDraft(null);
    setPendingCategoryImage(null);
    setCategoryPreviewUrl("");
    categoryInitialDraftRef.current = null;
    pendingCategoryCreateRequestIdRef.current = null;
    pendingCategoryUploadedPathRef.current = null;
    if (keyboardReorder?.kind === "category") {
      setReorderPreviewState(null);
      setKeyboardReorder(null);
    }
    const returnTarget = categoryReturnFocusRef.current;
    categoryReturnFocusRef.current = null;
    window.requestAnimationFrame(() => returnTarget?.focus());
  }

  function backToCategoryManager() {
    if (busy) return;
    if (!confirmDiscardCategoryChanges()) return;
    setCategoryDraft(null);
    setPendingCategoryImage(null);
    setCategoryPreviewUrl("");
    categoryInitialDraftRef.current = null;
    pendingCategoryCreateRequestIdRef.current = null;
    pendingCategoryUploadedPathRef.current = null;
  }

  function chooseCategoryImage(file: File | null) {
    if (categoryPreviewUrl) URL.revokeObjectURL(categoryPreviewUrl);
    setPendingCategoryImage(file);
    setCategoryPreviewUrl(file ? URL.createObjectURL(file) : "");
    pendingCategoryUploadedPathRef.current = null;
  }

  async function saveCategoryDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!categoryDraft || !state) return;
    if (!categoryDraft.sectionId || Object.values(categoryDraft.name).some((value) => !value.trim())) {
      setNotice({ tone: "error", text: "메뉴 묶음과 세 언어의 카테고리 이름을 모두 입력해 주세요." });
      return;
    }
    if (!categoryDraft.imagePath.trim() && !pendingCategoryImage) {
      setNotice({ tone: "error", text: "카테고리 대표 사진을 선택하거나 사진 주소를 입력해 주세요." });
      return;
    }
    const orderNotes = Object.values(categoryDraft.orderNote).map((value) => value.trim());
    if (orderNotes.some(Boolean) && !orderNotes.every(Boolean)) {
      setNotice({ tone: "error", text: "주문 안내를 넣으려면 폴란드어·영어·한국어를 모두 작성해 주세요." });
      return;
    }
    const initialCategory = categoryInitialDraftRef.current;
    const categoryToSave = categoryDraft.id && initialCategory && initialCategory.sectionId !== categoryDraft.sectionId
      ? {
          ...categoryDraft,
          sortOrder: state.categories
            .filter((category) => category.id !== categoryDraft.id && category.sectionId === categoryDraft.sectionId && category.archivedAt === null)
            .reduce((highest, category) => Math.max(highest, category.sortOrder), -1) + 1,
        }
      : categoryDraft;
    setBusy(true);
    setNotice(null);
    let createdRemoteCategoryId: string | null = null;
    let refreshFailed = false;
    let refreshError = "";
    try {
      let imagePath = categoryToSave.imagePath.trim();
      if (remoteMode) {
        if (!session) throw new Error("로그인이 만료되었습니다.");
        if (categoryToSave.id) {
          if (pendingCategoryImage) {
            imagePath = pendingCategoryUploadedPathRef.current
              ?? await uploadRemoteCategoryImage(await optimizeImage(pendingCategoryImage), session, categoryToSave.id);
            pendingCategoryUploadedPathRef.current = imagePath;
          }
          await updateRemoteCategory({ ...categoryToSave, imagePath }, session);
        } else {
          if (pendingCategoryImage) {
            // Upload first because the database requires a non-empty image path.
            // The object filename is unique, so concurrent drafts cannot collide.
            imagePath = pendingCategoryUploadedPathRef.current
              ?? await uploadRemoteCategoryImage(await optimizeImage(pendingCategoryImage), session, "draft");
            pendingCategoryUploadedPathRef.current = imagePath;
          }
          const createRequestId = pendingCategoryCreateRequestIdRef.current ?? crypto.randomUUID();
          pendingCategoryCreateRequestIdRef.current = createRequestId;
          createdRemoteCategoryId = await createRemoteCategory(
            categoryInput({ ...categoryToSave, imagePath }),
            session,
            createRequestId,
          );
        }
        const remoteCategoryId = categoryToSave.id || createdRemoteCategoryId;
        if (!remoteCategoryId) throw new Error("저장된 카테고리를 확인하지 못했습니다.");
        const savedRemoteCategory: AdminCategory = {
          ...categoryToSave,
          id: remoteCategoryId,
          slug: categoryToSave.slug || remoteCategoryId,
          imagePath,
        };
        const optimisticState: MenuAdminState = {
          ...state,
          categories: categoryToSave.id
            ? state.categories.map((category) => category.id === savedRemoteCategory.id ? savedRemoteCategory : category)
            : [...state.categories, savedRemoteCategory],
        };
        const reloadResult = await reloadRemoteWithFallback(optimisticState, session);
        refreshFailed = !reloadResult.reloaded;
        refreshError = reloadResult.errorMessage;
      } else {
        if (pendingCategoryImage) imagePath = await blobToDataUrl(await optimizeImage(pendingCategoryImage));
        const savedCategory = { ...categoryToSave, imagePath };
        if (savedCategory.id) {
          commitLocal({
            ...state,
            categories: state.categories.map((category) => category.id === savedCategory.id ? savedCategory : category),
          });
        } else {
          commitLocal({ ...state, categories: [...state.categories, newLocalCategory(categoryInput(savedCategory))] });
        }
      }
      setCategoryDraft(null);
      setPendingCategoryImage(null);
      setCategoryPreviewUrl("");
      categoryInitialDraftRef.current = null;
      pendingCategoryCreateRequestIdRef.current = null;
      pendingCategoryUploadedPathRef.current = null;
      setNotice(refreshFailed
        ? { tone: "info", text: `카테고리는 저장했지만 온라인 목록을 다시 불러오지 못했습니다. 손님 화면에는 확인용 저장과 사이트 공개 후 반영됩니다. ${refreshError}` }
        : { tone: "success", text: `${categoryDraft.id ? "카테고리를 수정했습니다." : "새 카테고리를 추가했습니다."} 확인용 저장 후 사이트에 공개하면 손님 화면에 반영됩니다.` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "카테고리를 저장하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  async function archiveCategory(category: AdminCategory, archived: boolean) {
    if (!state || !canManageContent) return;
    const activeMenuCount = state.items.filter((item) => item.categoryId === category.id && item.archivedAt === null).length;
    if (archived && activeMenuCount > 0) {
      setNotice({ tone: "error", text: `‘${category.name.ko}’에 사용 중인 메뉴가 ${activeMenuCount}개 있습니다. 메뉴를 옮기거나 보관한 뒤 다시 시도해 주세요.` });
      return;
    }
    if (archived && !window.confirm(`‘${category.name.ko}’ 카테고리를 보관할까요? 확인용으로 저장하고 최고 관리자가 사이트에 공개한 뒤 손님 메뉴에서 숨겨집니다.`)) return;
    setBusy(true);
    let refreshFailed = false;
    try {
      const archivedAt = archived ? (category.archivedAt ?? new Date().toISOString()) : null;
      const restoredSortOrder = archived
        ? category.sortOrder
        : state.categories
            .filter((candidate) => candidate.id !== category.id && candidate.sectionId === category.sectionId && candidate.archivedAt === null)
            .reduce((highest, candidate) => Math.max(highest, candidate.sortOrder), -1) + 1;
      const optimisticState: MenuAdminState = {
        ...state,
        categories: state.categories.map((candidate) => candidate.id === category.id
          ? { ...candidate, archivedAt, sortOrder: restoredSortOrder }
          : candidate),
      };
      if (remoteMode) {
        if (!session) throw new Error("로그인이 만료되었습니다.");
        await setRemoteCategoryArchived(category.id, archived, session);
        refreshFailed = !(await reloadRemoteWithFallback(optimisticState, session)).reloaded;
      } else {
        commitLocal(optimisticState);
      }
      if (archived && categoryFilter === category.id) setCategoryFilter("all");
      setCategoryDraft(null);
      setNotice(refreshFailed
        ? { tone: "info", text: `${archived ? "카테고리 보관" : "카테고리 복원"}은 끝났지만 온라인 목록을 다시 불러오지 못했습니다. 손님 화면에는 확인용 저장과 사이트 공개 후 반영됩니다.` }
        : { tone: "success", text: `${archived ? "카테고리를 보관했습니다." : "카테고리를 복원했습니다."} 확인용 저장 후 사이트에 공개하면 손님 화면에 반영됩니다.` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "카테고리 상태를 변경하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  async function deleteCategory(category: AdminCategory) {
    if (!state || !canManageContent) return;
    const menuCount = state.items.filter((item) => item.categoryId === category.id).length;
    if (menuCount > 0) {
      setNotice({
        tone: "error",
        text: `‘${category.name.ko}’에 연결된 메뉴가 ${menuCount}개 있습니다. 메뉴가 있는 카테고리는 삭제할 수 없습니다.`,
      });
      return;
    }
    if (!window.confirm(`‘${category.name.ko}’ 카테고리를 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    setBusy(true);
    let refreshFailed = false;
    try {
      const optimisticState: MenuAdminState = {
        ...state,
        categories: state.categories.filter((candidate) => candidate.id !== category.id),
      };
      if (remoteMode) {
        if (!session) throw new Error("로그인이 만료되었습니다.");
        await deleteRemoteCategory(category.id, session);
        refreshFailed = !(await reloadRemoteWithFallback(optimisticState, session)).reloaded;
      } else {
        commitLocal(optimisticState);
      }
      if (categoryFilter === category.id) setCategoryFilter("all");
      setCategoryDraft(null);
      setNotice(refreshFailed
        ? { tone: "info", text: "빈 카테고리는 삭제했지만 온라인 목록을 다시 불러오지 못했습니다. 현재 화면에는 삭제 결과를 그대로 두었습니다." }
        : { tone: "success", text: "빈 카테고리를 삭제했습니다." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "카테고리를 삭제하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !state) return;
    if (!draft.categoryId || Object.values(draft.name).some((value) => !value.trim()) || Object.values(draft.price).some((value) => !value.trim())) {
      setNotice({ tone: "error", text: "카테고리와 세 언어의 메뉴명·가격을 모두 입력해 주세요." });
      return;
    }
    const initialItem = draft.id ? state.items.find((item) => item.id === draft.id) : null;
    const draftToSave = initialItem && initialItem.categoryId !== draft.categoryId
      ? {
          ...draft,
          sortOrder: state.items
            .filter((item) => item.id !== draft.id && item.categoryId === draft.categoryId && item.archivedAt === null)
            .reduce((highest, item) => Math.max(highest, item.sortOrder), -1) + 1,
        }
      : draft;
    setBusy(true);
    setNotice(null);
    let refreshFailed = false;
    let refreshError = "";
    try {
      let imagePath = draftToSave.imagePath.trim();
      if (remoteMode) {
        if (!session) throw new Error("로그인이 만료되었습니다.");
        if (pendingImage) {
          imagePath = pendingItemUploadedPathRef.current
            ?? await uploadRemoteImage(
              await optimizeImage(pendingImage),
              session,
              draftToSave.id || undefined,
            );
          pendingItemUploadedPathRef.current = imagePath;
        }

        const updatedAt = new Date().toISOString();
        let savedRemoteItem: AdminMenuItem;
        if (draftToSave.id) {
          savedRemoteItem = { ...draftToSave, imagePath, updatedAt };
          await updateRemoteItem(savedRemoteItem, session);
        } else {
          const createRequestId = pendingItemCreateRequestIdRef.current ?? crypto.randomUUID();
          pendingItemCreateRequestIdRef.current = createRequestId;
          const createdId = await createRemoteItem(
            itemInput({ ...draftToSave, imagePath, updatedAt: "" }),
            session,
            createRequestId,
          );
          savedRemoteItem = {
            ...draftToSave,
            id: createdId,
            slug: `menu-${createdId.replaceAll("-", "")}`,
            imagePath,
            updatedAt,
          };
        }
        const optimisticState: MenuAdminState = {
          ...state,
          items: draftToSave.id
            ? state.items.map((item) => item.id === savedRemoteItem.id ? savedRemoteItem : item)
            : [...state.items, savedRemoteItem],
        };
        const reloadResult = await reloadRemoteWithFallback(optimisticState, session);
        refreshFailed = !reloadResult.reloaded;
        refreshError = reloadResult.errorMessage;
      } else {
        if (pendingImage) imagePath = await blobToDataUrl(await optimizeImage(pendingImage));
        const savedDraft = { ...draftToSave, imagePath, updatedAt: new Date().toISOString() };
        if (savedDraft.id) {
          commitLocal({ ...state, items: state.items.map((item) => item.id === savedDraft.id ? savedDraft : item) });
        } else {
          commitLocal({ ...state, items: [...state.items, newLocalItem(itemInput(savedDraft))] });
        }
      }
      setDraft(null);
      setPendingImage(null);
      setPreviewUrl("");
      pendingItemCreateRequestIdRef.current = null;
      pendingItemUploadedPathRef.current = null;
      const successMessage = `${draft.id ? "메뉴를 수정했습니다." : "새 메뉴를 추가했습니다."} 확인용 저장 후 사이트에 공개하면 손님 화면에 반영됩니다.`;
      setNotice(refreshFailed
        ? { tone: "info", text: `${successMessage} 온라인 목록을 다시 불러오지 못해 저장 결과를 현재 화면에 그대로 두었습니다. ${refreshError}` }
        : { tone: "success", text: successMessage });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "메뉴를 저장하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  async function toggleAvailability(item: AdminMenuItem) {
    if (!state || reorderSyncUncertain) return;
    const isAvailable = !item.isAvailable;
    const optimisticState: MenuAdminState = {
      ...state,
      items: state.items.map((candidate) => candidate.id === item.id
        ? { ...candidate, isAvailable, updatedAt: new Date().toISOString() }
        : candidate),
    };
    setBusy(true);
    let refreshError = "";
    try {
      if (remoteMode) {
        if (!session) throw new Error("로그인이 만료되었습니다.");
        await setRemoteAvailability(item.id, isAvailable, session);
        const reloadResult = await reloadRemoteWithFallback(optimisticState, session);
        refreshError = reloadResult.errorMessage;
      } else {
        commitLocal(optimisticState);
      }
      const successMessage = item.isAvailable
        ? "품절로 표시했고 손님 화면에 바로 반영했습니다."
        : "판매 중으로 바꿨고 손님 화면에 바로 반영했습니다.";
      setNotice(refreshError
        ? { tone: "info", text: `${successMessage} 온라인 목록을 다시 불러오지 못해 저장 결과를 현재 화면에 그대로 두었습니다. ${refreshError}` }
        : { tone: "success", text: successMessage });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "상태를 변경하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  async function archiveItem(item: AdminMenuItem, archived: boolean) {
    if (!state || !canManageContent) return;
    const parentCategory = categoryMap.get(item.categoryId);
    if (!archived && (!parentCategory || parentCategory.archivedAt !== null)) {
      setNotice({ tone: "error", text: "보관한 카테고리에 들어 있는 메뉴입니다. 카테고리를 먼저 복원해 주세요." });
      return;
    }
    if (archived && !window.confirm(`‘${item.name.ko}’ 메뉴를 보관할까요? 확인용으로 저장하고 최고 관리자가 사이트에 공개한 뒤 손님 메뉴에서 숨겨집니다.`)) return;
    const restoredSortOrder = archived
      ? item.sortOrder
      : state.items
          .filter((candidate) => candidate.id !== item.id && candidate.categoryId === item.categoryId && candidate.archivedAt === null)
          .reduce((highest, candidate) => Math.max(highest, candidate.sortOrder), -1) + 1;
    const optimisticState: MenuAdminState = {
      ...state,
      items: state.items.map((candidate) => candidate.id === item.id
        ? {
            ...candidate,
            archivedAt: archived ? new Date().toISOString() : null,
            sortOrder: restoredSortOrder,
            updatedAt: new Date().toISOString(),
          }
        : candidate),
    };
    setBusy(true);
    let refreshError = "";
    try {
      if (remoteMode) {
        if (!session) throw new Error("로그인이 만료되었습니다.");
        await setRemoteArchived(item.id, archived, session);
        const reloadResult = await reloadRemoteWithFallback(optimisticState, session);
        refreshError = reloadResult.errorMessage;
      } else {
        commitLocal(optimisticState);
      }
      const successMessage = `${archived ? "메뉴를 보관했습니다." : "메뉴를 복원했습니다."} 확인용 저장 후 사이트에 공개하면 손님 화면에 반영됩니다.`;
      setNotice(refreshError
        ? { tone: "info", text: `${successMessage} 온라인 목록을 다시 불러오지 못해 저장 결과를 현재 화면에 그대로 두었습니다. ${refreshError}` }
        : { tone: "success", text: successMessage });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "메뉴 상태를 변경하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  function rememberRestoreRequestId(requestId: string) {
    setPendingRestoreRequestId(requestId);
    try {
      window.sessionStorage.setItem(pendingRestoreRequestStorageKey, requestId);
    } catch {
      // State still preserves the idempotency key for this page visit.
    }
  }

  function forgetRestoreRequestId() {
    setPendingRestoreRequestId(null);
    try {
      window.sessionStorage.removeItem(pendingRestoreRequestStorageKey);
    } catch {
      // A completed reconciliation must not be blocked by storage cleanup.
    }
  }

  function markDeploymentQueued(releaseId: string) {
    const requestedAt = new Date().toISOString();
    setState((current) => current ? {
      ...current,
      releases: current.releases.map((release) => release.id === releaseId ? {
        ...release,
        deploymentTriggered: true,
        deploymentStatus: "queued",
        deploymentRequestedAt: release.deploymentRequestedAt ?? requestedAt,
        deploymentStartedAt: undefined,
        deploymentFinishedAt: undefined,
        deploymentError: undefined,
      } : release),
    } : current);
  }

  async function requestSiteDeployment(releaseId: string, auth: AuthSession): Promise<DeploymentOutcome> {
    setDeployingReleaseId(releaseId);
    try {
      if (deploymentUncertainReleaseId === releaseId) {
        try {
          const reconciledState = await loadRemoteState(auth);
          setState(reconciledState);
          const reconciledRelease = reconciledState.releases.find((release) => release.id === releaseId);
          if (!reconciledRelease) {
            return { kind: "uncertain", errorMessage: "저장본의 최신 공개 상태를 확인하지 못했습니다." };
          }
          const reconciledStatus = deploymentStatusOf(reconciledRelease);
          if (deploymentWasAccepted(reconciledStatus)) {
            setDeploymentUncertainReleaseId(null);
            return { kind: "accepted", status: reconciledStatus };
          }
          setDeploymentUncertainReleaseId(null);
        } catch (error) {
          return {
            kind: "uncertain",
            errorMessage: error instanceof Error ? error.message : "사이트 공개 상태를 다시 확인하지 못했습니다.",
          };
        }
      }

      try {
        await requestRemoteDeployment(releaseId, auth);
        markDeploymentQueued(releaseId);
        setDeploymentUncertainReleaseId(null);
        try {
          const refreshedState = await loadRemoteState(auth);
          setState(refreshedState);
          const refreshedRelease = refreshedState.releases.find((release) => release.id === releaseId);
          const refreshedStatus = deploymentStatusOf(refreshedRelease);
          if (refreshedRelease && refreshedStatus === "failed") {
            return { kind: "failed", status: refreshedStatus, errorMessage: refreshedRelease.deploymentError };
          }
          return {
            kind: "accepted",
            status: refreshedRelease && deploymentWasAccepted(refreshedStatus) ? refreshedStatus : "queued",
          };
        } catch (error) {
          return {
            kind: "accepted",
            status: "queued",
            errorMessage: error instanceof Error ? error.message : "공개 상태를 바로 새로고침하지 못했습니다.",
          };
        }
      } catch (requestError) {
        try {
          const reconciledState = await loadRemoteState(auth);
          setState(reconciledState);
          const reconciledRelease = reconciledState.releases.find((release) => release.id === releaseId);
          if (!reconciledRelease) {
            setDeploymentUncertainReleaseId(releaseId);
            return { kind: "uncertain", errorMessage: "공개 요청 결과가 목록에 나타났는지 확인하지 못했습니다." };
          }
          const reconciledStatus = deploymentStatusOf(reconciledRelease);
          if (deploymentWasAccepted(reconciledStatus)) {
            setDeploymentUncertainReleaseId(null);
            return { kind: "accepted", status: reconciledStatus };
          }
          return {
            kind: "failed",
            status: reconciledStatus,
            errorMessage: reconciledRelease.deploymentError
              || (requestError instanceof Error ? requestError.message : "사이트 공개를 요청하지 못했습니다."),
          };
        } catch (reconcileError) {
          setDeploymentUncertainReleaseId(releaseId);
          return {
            kind: "uncertain",
            errorMessage: reconcileError instanceof Error
              ? reconcileError.message
              : requestError instanceof Error
                ? requestError.message
                : "사이트 공개 요청 결과를 확인하지 못했습니다.",
          };
        }
      }
    } finally {
      setDeployingReleaseId(null);
    }
  }

  async function deploySavedRelease(release: AdminRelease) {
    if (
      !remoteMode
      || role !== "owner"
      || !session
      || !state
      || busy
      || restoringPretestMenu
      || Boolean(keyboardReorder)
      || Boolean(dragging)
      || Boolean(operatorBusyId)
      || categoryPanelOpen
      || Boolean(draft)
    ) return;
    if (publicationReloadRequired) {
      setNotice({ tone: "info", text: "방금 저장한 서버 내용을 다시 확인해야 합니다. 페이지를 새로고침한 뒤 사이트에 공개해 주세요." });
      return;
    }
    if (release.id !== state.releases[0]?.id) {
      setNotice({ tone: "info", text: "과거 저장본은 사이트에 공개할 수 없습니다. 가장 최근 저장본을 선택해 주세요." });
      return;
    }
    const currentStatus = deploymentStatusOf(release);
    const retryIsDue = deploymentRetryIsDue(release);
    if (deploymentWasAccepted(currentStatus) && deploymentUncertainReleaseId !== release.id && !retryIsDue) return;
    const action = currentStatus === "failed" || retryIsDue ? "사이트 공개를 다시 요청" : "사이트에 공개";
    if (!window.confirm(
      `${formatDate(release.createdAt)}에 만든 확인용 저장본을 ${action}할까요?\n\n이 저장본의 메뉴가 손님이 보는 사이트에 반영됩니다.`,
    )) return;

    setBusy(true);
    setNotice(null);
    try {
      const outcome = await requestSiteDeployment(release.id, session);
      if (outcome.kind === "accepted") {
        setNotice({
          tone: "success",
          text: outcome.status === "succeeded"
            ? "이 저장본은 이미 사이트에 공개되어 있습니다."
            : "사이트 공개 요청을 접수했습니다. 완료될 때까지 상태를 자동으로 확인합니다.",
        });
      } else if (outcome.kind === "failed") {
        setNotice({
          tone: "error",
          text: `사이트 공개 요청을 완료하지 못했습니다. 저장한 메뉴는 그대로이며 다시 시도할 수 있습니다.${outcome.errorMessage ? ` ${outcome.errorMessage}` : ""}`,
        });
      } else {
        setNotice({
          tone: "info",
          text: "사이트 공개 요청 결과를 확인하지 못했습니다. 중복 요청하지 않고 최신 상태를 다시 확인할 수 있도록 표시했습니다.",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function reconcileRestoredMenu(result: MenuRestoreResult, auth: AuthSession) {
    const [freshStatus, freshState] = await Promise.all([
      loadRemoteMenuRestoreStatus(auth),
      loadRemoteState(auth),
    ]);
    setMenuRestoreStatus(freshStatus);
    setMenuRestoreStatusError("");
    setState(freshState);
    return restoreIsConfirmed(result, freshStatus, freshState);
  }

  async function restorePretestMenu() {
    if (
      !remoteMode
      || role !== "owner"
      || !session
      || !state
      || busy
      || restoringPretestMenu
      || Boolean(keyboardReorder)
      || Boolean(dragging)
      || Boolean(operatorBusyId)
      || categoryPanelOpen
      || Boolean(draft)
      || publicationReloadRequired
    ) return;

    setMenuRestoreStatusLoading(true);
    let freshStatus: MenuRestoreStatus;
    try {
      freshStatus = await loadRemoteMenuRestoreStatus(session);
      setMenuRestoreStatus(freshStatus);
      setMenuRestoreStatusError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "복구 기준점을 확인하지 못했습니다.";
      setMenuRestoreStatusError(message);
      setNotice({ tone: "error", text: message });
      setMenuRestoreStatusLoading(false);
      return;
    }
    setMenuRestoreStatusLoading(false);

    if (freshStatus.baselineItemCount !== 80) {
      setNotice({ tone: "error", text: "보호된 테스트 전 기준점이 80개 메뉴인지 확인할 수 없어 복구를 중단했습니다." });
      return;
    }
    let reconciledPendingResult: MenuRestoreResult | null = null;
    if (pendingRestoreRequestId) {
      try {
        reconciledPendingResult = await loadRemoteMenuRestoreResult(pendingRestoreRequestId, session);
      } catch (error) {
        setNotice({
          tone: "info",
          text: `이전 복구 요청 결과를 아직 확인하지 못했습니다. 같은 요청 번호를 유지하며 메뉴를 중복 복구하지 않습니다.${error instanceof Error ? ` ${error.message}` : ""}`,
        });
        return;
      }
      if (!reconciledPendingResult && freshStatus.isDraftAtBaseline && freshStatus.isPublishedAtBaseline) {
        setNotice({ tone: "info", text: "이전 요청의 복구 기록은 아직 없지만 현재 메뉴는 이미 보호된 테스트 전 80개 메뉴와 같습니다. 요청 번호는 결과 확인을 위해 유지합니다." });
        return;
      }
    }
    if (freshStatus.isDraftAtBaseline && freshStatus.isPublishedAtBaseline && !pendingRestoreRequestId) {
      setNotice({ tone: "info", text: "현재 메뉴와 최근 저장본이 이미 보호된 테스트 전 80개 메뉴와 같습니다." });
      return;
    }
    if (!window.confirm(
      "테스트 전 메뉴로 복구할까요?\n\n현재 메뉴 편집 내용은 보호된 80개 메뉴 기준으로 덮어쓰며, 복구가 확인되면 손님이 보는 사이트에도 바로 공개를 요청합니다. 이 작업은 되돌리기 어렵습니다.",
    )) return;
    const typedPhrase = window.prompt(`계속하려면 ‘${restoreConfirmationPhrase}’를 정확히 입력해 주세요.`);
    if (typedPhrase?.trim() !== restoreConfirmationPhrase) {
      setNotice({ tone: "info", text: "확인 문구가 일치하지 않아 복구하지 않았습니다." });
      return;
    }

    const requestId = pendingRestoreRequestId ?? window.crypto.randomUUID();
    if (!pendingRestoreRequestId) rememberRestoreRequestId(requestId);
    setBusy(true);
    setRestoringPretestMenu(true);
    setNotice(null);
    let result: MenuRestoreResult | null = reconciledPendingResult;
    let restoreError: unknown = null;
    try {
      if (!result) result = await restoreRemotePretestMenu(freshStatus, requestId, session);
    } catch (error) {
      restoreError = error;
      try {
        result = await loadRemoteMenuRestoreResult(requestId, session);
      } catch {
        // The latest menu/status reload below is the final response-loss reconciliation step.
      }
    }

    try {
      if (!result) {
        try {
          const [reconciledStatus, reconciledState] = await Promise.all([
            loadRemoteMenuRestoreStatus(session),
            loadRemoteState(session),
          ]);
          setMenuRestoreStatus(reconciledStatus);
          setState(reconciledState);
          if (reconciledStatus.isDraftAtBaseline && reconciledStatus.isPublishedAtBaseline) {
            setNotice({
              tone: "info",
              text: "메뉴는 테스트 전 80개 기준과 일치하지만 복구 요청 결과 번호를 확인하지 못했습니다. 같은 버튼으로 결과를 다시 확인해 주세요.",
            });
          } else {
            setNotice({
              tone: "error",
              text: restoreError instanceof Error ? restoreError.message : "메뉴를 복구하지 못했습니다. 같은 요청으로 다시 시도할 수 있습니다.",
            });
          }
        } catch {
          setNotice({
            tone: "info",
            text: "복구 요청과 최신 메뉴 상태를 확인하지 못했습니다. 중복 복구하지 않도록 같은 요청 번호로 다시 확인할 수 있게 두었습니다.",
          });
        }
        return;
      }

      setPendingRestoreResult(result);
      let restored = false;
      try {
        restored = await reconcileRestoredMenu(result, session);
      } catch (error) {
        setNotice({
          tone: "info",
          text: `복구 기록은 확인했지만 최신 80개 메뉴 상태를 다시 확인하지 못했습니다. 사이트에는 아직 공개 요청하지 않았습니다.${error instanceof Error ? ` ${error.message}` : ""}`,
        });
        return;
      }
      if (!restored) {
        setNotice({
          tone: "error",
          text: "복구 기록과 현재 메뉴 상태가 일치하지 않아 사이트 공개를 중단했습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.",
        });
        return;
      }
      forgetRestoreRequestId();

      const outcome = await requestSiteDeployment(result.restoredReleaseId, session);
      if (outcome.kind === "accepted") {
        setNotice({
          tone: "success",
          text: outcome.status === "succeeded"
            ? "테스트 전 80개 메뉴로 복구했고 사이트 공개도 완료했습니다."
            : "테스트 전 80개 메뉴로 복구했습니다. 사이트 공개 요청도 접수했으며 완료 상태를 자동으로 확인합니다.",
        });
      } else if (outcome.kind === "failed") {
        setNotice({
          tone: "error",
          text: `메뉴는 테스트 전 80개 기준으로 복구됐지만 사이트 공개 요청은 완료하지 못했습니다. 아래에서 다시 시도해 주세요.${outcome.errorMessage ? ` ${outcome.errorMessage}` : ""}`,
        });
      } else {
        setNotice({
          tone: "info",
          text: "메뉴는 테스트 전 80개 기준으로 복구됐지만 사이트 공개 요청 결과는 확인하지 못했습니다. 아래에서 상태를 확인한 뒤 다시 시도할 수 있습니다.",
        });
      }
    } finally {
      setRestoringPretestMenu(false);
      setBusy(false);
    }
  }

  async function retryRestoredMenuDeployment() {
    if (!pendingRestoreResult || !session || role !== "owner" || busy || restoringPretestMenu || Boolean(keyboardReorder) || publicationReloadRequired) return;
    if (!window.confirm("복구된 테스트 전 80개 메뉴를 손님이 보는 사이트에 공개할까요?")) return;
    setBusy(true);
    setRestoringPretestMenu(true);
    setNotice(null);
    try {
      const restored = await reconcileRestoredMenu(pendingRestoreResult, session);
      if (!restored) {
        setNotice({ tone: "error", text: "현재 메뉴가 복구 기록과 일치하지 않아 사이트 공개를 요청하지 않았습니다." });
        return;
      }
      const outcome = await requestSiteDeployment(pendingRestoreResult.restoredReleaseId, session);
      if (outcome.kind === "accepted") {
        setNotice({ tone: "success", text: outcome.status === "succeeded" ? "복구된 메뉴가 이미 사이트에 공개되었습니다." : "복구된 메뉴의 사이트 공개 요청을 접수했습니다." });
      } else if (outcome.kind === "failed") {
        setNotice({ tone: "error", text: `메뉴 복구는 유지됐지만 사이트 공개 요청은 완료하지 못했습니다.${outcome.errorMessage ? ` ${outcome.errorMessage}` : ""}` });
      } else {
        setNotice({ tone: "info", text: "메뉴 복구는 유지됐지만 사이트 공개 요청 결과를 확인하지 못했습니다. 최신 상태를 다시 확인해 주세요." });
      }
    } catch (error) {
      setNotice({
        tone: "info",
        text: `복구된 메뉴의 최신 상태를 확인하지 못해 사이트 공개를 요청하지 않았습니다.${error instanceof Error ? ` ${error.message}` : ""}`,
      });
    } finally {
      setRestoringPretestMenu(false);
      setBusy(false);
    }
  }

  async function publishMenu() {
    if (!state || !canManageContent) return;
    if (publicationReloadRequired) {
      setNotice({ tone: "info", text: "이전 저장 결과를 서버에서 다시 확인해야 합니다. 페이지를 새로고침해 주세요." });
      return;
    }
    if (!window.confirm("이름·가격·사진·순서·보관 등 카탈로그 변경을 확인용으로 저장할까요? 판매 중·품절 변경은 이미 손님 화면에 바로 반영되어 있습니다.")) return;
    setBusy(true);
    setNotice(null);
    try {
      let result: PublishResult;
      if (remoteMode) {
        if (!session) throw new Error("로그인이 만료되었습니다.");
        result = await publishRemoteMenu(session);
        try {
          setState(await loadRemoteState(session));
          setPublicationReloadRequired(false);
        } catch (error) {
          setPublicationReloadRequired(true);
          setLastPublish(null);
          setNotice({
            tone: "info",
            text: `확인용 저장은 완료됐지만 서버가 실제로 저장한 내용을 다시 읽지 못해 사이트 공개를 잠시 막았습니다. 페이지를 새로고침해 주세요.${error instanceof Error ? ` ${error.message}` : ""}`,
          });
          return;
        }
      } else {
        const published = publishLocalState(state);
        setState(published.state);
        result = published.result;
      }
      setLastPublish(result);
      const successMessage = "카탈로그 변경을 확인용으로 저장했습니다. 판매 중·품절은 이미 반영되었고, 그 외 변경은 아직 사이트에 공개하지 않았습니다.";
      setNotice({ tone: "success", text: successMessage });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "확인용 메뉴를 저장하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    if (!window.confirm("이 브라우저에서 바꾼 내용과 저장 내역을 모두 지우고 처음 메뉴로 되돌릴까요?")) return;
    setState(resetLocalState());
    setLastPublish(null);
    setNotice({ tone: "info", text: "현재 사이트 메뉴를 다시 불러왔습니다." });
  }

  function showSoldOutItems() {
    const firstSoldOut = soldOutItems[0];
    if (!firstSoldOut) return;
    setViewFilter("active");
    setAvailabilityFilter("sold-out");
    setCategoryFilter("all");
    setQuery("");
    setHighlightItemId(firstSoldOut.id);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.getElementById(`admin-menu-${firstSoldOut.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    window.setTimeout(() => setHighlightItemId(null), 2200);
  }

  function showArchivedItems() {
    const firstArchived = archivedItems[0];
    if (!firstArchived) return;
    setViewFilter("archived");
    setAvailabilityFilter("all");
    setCategoryFilter("all");
    setQuery("");
    setHighlightItemId(firstArchived.id);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.getElementById(`admin-menu-${firstArchived.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    window.setTimeout(() => setHighlightItemId(null), 2200);
  }

  function renderOperatorCard(candidate: AdminAccessCandidate) {
    const isSelf = candidate.userId === session?.userId;
    const selectedRole = operatorRoleDrafts[candidate.userId] ?? candidate.role ?? "staff";
    const roleChanged = candidate.role !== selectedRole;
    const needsGoogleIdentity = candidate.role === null || !candidate.isActive
      || (candidate.role === "staff" && selectedRole !== "staff")
      || (candidate.role === "manager" && selectedRole === "owner");
    const googleBlocked = needsGoogleIdentity && !candidate.hasGoogleIdentity;
    const changing = operatorBusyId === candidate.userId;
    const saving = changing && operatorBusyAction === "save";
    const rejecting = changing && operatorBusyAction === "reject";
    const deleting = changing && operatorBusyAction === "delete";
    const operatorLocked = operatorLoading || Boolean(operatorBusyId);
    const initial = (candidate.email.trim()[0] || "?").toLocaleUpperCase();

    return (
      <article className={`${styles.operatorCard} ${!candidate.isActive ? styles.operatorInactive : ""}`} key={candidate.userId}>
        <div className={styles.operatorAvatar} aria-hidden="true">{initial}</div>
        <div className={styles.operatorIdentity}>
          <div>
            <strong>{candidate.email || "이메일을 확인할 수 없는 계정"}</strong>
            {isSelf && <span className={styles.selfBadge}>내 계정</span>}
          </div>
          <p>
            {candidate.role === null
              ? `승인 요청 ${candidate.requestedAt ? formatDate(candidate.requestedAt) : ""}`
              : !candidate.isActive && candidate.requestedAt
                ? `다시 사용 요청 ${formatDate(candidate.requestedAt)}`
              : candidate.isActive
                ? `${roleLabel[candidate.role]} · 사용 중`
                : `${roleLabel[candidate.role]} · 이용 중지`}
          </p>
          <span className={candidate.hasGoogleIdentity ? styles.googleLinked : styles.googleUnlinked}>
            {candidate.hasGoogleIdentity ? "Google 계정 연결됨" : "Google 로그인 연결 필요"}
          </span>
        </div>
        <div className={styles.operatorControls}>
          <label>
            <span>관리 권한</span>
            <select
              value={selectedRole}
              onChange={(event) => setOperatorRoleDrafts((current) => ({
                ...current,
                [candidate.userId]: event.target.value as AdminRole,
              }))}
              disabled={isSelf || operatorLocked}
              aria-label={`${candidate.email} 권한`}
            >
              <option value="staff">매장 직원</option>
              <option value="manager">메뉴 관리자</option>
              <option value="owner">최고 관리자</option>
            </select>
            <small>{roleDescription[selectedRole]}</small>
          </label>
          {googleBlocked && (
            <p className={styles.operatorBlockedHelp} role="status">
              이 계정으로 Google 로그인을 한 번 해야 승인하거나 권한을 올릴 수 있습니다.
            </p>
          )}
          <div className={styles.operatorActions}>
            {isSelf ? (
              <span className={styles.protectedAccount}>현재 로그인 계정 · 변경할 수 없음</span>
            ) : candidate.role === null ? (
              <>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => changeOperatorAccess(candidate, selectedRole, true)}
                  disabled={operatorLocked || googleBlocked}
                  title={googleBlocked ? "Google 로그인이 연결된 계정만 승인할 수 있습니다." : undefined}
                >{saving ? "승인 중…" : `${roleLabel[selectedRole]} 권한으로 승인`}</button>
                <button className={styles.dangerButton} type="button" onClick={() => rejectOperatorRequest(candidate)} disabled={operatorLocked}>{rejecting ? "처리 중…" : "요청 거절"}</button>
              </>
            ) : candidate.isActive ? (
              <>
                <button
                  type="button"
                  onClick={() => changeOperatorAccess(candidate, selectedRole, true)}
                  disabled={operatorLocked || !roleChanged || googleBlocked}
                  title={googleBlocked ? "Google 로그인을 연결한 뒤 권한을 올릴 수 있습니다." : undefined}
                >{saving ? "저장 중…" : "권한 저장"}</button>
                <button className={styles.dangerButton} type="button" onClick={() => changeOperatorAccess(candidate, candidate.role ?? selectedRole, false)} disabled={operatorLocked}>이용 중지</button>
              </>
            ) : (
              <>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => changeOperatorAccess(candidate, selectedRole, true)}
                  disabled={operatorLocked || googleBlocked}
                  title={googleBlocked ? "먼저 이 계정으로 Google 로그인을 시도해야 합니다." : undefined}
                >{saving ? "저장 중…" : `${roleLabel[selectedRole]} 권한으로 다시 사용`}</button>
                {candidate.requestedAt && <button className={styles.dangerButton} type="button" onClick={() => rejectOperatorRequest(candidate)} disabled={operatorLocked}>{rejecting ? "처리 중…" : "요청 거절"}</button>}
                <button
                  className={styles.dangerButton}
                  type="button"
                  onClick={() => deleteOperatorAccess(candidate)}
                  disabled={operatorLocked}
                >{deleting ? "삭제 중…" : "운영자 목록에서 삭제"}</button>
              </>
            )}
          </div>
        </div>
      </article>
    );
  }

  if (booting) {
    return <main className={styles.loading}><span className={styles.spinner} />운영툴을 준비하고 있습니다.</main>;
  }

  if (remoteMode && !session) {
    return (
      <main className={styles.loginPage}>
        <section className={styles.loginCard}>
          <div className={styles.loginMark}><img src={`${basePath}/brand/logo.png`} alt="" /></div>
          <p className={styles.kicker}>K STREET SNACK 운영툴</p>
          <h1>Google 계정으로 로그인하세요</h1>
          <p className={styles.loginIntro}>등록된 운영자는 메뉴와 운영 정보를 관리할 수 있습니다.</p>
          {notice && <div className={`${styles.notice} ${styles[notice.tone]}`} role="alert">{notice.text}</div>}
          <button className={`${styles.primaryButton} ${styles.googleLoginButton}`} disabled={busy} type="button" onClick={handleGoogleLogin}>
            <span aria-hidden="true">G</span>{busy ? "Google로 이동 중…" : "Google로 로그인"}
          </button>
          <p className={styles.loginHelp}>처음 로그인하면 최고 관리자에게 운영자 승인 요청이 전송됩니다.</p>
        </section>
      </main>
    );
  }

  if (!state) {
    return (
      <main className={styles.loginPage}>
        <section className={styles.loginCard}>
          <div className={styles.loginMark}><img src={`${basePath}/brand/logo.png`} alt="" /></div>
          <h1>운영 데이터를 불러오지 못했습니다.</h1>
          <p className={styles.loginIntro}>계정 권한과 인터넷 연결을 확인한 뒤 다시 로그인해 주세요.</p>
          {notice && <div className={`${styles.notice} ${styles[notice.tone]}`} role="alert">{notice.text}</div>}
          {session && <button className={styles.primaryButton} type="button" onClick={handleLogout} disabled={busy}>로그아웃 후 다시 시도</button>}
        </section>
      </main>
    );
  }

  const soldOutCount = activeItems.filter((item) => !item.isAvailable).length;
  const archivedCount = archivedItems.length;
  const requestedOperators = operatorCandidates.filter(
    (candidate) => candidate.role === null || (!candidate.isActive && Boolean(candidate.requestedAt)),
  );
  const activeOperators = operatorCandidates.filter(
    (candidate) => candidate.role !== null && candidate.isActive,
  );
  const inactiveOperators = operatorCandidates.filter(
    (candidate) => candidate.role !== null && !candidate.isActive && !candidate.requestedAt,
  );
  const latestRelease = state.releases[0];
  const latestReleaseSummary = latestRelease?.payload
    ? summarizeReleasePayload(latestRelease.payload)
    : null;
  const navigationLocked = busy || Boolean(keyboardReorder) || Boolean(operatorBusyId);
  const mutationLocked = navigationLocked
    || restoringPretestMenu
    || Boolean(dragging)
    || categoryPanelOpen
    || Boolean(draft);
  const latestDeploymentStatus = deploymentStatusOf(latestRelease);
  const latestDeploymentRetryIsDue = deploymentRetryIsDue(latestRelease);
  const lastPublishedRelease = lastPublish
    ? state.releases.find((release) => release.id === lastPublish.releaseId)
    : undefined;
  const lastPublishDeploymentStatus = deploymentStatusOf(lastPublishedRelease);
  const restoreAlreadyApplied = Boolean(
    menuRestoreStatus?.isDraftAtBaseline && menuRestoreStatus.isPublishedAtBaseline,
  );
  const pendingRestoreRelease = pendingRestoreResult
    ? state.releases.find((release) => release.id === pendingRestoreResult.restoredReleaseId)
    : undefined;
  const pendingRestoreDeploymentStatus = deploymentStatusOf(pendingRestoreRelease);
  const pendingRestoreDeploymentRetryIsDue = deploymentRetryIsDue(pendingRestoreRelease);

  function blockLockedNavigation(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (!navigationLocked) return;
    event.preventDefault();
  }

  return (
    <main className={styles.shell}>
      <p id="reorder-instructions" className={styles.visuallyHidden}>스페이스 또는 엔터로 항목을 선택한 뒤 위아래 방향키나 Home, End 키로 이동합니다. 엔터로 저장하고 Escape로 취소합니다.</p>
      <div className={styles.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{reorderAnnouncement}</div>
      <header className={styles.header}>
        <Link
          className={styles.brandBlock}
          href={adminDashboardPath}
          onClick={blockLockedNavigation}
          aria-disabled={navigationLocked}
        >
          <div className={styles.brandMark}><img src={`${basePath}/brand/logo.png`} alt="" /></div>
          <div><p>K STREET SNACK</p><h1>운영툴</h1></div>
        </Link>
        <div className={styles.headerActions}>
          <span className={`${styles.modeBadge} ${remoteMode ? styles.cloudMode : styles.localMode}`}>
            <i />{remoteMode ? "온라인 저장소 연결됨" : "이 브라우저에만 저장"}
          </span>
          {!remoteMode && (
            <button
              className={styles.headerResetButton}
              type="button"
              onClick={handleReset}
              disabled={busy || Boolean(keyboardReorder)}
              aria-label="처음 상태로 되돌리기"
              title="이 브라우저에서 바꾼 메뉴와 저장 기록을 모두 처음 상태로 되돌립니다."
            >
              <span className={styles.resetLabelFull}>처음 상태로 되돌리기</span>
              <span className={styles.resetLabelShort}>처음으로</span>
            </button>
          )}
          {remoteMode && (
            <>
              <span
                className={styles.accountSummary}
                title={`${session?.email ?? "현재 계정"} · ${role ? roleLabel[role] : "권한 확인 중"}`}
              >
                {session?.email} · {role ? roleLabel[role] : "권한 확인 중"}
              </span>
              <button
                className={styles.logoutButton}
                type="button"
                onClick={handleLogout}
                disabled={busy || Boolean(keyboardReorder)}
                aria-label={`${session?.email ?? "현재 계정"}에서 로그아웃`}
              >
                로그아웃
              </button>
            </>
          )}
        </div>
      </header>

      <div className={styles.appNavBar}>
        <nav className={styles.adminNav} aria-label="운영툴 주요 메뉴">
          <Link className={view === "dashboard" ? styles.activeNav : ""} href={adminDashboardPath} onClick={blockLockedNavigation} aria-current={view === "dashboard" ? "page" : undefined} aria-disabled={navigationLocked}>대시보드</Link>
          <Link className={view === "menu" ? styles.activeNav : ""} href={adminMenuPath} onClick={blockLockedNavigation} aria-current={view === "menu" ? "page" : undefined} aria-disabled={navigationLocked}>메뉴 관리</Link>
          <Link className={view === "displays" ? styles.activeNav : ""} href={adminDisplaysPath} onClick={blockLockedNavigation} aria-current={view === "displays" ? "page" : undefined} aria-disabled={navigationLocked}>매장 메뉴판</Link>
          <Link className={view === "operators" ? styles.activeNav : ""} href={adminOperatorsPath} onClick={blockLockedNavigation} aria-current={view === "operators" ? "page" : undefined} aria-disabled={navigationLocked}>
            운영자 관리{role === "owner" && requestedOperators.length > 0 && <b>{requestedOperators.length}</b>}
          </Link>
        </nav>
      </div>

      <div className={styles.page}>
        {notice && <div className={`${styles.notice} ${styles[notice.tone]}`} role="status"><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="알림 닫기">×</button></div>}

        {view === "dashboard" && (
          <div className={styles.dashboard}>
            <section className={styles.dashboardHeading} aria-labelledby="dashboard-title">
              <div>
                <p className={styles.kicker}>운영 현황</p>
                <h2 id="dashboard-title">오늘 확인할 일을 한눈에 보세요.</h2>
                <p>메뉴 판매 상태와 운영자 요청을 확인하고 필요한 관리 화면으로 바로 이동할 수 있습니다.</p>
              </div>
              <div className={styles.dashboardAccount}>
                <span>현재 로그인</span>
                <strong>{session?.email ?? "개발용 로컬 모드"}</strong>
                <small>{role ? roleLabel[role] : remoteMode ? "권한 확인 중" : "이 브라우저에서만 저장"}</small>
              </div>
            </section>

            <section className={styles.dashboardStats} aria-label="오늘의 운영 현황">
              <Link href={`${adminMenuPath}?status=available`} onClick={blockLockedNavigation} aria-disabled={navigationLocked}>
                <span>판매 중</span><strong>{activeItems.length - soldOutCount}<small>개</small></strong><em>전체 {activeItems.length}개 메뉴</em>
              </Link>
              <Link className={soldOutCount ? styles.dashboardAlertStat : ""} href={`${adminMenuPath}?status=sold-out`} onClick={blockLockedNavigation} aria-disabled={navigationLocked}>
                <span>품절</span><strong>{soldOutCount}<small>개</small></strong><em>{soldOutCount ? "메뉴 관리에서 확인 →" : "현재 없음"}</em>
              </Link>
              <Link href={`${adminMenuPath}?view=archived`} onClick={blockLockedNavigation} aria-disabled={navigationLocked}>
                <span>보관</span><strong>{archivedCount}<small>개</small></strong><em>{archivedCount ? "보관 메뉴 확인 →" : "현재 없음"}</em>
              </Link>
              <Link className={requestedOperators.length ? styles.dashboardRequestStat : ""} href={adminOperatorsPath} onClick={blockLockedNavigation} aria-disabled={navigationLocked}>
                <span>운영자 승인 대기</span><strong>{role === "owner" ? requestedOperators.length : 0}<small>건</small></strong><em>{role === "owner" ? (requestedOperators.length ? "요청 확인 →" : "확인할 요청 없음") : "최고 관리자만 확인"}</em>
              </Link>
            </section>

            <section className={styles.dashboardModules} aria-label="관리 메뉴">
              <Link className={styles.dashboardModule} href={adminMenuPath} onClick={blockLockedNavigation} aria-disabled={navigationLocked}>
                <span className={styles.moduleIcon} aria-hidden="true">M</span>
                <div><p>메뉴 관리</p><h2>메뉴와 카테고리 관리</h2><span>이름, 가격, 사진, 판매 상태와 표시 순서를 관리합니다.</span></div>
                <b>열기 →</b>
              </Link>
              <Link className={styles.dashboardModule} href={adminOperatorsPath} onClick={blockLockedNavigation} aria-disabled={navigationLocked}>
                <span className={styles.moduleIcon} aria-hidden="true">O</span>
                <div><p>운영자 관리</p><h2>운영자와 권한 관리</h2><span>{role === "owner" ? "Google 로그인 요청을 승인하고 관리 권한과 이용 여부를 변경합니다." : "내 계정의 권한과 운영자 관리 정책을 확인합니다."}</span></div>
                <b>열기 →</b>
              </Link>
              <Link className={`${styles.dashboardModule} ${styles.dashboardModuleWide}`} href={adminDisplaysPath} onClick={blockLockedNavigation} aria-disabled={navigationLocked}>
                <span className={styles.moduleIcon} aria-hidden="true">TV</span>
                <div><p>매장 메뉴판 · 시험 기능</p><h2>TV용 음식·카페 메뉴판</h2><span>운영툴에 저장된 현재 메뉴를 16:9 화면에 맞춰 새 탭으로 엽니다.</span></div>
                <b>열기 →</b>
              </Link>
            </section>

            <section className={styles.dashboardColumns}>
              <article className={styles.dashboardCard}>
                <div className={styles.dashboardCardHeading}><div><p className={styles.kicker}>빠른 작업</p><h2>자주 쓰는 기능</h2></div></div>
                <div className={styles.quickActions}>
                  <Link href={adminMenuPath} onClick={blockLockedNavigation} aria-disabled={navigationLocked}><span>메뉴 목록 열기</span><b>→</b></Link>
                  <button type="button" onClick={publishMenu} disabled={busy || !canManageContent || Boolean(keyboardReorder)}><span>확인용으로 저장</span><b>→</b></button>
                  <a href={adminPreviewPath} target="_blank" rel="noreferrer"><span>사이트 화면 미리보기</span><b>↗</b></a>
                  <Link href={`${adminMenuPath}#saved-menu-records`} onClick={blockLockedNavigation} aria-disabled={navigationLocked}><span>저장한 메뉴 확인</span><b>→</b></Link>
                </div>
              </article>

              <article className={styles.dashboardCard}>
                <div className={styles.dashboardCardHeading}><div><p className={styles.kicker}>확인할 일</p><h2>지금 확인해 주세요</h2></div></div>
                <div className={styles.dashboardTasks}>
                  {role === "owner" && requestedOperators.length > 0 && <Link href={adminOperatorsPath} onClick={blockLockedNavigation} aria-disabled={navigationLocked}><span><i className={styles.taskCritical} />운영자 승인 요청이 있습니다.</span><b>{requestedOperators.length}건 →</b></Link>}
                  {soldOutCount > 0 && <Link href={`${adminMenuPath}?status=sold-out`} onClick={blockLockedNavigation} aria-disabled={navigationLocked}><span><i className={styles.taskWarning} />품절로 표시된 메뉴가 있습니다.</span><b>{soldOutCount}개 →</b></Link>}
                  {!state.releases.length && canManageContent && <Link href={adminMenuPath} onClick={blockLockedNavigation} aria-disabled={navigationLocked}><span><i />아직 확인용 저장본이 없습니다.</span><b>저장하기 →</b></Link>}
                  {(role !== "owner" || !requestedOperators.length) && !soldOutCount && (state.releases.length > 0 || !canManageContent) && <p>지금 확인할 일이 없습니다.</p>}
                </div>
              </article>
            </section>

            <section className={styles.dashboardCard} aria-labelledby="latest-release-title">
              <div className={styles.dashboardCardHeading}>
                <div><p className={styles.kicker}>사이트 공개 전 확인</p><h2 id="latest-release-title">최근 확인용 저장</h2></div>
                <Link href={`${adminMenuPath}#saved-menu-records`} onClick={blockLockedNavigation} aria-disabled={navigationLocked}>저장 기록 보기 →</Link>
              </div>
              {latestRelease ? (
                <div className={styles.latestRelease}>
                  <strong>{formatDate(latestRelease.createdAt)}</strong>
                  <span>{latestReleaseSummary ? `메뉴 ${latestReleaseSummary.itemCount}개 · 카테고리 ${latestReleaseSummary.categoryCount}개 · 품절 ${latestReleaseSummary.soldOutCount}개` : "상세 내용을 확인할 수 없는 저장본"}</span>
                  <em className={deploymentStatusClass(latestDeploymentStatus)}>{deploymentStatusLabel[latestDeploymentStatus]}</em>
                </div>
              ) : <div className={styles.dashboardEmpty}>아직 확인용으로 저장한 메뉴가 없습니다.</div>}
            </section>
          </div>
        )}

        {view === "displays" && (
          <div className={styles.displaysPage}>
            <section className={styles.sectionHeading} aria-labelledby="display-launcher-title">
              <div>
                <p className={styles.kicker}>매장 메뉴판 · 시험 기능</p>
                <h2 id="display-launcher-title">운영툴의 메뉴를 TV 화면으로 열어 보세요.</h2>
                <p>현재 운영툴에 저장된 메뉴 이름, 가격, 사진과 품절 상태를 불러와 16:9 메뉴판으로 보여줍니다.</p>
              </div>
              <span className={styles.displayTestBadge}>시험 기능</span>
            </section>

            <section className={styles.displayExperimentNotice} aria-label="테스트 안내">
              <span aria-hidden="true">i</span>
              <div>
                <h2>현재 시험 운영 중인 기능입니다.</h2>
                <p>운영툴에 로그인한 기기에서 매장 TV 확인용으로 사용해 주세요. 메뉴를 저장한 뒤 화면을 다시 열거나 새로고침하면 최신 내용이 표시됩니다.</p>
              </div>
            </section>

            <section className={styles.displayLauncherGrid} aria-label="TV 메뉴판 선택">
              <article className={styles.displayLauncherCard}>
                <div className={styles.displayCardPreview} aria-hidden="true">
                  <div className={styles.displayPreviewBrand}><img src={`${basePath}/brand/symbol-variant-01.svg`} alt="" /><strong>BUNSIK</strong></div>
                  <div className={styles.displayPreviewRows}><i /><i /><i /><i /></div>
                </div>
                <div className={styles.displayCardContent}>
                  <p>FOOD BOARD</p>
                  <h2>음식 메뉴판</h2>
                  <span>김밥, K-핫도그, 떡볶이, 치킨, 라면과 간식 메뉴를 한 화면에 모아 보여줍니다.</span>
                  <a href={adminFoodDisplayPath} target="_blank" rel="noreferrer" onClick={blockLockedNavigation} aria-disabled={navigationLocked}>TV 화면으로 열기 <b>↗</b></a>
                </div>
              </article>

              <article className={`${styles.displayLauncherCard} ${styles.cafeDisplayCard}`}>
                <div className={styles.displayCardPreview} aria-hidden="true">
                  <div className={styles.displayPreviewBrand}><img src={`${basePath}/brand/symbol-variant-01.svg`} alt="" /><strong>CAFE</strong></div>
                  <div className={styles.displayPreviewRows}><i /><i /><i /><i /></div>
                </div>
                <div className={styles.displayCardContent}>
                  <p>CAFE &amp; NAPOJE</p>
                  <h2>카페·음료 메뉴판</h2>
                  <span>커피, 차, 차가운 음료, 병음료와 주류를 사진이 있는 TV 메뉴판으로 보여줍니다.</span>
                  <a href={adminCafeDisplayPath} target="_blank" rel="noreferrer" onClick={blockLockedNavigation} aria-disabled={navigationLocked}>TV 화면으로 열기 <b>↗</b></a>
                </div>
              </article>
            </section>

            <section className={styles.displayGuide} aria-labelledby="display-guide-title">
              <div>
                <p className={styles.kicker}>TV에서 사용하기</p>
                <h2 id="display-guide-title">새 탭을 TV로 옮긴 뒤 전체화면으로 전환하세요.</h2>
              </div>
              <ol>
                <li><b>1</b><span>원하는 메뉴판을 새 탭으로 엽니다.</span></li>
                <li><b>2</b><span>TV 화면으로 브라우저 창을 옮깁니다.</span></li>
                <li><b>3</b><span><kbd>F</kbd> 키로 전체화면을 켭니다.</span></li>
                <li><b>4</b><span>메뉴를 바꾼 뒤 화면 오른쪽 위의 <kbd>↻</kbd> 버튼으로 다시 불러옵니다.</span></li>
              </ol>
            </section>
          </div>
        )}

        {view === "menu" && (
          <>
        <section className={styles.hero}>
          <div>
            <p className={styles.kicker}>메뉴 관리</p>
            <h2>K STREET SNACK 의 메뉴를<br /><em>한곳에서</em> 관리하세요.</h2>
            <p>판매 중·품절은 손님 화면에 바로 반영됩니다. 이름·가격·사진·순서·보관 변경은 확인용 저장과 사이트 공개 후 반영됩니다.</p>
          </div>
          <div className={styles.publishPanel}>
            <div><span>판매 중인 메뉴</span><strong>{activeItems.length - soldOutCount}<small> / 전체 {activeItems.length}개</small></strong></div>
            <button className={styles.publishButton} onClick={publishMenu} disabled={busy || !canManageContent || Boolean(keyboardReorder) || publicationReloadRequired} title={publicationReloadRequired ? "페이지를 새로고침해 서버 저장본을 다시 확인해 주세요." : canManageContent ? undefined : "관리 권한이 있는 계정만 저장할 수 있습니다."}>확인용으로 저장 <span>→</span></button>
            <a className={styles.previewButton} href={adminPreviewPath} target="_blank" rel="noreferrer">사이트 화면 미리보기 <span>↗</span></a>
            <a className={styles.releaseShortcut} href="#saved-menu-records">
              <span>최근 저장본</span><b>{state.releases.length ? `${state.releases.length}개 확인` : "아직 없음"} <i aria-hidden="true">↓</i></b>
            </a>
            {remoteMode && role === "owner" ? (
              <button
                className={`${styles.deploymentButton} ${deploymentStatusClass(latestDeploymentStatus)}`}
                type="button"
                onClick={() => latestRelease && void deploySavedRelease(latestRelease)}
                disabled={mutationLocked
                  || publicationReloadRequired
                  || !latestRelease
                  || (deploymentWasAccepted(latestDeploymentStatus)
                    && deploymentUncertainReleaseId !== latestRelease.id
                    && !latestDeploymentRetryIsDue)}
              >
                <span>{deployingReleaseId === latestRelease?.id
                  ? "공개 상태 확인 중…"
                  : deploymentUncertainReleaseId === latestRelease?.id || latestDeploymentRetryIsDue
                    ? "공개 상태 확인 / 다시 요청"
                    : latestDeploymentStatus === "failed"
                      ? "사이트 공개 다시 시도"
                      : latestDeploymentStatus === "succeeded"
                        ? "사이트 공개 완료"
                        : latestDeploymentStatus === "queued"
                          ? "공개 대기 중"
                          : latestDeploymentStatus === "running"
                            ? "사이트 공개 중"
                            : "사이트에 공개"}</span>
                <b>{latestRelease ? deploymentStatusLabel[latestDeploymentStatus] : "저장본 필요"}</b>
              </button>
            ) : (
              <div className={styles.deploymentLocked}>
                <span>사이트에 공개</span>
                <b>{remoteMode ? "최고 관리자만 가능" : "온라인 연결 필요"}</b>
              </div>
            )}
            <p>{role === "owner" && remoteMode
              ? "판매 상태는 이미 즉시 반영됩니다. 이 저장본을 공개하면 이름·가격·사진·순서·보관 변경이 반영됩니다."
              : "판매 상태는 즉시 반영됩니다. 카탈로그 변경은 확인용 저장 후 최고 관리자가 사이트에 공개합니다."}</p>
          </div>
        </section>

        {reorderSyncUncertain && (
          <div className={styles.syncWarning} role="alert">
            <span><strong>순서가 저장됐는지 확인해 주세요</strong> 인터넷 연결이 끊겨 저장 여부를 확인하지 못했습니다. 최신 목록을 다시 불러올 때까지 수정할 수 없습니다.</span>
            <button type="button" onClick={retryReorderSync} disabled={busy}>{busy ? "불러오는 중…" : "최신 목록 다시 불러오기"}</button>
          </div>
        )}
        {lastPublish && (
          <div className={styles.publishResult}>
            <span>확인용 저장 완료</span><strong>{formatDate(lastPublish.publishedAt)}</strong><b className={deploymentStatusClass(lastPublishDeploymentStatus)}>{deploymentStatusLabel[lastPublishDeploymentStatus]}</b><small>{role === "owner" ? "내용을 확인한 뒤 사이트에 공개할 수 있습니다." : "최고 관리자가 확인한 뒤 사이트에 공개합니다."}</small>
          </div>
        )}

        <section id="saved-menu-records" className={styles.releaseSection} tabIndex={-1} aria-labelledby="saved-menu-records-title">
          <div className={styles.releaseHeading}>
            <div>
              <p className={styles.kicker}>사이트 공개 전 확인</p>
              <h2 id="saved-menu-records-title">저장한 메뉴 확인</h2>
              <p>사이트에 공개할 카탈로그 저장본입니다. 판매 중·품절 상태는 저장과 별개로 손님 화면에 즉시 반영되며 최근 저장본은 최대 5개까지 보여줍니다.</p>
            </div>
            <strong>{state.releases.length}<small>개</small></strong>
          </div>
          {state.releases.length ? (
            <div className={styles.releaseList}>
              {state.releases.map((release, index) => {
                const summary = release.payload ? summarizeReleasePayload(release.payload) : null;
                const previousPayload = state.releases[index + 1]?.payload;
                const diff = release.payload && previousPayload
                  ? diffReleasePayloads(release.payload, previousPayload)
                  : null;
                const diffRows = diff ? [
                  { label: "추가", names: diff.added },
                  { label: "제외", names: diff.removed },
                  { label: "내용 수정", names: diff.edited },
                  { label: "판매 상태 변경", names: diff.statusChanged },
                ].filter((row) => row.names.length) : [];
                const deploymentStatus = deploymentStatusOf(release);
                const deploymentUncertain = deploymentUncertainReleaseId === release.id;
                const deploymentRetryDue = deploymentRetryIsDue(release);

                return (
                  <details className={styles.releaseCard} key={release.id}>
                    <summary>
                      <span className={styles.releaseRecency}>{index === 0 ? "최근 저장" : "이전 저장"}</span>
                      <span className={styles.releaseMeta}>
                        <strong>{formatDate(release.createdAt)}</strong>
                        <small>{summary
                          ? `메뉴 ${summary.itemCount}개 · 카테고리 ${summary.categoryCount}개 · 품절 ${summary.soldOutCount}개`
                          : "상세 내용을 확인할 수 없는 저장본"}</small>
                      </span>
                      <span className={`${styles.releaseState} ${deploymentStatusClass(deploymentStatus)}`}>{deploymentStatusLabel[deploymentStatus]}</span>
                      <span className={styles.releaseToggle}>내용 보기 <i aria-hidden="true">⌄</i></span>
                    </summary>
                    <div className={styles.releaseDetail}>
                      <div className={styles.releaseDeployment}>
                        <div className={styles.releaseDeploymentInfo}>
                          <span>사이트 공개 상태</span>
                          <strong className={deploymentStatusClass(deploymentStatus)}>{deploymentUncertain || deploymentRetryDue ? "공개 상태 확인 필요" : deploymentStatusLabel[deploymentStatus]}</strong>
                          {release.deploymentRequestedAt && <small>요청 {formatDate(release.deploymentRequestedAt)}{release.deploymentFinishedAt ? ` · 완료 ${formatDate(release.deploymentFinishedAt)}` : release.deploymentStartedAt ? ` · 시작 ${formatDate(release.deploymentStartedAt)}` : ""}</small>}
                          {release.deploymentError && <p role="alert">{release.deploymentError}</p>}
                          {release.deploymentRunUrl && <a href={release.deploymentRunUrl} target="_blank" rel="noreferrer">공개 작업 기록 보기 ↗</a>}
                        </div>
                        {index > 0 ? (
                          <small className={styles.releaseDeploymentHelp}>과거 저장본은 다시 공개할 수 없습니다. 가장 최근 저장본만 사이트에 공개할 수 있습니다.</small>
                        ) : remoteMode && role === "owner" ? (
                          <button
                            type="button"
                            onClick={() => void deploySavedRelease(release)}
                            disabled={mutationLocked
                              || publicationReloadRequired
                              || deployingReleaseId === release.id
                              || (deploymentWasAccepted(deploymentStatus) && !deploymentUncertain && !deploymentRetryDue)}
                          >
                            {deployingReleaseId === release.id
                              ? "상태 확인 중…"
                              : deploymentUncertain || deploymentRetryDue
                                ? "상태 확인 / 다시 요청"
                                : deploymentStatus === "failed"
                                  ? "사이트 공개 다시 시도"
                                  : deploymentStatus === "not_requested"
                                    ? "사이트에 공개"
                                    : deploymentStatusLabel[deploymentStatus]}
                          </button>
                        ) : (
                          <small className={styles.releaseDeploymentHelp}>{remoteMode ? "사이트 공개는 최고 관리자만 할 수 있습니다." : "온라인 연결 후 사이트에 공개할 수 있습니다."}</small>
                        )}
                      </div>
                      {summary ? (
                        <>
                          <div className={styles.releaseOverview} aria-label="저장한 메뉴 요약">
                            <article><span>전체 메뉴</span><strong>{summary.itemCount}<small>개</small></strong></article>
                            <article><span>카테고리</span><strong>{summary.categoryCount}<small>개</small></strong></article>
                            <article><span>판매 중</span><strong>{summary.availableCount}<small>개</small></strong></article>
                            <article><span>품절</span><strong>{summary.soldOutCount}<small>개</small></strong></article>
                          </div>
                          <div className={styles.releaseChanges}>
                            <strong>이전 저장본과 비교한 메뉴 항목 변경</strong>
                            {diff ? (
                              diffRows.length ? (
                                <ul>{diffRows.map((row) => <li key={row.label}><b>{row.label} {row.names.length}개</b><span>{row.names.join(", ")}</span></li>)}</ul>
                              ) : <p>메뉴 추가·제외와 이름, 가격, 사진, 판매 상태 변경이 없습니다.</p>
                            ) : <p>비교할 이전 저장본이 없어 변경 내용을 표시하지 않습니다.</p>}
                            <small>판매 상태는 즉시 반영되며 여기에는 저장 시점의 상태로만 기록됩니다. 카테고리 정보와 메뉴 순서 변경은 이 비교에 포함되지 않습니다.</small>
                          </div>
                          <div className={styles.releaseCategoryList}>
                            {summary.categories.map((category) => (
                              <section className={styles.releaseCategory} key={category.id}>
                                <header><strong>{category.nameKo}</strong><span>메뉴 {category.items.length}개{category.soldOutCount ? ` · 품절 ${category.soldOutCount}개` : ""}</span></header>
                                <ul>
                                  {category.items.map((item) => (
                                    <li key={item.id}>
                                      <span><strong>{item.nameKo}</strong><small>{item.pricePl}</small></span>
                                      <em className={item.availability === "sold_out" ? styles.releaseSoldOut : styles.releaseAvailable}>{item.availability === "sold_out" ? "품절" : "판매 중"}</em>
                                      <small>{item.hasImage ? "메뉴 사진 있음" : "카테고리 사진 사용"}</small>
                                    </li>
                                  ))}
                                </ul>
                              </section>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className={styles.releaseUnavailable}>
                          <strong>이 저장본의 메뉴 내용을 불러올 수 없습니다.</strong>
                          <span>이전 방식으로 저장했거나 저장 데이터가 올바르지 않습니다. 새로 확인용 저장을 만들면 상세 내용을 확인할 수 있습니다.</span>
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <div className={styles.releaseEmpty}>
              <strong>아직 저장한 메뉴가 없습니다.</strong>
              <span>위의 ‘확인용으로 저장’을 누르면 현재 메뉴 상태를 나중에 다시 확인할 수 있습니다.</span>
            </div>
          )}
        </section>

        <section className={styles.stats} aria-label="메뉴 현황">
          <article><span>전체 메뉴</span><strong>{activeItems.length}</strong><small>개</small></article>
          <article><span>판매 중</span><strong>{activeItems.length - soldOutCount}</strong><small>개</small></article>
          <article className={`${styles.interactiveStat} ${soldOutCount ? styles.alertStat : ""}`}>
            <button className={styles.statButton} type="button" onClick={showSoldOutItems} aria-label={soldOutCount ? `품절 메뉴 ${soldOutCount}개 목록으로 이동` : "현재 품절 메뉴 없음"}>
              <span>품절</span>
              <span className={styles.statValue}><strong>{soldOutCount}</strong><small>개</small></span>
              <span className={styles.statSummary}>
                <em>{soldOutCount ? `${soldOutItems.slice(0, 2).map((item) => item.name.ko).join(", ")}${soldOutCount > 2 ? ` 외 ${soldOutCount - 2}개` : ""}` : "현재 없음"}</em>
                {soldOutCount > 0 && <small>목록 보기 →</small>}
              </span>
            </button>
          </article>
          <article className={styles.interactiveStat}>
            <button className={styles.statButton} type="button" onClick={showArchivedItems} aria-label={archivedCount ? `보관 메뉴 ${archivedCount}개 목록으로 이동` : "현재 보관 메뉴 없음"}>
              <span>보관</span>
              <span className={styles.statValue}><strong>{archivedCount}</strong><small>개</small></span>
              <span className={styles.statSummary}>
                <em>{archivedCount ? `${archivedItems.slice(0, 2).map((item) => item.name.ko).join(", ")}${archivedCount > 2 ? ` 외 ${archivedCount - 2}개` : ""}` : "현재 없음"}</em>
                {archivedCount > 0 && <small>목록 보기 →</small>}
              </span>
            </button>
          </article>
        </section>

        <section className={styles.workspace}>
          <aside className={styles.sidebar}>
            <div className={styles.sidebarHeading}>
              <div className={styles.sidebarHeadingTitle}><span>카테고리</span><b>{categories.length}</b></div>
              {canManageContent && <button className={styles.manageCategoriesButton} type="button" onClick={openCategoryManager} disabled={busy || Boolean(keyboardReorder)}>관리</button>}
            </div>
            <nav className={styles.categoryList} aria-label="메뉴 카테고리">
              <button className={categoryFilter === "all" ? styles.activeCategory : ""} onClick={() => setCategoryFilter("all")}>
                <span>전체 메뉴</span><b>{state.items.filter((item) => viewFilter === "active" ? item.archivedAt === null : item.archivedAt !== null).length}</b>
              </button>
              {categories.map((category) => {
                const count = state.items.filter((item) => item.categoryId === category.id && (viewFilter === "active" ? item.archivedAt === null : item.archivedAt !== null)).length;
                return (
                  <button key={category.id} className={categoryFilter === category.id ? styles.activeCategory : ""} onClick={() => setCategoryFilter(category.id)}>
                    <span>{category.name.ko}<small>{category.name.pl}</small></span><b>{count}</b>
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className={styles.content}>
            <div className={styles.toolbar}>
              <div>
                <p className={styles.kicker}>메뉴 관리</p>
                <h2>{viewFilter === "active" ? "메뉴 목록" : "보관한 메뉴"}</h2>
              </div>
              {canManageContent && <button className={styles.addButton} onClick={openAdd} disabled={busy || Boolean(keyboardReorder)}><span>＋</span> 메뉴 추가</button>}
            </div>

            <div className={styles.filters}>
              <label className={styles.search}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="메뉴 이름 검색" /></label>
              <div className={styles.segmented} aria-label="메뉴 사용 여부">
                <button className={viewFilter === "active" ? styles.selected : ""} onClick={() => setViewFilter("active")}>사용 중</button>
                <button className={viewFilter === "archived" ? styles.selected : ""} onClick={() => setViewFilter("archived")}>보관</button>
              </div>
              <select aria-label="판매 상태" value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value as AvailabilityFilter)}>
                <option value="all">전체 상태</option><option value="available">판매 중</option><option value="sold-out">품절</option>
              </select>
            </div>

            {canManageContent && (
              <div className={styles.orderModeBanner}>
                <span className={styles.orderModeHint}>{menuReorderHint}</span>
              </div>
            )}

            <div className={styles.listHeader}><span>{filteredItems.length}개 메뉴</span><small>판매 중·품절 변경은 손님 화면에 바로 반영됩니다. 이름·가격·사진·순서·보관 변경은 확인용으로 저장한 뒤 최고 관리자가 사이트에 공개해야 반영됩니다.</small></div>
            <div className={styles.menuList}>
              {filteredItems.map((item) => {
                const category = categoryMap.get(item.categoryId);
                const siblings = displayState ? activeSiblings(displayState, "item", item.id) : [];
                const orderIndex = siblings.findIndex((candidate) => candidate.id === item.id);
                return (
                  <article
                    id={`admin-menu-${item.id}`}
                    className={`${styles.menuCard} ${!item.isAvailable ? styles.soldOutCard : ""} ${highlightItemId === item.id ? styles.focusCard : ""} ${reorderCardClass("item", item.id)}`}
                    key={item.id}
                    data-reorder-kind="item"
                    data-reorder-id={item.id}
                    onDragOver={(event) => dragOverCard(event, "item", item.id)}
                    onDrop={(event) => dropOnCard(event, "item", item.id)}
                  >
                    {menuReorderEnabled && (
                      <button
                        className={styles.dragHandle}
                        type="button"
                        data-reorder-handle
                        draggable={!busy && !keyboardReorder}
                        disabled={busy || Boolean(keyboardReorder && (keyboardReorder.kind !== "item" || keyboardReorder.id !== item.id))}
                        aria-label={`${item.name.ko} 메뉴 순서 변경, 현재 ${orderIndex + 1}/${siblings.length}`}
                        aria-describedby="reorder-instructions"
                        aria-pressed={keyboardReorder?.kind === "item" && keyboardReorder.id === item.id}
                        title="끌어서 순서 바꾸기 · 키보드는 Enter 후 방향키"
                        onClick={() => handleReorderClick("item", item.id)}
                        onKeyDown={(event) => keyboardMove(event, "item", item.id)}
                        onDragStart={(event) => nativeDragStart(event, "item", item.id)}
                        onDragEnd={nativeDragEnd}
                        onPointerDown={(event) => touchPointerDown(event, "item", item.id)}
                        onPointerMove={touchPointerMove}
                        onPointerUp={touchPointerEnd}
                        onPointerCancel={touchPointerCancel}
                      >⠿</button>
                    )}
                    <div className={styles.thumb}>
                      {item.imagePath ? <img src={resolveAdminImage(item.imagePath)} alt="" /> : <span>사진<br />없음</span>}
                      {!item.isAvailable && <b>품절</b>}
                    </div>
                    <div className={styles.menuInfo}>
                      <div className={styles.meta}><span>{category?.name.ko ?? "미분류"}</span>{item.tag && <i>{tagLabel[item.tag]}</i>}</div>
                      <h3>{item.name.ko}</h3>
                      <p>{item.name.pl} · {item.name.en}</p>
                    </div>
                    <div className={styles.price} aria-label={`가격 ${item.price.pl}`} title={item.price.pl}>
                      {priceLines(item.price.pl).map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}
                    </div>
                    <div className={styles.cardActions}>
                      {viewFilter === "active" ? (
                        <>
                          {menuReorderEnabled && (
                            <div className={styles.keyboardMoveControls} aria-label={`${item.name.ko} 빠른 순서 이동`}>
                              <button type="button" onClick={() => moveWithTouchControls("item", item.id, -1)} disabled={busy || orderIndex <= 0} aria-label={`${item.name.ko} 위로 이동`}>↑</button>
                              <button type="button" onClick={() => moveWithTouchControls("item", item.id, 1)} disabled={busy || orderIndex < 0 || orderIndex >= siblings.length - 1} aria-label={`${item.name.ko} 아래로 이동`}>↓</button>
                            </div>
                          )}
                          <button className={`${styles.statusButton} ${item.isAvailable ? styles.available : styles.unavailable}`} onClick={() => toggleAvailability(item)} disabled={busy || reorderSyncUncertain || Boolean(keyboardReorder)}>
                            <i />{item.isAvailable ? "판매 중" : "품절"}
                          </button>
                          {canManageContent && <button onClick={() => openEdit(item)} disabled={busy || Boolean(keyboardReorder)}>수정</button>}
                          {canManageContent && <button className={styles.archiveAction} onClick={() => archiveItem(item, true)} disabled={busy || Boolean(keyboardReorder)}>보관</button>}
                        </>
                      ) : canManageContent ? <button className={styles.restoreAction} onClick={() => archiveItem(item, false)} disabled={busy}>메뉴 복원</button> : <span>이 계정은 복원할 수 없습니다.</span>}
                    </div>
                  </article>
                );
              })}
              {!filteredItems.length && <div className={styles.empty}><b>조건에 맞는 메뉴가 없습니다.</b><span>검색어나 선택 조건을 바꿔 보세요.</span></div>}
            </div>
          </div>
        </section>

        {remoteMode && role === "owner" && (
          <section className={styles.dataManagement} aria-labelledby="pretest-restore-title">
            <div className={styles.dataManagementHeading}>
              <div>
                <p className={styles.kicker}>데이터 관리 · 최고 관리자 전용</p>
                <h2 id="pretest-restore-title">테스트 전 메뉴로 복구</h2>
                <p>현재 편집 중인 메뉴를 보호된 테스트 전 80개 메뉴 기준으로 덮어쓴 뒤, 복구된 저장본을 손님이 보는 사이트에 다시 공개합니다.</p>
              </div>
              <span className={styles.dangerBadge}>주의가 필요한 작업</span>
            </div>

            <div className={styles.restoreStatusGrid} aria-label="테스트 전 메뉴 복구 기준 상태">
              <span><small>보호된 기준</small><strong>{menuRestoreStatusLoading ? "확인 중…" : menuRestoreStatus ? `${menuRestoreStatus.baselineItemCount}개 메뉴` : "확인 필요"}</strong></span>
              <span><small>기준 저장 시각</small><strong>{menuRestoreStatus ? formatDate(menuRestoreStatus.capturedAt) : "—"}</strong></span>
              <span><small>현재 상태</small><strong className={restoreAlreadyApplied ? styles.restoreReady : styles.restoreChanged}>{restoreAlreadyApplied ? "테스트 전 메뉴와 같음" : "현재 메뉴가 다름"}</strong></span>
            </div>

            {menuRestoreStatusError && <div className={styles.restoreError} role="alert">기준점을 확인하지 못했습니다. {menuRestoreStatusError}</div>}
            {pendingRestoreRequestId && (
              <div className={styles.restorePending} role="status">
                이전 복구 요청의 결과를 확인 중입니다. 같은 요청 번호를 재사용하므로 메뉴가 중복 복구되지 않습니다.
              </div>
            )}
            {pendingRestoreResult && (
              <div className={styles.restorePublishRetry}>
                <div>
                  <strong>메뉴 복구 완료 · {deploymentStatusLabel[pendingRestoreDeploymentStatus]}</strong>
                  <span>80개 메뉴 복구는 유지됩니다. 사이트 공개가 완료되지 않았다면 같은 복구 저장본으로 다시 요청할 수 있습니다.</span>
                </div>
                <button
                  type="button"
                  onClick={() => void retryRestoredMenuDeployment()}
                  disabled={mutationLocked
                    || publicationReloadRequired
                    || deployingReleaseId === pendingRestoreResult.restoredReleaseId
                    || (deploymentWasAccepted(pendingRestoreDeploymentStatus)
                      && deploymentUncertainReleaseId !== pendingRestoreResult.restoredReleaseId
                      && !pendingRestoreDeploymentRetryIsDue)}
                >
                  {deployingReleaseId === pendingRestoreResult.restoredReleaseId
                    ? "공개 상태 확인 중…"
                    : deploymentUncertainReleaseId === pendingRestoreResult.restoredReleaseId || pendingRestoreDeploymentRetryIsDue
                      ? "공개 상태 확인 / 다시 요청"
                      : pendingRestoreDeploymentStatus === "failed"
                        ? "사이트 공개 다시 시도"
                        : pendingRestoreDeploymentStatus === "not_requested"
                          ? "사이트에 공개"
                          : deploymentStatusLabel[pendingRestoreDeploymentStatus]}
                </button>
              </div>
            )}

            <div className={styles.dataManagementAction}>
              <p><strong>실행 전 두 번 확인합니다.</strong><span>작업 중인 편집 내용은 사라지며, 복구 후 새 저장 기록은 남습니다. 기존 저장 기록은 삭제하지 않습니다.</span></p>
              <button
                className={styles.restoreBaselineButton}
                type="button"
                onClick={() => void restorePretestMenu()}
                disabled={mutationLocked
                  || publicationReloadRequired
                  || menuRestoreStatusLoading
                  || (restoreAlreadyApplied && !pendingRestoreRequestId)}
              >
                {restoringPretestMenu
                  ? "복구와 공개 상태 확인 중…"
                  : restoreAlreadyApplied && !pendingRestoreRequestId
                    ? "테스트 전 메뉴 복구됨"
                    : pendingRestoreRequestId
                      ? "이전 복구 결과 다시 확인"
                      : "테스트 전 메뉴로 복구"}
              </button>
            </div>
          </section>
        )}
          </>
        )}

        {view === "operators" && (
          <div className={styles.operatorsPage}>
            <section className={styles.sectionHeading} aria-labelledby="operator-manager-title">
              <div>
                <p className={styles.kicker}>운영자 관리</p>
                <h2 id="operator-manager-title">운영툴을 사용할 사람과 권한을 관리하세요.</h2>
                <p>Google로 로그인한 계정을 승인하고, 관리 권한과 이용 여부를 안전하게 변경할 수 있습니다.</p>
              </div>
            </section>

            <section className={styles.operatorAccountGrid} aria-label="현재 운영툴 상태">
              <article><span>내 계정</span><strong>{session?.email ?? "개발용 로컬 모드"}</strong><small>{role ? roleLabel[role] : "온라인 연결 필요"}</small></article>
              <article><span>로그인 방식</span><strong>{remoteMode ? "Google" : "로컬 모드"}</strong><small>{remoteMode ? "Google 로그인만 사용" : "로그인 없이 이 브라우저에서만 사용"}</small></article>
              <article><span>저장 위치</span><strong>{remoteMode ? "온라인" : "이 브라우저"}</strong><small>{remoteMode ? "Supabase 연결됨" : "다른 기기와 공유되지 않음"}</small></article>
            </section>

            {!remoteMode ? (
              <section className={styles.operatorPermissionInfo}>
                <span aria-hidden="true">i</span>
                <div><h2>운영자 관리는 온라인 저장소 연결 후 사용할 수 있습니다.</h2><p>현재는 개발용 로컬 모드이므로 계정 승인과 권한 변경 기능이 표시되지 않습니다.</p></div>
              </section>
            ) : role !== "owner" ? (
              <section className={styles.operatorPermissionInfo}>
                <span aria-hidden="true">i</span>
                <div><h2>최고 관리자만 운영자 권한을 변경할 수 있습니다.</h2><p>{role ? roleDescription[role] : "현재 계정의 권한을 확인하고 있습니다."}</p></div>
              </section>
            ) : (
              <section className={styles.operatorPagePanel} aria-label="운영자 계정과 권한">
                <div className={styles.operatorScroll}>
                  <div className={styles.operatorIntro}>
                    <div>
                      <h3>운영툴에 들어올 사람을 정합니다.</h3>
                      <p>Google로 처음 로그인한 계정은 승인 대기에 표시됩니다. 기본 권한은 판매 상태만 바꾸는 매장 직원입니다.</p>
                    </div>
                    <button type="button" onClick={() => session && refreshOperatorCandidates(session)} disabled={operatorLoading || Boolean(operatorBusyId)}>
                      {operatorLoading ? "불러오는 중…" : "목록 새로고침"}
                    </button>
                  </div>

                  <div className={styles.operatorSummary} aria-label="운영자 현황">
                    <span><b>{requestedOperators.length}</b> 확인할 요청</span>
                    <span><b>{activeOperators.length}</b> 사용 중</span>
                    <span><b>{inactiveOperators.length}</b> 이용 중지</span>
                  </div>

                  {operatorError && <div className={styles.operatorError} role="alert"><span>{operatorError}</span><button type="button" onClick={() => session && refreshOperatorCandidates(session)} disabled={operatorLoading}>다시 불러오기</button></div>}
                  {operatorLoading && !operatorCandidates.length ? (
                    <div className={styles.operatorLoading}><span className={styles.spinner} />운영자 목록을 불러오고 있습니다.</div>
                  ) : (
                    <div className={styles.operatorGroups}>
                      <section className={styles.operatorGroup}>
                        <div className={styles.operatorGroupHeading}><div><h3>승인 또는 다시 사용 요청</h3><p>처음 사용하거나, 이용 중지 후 다시 사용하려는 계정입니다.</p></div><b>{requestedOperators.length}</b></div>
                        <div className={styles.operatorList}>
                          {requestedOperators.map(renderOperatorCard)}
                          {!requestedOperators.length && <p className={styles.operatorEmpty}>확인할 요청이 없습니다.</p>}
                        </div>
                      </section>

                      <section className={styles.operatorGroup}>
                        <div className={styles.operatorGroupHeading}><div><h3>사용 중인 운영자</h3><p>현재 운영툴에 들어올 수 있는 계정입니다.</p></div><b>{activeOperators.length}</b></div>
                        <div className={styles.operatorList}>
                          {activeOperators.map(renderOperatorCard)}
                          {!activeOperators.length && <p className={styles.operatorEmpty}>사용 중인 운영자가 없습니다.</p>}
                        </div>
                      </section>

                      <section className={styles.operatorGroup}>
                        <div className={styles.operatorGroupHeading}><div><h3>이용 중지된 운영자</h3><p>현재 운영툴은 사용할 수 없으며, 필요하면 운영자 목록에서 삭제할 수 있습니다.</p></div><b>{inactiveOperators.length}</b></div>
                        <div className={styles.operatorList}>
                          {inactiveOperators.map(renderOperatorCard)}
                          {!inactiveOperators.length && <p className={styles.operatorEmpty}>이용 중지된 운영자가 없습니다.</p>}
                        </div>
                      </section>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {categoryPanelOpen && (
        <div className={styles.editorBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCategoryPanel(); }}>
          <section ref={categoryDialogRef} className={`${styles.editor} ${styles.categoryManager}`} role="dialog" aria-modal="true" aria-labelledby="category-editor-title" tabIndex={-1}>
            <header>
              <div className={styles.categoryHeaderTitle}>
                {categoryDraft && <button className={styles.categoryBackButton} type="button" onClick={backToCategoryManager} aria-label="카테고리 목록으로 돌아가기">←</button>}
                <div>
                  <p className={styles.kicker}>{categoryDraft ? (categoryDraft.id ? "카테고리 편집" : "새 카테고리") : "카테고리 목록"}</p>
                  <h2 id="category-editor-title">{categoryDraft ? (categoryDraft.id ? "카테고리 수정" : "카테고리 추가") : "카테고리 관리"}</h2>
                </div>
              </div>
              <button type="button" onClick={closeCategoryPanel} aria-label="카테고리 관리창 닫기">×</button>
            </header>

            {!categoryDraft ? (
              <div className={styles.categoryManagerScroll} data-reorder-scroll>
                <div className={styles.categoryManagerIntro}>
                  <div><h3>메뉴를 나누는 카테고리</h3><p>같은 메뉴 묶음 안에서 ↕ 순서 버튼을 끌어 순서를 바꿀 수 있습니다. 키보드는 방향키를 사용하세요.</p></div>
                  <button className={styles.primaryButton} data-category-primary type="button" onClick={openCategoryAdd} disabled={busy || Boolean(keyboardReorder)}>＋ 카테고리 추가</button>
                </div>

                {activeSections.map((section) => {
                  const sectionCategories = categories.filter((category) => category.sectionId === section.id);
                  return (
                    <section className={styles.categoryGroup} key={section.id}>
                      <div className={styles.categoryGroupHeader}>
                        <div><h3>{section.name.ko}</h3><small>{section.name.pl} · 같은 묶음 안에서 순서 변경</small></div>
                        <span>{sectionCategories.length}개</span>
                      </div>
                      <div className={styles.categoryAdminList}>
                        {sectionCategories.map((category) => {
                      const categoryItems = state.items.filter((item) => item.categoryId === category.id);
                      const activeMenuCount = categoryItems.filter((item) => item.archivedAt === null).length;
                      const archivedMenuCount = categoryItems.length - activeMenuCount;
                      const orderIndex = sectionCategories.findIndex((candidate) => candidate.id === category.id);
                      return (
                        <article
                          className={`${styles.categoryAdminCard} ${reorderCardClass("category", category.id)}`}
                          key={category.id}
                          data-reorder-kind="category"
                          data-reorder-id={category.id}
                          onDragOver={(event) => dragOverCard(event, "category", category.id)}
                          onDrop={(event) => dropOnCard(event, "category", category.id)}
                        >
                          <button
                            className={styles.dragHandle}
                            type="button"
                            data-reorder-handle
                            draggable={!busy && !keyboardReorder}
                            disabled={busy || Boolean(keyboardReorder && (keyboardReorder.kind !== "category" || keyboardReorder.id !== category.id))}
                            aria-label={`${category.name.ko} 카테고리 순서 변경, 현재 ${orderIndex + 1}/${sectionCategories.length}`}
                            aria-describedby="reorder-instructions"
                            aria-pressed={keyboardReorder?.kind === "category" && keyboardReorder.id === category.id}
                            title="끌어서 순서 바꾸기 · 키보드는 Enter 후 방향키"
                            onClick={() => handleReorderClick("category", category.id)}
                            onKeyDown={(event) => keyboardMove(event, "category", category.id)}
                            onDragStart={(event) => nativeDragStart(event, "category", category.id)}
                            onDragEnd={nativeDragEnd}
                            onPointerDown={(event) => touchPointerDown(event, "category", category.id)}
                            onPointerMove={touchPointerMove}
                            onPointerUp={touchPointerEnd}
                            onPointerCancel={touchPointerCancel}
                          >⠿</button>
                          <div className={styles.categoryAdminImage}>{category.imagePath ? <img src={resolveAdminImage(category.imagePath)} alt="" /> : <span>사진<br />없음</span>}</div>
                          <div className={styles.categoryAdminInfo}>
                            <span>{section.name.ko}</span>
                            <h4>{category.name.ko}</h4>
                            <p>{category.name.pl} · {category.name.en}</p>
                            <div className={styles.categoryAdminMeta}><span>사용 중 메뉴 {activeMenuCount}</span>{archivedMenuCount > 0 && <span>보관 메뉴 {archivedMenuCount}</span>}<span>{orderIndex + 1}번째</span></div>
                          </div>
                          <div className={styles.categoryAdminActions}>
                            <div className={styles.keyboardMoveControls} aria-label={`${category.name.ko} 빠른 순서 이동`}>
                              <button type="button" onClick={() => moveWithTouchControls("category", category.id, -1)} disabled={busy || orderIndex <= 0} aria-label={`${category.name.ko} 위로 이동`}>↑</button>
                              <button type="button" onClick={() => moveWithTouchControls("category", category.id, 1)} disabled={busy || orderIndex >= sectionCategories.length - 1} aria-label={`${category.name.ko} 아래로 이동`}>↓</button>
                            </div>
                            <button type="button" onClick={() => openCategoryEdit(category)} disabled={busy || Boolean(keyboardReorder)}>수정</button>
                            <button
                              type="button"
                              onClick={() => archiveCategory(category, true)}
                              disabled={busy || Boolean(keyboardReorder)}
                              title={activeMenuCount > 0 ? `사용 중인 메뉴 ${activeMenuCount}개를 먼저 옮기거나 보관해 주세요.` : "확인용 저장과 사이트 공개 후 카테고리를 손님 화면에서 숨깁니다."}
                            >보관</button>
                            {categoryItems.length === 0 && <button className={styles.dangerButton} type="button" onClick={() => deleteCategory(category)} disabled={busy || Boolean(keyboardReorder)}>삭제</button>}
                          </div>
                        </article>
                      );
                    })}
                        {!sectionCategories.length && <div className={styles.categoryEmpty}>이 묶음에 사용 중인 카테고리가 없습니다.</div>}
                      </div>
                    </section>
                  );
                })}
                {!activeSections.length && <div className={styles.categoryEmpty}>사용 중인 메뉴 묶음이 없습니다.</div>}

                <section className={styles.categoryGroup}>
                  <div className={styles.categoryGroupHeader}><h3>보관함</h3><span>{archivedCategories.length}개</span></div>
                  <div className={styles.categoryAdminList}>
                    {archivedCategories.map((category) => {
                      const menuCount = state.items.filter((item) => item.categoryId === category.id).length;
                      return (
                        <article className={`${styles.categoryAdminCard} ${styles.categoryArchived}`} key={category.id}>
                          <div className={styles.categoryAdminImage}>{category.imagePath ? <img src={resolveAdminImage(category.imagePath)} alt="" /> : <span>사진<br />없음</span>}</div>
                          <div className={styles.categoryAdminInfo}>
                            <span>{sectionMap.get(category.sectionId)?.name.ko ?? "미분류 그룹"}</span>
                            <h4>{category.name.ko}</h4>
                            <p>{category.name.pl} · {category.name.en}</p>
                            <div className={styles.categoryAdminMeta}><span>포함된 메뉴 {menuCount}</span><span>사이트에서 숨김</span></div>
                          </div>
                          <div className={styles.categoryAdminActions}>
                            <button type="button" onClick={() => openCategoryEdit(category)} disabled={busy || Boolean(keyboardReorder)}>수정</button>
                            <button className={styles.restoreAction} type="button" onClick={() => archiveCategory(category, false)} disabled={busy || Boolean(keyboardReorder)}>복원</button>
                            {menuCount === 0 && <button className={styles.dangerButton} type="button" onClick={() => deleteCategory(category)} disabled={busy || Boolean(keyboardReorder)}>삭제</button>}
                          </div>
                        </article>
                      );
                    })}
                    {!archivedCategories.length && <div className={styles.categoryEmpty}>보관한 카테고리가 없습니다.</div>}
                  </div>
                </section>
              </div>
            ) : (
              <form onSubmit={saveCategoryDraft}>
                <div className={styles.editorScroll}>
                  <section className={styles.formSection}>
                    <h3><span>01</span> 기본 정보</h3>
                    <label className={styles.field}>메뉴 묶음<select value={categoryDraft.sectionId} onChange={(event) => setCategoryDraft({ ...categoryDraft, sectionId: event.target.value })} required>{activeSections.map((section) => <option key={section.id} value={section.id}>{section.name.ko} · {section.name.pl}</option>)}</select></label>
                    <div className={styles.languageFields}>
                      {languages.map((language) => <label className={styles.field} key={language.id}><span>카테고리명 <b>{language.label}</b><small>{language.hint}</small></span><input value={categoryDraft.name[language.id]} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: { ...categoryDraft.name, [language.id]: event.target.value } })} required /></label>)}
                    </div>
                  </section>

                  <section className={styles.formSection}>
                    <h3><span>02</span> 안내 문구</h3>
                    <div className={styles.languageFields}>
                      {languages.map((language) => <label className={styles.field} key={language.id}><span>설명 <b>{language.label}</b></span><input value={categoryDraft.description[language.id]} onChange={(event) => setCategoryDraft({ ...categoryDraft, description: { ...categoryDraft.description, [language.id]: event.target.value } })} placeholder="카테고리 아래에 표시할 설명" /></label>)}
                    </div>
                    <div className={styles.languageFields}>
                      {languages.map((language) => <label className={styles.field} key={language.id}><span>주문 안내 <b>{language.label}</b></span><input value={categoryDraft.orderNote[language.id]} onChange={(event) => setCategoryDraft({ ...categoryDraft, orderNote: { ...categoryDraft.orderNote, [language.id]: event.target.value } })} placeholder="선택 사항" /></label>)}
                    </div>
                  </section>

                  <section className={styles.formSection}>
                    <h3><span>03</span> 대표 사진과 표시 설정</h3>
                    <div className={styles.imageEditor}>
                      <div className={styles.imagePreview}>{(categoryPreviewUrl || categoryDraft.imagePath) ? <img src={categoryPreviewUrl || resolveAdminImage(categoryDraft.imagePath)} alt="카테고리 대표 사진 미리보기" /> : <span>사진<br />미리보기</span>}</div>
                      <div>
                        <label className={styles.uploadButton}>사진 선택<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseCategoryImage(event.target.files?.[0] ?? null)} /></label>
                        <p>JPG, PNG, WebP · 최대 10MB<br />사진은 알맞은 크기로 자동 조정해 저장합니다.</p>
                      </div>
                    </div>
                    <label className={styles.field}>사진 파일 주소 (선택)<input value={categoryDraft.imagePath} onChange={(event) => setCategoryDraft({ ...categoryDraft, imagePath: event.target.value })} placeholder="보통은 위의 ‘사진 선택’을 사용하세요." /></label>
                    <div className={styles.twoColumns}>
                      <label className={styles.field}>카테고리 순서<input type="text" value={`${categoryDraft.sortOrder + 1}번째`} readOnly /><small>저장한 뒤 카테고리 목록에서 끌어서 바꿀 수 있습니다.</small></label>
                      <label className={styles.availabilityToggle}><input type="checkbox" checked={categoryDraft.cover} onChange={(event) => setCategoryDraft({ ...categoryDraft, cover: event.target.checked })} /><span><i />대표 카테고리로 표시</span></label>
                    </div>
                  </section>
                </div>
                <footer className={styles.categoryPanelFooter}><button className={styles.cancelButton} type="button" onClick={backToCategoryManager} disabled={busy}>목록으로</button><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "저장 중…" : categoryDraft.id ? "수정 내용 저장" : "카테고리 추가"}</button></footer>
              </form>
            )}
          </section>
        </div>
      )}

      {draft && (
        <div className={styles.editorBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
          <section className={styles.editor} role="dialog" aria-modal="true" aria-labelledby="editor-title">
            <header><div><p className={styles.kicker}>{draft.id ? "메뉴 편집" : "새 메뉴"}</p><h2 id="editor-title">{draft.id ? "메뉴 수정" : "메뉴 추가"}</h2></div><button type="button" onClick={closeEditor} aria-label="편집창 닫기">×</button></header>
            <form onSubmit={saveDraft}>
              <div className={styles.editorScroll}>
                <section className={styles.formSection}>
                  <h3><span>01</span> 기본 정보</h3>
                  <label className={styles.field}>카테고리<select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })} required>{categories.map((category) => <option key={category.id} value={category.id}>{category.name.ko} · {category.name.pl}</option>)}</select></label>
                  <div className={styles.languageFields}>
                    {languages.map((language) => <label className={styles.field} key={language.id}><span>메뉴명 <b>{language.label}</b><small>{language.hint}</small></span><input value={draft.name[language.id]} onChange={(event) => setDraft({ ...draft, name: { ...draft.name, [language.id]: event.target.value } })} required /></label>)}
                  </div>
                </section>
                <section className={styles.formSection}>
                  <h3><span>02</span> 가격과 상태</h3>
                  <div className={styles.languageFields}>
                    {languages.map((language) => <label className={styles.field} key={language.id}><span>표시할 가격 <b>{language.label}</b></span><input value={draft.price[language.id]} onChange={(event) => setDraft({ ...draft, price: { ...draft.price, [language.id]: event.target.value } })} placeholder={language.id === "pl" ? "예: M 35 zł · L 60 zł" : "사이트에 표시할 가격"} required /></label>)}
                  </div>
                  <div className={styles.twoColumns}>
                    <label className={styles.field}>태그<select value={draft.tag} onChange={(event) => setDraft({ ...draft, tag: event.target.value as MenuTag })}>{tagOptions.map((tag) => <option key={tag.value} value={tag.value}>{tag.label}</option>)}</select></label>
                    <label className={styles.field}>메뉴 순서<input type="text" value={`${draft.sortOrder + 1}번째`} readOnly /><small>저장한 뒤 해당 카테고리 목록에서 끌어서 바꿀 수 있습니다.</small></label>
                  </div>
                  <label className={styles.availabilityToggle}><input type="checkbox" checked={draft.isAvailable} onChange={(event) => setDraft({ ...draft, isAvailable: event.target.checked })} /><span><i />판매 중으로 표시</span></label>
                </section>
                <section className={styles.formSection}>
                  <h3><span>03</span> 메뉴 사진</h3>
                  <div className={styles.imageEditor}>
                    <div className={styles.imagePreview}>{(previewUrl || draft.imagePath) ? <img src={previewUrl || resolveAdminImage(draft.imagePath)} alt="메뉴 사진 미리보기" /> : <span>사진<br />미리보기</span>}</div>
                    <div>
                      <label className={styles.uploadButton}>사진 선택<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseImage(event.target.files?.[0] ?? null)} /></label>
                      <p>JPG, PNG, WebP · 최대 10MB<br />사진은 알맞은 크기로 자동 조정해 저장합니다.</p>
                    </div>
                  </div>
                  <label className={styles.field}>사진 파일 주소 (선택)<input value={draft.imagePath} onChange={(event) => setDraft({ ...draft, imagePath: event.target.value })} placeholder="보통은 위의 ‘사진 선택’을 사용하세요." /></label>
                </section>
              </div>
              <footer><button className={styles.cancelButton} type="button" onClick={closeEditor} disabled={busy}>취소</button><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "저장 중…" : draft.id ? "수정 내용 저장" : "메뉴 추가"}</button></footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
