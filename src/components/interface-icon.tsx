const paths = {
  menu: "M4 6h16M4 12h16M4 18h16",
  task: "M4 4h16v16H4z M8 12l3 3 5-6",
  close: "m6 6 12 12M6 18 18 6",
  refresh:
    "M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6M4 13a8 8 0 0 0 14 5l3-3m0 6v-6h-6",
  chevron: "m9 5 7 7-7 7",
  plus: "M12 5v14M5 12h14",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  pulse: "M3 12h4l3-7 4 14 3-7h4",
  link: "m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1",
} as const;

export default function InterfaceIcon({
  name,
  className = "",
}: {
  name: keyof typeof paths;
  className?: string;
}) {
  return (
    <svg
      className={`interface-icon ${className}`.trim()}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
