"use client";

import { useEffect } from "react";

type RevealKind = "up" | "left" | "right" | "scale";

type RevealGroup = {
  selector: string;
  kind: RevealKind;
  delay?: number;
  delayStep?: number;
  delayCycle?: number;
};

const revealGroups: RevealGroup[] = [
  { selector: ".section-heading", kind: "up" },
  { selector: ".menu-card", kind: "up", delayStep: 70, delayCycle: 3 },
  { selector: ".menu-footnote", kind: "up" },
  { selector: ".story-symbol", kind: "left" },
  { selector: ".story-copy", kind: "right", delay: 80 },
  { selector: ".value-card", kind: "up", delayStep: 70, delayCycle: 3 },
  { selector: ".instagram-copy", kind: "left" },
  { selector: ".instagram-card", kind: "right", delay: 90 },
  { selector: ".visit-title", kind: "left" },
  { selector: ".visit-card", kind: "right", delay: 90 },
  { selector: ".visit-drinks", kind: "scale", delay: 140 },
  { selector: ".full-menu-heading", kind: "up" },
  { selector: ".full-menu-group-title", kind: "up" },
  { selector: ".full-menu-card", kind: "up", delayStep: 70, delayCycle: 2 },
  { selector: ".full-menu-note", kind: "up" },
  { selector: ".menu-instagram-message", kind: "left" },
  { selector: ".menu-instagram-strip > a", kind: "right", delay: 80 },
  { selector: "footer > *", kind: "up", delayStep: 60, delayCycle: 3 },
];

export default function ScrollReveal() {
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (reduceMotion.matches || !("IntersectionObserver" in window)) {
      return;
    }

    const root = document.documentElement;
    const elements: HTMLElement[] = [];

    revealGroups.forEach(({ selector, kind, delay = 0, delayStep = 0, delayCycle = 1 }) => {
      document.querySelectorAll<HTMLElement>(selector).forEach((element, index) => {
        if (element.dataset.reveal) return;

        element.dataset.reveal = kind;
        element.style.setProperty(
          "--reveal-delay",
          `${delay + (index % delayCycle) * delayStep}ms`,
        );
        elements.push(element);
      });
    });

    const visibleBoundary = window.innerHeight * 0.92;
    elements.forEach((element) => {
      const bounds = element.getBoundingClientRect();
      if (bounds.top < visibleBoundary && bounds.bottom > 0) {
        element.classList.add("is-visible");
      }
    });

    root.classList.add("motion-ready");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        rootMargin: "0px 0px -7% 0px",
        threshold: 0.06,
      },
    );

    elements.forEach((element) => {
      if (!element.classList.contains("is-visible")) {
        observer.observe(element);
      }
    });

    const revealFocusedElement = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const revealTarget = target.closest<HTMLElement>("[data-reveal]");
      if (!revealTarget) return;

      revealTarget.style.setProperty("--reveal-delay", "0ms");
      revealTarget.classList.add("is-visible");
      observer.unobserve(revealTarget);
    };

    document.addEventListener("focusin", revealFocusedElement);

    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", revealFocusedElement);
      root.classList.remove("motion-ready");
      elements.forEach((element) => {
        element.classList.remove("is-visible");
        element.removeAttribute("data-reveal");
        element.style.removeProperty("--reveal-delay");
      });
    };
  }, []);

  return null;
}
