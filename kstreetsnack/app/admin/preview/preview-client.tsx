"use client";

import { useEffect, useState } from "react";
import MenuView from "@/app/menu-view";
import type { Lang } from "@/app/page";
import { buildPublishedPayload, loadLocalState } from "@/lib/menu-admin/local-store";
import {
  isSupabaseConfigured,
  loadRemoteState,
  restoreSession,
} from "@/lib/menu-admin/supabase-rest";
import type { PublishedMenuGroups } from "@/lib/menu/published-menu";
import styles from "./preview.module.css";

const menuAdminPath = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/admin/menu/`;

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; groups: PublishedMenuGroups; source: "local" | "supabase" };

export default function LocalMenuPreview() {
  const [lang, setLang] = useState<Lang>("pl");
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    async function loadPreview() {
      try {
        if (!isSupabaseConfigured) {
          const payload = buildPublishedPayload(loadLocalState());
          if (active) setPreview({ status: "ready", groups: payload.groups, source: "local" });
          return;
        }

        const session = await restoreSession();
        if (!session) throw new Error("운영툴에 먼저 로그인한 뒤 미리보기를 열어 주세요.");
        const payload = buildPublishedPayload(await loadRemoteState(session));
        if (active) setPreview({ status: "ready", groups: payload.groups, source: "supabase" });
      } catch (error) {
        if (active) {
          setPreview({
            status: "error",
            message: error instanceof Error ? error.message : "미리보기를 불러오지 못했습니다.",
          });
        }
      }
    }
    void loadPreview();
    return () => { active = false; };
  }, []);

  if (preview.status !== "ready") {
    return (
      <main className={styles.statePage}>
        <p>{preview.status === "loading" ? "메뉴 미리보기를 준비하고 있습니다." : preview.message}</p>
        {preview.status === "error" && <a href={menuAdminPath}>메뉴 관리로 돌아가기</a>}
      </main>
    );
  }

  return (
    <>
      <aside className={styles.toolbar} aria-label="메뉴 미리보기 설정">
        <div>
          <strong>사이트 공개 전 미리보기</strong>
          <span>{preview.source === "local" ? "이 브라우저에 저장된 메뉴" : "온라인에 저장된 메뉴"}</span>
        </div>
        <label>
          언어
          <select value={lang} onChange={(event) => setLang(event.target.value as Lang)}>
            <option value="pl">폴란드어 (PL)</option>
            <option value="en">영어 (EN)</option>
            <option value="ko">한국어 (KO)</option>
          </select>
        </label>
        <a href={menuAdminPath}>메뉴 관리로 돌아가기</a>
      </aside>
      <MenuView lang={lang} groups={preview.groups} />
    </>
  );
}
