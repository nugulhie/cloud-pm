"use client";
import { useState } from "react";
import { createId } from "../core/browser-id";
import { suggestProjectPrefix } from "../core/project-prefix";
export default function ProjectPrefixField({
  projectName,
  seed,
  defaultValue,
  used = [],
}: {
  projectName: string;
  seed: string;
  defaultValue?: string;
  used?: string[];
}) {
  const [manual, setManual] = useState(defaultValue);
  const value = manual ?? suggestProjectPrefix(projectName, seed, used);
  return (
    <div className="project-prefix-field">
      <label>
        기능 식별자 (5자리)
        <input
          name="featurePrefix"
          aria-label="기능 식별자 (5자리)"
          required
          minLength={5}
          maxLength={5}
          pattern="[A-Z0-9]{5}"
          value={value}
          onChange={(e) => setManual(e.target.value.toUpperCase())}
          placeholder="ADMIN"
          autoComplete="off"
        />
      </label>
      <button
        type="button"
        className="text-button"
        onClick={() =>
          setManual(suggestProjectPrefix(projectName, createId(), used))
        }
      >
        식별자 자동 생성
      </button>
      <small>
        영문 대문자·숫자 5자리. PRD 번호는 {value || "ADMIN"}-001 형식으로
        부여됩니다.
      </small>
    </div>
  );
}
