import React from "react";

interface LogoProps {
  className?: string;
}

/**
 * Hardback Option 03: "Double Flux Cascade (Dual Drive)"
 * Exact representation from proposal Option 03:
 * Two overlapping SSD plates, speed indicator lines, and emerald/gold checkmark vector.
 */
export function HardbackCascadeLogo({ className = "w-7 h-7" }: LogoProps) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="p3-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#21201D" />
          <stop offset="100%" stopColor="#141311" />
        </linearGradient>
        <linearGradient id="p3-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#D97706" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="p3-front-ssd" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#323235" />
          <stop offset="100%" stopColor="#1C1C1E" />
        </linearGradient>
        <linearGradient id="p3-check-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#10B981" />
        </linearGradient>
        <filter id="p3-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="-10" dy="16" stdDeviation="18" floodColor="#000000" floodOpacity="0.7" />
        </filter>
      </defs>

      {/* Squircle Background Canvas */}
      <rect width="1024" height="1024" rx="230" fill="url(#p3-bg)" />
      <rect x="16" y="16" width="992" height="992" rx="214" fill="none" stroke="url(#p3-rim)" strokeWidth="4" />

      {/* Back SSD (Destination) */}
      <rect x="290" y="220" width="530" height="420" rx="70" fill="#242426" stroke="#3A3A3D" strokeWidth="8" />
      <circle cx="760" cy="280" r="14" fill="#3B82F6" />

      {/* Front SSD (Source) */}
      <rect x="200" y="380" width="530" height="420" rx="70" fill="url(#p3-front-ssd)" stroke="#454549" strokeWidth="8" filter="url(#p3-shadow)" />

      {/* Intersecting Speed Vector & Checkmark */}
      <g transform="translate(360, 470)">
        {/* Fast Transfer Arrows forming check */}
        <path d="M60 140 L130 210 L280 60" fill="none" stroke="url(#p3-check-grad)" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M140 10 L230 10 M200 40 L250 40 M170 70 L210 70" stroke="#F59E0B" strokeWidth="10" strokeLinecap="round" opacity="0.6" />
      </g>
    </svg>
  );
}

export default HardbackCascadeLogo;
