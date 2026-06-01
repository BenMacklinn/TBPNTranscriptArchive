"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOptionalHomeReset } from "./home-reset-context";

function handleHomeClick(
  event: React.MouseEvent<HTMLAnchorElement>,
  pathname: string,
  resetHome?: () => void,
) {
  if (pathname !== "/" || !resetHome) {
    return;
  }

  event.preventDefault();
  resetHome();
}

export function SiteHeader() {
  const pathname = usePathname();
  const homeReset = useOptionalHomeReset();

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link
          className="site-header-title"
          href="/"
          onClick={(event) => handleHomeClick(event, pathname, homeReset?.resetHome)}
        >
          TBPN Transcript Search
        </Link>
        <Link
          className="brand-logo"
          href="/"
          onClick={(event) => handleHomeClick(event, pathname, homeReset?.resetHome)}
        >
          <span className="brand-logo-crop">
            <Image
              src="/tbpn-logo.png"
              alt="TBPN"
              width={1024}
              height={1024}
              priority
              className="brand-logo-img"
            />
          </span>
        </Link>
        <nav className="site-header-nav" aria-label="Site sections">
          <Link
            className={`site-header-nav-link${pathname === "/" ? " is-active" : ""}`}
            href="/"
            onClick={(event) => handleHomeClick(event, pathname, homeReset?.resetHome)}
          >
            Search
          </Link>
          <Link
            className={`site-header-nav-link${pathname === "/api-docs" ? " is-active" : ""}`}
            href="/api-docs"
          >
            API
          </Link>
        </nav>
      </div>
    </header>
  );
}
