export default function NavigationIcon({ index }: { index: number }) {
  const paths = [
    "M3 3h7v8H3z M14 3h7v5h-7z M3 15h7v6H3z M14 12h7v9h-7z",
    "M4 4h16v16H4z M4 9h16 M10 9v11",
    "M8 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0 M8 17a3 3 0 1 0-6 0 3 3 0 0 0 6 0 M5 10v4 M8 17h7a4 4 0 0 0 4-4V7 M16 7l3-3 3 3",
    "M3 12a9 9 0 1 0 2.6-6.4 M3 3v6h6 M12 7v5l3 2",
    "M4 6h16 M4 12h16 M4 18h10 M18 16l3 3-3 3",
    "M4 5h16v14H4z M4 10h16 M9 10v9",
    "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16",
    "M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7",
    "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
    "M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4z M13 7a3 3 0 0 1 3-3h5v14h-5a4 4 0 0 0-3 3",
  ];
  return (
    <svg
      className="navigation-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[index]} />
    </svg>
  );
}
