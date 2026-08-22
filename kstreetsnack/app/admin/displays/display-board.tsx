"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildPublishedPayload, loadLocalState } from "@/lib/menu-admin/local-store";
import {
  checkRemoteMenuAccess,
  isSupabaseConfigured,
  loadRemoteState,
  restoreSession,
} from "@/lib/menu-admin/supabase-rest";
import type { AuthSession } from "@/lib/menu-admin/types";
import {
  resolvePublishedMenuImage,
  type PublishedMenuGroups,
  type PublishedMenuItem,
} from "@/lib/menu/published-menu";
import {
  boardSlideDuration,
  boardSubtitle,
  boardTitle,
  paginateCategories,
  partitionSlideColumns,
  polishText,
  splitPrice,
  type BoardCategorySlice,
  type BoardKind,
} from "./board-utils";
import styles from "./display-board.module.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const displayHomePath = `${basePath}/admin/displays/`;
const menuAdminPath = `${basePath}/admin/menu/`;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? "";
const availabilityRefreshIntervalMs = 60_000;
const accessCheckIntervalMs = 15 * 60_000;

type BoardAvailabilityRow = {
  menu_item_id: string;
  is_available: boolean;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; groups: PublishedMenuGroups; source: "local" | "supabase" };

const tagLabels: Record<NonNullable<PublishedMenuItem["tag"]>, string> = {
  spicy: "OSTRE",
  "mild-spicy": "LEKKO OSTRE",
  "very-spicy": "BARDZO OSTRE",
  hot: "HOT",
  ice: "ICE",
};

function parseAvailability(value: unknown): BoardAvailabilityRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: BoardAvailabilityRow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.menu_item_id !== "string" || typeof row.is_available !== "boolean") return null;
    rows.push({ menu_item_id: row.menu_item_id, is_available: row.is_available });
  }
  return rows;
}

