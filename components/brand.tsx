import Image from "next/image";

type BrandProps = { size?: number; className?: string };

export function BrandMark({ size = 44, className = "" }: BrandProps) {
  return <Image src="/images/icon-only.svg" alt="Buladde Palm Villa Hotel" width={size} height={size} priority className={`shrink-0 object-contain ${className}`} />;
}

export function BrandLogo({ width = 180, className = "" }: { width?: number; className?: string }) {
  return <Image src="/images/logo.svg" alt="Buladde Palm Villa Hotel" width={width} height={Math.round(width * 0.972)} priority className={`h-auto max-w-full object-contain ${className}`} />;
}
