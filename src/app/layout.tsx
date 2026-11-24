import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./soldoc-theme.css";
// Preloaded with metric-adjusted fallbacks so the Korean face swaps in without layout shift.
const pretendard = localFont({
  src: "../../public/fonts/PretendardVariable.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-pretendard",
});
export const metadata: Metadata = {
  title: "솔닥 Cloud PM — 팀 워크스페이스",
  description:
    "솔닥의 프로젝트, PRD와 개발 업무를 함께 관리하는 팀 워크스페이스",
  icons: { icon: "/brand/soldoc-icon.png", apple: "/brand/soldoc-icon.png" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body>{children}</body>
    </html>
  );
}
