import React from 'react';

interface AgentAssetsIconProps {
  className?: string;
}

export default function AgentAssetsIcon({ className }: AgentAssetsIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m10 2.8 6 3-6 3-6-3 6-3Z" />
      <path d="m4 9.25 6 3 6-3" />
      <path d="m4 12.7 6 3 6-3" />
    </svg>
  );
}
