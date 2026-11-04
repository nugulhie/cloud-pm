"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export default function SettingsLayout({
  sections,
}: {
  sections: {
    id: string;
    title: string;
    description: string;
    content: ReactNode;
  }[];
}) {
  const [active, setActive] = useState(sections[0]!.id);
  const [narrow, setNarrow] = useState(false);
  const prefix = useId();
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return (
    <div className="settings-layout">
      <nav className="settings-navigation" aria-label="설정 분류">
        <div
          ref={tabs}
          role="tablist"
          aria-label="설정 메뉴"
          aria-orientation={narrow ? "horizontal" : "vertical"}
        >
          {sections.map((section, index) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              id={`${prefix}-tab-${section.id}`}
              aria-controls={`${prefix}-panel-${section.id}`}
              aria-selected={active === section.id}
              tabIndex={active === section.id ? 0 : -1}
              onClick={() => setActive(section.id)}
              onKeyDown={(event) => {
                let next: number;
                if (["ArrowDown", "ArrowRight"].includes(event.key))
                  next = (index + 1) % sections.length;
                else if (["ArrowUp", "ArrowLeft"].includes(event.key))
                  next = (index - 1 + sections.length) % sections.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = sections.length - 1;
                else return;
                event.preventDefault();
                setActive(sections[next]!.id);
                tabs.current
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  [next]?.focus();
              }}
            >
              {section.title}
            </button>
          ))}
        </div>
      </nav>
      <div className="settings-content">
        {sections.map((section) => (
          <section
            key={section.id}
            className="settings-panel"
            role="tabpanel"
            id={`${prefix}-panel-${section.id}`}
            aria-labelledby={`${prefix}-tab-${section.id}`}
            hidden={active !== section.id}
            tabIndex={0}
          >
            <header className="settings-panel-heading">
              <h3>{section.title}</h3>
              <p>{section.description}</p>
            </header>
            {section.content}
          </section>
        ))}
      </div>
    </div>
  );
}
