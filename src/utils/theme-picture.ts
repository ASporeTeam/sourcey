/** One active image family, with a system-mode fallback before scripts run. */
export function themePictureSources(light: string, dark = light) {
  const data = { "data-light": light, "data-dark": dark };
  return light === dark
    ? [{ srcset: light, ...data, media: undefined }]
    : [{ srcset: dark, ...data, media: "(prefers-color-scheme: dark)" }, { srcset: light, ...data, media: undefined }];
}
