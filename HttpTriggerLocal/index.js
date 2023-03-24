module.exports = async function (context, req) {
  context.log("JavaScript HTTP trigger function processed a request.");

  const version = (req.body && req.body.version) || new Date().getTime();

  const contentful = await import("contentful");
  // import { Block, Inline, BLOCKS, INLINES } from "@contentful/rich-text-types";
  const richTextReactRenderer = await import(
    "@contentful/rich-text-react-renderer"
  );
  const richTextTypes = await import("@contentful/rich-text-types");
  const contentfulManagement = await import("contentful-management");
  const dotenv = await import("dotenv");
  dotenv.config();

  if (
    process.env.CONTENTFUL_TOKEN ||
    process.env.CONTENTFUL_SPACE ||
    process.env.CONTENTFUL_HOST ||
    process.env.CONTENTFUL_ENVIRONMENT ||
    process.env.CONTENTFUL_MANAGEMENT_TOKEN
  ) {
    const client = contentful.default.createClient({
      space: process.env.CONTENTFUL_SPACE,
      accessToken: process.env.CONTENTFUL_TOKEN,
      host: process.env.CONTENTFUL_HOST,
    });

    const DEFAULT_LOCALE = "en-US";
    const AppLocales = ["en-US"];

    const localeResponse = await client.getLocales();
    const syncResponse = await client.sync({ initial: true });

    if (syncResponse.entries.length && localeResponse.items.length) {
      const reactRichTextOptions = () => ({
        renderNode: {
          [richTextTypes.BLOCKS.PARAGRAPH]: (_node, children) => children,
          [richTextTypes.INLINES.EMBEDDED_ENTRY]: (node) =>
            `{{ ${node.data.target.fields.key[DEFAULT_LOCALE]} }}`,
        },
      });

      const transformContentSet = (locale, fallbackLocale, set) => {
        const contentItems = set?.fields.contentItems?.[DEFAULT_LOCALE];
        if (!contentItems) {
          return {};
        }
        return contentItems.reduce((ac, entry) => {
          if (entry.fields.key?.[DEFAULT_LOCALE]) {
            if (
              entry.sys.contentType.sys.id === "contentSet" ||
              entry.sys.contentType.sys.id === "regulatedContentSet"
            ) {
              return {
                ...ac,
                [entry.fields.key[DEFAULT_LOCALE]]: transformContentSet(
                  locale,
                  fallbackLocale,
                  entry
                ),
              };
            } else if (
              entry.sys.contentType.sys.id === "contentImage" ||
              entry.sys.contentType.sys.id === "regulatedContentImage"
            ) {
              return ac;
            } else {
              const bodyText =
                // TODO: Confirm, if we need chaining fallbacks
                entry.fields.bodyText?.[locale] ||
                entry.fields.bodyText?.[fallbackLocale] ||
                entry.fields.bodyText?.[DEFAULT_LOCALE];
              if (bodyText) {
                const resolvedStringArray =
                  richTextReactRenderer.default.documentToReactComponents(
                    bodyText,
                    reactRichTextOptions()
                  );
                return {
                  ...ac,
                  [entry.fields.key[DEFAULT_LOCALE]]: resolvedStringArray
                    ?.map((innerElem) => innerElem.join(""))
                    ?.join("\n"),
                };
              }
            }
            return ac;
          }
          return ac;
        }, {});
      };

      const transformContentSetArray = (
        locale,
        fallbackLocale,
        contentSetArray
      ) => {
        if (!contentSetArray) {
          return {};
        }

        return contentSetArray?.reduce((acc, set) => {
          return {
            ...acc,
            ...(set.fields.key?.[DEFAULT_LOCALE] && {
              [set.fields.key?.[DEFAULT_LOCALE]]: transformContentSet(
                locale,
                fallbackLocale,
                set
              ),
            }),
          };
        }, {});
      };

      const transformScreensArray = (
        locale,
        fallbackLocale,
        screenType,
        contentSetType,
        screens
      ) => {
        return screens
          ?.filter((screen) => screen.sys.contentType.sys.id === screenType)
          ?.reduce((acc, screen) => {
            const contentSets = screen.fields.contents?.[
              DEFAULT_LOCALE
            ]?.filter((content) => {
              return content.sys.contentType.sys.id === contentSetType;
            }).map((screen) => screen);
            return {
              ...acc,
              [screen.fields.name[DEFAULT_LOCALE]]: transformContentSetArray(
                locale,
                fallbackLocale,
                contentSets
              ),
            };
          }, {});
      };

      const moduleScreensExtractor = (modules, locale, fallbackLocale) => {
        const moduleScreenSets = modules?.reduce(
          (acc, module) => [
            ...acc,
            ...(module.fields.screenSets?.[DEFAULT_LOCALE] || []),
          ],
          []
        );

        const screens = moduleScreenSets?.reduce(
          (acc, screenSet) => [
            ...acc,
            ...(screenSet.fields.screens?.[DEFAULT_LOCALE] || []),
          ],
          []
        );

        return transformScreens(locale, fallbackLocale, screens);
      };

      const moduleModalsExtractor = (modules, locale, fallbackLocale) => {
        const moduleModals = modules?.reduce(
          (acc, module) => [
            ...acc,
            ...(module.fields.modals?.[DEFAULT_LOCALE] || []),
          ],
          []
        );

        return transformContentSetArray(locale, fallbackLocale, moduleModals);
      };

      const moduleMicrocopyExtractor = (modules, locale, fallbackLocale) => {
        const moduleMicrocopy = modules?.reduce(
          (acc, module) => [
            ...acc,
            ...(module.fields.microcopy?.[DEFAULT_LOCALE] || []),
          ],
          []
        );

        return transformContentSetArray(
          locale,
          fallbackLocale,
          moduleMicrocopy
        );
      };

      const transformForLocale = (deliveryChannel, locale, fallbackObject) => {
        const fallbackLocale = fallbackObject?.[locale];

        const globalMicrocopyOutput = transformContentSetArray(
          locale,
          fallbackLocale,
          deliveryChannel?.fields.microcopy?.[DEFAULT_LOCALE]
        );

        const modules = deliveryChannel?.fields?.modules?.[DEFAULT_LOCALE];

        const regulatedModules = modules.filter(
          (m) => m.sys.contentType.sys.id === "regulatedModule"
        );
        const unRegulatedModules = modules.filter(
          (m) => m.sys.contentType.sys.id === "module"
        );

        const regulatedModuleModalsOutput = moduleModalsExtractor(
          regulatedModules,
          locale,
          fallbackLocale
        );
        const unRegulatedModuleModalsOutput = moduleModalsExtractor(
          unRegulatedModules,
          locale,
          fallbackLocale
        );

        const regulatedModuleMicrocopyOutput = moduleMicrocopyExtractor(
          regulatedModules,
          locale,
          fallbackLocale
        );
        const runRegulatedModuleMicrocopyOutput = moduleMicrocopyExtractor(
          unRegulatedModules,
          locale,
          fallbackLocale
        );

        const regulatedModuleScreensOutput = moduleScreensExtractor(
          regulatedModules,
          locale,
          fallbackLocale
        );
        const unRegulatedModuleScreensOutput = moduleScreensExtractor(
          unRegulatedModules,
          locale,
          fallbackLocale
        );

        return {
          ...globalMicrocopyOutput,
          ...regulatedModuleMicrocopyOutput,
          ...runRegulatedModuleMicrocopyOutput,
          modals: {
            ...regulatedModuleModalsOutput,
            ...unRegulatedModuleModalsOutput,
          },
          ...regulatedModuleScreensOutput,
          ...unRegulatedModuleScreensOutput,
        };
      };

      const transformScreens = (locale, fallbackLocale, screens) => {
        const regulatedScreenType = "regulatedScreenFlexible";
        const regulatedContentSetType = "regulatedContentSet";
        const regulatedScreens = transformScreensArray(
          locale,
          fallbackLocale,
          regulatedScreenType,
          regulatedContentSetType,
          screens
        );

        const unRegulatedScreenType = "screenFlexible";
        const unRegulatedContentSetType = "contentSet";
        const unRegulatedScreens = transformScreensArray(
          locale,
          fallbackLocale,
          unRegulatedScreenType,
          unRegulatedContentSetType,
          screens
        );

        return {
          ...unRegulatedScreens,
          ...regulatedScreens,
        };
      };

      const transformResponse = (syncResponse, localeResponse) => {
        // TODO: filter from multiple apps if added to the space
        const deliveryChannel = syncResponse.entries.find(
          (entry) =>
            entry.sys.contentType.sys.id === "deliveryChannelMobileApplication"
        );

        const fallbackObject = localeResponse.items.reduce((acc, item) => {
          return {
            ...acc,
            ...(item.code &&
              !item.fallbackCode && {
                [item.code]: item.code,
              }),
            ...(item.code &&
              item.fallbackCode && {
                [item.code]: item.fallbackCode,
              }),
          };
        }, {});

        return AppLocales.map((locale) => ({
          locale,
          content: transformForLocale(deliveryChannel, locale, fallbackObject),
        }));
      };

      const output = transformResponse(syncResponse, localeResponse);

      output.forEach((item) => {
        if (item.locale === DEFAULT_LOCALE) {
          const cmClient = contentfulManagement.default.createClient({
            accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN,
          });

          cmClient
            .getSpace(process.env.CONTENTFUL_SPACE)
            .then((space) =>
              space.getEnvironment(process.env.CONTENTFUL_ENVIRONMENT)
            )
            .then((environment) =>
              environment.getEntry("1EetE6l1jS142wdkSoMWTL")
            )
            .then(async (entry) => {
              entry.fields.version[DEFAULT_LOCALE] = parseFloat(version);
              entry.fields.data[DEFAULT_LOCALE] = item.content;
              return await entry.update();
            })
            .then((entry) => entry.publish())
            .catch((err) => context.log(err));
        }
      });
    }
  }

  context.res = {
    body: `Version: ${version}`,
  };
};
