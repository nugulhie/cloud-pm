"use client";
import { useEffect, useRef, type ReactNode } from "react";
export default function EditorDialog({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    element
      ?.querySelector<HTMLElement>(
        'form input:not([type="checkbox"]):not([type="hidden"]):not(:disabled), form textarea:not(:disabled)',
      )
      ?.focus();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="prd-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="section-title">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="닫기"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
