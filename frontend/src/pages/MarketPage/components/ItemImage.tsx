/**
 * ItemImage -- the wiki thumbnail of a marketplace item, in a .ui-thumb frame.
 *
 * The frame reserves the space before the image loads (fixed aspect ratio), so
 * the grid never reflows, and a wiki miss (mod items, typos in the blueprint)
 * falls back to a package icon instead of a broken box.
 *
 * `nameOverride` lets a caller ask for a different wiki page than the one
 * derived from the blueprint -- cryopod cards use it to show the DINO
 * ('Moschops') rather than the empty pod's icon. Both go through
 * /api/v1/market/thumb/<name>, which caches the wiki response on first hit.
 */
import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { arkItemThumbUrl } from "../../../utils/arkItem";

export function ItemImage({
  blueprint, nameOverride, className,
}: {
  blueprint: string;
  nameOverride?: string;
  /** Sizing wrapper from the page CSS module. */
  className?: string;
}) {
  const [errored, setErrored] = useState(false);

  const url = nameOverride
    ? `/api/v1/market/thumb/${encodeURIComponent(nameOverride)}`
    : arkItemThumbUrl(blueprint);

  // Reset the error flag when the image source changes (e.g. a sync
  // re-fetch hands us a different blueprint mid-render).
  useEffect(() => { setErrored(false); }, [url]);

  const frame = className ? `ui-thumb ui-thumb--square ${className}` : "ui-thumb ui-thumb--square";

  if (!url || errored) {
    return (
      <span className={frame}>
        <Package aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className={frame}>
      {/* Decorative: the item name is always rendered next to the frame. */}
      <img
        src={url}
        alt=""
        loading="lazy"
        onError={() => setErrored(true)}
      />
    </span>
  );
}
