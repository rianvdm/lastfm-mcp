// ABOUTME: Builds the landing page served at / from landing.html, imported as a text module.
// ABOUTME: Fills in the request origin so every address a visitor copies points at the server they're looking at.
import landing from './landing.html'
import { fillPlaceholders } from './template'

/** Returns the landing page HTML with every copyable server address pointing at `origin`. */
export function buildLandingPage(origin: string): string {
	return fillPlaceholders(landing, { ORIGIN: origin })
}
