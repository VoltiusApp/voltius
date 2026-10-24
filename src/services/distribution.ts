/**
 * Store builds (VITE_DISTRIBUTION=play for Google Play, appstore for the App
 * Store) must not send users to an outside payment page, so they show no
 * purchase or billing-portal buttons. Plans are
 * bought on the website or from the desktop app; signing in unlocks them here.
 */
const STORE_BUILDS = ["play", "appstore"];
export const CAN_OPEN_CHECKOUT: boolean = !STORE_BUILDS.includes(
  import.meta.env.VITE_DISTRIBUTION ?? "",
);
