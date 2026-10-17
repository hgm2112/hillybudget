import Image from "next/image";
import { cn } from "cn";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <>
      <Image
        src="/brand/logo-light.svg"
        alt="hillybudget"
        width={432}
        height={144}
        unoptimized
        className={cn("block dark:hidden", className)}
      />
      <Image
        src="/brand/logo-dark.svg"
        alt="hillybudget"
        width={432}
        height={144}
        unoptimized
        className={cn("hidden dark:block", className)}
      />
    </>
  );
}

export function BrandIcon({ className }: { className?: string }) {
  return (
    <>
      <Image
        src="/brand/icon-light.svg"
        alt=""
        width={180}
        height={180}
        unoptimized
        className={cn("block dark:hidden", className)}
      />
      <Image
        src="/brand/icon-dark.svg"
        alt=""
        width={180}
        height={180}
        unoptimized
        className={cn("hidden dark:block", className)}
      />
    </>
  );
}
