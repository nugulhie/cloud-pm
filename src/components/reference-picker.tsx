"use client";
import { useId, useState } from "react";

export type ReferenceOption = {
  id: string;
  name: string;
  category?: string;
  status?: string;
  disabledReason?: string;
};
export default function ReferencePicker({
  name,
  label,
  buttonLabel,
  options,
  initial = [],
  max = 10,
}: {
  name: string;
  label: string;
  buttonLabel: string;
  options: ReferenceOption[];
  initial?: string[];
  max?: number;
}) {
  const [selected, setSelected] = useState(() => [...new Set(initial)]);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const control = useId();
  const byId = new Map(options.map((option) => [option.id, option]));
  const matches = options.filter((option) =>
    `${option.name} ${option.category ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <fieldset className="reference-picker" aria-label={label}>
      <legend>
        {label}{" "}
        <span className="muted">
          {selected.length}/{max}
        </span>
      </legend>
      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <div className="reference-selected">
        {selected.map((id) => (
          <button
            key={id}
            type="button"
            className="reference-chip"
            aria-label={`${byId.get(id)?.name ?? "연결된 문서"} 연결 해제`}
            onClick={() =>
              setSelected((current) => current.filter((v) => v !== id))
            }
          >
            {byId.get(id)?.name ?? "연결된 문서"}{" "}
            <span aria-hidden="true">×</span>
          </button>
        ))}
        {!selected.length && (
          <span className="muted">선택한 항목이 없습니다.</span>
        )}
      </div>
      <div className="reference-actions">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={control}
          onClick={() => setOpen((v) => !v)}
        >
          {buttonLabel}
          {open ? " 닫기" : ""}
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            className="text-button"
            onClick={() => setSelected([])}
          >
            전체 해제
          </button>
        )}
      </div>
      {open && (
        <div id={control} className="reference-options">
          <input
            type="search"
            aria-label={`${label} 검색`}
            placeholder="이름·분류 검색"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(50);
            }}
          />
          <p className="muted">
            체크로 연결·해제한 뒤 저장하면 적용됩니다. 최대 {max}개를 선택할 수
            있습니다.
          </p>
          <div className="reference-checkboxes">
            {matches.slice(0, limit).map((option) => {
              const checked = selected.includes(option.id);
              return (
                <label key={option.id} className="reference-option">
                  <input
                    type="checkbox"
                    aria-label={option.name}
                    checked={checked}
                    disabled={
                      !checked &&
                      (!!option.disabledReason || selected.length >= max)
                    }
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelected((current) =>
                        checked
                          ? current.includes(option.id) || current.length >= max
                            ? current
                            : [...current, option.id]
                          : current.filter((id) => id !== option.id),
                      );
                    }}
                  />
                  <span>
                    <strong>{option.name}</strong>
                    {option.category && <small>{option.category}</small>}
                    {option.status === "deprecated" && <small>사용 중단</small>}
                    {option.disabledReason && (
                      <small>{option.disabledReason}</small>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          {!matches.length && <p className="muted">선택할 항목이 없습니다.</p>}
          {matches.length > limit && (
            <button
              type="button"
              className="text-button"
              onClick={() => setLimit((current) => current + 50)}
            >
              50개 더 보기 ({Math.min(limit, matches.length)}/{matches.length})
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}
