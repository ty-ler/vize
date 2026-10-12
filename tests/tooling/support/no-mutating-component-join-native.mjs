import { currentNoDupeDeepPropsNativeIngress } from "./no-dupe-keys-common-native-ingress.mjs";

/** Keep the actual child build distinct from the complete historical parent source. */
export async function currentJoinDeepPropsNativeSource(root) {
  const current = await currentNoDupeDeepPropsNativeIngress(root);
  return current;
}
