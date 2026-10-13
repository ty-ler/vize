/** Select the existing parser by Vue's declared script language. */
export function scriptParsersByLanguage(scriptParser) {
  return {
    js: scriptParser,
    jsx: scriptParser,
    tsx: scriptParser,
    "<template>": scriptParser,
    ts: {
      ...scriptParser,
      parseForESLint(code, options) {
        // `.vue` is an unknown extension to the TS parser, so its global JSX
        // option otherwise makes valid TS assertions and generic arrows TSX.
        return scriptParser.parseForESLint(code, {
          ...options,
          ecmaFeatures: { ...options.ecmaFeatures, jsx: false },
        });
      },
    },
  };
}
