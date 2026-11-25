import { Film, FolderOpen, Package } from "lucide-react";

export function SdCardLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M6 3H14.8L19 7.2V19C19 20.1 18.1 21 17 21H6C4.9 21 4 20.1 4 19V5C4 3.9 4.9 3 6 3Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 6.5V9.5M10 6.5V9.5M12.5 6.5V9.5M15 7.5V9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect
        x="7"
        y="13"
        width="9"
        height="4.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function SsdLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M13 8.5L9.5 12.5H12.5L11 15.5L14.5 11.5H11.5L13 8.5Z"
        fill="currentColor"
      />
      <circle cx="6.5" cy="8.5" r="1" fill="currentColor" />
      <circle cx="17.5" cy="15.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function HddLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect
        x="4"
        y="3"
        width="16"
        height="18"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle cx="12" cy="10.5" r="4.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="10.5" r="1.2" fill="currentColor" />
      <path
        d="M15.5 16.5L13.2 12.8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="8" cy="17.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function EjectIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 5L4.5 14H19.5L12 5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M5 18.5H19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DeviceVisualIcon({
  deviceType,
  className = "w-5 h-5",
}: {
  deviceType: string;
  className?: string;
}) {
  if (deviceType === "sd_card") return <SdCardLogo className={className} />;
  if (deviceType === "hdd") return <HddLogo className={className} />;
  if (deviceType === "package") return <Package className={className} />;
  if (deviceType === "single_file") return <Film className={className} />;
  if (deviceType === "folder") return <FolderOpen className={className} />;
  return <SsdLogo className={className} />;
}
