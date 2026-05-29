import Image from "next/image";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="site-header-title" href="/">
          TBPN Transcript Search
        </Link>
        <Link className="brand-logo" href="/">
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
      </div>
    </header>
  );
}
