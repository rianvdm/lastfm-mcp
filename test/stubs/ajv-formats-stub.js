// ABOUTME: Test stub for the ajv-formats package used alongside ajv.
// ABOUTME: Replaces the CJS ajv-formats package that cannot run in workerd's ESM-only runtime.

/**
 * Minimal ajv-formats stub for use in Cloudflare Workers test environment.
 *
 * The real ajv-formats package adds format validators (date, email, etc.) to an
 * Ajv instance. Since we stub out Ajv itself, this stub is a no-op that accepts
 * and ignores any Ajv instance passed to it.
 */
function addFormats(_ajv, _options) {
	// No-op: format validation not needed in tests
}

addFormats.formats = {}

export default addFormats
