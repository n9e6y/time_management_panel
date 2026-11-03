// The pages in the URL (IA §3.3), so every view can be bookmarked. No router dependency: four paths.
import { useEffect, useState } from "react";

export type Page = "overview" | "rhythm" | "quality" | "settings";

export const PAGE_PATH: Record<Page, string> = {
  overview: "/overview", rhythm: "/rhythm", quality: "/data-quality", settings: "/settings",
};

const BY_PATH = new Map(Object.entries(PAGE_PATH).map(([page, path]) => [path, page as Page]));

export function pageOf(pathname: string): Page {
  return BY_PATH.get(pathname.replace(/\/+$/, "") || "/") ?? "overview";
}

/** The current page, kept in the path; Back and Forward work. */
export function useRoute(): [Page, (page: Page) => void] {
  const [page, setPage] = useState<Page>(() => pageOf(window.location.pathname));
  useEffect(() => {
    // Land on the canonical path, so "/" becomes "/overview" and Back has somewhere to return to.
    const path = PAGE_PATH[pageOf(window.location.pathname)];
    if (window.location.pathname !== path) {
      window.history.replaceState(null, "", `${path}${window.location.search}${window.location.hash}`);
    }
    const onPop = () => setPage(pageOf(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (next: Page) => {
    if (next !== pageOf(window.location.pathname)) {
      window.history.pushState(null, "", `${PAGE_PATH[next]}${window.location.search}${window.location.hash}`);
    }
    setPage(next);
  };
  return [page, go];
}
