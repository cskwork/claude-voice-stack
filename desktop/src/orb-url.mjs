// The orb page URL for a given Gateway origin: skin, auto-hide, wake word and
// language travel as query parameters the page reads on load. Published so an
// embedding host builds the same URL the desktop shell does — applying an
// imported skin is `settings.save({ orbSkin }) → orb.load(desktopOrbUrl(...))`.
export { desktopOrbUrl } from './security.mjs'
