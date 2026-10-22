/**
 * Google Play builds (VITE_DISTRIBUTION=play) must not send users to an outside
 * payment page, so they show no purchase or billing-portal buttons. Plans are
 * bought on the website or from the desktop app; signing in unlocks them here.
 */
export const CAN_OPEN_CHECKOUT: boolean = import.meta.env.VITE_DISTRIBUTION !== "play";
