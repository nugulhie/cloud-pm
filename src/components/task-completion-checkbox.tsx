"use client";
import { useState } from "react";
import type { Stored, Task } from "../core/model";

export default function TaskCompletionCheckbox({
  task,
  writable,
  busy,
  onMove,
}: {
  task: Stored<Task>;
  writable: boolean;
  busy: boolean;
  onMove: (task: Stored<Task>, status: Task["status"]) => Promise<void>;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  async function change(checked: boolean) {
    setPending(checked);
    try {
      await onMove(task, checked ? "done" : "backlog");
    } finally {
      setPending(null);
    }
  }
  return (
    <input
      type="checkbox"
      aria-label={`${task.data.title} 완료`}
      aria-busy={pending !== null}
      checked={pending ?? task.data.status === "done"}
      disabled={!writable || busy || pending !== null}
      onChange={(event) => void change(event.target.checked)}
    />
  );
}
