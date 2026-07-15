import React from 'react';
import type { ManagerLayout } from './managerLayout';

type ManagerLayoutIconProps = {
  layout: ManagerLayout;
  className?: string;
};

export default function ManagerLayoutIcon({ layout, className }: ManagerLayoutIconProps) {
  if (layout === 'command') {
    return (
      <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
        <rect x="2.5" y="3" width="15" height="3.5" rx="1" strokeWidth="1.35" />
        <rect x="2.5" y="8.25" width="15" height="3.5" rx="1" strokeWidth="1.35" />
        <rect x="2.5" y="13.5" width="15" height="3.5" rx="1" strokeWidth="1.35" />
      </svg>
    );
  }

  if (layout === 'explorer') {
    return (
      <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
        <rect x="2.5" y="3" width="15" height="14" rx="1.5" strokeWidth="1.35" />
        <path d="M7 3v14M9.5 7h5M9.5 10h5M9.5 13h3.5" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="2.5" y="3" width="6.25" height="6" rx="1.2" strokeWidth="1.35" />
      <rect x="11.25" y="3" width="6.25" height="6" rx="1.2" strokeWidth="1.35" />
      <rect x="2.5" y="11" width="6.25" height="6" rx="1.2" strokeWidth="1.35" />
      <rect x="11.25" y="11" width="6.25" height="6" rx="1.2" strokeWidth="1.35" />
    </svg>
  );
}