async function loadAvailability(): Promise<BoardAvailabilityRow[]> {
  if (!supabaseUrl || !supabasePublicKey) throw new Error("판매 상태 연결 정보가 없습니다.");
  const endpoint = new URL("/rest/v1/menu_availability", supabaseUrl);
  endpoint.searchParams.set("select", "menu_item_id,is_available");
  const response = await fetch(endpoint, {
    headers: { apikey: supabasePublicKey },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("판매 상태를 불러오지 못했습니다.");
  const rows = parseAvailability(await response.json());
  if (!rows) throw new Error("판매 상태 응답을 확인하지 못했습니다.");
  return rows;
}

function withAvailability(
  groups: PublishedMenuGroups,
  rows: readonly BoardAvailabilityRow[],
): PublishedMenuGroups {
  const availability = new Map(rows.map((row) => [row.menu_item_id, row.is_available]));
  return groups.map((group) => group.map((category) => ({
    ...category,
    items: category.items.map((item) => {
      if (!item.id) return item;
      return {
        ...item,
        availability: availability.get(item.id) === true ? "available" as const : "sold_out" as const,
      };
    }),
  })));
}

function Price({ item }: { item: PublishedMenuItem }) {
  const parts = splitPrice(item.price);
  const accessiblePrice = parts.map((part) => `${part.label} ${part.value}`.trim()).join(", ");
  return (
    <span className={styles.priceOptions} aria-label={accessiblePrice} title={accessiblePrice}>
      {parts.map((part, index) => (
        <span className={styles.priceOption} key={`${part.label}-${part.value}-${index}`}>
          {part.label && <span className={styles.priceLabel}>{part.label}</span>}
          <strong className={styles.priceValue}>{part.value}</strong>
        </span>
      ))}
    </span>
  );
}

type MotionStyle = CSSProperties & {
  "--column-delay"?: string;
  "--category-delay"?: string;
  "--ambient-delay"?: string;
};

function MenuRow({ item }: { item: PublishedMenuItem }) {
  const soldOut = item.availability === "sold_out";
  const itemName = polishText(item.name);
  return (
    <li className={`${styles.menuRow} ${soldOut ? styles.soldOut : ""}`}>
      <span className={styles.itemIdentity}>
        <span className={styles.itemName} title={itemName}>{itemName}</span>
        {item.tag && <span className={`${styles.tag} ${styles[`tag_${item.tag}`]}`}>{tagLabels[item.tag]}</span>}
        {soldOut && <span className={styles.soldOutLabel}>WYPRZEDANE</span>}
      </span>
      <Price item={item} />
    </li>
  );
}

function CategoryCard({
  slice,
  categoryIndex,
  ambientIndex,
}: {
  slice: BoardCategorySlice;
  categoryIndex: number;
  ambientIndex: number;
}) {
  const imageUrl = resolvePublishedMenuImage(slice.category.image, basePath);
  const multiPrice = slice.items.some((item) => splitPrice(item.price).length > 1);
  const dense = slice.items.length > 12;

  return (
    <section
      className={`${styles.category} ${multiPrice ? styles.multiPriceCategory : ""} ${dense ? styles.denseCategory : ""}`}
      style={{
        "--category-delay": `${categoryIndex * 35}ms`,
        "--ambient-delay": `${ambientIndex * 1450}ms`,
      } as MotionStyle}
    >
      <div className={styles.categoryIntro}>
        {/* Category artwork is intentionally shown once, never repeated per item. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.categoryImage} src={imageUrl} alt="" aria-hidden="true" />
        <div>
          <div className={styles.categoryTitleLine}>
            <h2>{polishText(slice.category.title)}</h2>
            {slice.continuation && <span className={styles.continuation}>CD.</span>}
          </div>
          <p>{polishText(slice.category.subtitle)}</p>
          {slice.category.orderNote && <small>{polishText(slice.category.orderNote)}</small>}
        </div>
      </div>
      <ul className={styles.items}>
        {slice.items.map((item, index) => (
          <MenuRow item={item} key={item.id ?? `${slice.category.id}-${index}`} />
        ))}
      </ul>
    </section>
  );
}

function BoardSlideView({
  kind,
  slide,
  slideIndex,
  slideCount,
  onOverflow,
}: {
  kind: BoardKind;
  slide: ReturnType<typeof paginateCategories>[number];
  slideIndex: number;
  slideCount: number;
  onOverflow?: () => void;
}) {
  const columns = partitionSlideColumns(slide, 3);
  const columnsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onOverflow || !columnsRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const renderedColumns = columnsRef.current?.querySelectorAll<HTMLElement>(":scope > div");
      if (!renderedColumns) return;
      const overflowed = Array.from(renderedColumns).some((column) => (
        column.scrollHeight > column.clientHeight + 1
        || column.scrollWidth > column.clientWidth + 1
      ));
      if (overflowed) onOverflow();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [kind, onOverflow, slide]);

  return (
    <div className={`${styles.board} ${kind === "food" ? styles.foodBoard : styles.cafeBoard}`}>
      <header className={styles.boardHeader}>
        <div className={styles.brandLockup}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${basePath}/brand/logo.png`} alt="K Street Snack" />
          <div>
            <p>K STREET SNACK · WROCŁAW</p>
            <h1>{boardTitle(kind)}</h1>
          </div>
        </div>
        <div className={styles.boardDescriptor}>
          <strong>{boardSubtitle(kind)}</strong>
          <span>PRZYGOTOWUJEMY NA ŚWIEŻO</span>
        </div>
      </header>

      <div className={styles.columns} ref={columnsRef} key={`${kind}-${slideIndex}`}>
        {columns.map((column, columnIndex) => (
          <div
            className={styles.column}
            style={{ "--column-delay": `${columnIndex * 45}ms` } as MotionStyle}
            key={columnIndex}
          >
            {column.map((slice, categoryIndex) => (
              <CategoryCard
                slice={slice}
                categoryIndex={categoryIndex}
                ambientIndex={(columnIndex * 4) + categoryIndex}
                key={`${slice.category.id}-${slice.continuation ? "continuation" : "start"}`}
              />
            ))}
          </div>
        ))}
      </div>

      <footer className={styles.boardFooter}>
        <span>ALERGENY? ZAPYTAJ NASZ ZESPÓŁ</span>
        {slideCount > 1 && (
          <span className={styles.pageNumber}>{String(slideIndex + 1).padStart(2, "0")} / {String(slideCount).padStart(2, "0")}</span>
        )}
        <span>SMACZNEGO!</span>
      </footer>
    </div>
  );
}

export default function DisplayBoard({ kind }: { kind: BoardKind }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [slideIndex, setSlideIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [availabilitySyncFailed, setAvailabilitySyncFailed] = useState(false);
  const [draftSyncFailed, setDraftSyncFailed] = useState(false);
  const [forcePagination, setForcePagination] = useState(false);
  const remoteSessionRef = useRef<AuthSession | null>(null);

  const loadBoard = useCallback(async (silent = false) => {
    if (!silent) {
      setForcePagination(false);
      setLoadState({ status: "loading" });
    }
    try {
      if (!isSupabaseConfigured) {
        remoteSessionRef.current = null;
        const payload = buildPublishedPayload(loadLocalState());
        setLoadState({ status: "ready", groups: payload.groups, source: "local" });
        setAvailabilitySyncFailed(false);
        setDraftSyncFailed(false);
        return;
      }

      const session = await restoreSession();
      if (!session) throw new Error("운영툴에 먼저 로그인한 뒤 매장 화면을 열어 주세요.");
      remoteSessionRef.current = session;
      const payload = buildPublishedPayload(await loadRemoteState(session));
      setLoadState({ status: "ready", groups: payload.groups, source: "supabase" });
      setAvailabilitySyncFailed(false);
      setDraftSyncFailed(false);
    } catch (error) {
      if (silent) {
        setDraftSyncFailed(true);
        return;
      }
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "매장 메뉴를 불러오지 못했습니다.",
      });
    }
  }, []);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    const refreshAvailability = async () => {
      if (document.visibilityState !== "visible") return;
      if (!isSupabaseConfigured) {
        await loadBoard(true);
        return;
      }
      try {
        const rows = await loadAvailability();
        setLoadState((current) => current.status === "ready"
          ? { ...current, groups: withAvailability(current.groups, rows) }
          : current);
        setAvailabilitySyncFailed(false);
      } catch {
        setAvailabilitySyncFailed(true);
      }
    };
    const timer = window.setInterval(() => void refreshAvailability(), availabilityRefreshIntervalMs);
    const onVisibilityChange = () => void refreshAvailability();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadBoard]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible" || !remoteSessionRef.current) return;
      try {
        const hasAccess = await checkRemoteMenuAccess(remoteSessionRef.current);
        setDraftSyncFailed(!hasAccess);
      } catch {
        setDraftSyncFailed(true);
      }
    }, accessCheckIntervalMs);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReducedMotion(media.matches);
      if (media.matches) setPaused(true);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const slides = useMemo(() => {
    if (loadState.status !== "ready") return [];
    const groupIndex = kind === "food" ? 0 : 1;
    // The current 37-item food board and 43-item cafe board each fit on one
    // 16:9 screen. A later, larger menu still falls back to additional pages.
    return paginateCategories(
      loadState.groups[groupIndex] ?? [],
      forcePagination ? (kind === "food" ? 14 : 16) : (kind === "food" ? 44 : 50),
      forcePagination ? 4 : 10,
    );
  }, [forcePagination, kind, loadState]);

  const handleBoardOverflow = useCallback(() => {
    setForcePagination(true);
    setSlideIndex(0);
  }, []);

  const goTo = useCallback((offset: number) => {
    setSlideIndex((current) => {
      if (slides.length < 1) return 0;
      return (current + offset + slides.length) % slides.length;
    });
  }, [slides.length]);

  useEffect(() => {
    if (paused || reducedMotion || slides.length <= 1) return;
    const timer = window.setInterval(() => goTo(1), boardSlideDuration(kind));
    return () => window.clearInterval(timer);
  }, [goTo, kind, paused, reducedMotion, slides.length]);

  useEffect(() => {
    if (slideIndex >= slides.length) setSlideIndex(0);
  }, [slideIndex, slides.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest("a, button, input, select, textarea")) return;
      if (event.code === "Space") {
        event.preventDefault();
        setPaused((value) => !value);
      } else if (event.key === "ArrowRight") {
        goTo(1);
      } else if (event.key === "ArrowLeft") {
        goTo(-1);
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (!document.fullscreenElement) void document.documentElement.requestFullscreen();
        else void document.exitFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goTo]);

  if (loadState.status !== "ready") {
    return (
      <main className={styles.statePage}>
        <div className={styles.stateCard}>
          <span className={styles.stateKicker}>K STREET SNACK · DISPLAY</span>
          <h1>{loadState.status === "loading" ? "매장 메뉴를 준비하고 있어요." : "매장 메뉴를 열지 못했어요."}</h1>
          <p>{loadState.status === "loading" ? "운영툴에 저장된 최신 메뉴를 불러오는 중입니다." : loadState.message}</p>
          {loadState.status === "error" && (
            <div className={styles.stateActions}>
              <button type="button" onClick={() => void loadBoard()}>다시 불러오기</button>
              <a href={menuAdminPath}>메뉴 관리로 이동</a>
            </div>
          )}
        </div>
      </main>
    );
  }

  if (slides.length === 0) {
    return (
      <main className={styles.statePage}>
        <div className={styles.stateCard}>
          <span className={styles.stateKicker}>K STREET SNACK · DISPLAY</span>
          <h1>표시할 메뉴가 없어요.</h1>
          <p>메뉴 관리에서 이 화면에 사용할 카테고리와 메뉴를 확인해 주세요.</p>
          <a className={styles.stateLink} href={menuAdminPath}>메뉴 관리로 이동</a>
        </div>
      </main>
    );
  }

  const activeSlide = slides[slideIndex] ?? slides[0];
  return (
    <main className={styles.viewport} data-source={loadState.source}>
      <div className={styles.canvas} aria-live="off">
        <BoardSlideView
          kind={kind}
          slide={activeSlide}
          slideIndex={slideIndex}
          slideCount={slides.length}
          onOverflow={!forcePagination && slides.length === 1 ? handleBoardOverflow : undefined}
        />

        {(availabilitySyncFailed || draftSyncFailed) && (
          <div className={styles.syncWarning} role="status">
            <span>운영툴 자동 갱신이 잠시 멈췄습니다.</span>
            <button type="button" onClick={() => void loadBoard()}>다시 연결</button>
          </div>
        )}

        <nav className={styles.controls} aria-label="매장 메뉴 화면 제어">
          <a href={displayHomePath} aria-label="매장 화면 선택으로 돌아가기">←</a>
          {slides.length > 1 && (
            <>
              <button type="button" onClick={() => goTo(-1)} aria-label="이전 화면">‹</button>
              <button type="button" onClick={() => setPaused((value) => !value)} aria-label={paused ? "자동 넘김 시작" : "자동 넘김 일시정지"}>
                {paused ? "▶" : "Ⅱ"}
              </button>
              <button type="button" onClick={() => goTo(1)} aria-label="다음 화면">›</button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              if (!document.fullscreenElement) void document.documentElement.requestFullscreen();
              else void document.exitFullscreen();
            }}
            aria-label="전체 화면 전환"
          >
            ⛶
          </button>
          <button type="button" onClick={() => void loadBoard()} aria-label="운영툴 메뉴 다시 불러오기">↻</button>
        </nav>

        {slides.length > 1 && (
          <div className={styles.progress} aria-label={`${slides.length}개 화면 중 ${slideIndex + 1}번째`}>
            {slides.map((_, index) => (
              <button
                type="button"
                className={index === slideIndex ? styles.activeDot : ""}
                onClick={() => setSlideIndex(index)}
                aria-label={`${index + 1}번째 화면`}
                aria-current={index === slideIndex ? "page" : undefined}
                key={index}
              />
            ))}
          </div>
        )}
      </div>
      <span className={styles.keyboardHint}>
        {slides.length > 1
          ? "Space: 일시정지 · ← →: 이동 · F: 전체 화면"
          : "F: 전체 화면 · 마우스를 올리면 제어 버튼 표시"}
      </span>
    </main>
  );
}
