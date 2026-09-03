"use client";

import { useEffect, useState } from "react";

/**
 * Whether the viewport is below Tailwind's `md` breakpoint (768px). Used to
 * decide whether a mobile-only Sheet should mount at all: hiding it with
 * `md:hidden` is not enough because its overlay is a portalled sibling that
 * would still cover the whole viewport on desktop.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isMobile;
}
