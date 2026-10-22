import { Instagram, Facebook, Youtube, Pin } from "lucide-react";
import type { Platform } from "@social/shared";
const icons = {
  instagram: Instagram,
  facebook: Facebook,
  youtube: Youtube,
  pinterest: Pin,
};
export function PlatformIcon({
  platform,
  small = false,
}: {
  platform: Platform;
  small?: boolean;
}) {
  const Icon = icons[platform];
  return (
    <span className={`platform-icon ${platform} ${small ? "small" : ""}`}>
      <Icon size={small ? 13 : 20} />
    </span>
  );
}
