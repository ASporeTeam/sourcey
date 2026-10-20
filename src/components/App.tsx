import type { CurrentPage } from "../core/site-model.js";
import type { NormalizedSpec } from "../core/types.js";
import type { SiteNavigation } from "../core/navigation.js";
import {
  SpecContext,
  OptionsContext,
  NavigationContext,
  PageContext,
  SiteContext,
} from "../renderer/context.js";
import type { RenderOptions, SiteConfig } from "../renderer/context.js";
import { Head } from "./layout/Head.js";
import { Page } from "./layout/Page.js";
import { messagesFor } from "../core/messages.js";

export interface AppProps {
  spec: NormalizedSpec | undefined;
  options: RenderOptions;
  navigation: SiteNavigation;
  currentPage: CurrentPage;
  site: SiteConfig;
}

/**
 * Root component. Renders a complete HTML document with modern layout.
 * When embeddable, renders just the page content without html/body wrapper.
 */
export function App({ spec, options, navigation, currentPage, site }: AppProps) {
  const content = options.embeddable ? (
    <Page />
  ) : (
    <html lang={options.contentLocale ?? options.locale ?? "en"} dir={options.dir ?? "ltr"}>
      <Head />
      <body id="sourcey" data-sourcey-theme={site.theme.name}>
        <Page />
        {options.assets && <script src={options.assets.client} type={options.assets.clientType} defer />}
      </body>
    </html>
  );

  return (
    <SiteContext.Provider value={site}>
      <SpecContext.Provider value={spec!}>
        <OptionsContext.Provider value={{ ...options, messages: options.messages ?? messagesFor(options.locale ?? "en") }}>
          <NavigationContext.Provider value={navigation}>
            <PageContext.Provider value={currentPage}>{content}</PageContext.Provider>
          </NavigationContext.Provider>
        </OptionsContext.Provider>
      </SpecContext.Provider>
    </SiteContext.Provider>
  );
}
