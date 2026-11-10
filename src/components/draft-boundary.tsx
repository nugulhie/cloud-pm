"use client";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
export const DraftScope = createContext<string | null>(null);
type Values = Record<string, string[]>;
const DraftRestoreContext = createContext<{
  values: Values;
  claim: (key: string) => boolean;
} | null>(null);
export function useDraftRestore(
  key: string,
  callback: (values: Values) => void,
) {
  const restore = useContext(DraftRestoreContext),
    handler = useRef(callback);
  handler.current = callback;
  useEffect(() => {
    if (restore && restore.claim(key)) handler.current(restore.values);
  }, [restore, key]);
}
type Draft = { values: Values; savedAt: number; revision?: number };
const maxAge = 7 * 86400000;
function fields(root: HTMLElement) {
  return [
    ...root.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input,select,textarea"),
  ].filter(
    (e) =>
      !["password", "file", "search", "submit", "button"].includes(e.type) &&
      !!e.name &&
      !e.closest("[data-draft-ignore]"),
  );
}
function fieldKey(
  e: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
) {
  return e.name;
}
function snapshot(root: HTMLElement) {
  const values: Values = Object.create(null);
  for (const e of fields(root)) {
    const key = fieldKey(e);
    values[key] ??= [];
    if (
      e instanceof HTMLInputElement &&
      ["checkbox", "radio"].includes(e.type)
    ) {
      if (e.checked) values[key].push(e.value);
    } else if (e instanceof HTMLSelectElement && e.multiple)
      values[key].push(...[...e.selectedOptions].map((o) => o.value));
    else values[key].push(e.value);
  }
  return values;
}
export function draftSaved(element: HTMLElement | null) {
  element
    ?.closest("[data-draft-boundary]")
    ?.dispatchEvent(new Event("pm:draft-saved"));
}
export default function DraftBoundary({
  id,
  revision,
  onClose,
  onRestore,
  children,
}: {
  id: string;
  revision?: number;
  onClose: () => void;
  onRestore?: (values: Values) => void;
  children: ReactNode;
}) {
  const scope = useContext(DraftScope),
    root = useRef<HTMLDivElement>(null),
    initial = useRef(""),
    dirty = useRef(false);
  const key = scope ? `cloud-pm:draft:v1:${scope}:${id}` : null;
  const [available, setAvailable] = useState<Draft | null>(null),
    [notice, setNotice] = useState(""),
    [closing, setClosing] = useState(false);
  const [restoration, setRestoration] = useState<{
    values: Values;
    claim: (key: string) => boolean;
  } | null>(null);
  const saveRef = useRef(() => {});
  const touched = useRef(false);
  saveRef.current = () => {
    if (!key || !root.current) return;
    const values = snapshot(root.current);
    dirty.current = JSON.stringify(values) !== initial.current;
    try {
      if (dirty.current) {
        localStorage.setItem(
          key,
          JSON.stringify({ values, savedAt: Date.now(), revision }),
        );
        setNotice("초안 저장됨 · 이 브라우저에 7일 보관");
      } else {
        localStorage.removeItem(key);
        setNotice("");
      }
    } catch {
      setNotice("초안을 보관할 공간이 부족합니다. 저장 후 닫아 주세요.");
    }
  };
  useEffect(() => {
    if (!key || !root.current) return;
    const element = root.current;
    setAvailable(null);
    setRestoration(null);
    setClosing(false);
    setNotice("");
    touched.current = false;
    initial.current = JSON.stringify(snapshot(element));
    dirty.current = false;
    try {
      const raw = localStorage.getItem(key);
      const value = raw ? (JSON.parse(raw) as Draft) : null;
      if (
        value &&
        Date.now() - value.savedAt < maxAge &&
        value.values &&
        typeof value.values === "object" &&
        Object.values(value.values).every(
          (values) =>
            Array.isArray(values) && values.every((v) => typeof v === "string"),
        )
      )
        setAvailable(value);
      else localStorage.removeItem(key);
    } catch {
      setNotice("초안을 읽지 못했습니다.");
    }
    const persist = () => {
      touched.current = true;
      saveRef.current();
    };
    const saved = () => {
      setRestoration(null);
      dirty.current = false;
      touched.current = false;
      try {
        localStorage.removeItem(key);
      } catch {}
      setAvailable(null);
      setNotice("");
      initial.current = JSON.stringify(snapshot(element));
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        persist();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        dirty.current &&
        (e.target as Element).closest?.("[data-draft-boundary]") === element &&
        element.closest("[open],.overlay")
      ) {
        e.preventDefault();
        e.stopPropagation();
        persist();
        setClosing(true);
      }
    };
    element.addEventListener("input", persist);
    element.addEventListener("change", persist);
    element.addEventListener("pm:draft-saved", saved);
    const observer = new MutationObserver(() => {
      if (touched.current || dirty.current) saveRef.current();
    });
    observer.observe(element, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["value", "checked"],
    });
    window.addEventListener("beforeunload", leave);
    window.addEventListener("keydown", escape, true);
    return () => {
      element.removeEventListener("input", persist);
      element.removeEventListener("change", persist);
      element.removeEventListener("pm:draft-saved", saved);
      observer.disconnect();
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("keydown", escape, true);
    };
  }, [key]);
  function discard() {
    touched.current = false;
    if (key) {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
    setAvailable(null);
    setNotice("");
    dirty.current = false;
  }
  useLayoutEffect(() => {
    if (!restoration || !root.current) return;
    const seen: Record<string, number> = {};
    for (const e of fields(root.current)) {
      if (e.type === "hidden") continue;
      const name = fieldKey(e),
        values = restoration.values[name];
      if (!values) continue;
      if (
        e instanceof HTMLInputElement &&
        ["checkbox", "radio"].includes(e.type)
      ) {
        if (e.checked !== values.includes(e.value)) e.click();
      } else {
        const value = values[seen[name] ?? 0] ?? "";
        seen[name] = (seen[name] ?? 0) + 1;
        const prototype =
          e instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : e instanceof HTMLSelectElement
              ? HTMLSelectElement.prototype
              : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
          e,
          value,
        );
        e.dispatchEvent(
          new Event(e instanceof HTMLSelectElement ? "change" : "input", {
            bubbles: true,
          }),
        );
      }
    }
  }, [restoration]);
  function restore() {
    if (!available) return;
    const claimed = new Set<string>();
    setRestoration({
      values: available.values,
      claim: (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
    });
    onRestore?.(available.values);
    setAvailable(null);
    setNotice("초안을 복원했습니다. 내용을 확인하고 저장하세요.");
    dirty.current = true;
  }
  return (
    <DraftRestoreContext.Provider value={restoration}>
      <div
        ref={root}
        data-draft-boundary={id}
        className="draft-boundary"
        onClickCapture={(e) => {
          if ((e.target as Element).closest(".reference-picker")) {
            touched.current = true;
            requestAnimationFrame(() => saveRef.current());
          }
          if (
            dirty.current &&
            (e.target as Element).closest("[data-draft-close]")
          ) {
            e.preventDefault();
            e.stopPropagation();
            saveRef.current();
            setClosing(true);
          }
        }}
      >
        {available && (
          <div className="draft-notice" role="status">
            이전에 작성한 초안이 있습니다.
            {available.revision !== revision &&
              " 원본이 변경되었습니다. 복원 후 최신 내용과 비교해 주세요."}
            <button type="button" onClick={restore}>
              초안 복원
            </button>
            <button type="button" onClick={discard}>
              초안 폐기
            </button>
          </div>
        )}
        {notice && (
          <p className="draft-status" role="status">
            {notice}
          </p>
        )}
        {closing && (
          <div className="draft-notice" role="alert">
            <span>작성 중인 내용을 초안으로 보관하고 닫을까요?</span>
            <button
              type="button"
              onClick={() => {
                saveRef.current();
                onClose();
              }}
            >
              초안 보관하고 닫기
            </button>
            <button
              type="button"
              onClick={() => {
                discard();
                onClose();
              }}
            >
              폐기하고 닫기
            </button>
            <button type="button" onClick={() => setClosing(false)}>
              계속 작성
            </button>
          </div>
        )}
        {children}
      </div>
    </DraftRestoreContext.Provider>
  );
}
