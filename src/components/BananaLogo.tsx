import React from 'react';
import { Laptop, Monitor, Smartphone } from 'lucide-react';
import type { DevicePlatform } from '../types';

export const BananaLogo: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="16" className="fill-[#171714] dark:fill-[#FACC15]" />
      <path
        d="M44.5 16.5C46 18 46.6 20.4 45.7 22.8C41.8 33.1 32.3 45.6 17.5 51.2C14.9 52.2 12.2 51.5 10.9 49.6C10.1 48.3 10.4 46.6 11.7 45.6C21.8 38.1 30.5 28.6 36.7 18.2C38.1 15.9 41.4 14.5 44.5 16.5Z"
        className="fill-[#FACC15] dark:fill-[#171714]"
      />
      <path
        d="M42.2 16.8C44.1 15.1 45.5 13.1 46.1 11.6C46.5 10.6 47.8 10.3 48.6 11C49.6 11.8 49.7 13.3 49 14.4C47.9 16.1 46.5 17.8 45.1 19"
        className="stroke-[#CA8A04] dark:stroke-[#713F12]"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
};

export const PlatformIcon: React.FC<{ platform: DevicePlatform; className?: string }> = ({
  platform,
  className = 'w-5 h-5',
}) => {
  switch (platform) {
    case 'android':
      return <Smartphone className={className} />;
    case 'windows':
      return <Monitor className={className} />;
    default:
      return <Laptop className={className} />;
  }
};
