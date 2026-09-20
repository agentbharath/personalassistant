import type { SVGProps } from "react";

/** One icon set, one stroke weight. Icons are decorative unless the parent button has an aria-label. */
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}
export const PlusIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const SearchIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></Icon>;
export const MenuIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>;
export const CloseIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
export const SendIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="m6 12 6-6 6 6M12 6v13" /></Icon>;
export const PaperclipIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M8.5 12.5 14.8 6.2a3 3 0 0 1 4.2 4.2l-8.1 8.1a5 5 0 0 1-7.1-7.1l8.1-8.1" /></Icon>;
export const MicIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" /></Icon>;
export const SunIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></Icon>;
export const MoonIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></Icon>;
export const MonitorIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Icon>;
export const TrashIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></Icon>;
export const ClockIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Icon>;
export const CalendarIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 10h16M9 3v4M15 3v4" /></Icon>;
export const MailIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><path d="m4 8 8 5.5L20 8" /></Icon>;
export const WalletIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H18v3" /><rect x="4" y="9" width="16" height="10" rx="2.5" /><circle cx="16" cy="14" r="1" /></Icon>;
export const ArrowRightIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
export const CheckIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
export const MoreIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="5.5" cy="12" r="1.1" fill="currentColor" /><circle cx="12" cy="12" r="1.1" fill="currentColor" /><circle cx="18.5" cy="12" r="1.1" fill="currentColor" /></Icon>;
export const PinIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="m14.5 4.5 5 5-2.2.7-2.6 3.3.4 3.3-1.2 1.2-3.6-3.6-4.9 4.9M9.5 9.2l-.4-3.4 1.2-1.2" /></Icon>;
export const EditIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></Icon>;
export const CopyIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2" /></Icon>;
export const ThumbUpIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M8 11v9H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Zm0 0 3.2-6.4A2 2 0 0 1 14 6.3V10h4.4a1.6 1.6 0 0 1 1.6 1.9l-1.2 6.4A2 2 0 0 1 16.8 20H8" /></Icon>;
export const ThumbDownIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M8 13V4H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3Zm0 0 3.2 6.4a2 2 0 0 0 2.8 1.3V14h4.4a1.6 1.6 0 0 0 1.6-1.9l-1.2-6.4A2 2 0 0 0 16.8 4H8" /></Icon>;
export const StopIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" /></Icon>;
export const ArrowDownIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="m6 12 6 6 6-6M12 18V5" /></Icon>;
export const KeyboardIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="3" y="6" width="18" height="12" rx="2.5" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></Icon>;
export const SettingsIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></Icon>;
export const SidebarIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15" /></Icon>;
export const LocateIcon = (p: SVGProps<SVGSVGElement>) => <Icon {...p}><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2" fill="currentColor" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></Icon>;
