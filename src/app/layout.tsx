import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Cloud PM — 프로젝트 관제실",
  description: "프로젝트의 진행과 다음 행동을 한눈에",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
