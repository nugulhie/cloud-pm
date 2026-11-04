"use client";
import { useEffect, useId, useRef } from "react";
import type { deletionImpact } from "./deletion-impact";
export default function DeleteConfirmation({
  names,
  busy,
  error,
  onCancel,
  onConfirm,
  impact,
}: {
  names: string[];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  impact?: ReturnType<typeof deletionImpact>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    submitting = useRef(false),
    titleId = useId(),
    descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) {
      element.showModal();
      cancel.current?.focus();
    }
    return () => {
      if (element?.open) element.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="delete-confirmation"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={titleId}>선택한 {names.length}개 항목을 삭제할까요?</h2>
      <p id={descriptionId}>
        삭제 후 화면에서 복구할 수 없습니다. 선택한 항목과 하위 작업·댓글·연결이
        함께 삭제됩니다. GitHub의 PR·이슈 원본은 유지됩니다.
      </p>
      {impact && (
        <div className="deletion-impact">
          <strong>함께 삭제되는 데이터</strong>
          <p>
            작업 {impact.tasks}개 · PRD {impact.requirements}개 · GitHub 연결{" "}
            {impact.links}개
          </p>
          <small>
            현재 조회된 데이터 기준입니다. 작업의 댓글도 함께 삭제됩니다.
          </small>
          {impact.blockers.length > 0 && (
            <p role="alert">
              선행 작업으로 참조하는 작업 {impact.blockers.length}개가 남아
              있습니다: {impact.blockers.slice(0, 5).join(", ")}. 의존관계를
              해제하거나 함께 선택하세요.
            </p>
          )}
        </div>
      )}
      <ul>
        {names.map((name, index) => (
          <li key={index}>{name}</li>
        ))}
      </ul>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          ref={cancel}
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onCancel}
        >
          취소
        </button>
        <button
          type="button"
          className="button danger"
          disabled={busy || !!impact?.blockers.length}
          onClick={async () => {
            if (submitting.current) return;
            submitting.current = true;
            try {
              await onConfirm();
            } finally {
              submitting.current = false;
            }
          }}
        >
          {busy ? "삭제 중…" : "삭제 확인"}
        </button>
      </div>
    </dialog>
  );
}
