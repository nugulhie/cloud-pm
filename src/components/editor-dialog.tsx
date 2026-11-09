"use client";
import { useEffect, useRef, type ReactNode } from "react";
import DraftBoundary from "./draft-boundary";
export default function EditorDialog({
  title,
  busy,
  onClose,
  children,
  draftKey,
  revision,
  onDraftRestore,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
  draftKey?: string;
  revision?: number;
  onDraftRestore?: (values: Record<string, string[]>) => void;
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
  const content = (
    <>
      <div className="section-title">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="닫기"
          data-draft-close
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </>
  );
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
      {draftKey ? (
        <DraftBoundary
          key={draftKey}
          id={draftKey}
          revision={revision}
          onClose={onClose}
          onRestore={onDraftRestore}
        >
          {content}
        </DraftBoundary>
      ) : (
        content
      )}
    </dialog>
  );
}
