import { Layers3 } from "lucide-react";
import { Link } from "react-router";
export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="SocialSync home">
      <span className="brand-mark">
        <Layers3 size={21} />
      </span>
      Social<span>Sync</span>
      <span className="brand-dot">.</span>
    </Link>
  );
}
