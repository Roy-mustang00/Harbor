import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

type TabBarAutoHide = {
  barHidden: boolean;
  showBar: () => void;
  setBarHidden: (hidden: boolean) => void;
};

const fallback: TabBarAutoHide = {
  barHidden: false,
  showBar: () => {},
  setBarHidden: () => {},
};

const TabBarAutoHideContext = createContext<TabBarAutoHide>(fallback);

// Auto-hide state for the bottom tab bar, mirroring mobile-sheet-lock's
// provider shape. Reporters (the shell's scroll containers) are gated on the
// standalone phone entry, so in the web-remote habitat nothing ever reports
// and the bar keeps its current always-visible behaviour.
export function TabBarAutoHideProvider({ children }: { children: ReactNode }) {
  const [barHidden, setBarHiddenState] = useState(false);
  const hiddenRef = useRef(false);

  const setBarHidden = useCallback((hidden: boolean) => {
    if (hiddenRef.current === hidden) return;
    hiddenRef.current = hidden;
    setBarHiddenState(hidden);
  }, []);
  const showBar = useCallback(() => setBarHidden(false), [setBarHidden]);

  const value = useMemo(
    () => ({ barHidden, showBar, setBarHidden }),
    [barHidden, showBar, setBarHidden],
  );
  return (
    <TabBarAutoHideContext.Provider value={value}>
      {children}
    </TabBarAutoHideContext.Provider>
  );
}

export function useTabBarAutoHide() {
  return useContext(TabBarAutoHideContext);
}

// Standard mobile pattern: scrolling down hides the bar, scrolling up brings
// it back, and near the top of the feed it is always visible. The deadzone
// keeps small jitter (and the rubber-band settle) from flickering the bar.
const TOP_REVEAL_PX = 56;
const DIRECTION_DEADZONE_PX = 6;

export function useHideTabBarOnScroll(
  scrollRef: { current: HTMLElement | null },
  enabled: boolean,
) {
  const { setBarHidden } = useTabBarAutoHide();

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    let lastTop = el.scrollTop;
    let raf = 0;
    const update = () => {
      raf = 0;
      const top = el.scrollTop;
      const delta = top - lastTop;
      if (top <= TOP_REVEAL_PX) setBarHidden(false);
      else if (delta >= DIRECTION_DEADZONE_PX) setBarHidden(true);
      else if (delta <= -DIRECTION_DEADZONE_PX) setBarHidden(false);
      lastTop = top;
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      setBarHidden(false);
    };
  }, [enabled, scrollRef, setBarHidden]);
}
