import Image from "next/image";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand compact" : "brand"}>
      <span className="brand-mark" aria-hidden="true">
        <Image src="/logo.png" alt="" width={80} height={80} sizes="38px" priority />
      </span>
      {!compact && <span>AgentWeave</span>}
    </div>
  );
}
