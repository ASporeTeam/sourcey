import { useContext } from "preact/hooks";
import { SiteContext } from "../../renderer/context.js";
import { nativeIcon, type IconPresentation, type NativeIcon as Meaning } from "../../utils/icons.js";

/** One of native's own icons, drawn from the site's icon set. */
export function NativeIcon({ meaning, size, class: className }: { meaning: Meaning } & IconPresentation) {
  const site = useContext(SiteContext);
  const drawing = nativeIcon(site.theme.icons, meaning);
  return <svg class={className} width={size} height={size} aria-hidden="true" {...drawing.attributes} dangerouslySetInnerHTML={{ __html: drawing.body }} />;
}
