import { createContext, useContext, useEffect, useRef, useState } from "react";
import { loadMs, LOAD_TOKENS } from "./loadTiming";

/**
 * Whether the page around a panel has been revealed (#494). A panel's skeleton clock starts then, not
 * at mount: a page holds its panels back for up to the reveal budget, and a skeleton that "appeared"
 * while nobody could see it would be gone again the moment the page is. True outside a page.
 */
export const PageRevealContext = createContext(true);

/**
 * The skeleton clock. `pending` is "the data isn't here yet". Returns whether to show a skeleton at
 * all (`pending`, or still holding for the minimum) and whether it is `visible` yet. Rules: not
 * visible until `pending` has lasted the show-delay (no flash on a fast load), and once visible it
 * stays for the minimum display, even if the data lands sooner (no flicker). Nothing here delays the
 * data: the content renders the moment `pending` ends unless a shown skeleton is inside its minimum.
 */
export function useSkeletonClock(pending: boolean): { show: boolean; visible: boolean } {
  const revealed = useContext(PageRevealContext);
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (pending && revealed && !visible) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, loadMs(LOAD_TOKENS.skeletonDelay));
      return () => clearTimeout(timer);
    }
    if (!pending && visible) {
      const left = shownAt.current + loadMs(LOAD_TOKENS.skeletonMin) - Date.now();
      if (left <= 0) {
        setVisible(false);
        return;
      }
      const timer = setTimeout(() => setVisible(false), left);
      return () => clearTimeout(timer);
    }
  }, [pending, revealed, visible]);

  return { show: pending || visible, visible };
}
