"use client";

/* The brand mark is a small fixed local asset shared with the admin shell. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import {
  completeGoogleOAuthSignIn,
  signInWithGoogle,
} from "@/lib/menu-admin/supabase-rest";
import styles from "../../admin.module.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const adminPath = `${basePath}/admin/`;

type CallbackState =
  | { status: "loading"; message: string }
  | { status: "error"; message: string };

export default function GoogleAuthCallback() {
  const [state, setState] = useState<CallbackState>({
    status: "loading",
    message: "Google 로그인을 확인하고 있습니다.",
  });
  const [retrying, setRetrying] = useState(false);
  const awaitingApproval = state.status === "error"
    && state.message.includes("운영자 권한 요청을 보냈습니다");

  useEffect(() => {
    let active = true;
    async function finishSignIn() {
      try {
        await completeGoogleOAuthSignIn();
        if (active) window.location.replace(adminPath);
      } catch (error) {
        if (active) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Google 로그인을 확인하지 못했습니다.",
          });
        }
      }
    }
    void finishSignIn();
    return () => { active = false; };
  }, []);

  async function retryGoogleLogin() {
    setRetrying(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Google 로그인을 다시 시작하지 못했습니다.",
      });
      setRetrying(false);
    }
  }

  return (
    <main className={styles.loginPage}>
      <section className={styles.loginCard} aria-live="polite">
        <div className={styles.loginMark}><img src={`${basePath}/brand/logo.png`} alt="" /></div>
        <p className={styles.kicker}>K STREET SNACK 메뉴 관리</p>
        <h1>{state.status === "loading" ? "로그인 확인 중" : awaitingApproval ? "운영자 승인을 기다리고 있어요" : "로그인하지 못했습니다"}</h1>
        <p className={styles.loginIntro}>
          {awaitingApproval
            ? "최고 관리자에게 승인을 받은 뒤 같은 Google 계정으로 다시 로그인하세요."
            : state.message}
        </p>
        {state.status === "loading" ? (
          <div className={styles.callbackProgress} role="status"><span className={styles.spinner} />잠시만 기다려 주세요.</div>
        ) : (
          <>
            <button className={`${styles.primaryButton} ${styles.googleLoginButton}`} type="button" onClick={retryGoogleLogin} disabled={retrying}>
              <span aria-hidden="true">G</span>{retrying ? "Google로 이동 중…" : awaitingApproval ? "승인받은 뒤 다시 로그인" : "Google 로그인 다시 시도"}
            </button>
            <a className={styles.callbackBackLink} href={adminPath}>메뉴 관리로 돌아가기</a>
          </>
        )}
      </section>
    </main>
  );
}
