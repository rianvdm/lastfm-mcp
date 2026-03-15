// ABOUTME: Test stub for the ajv JSON Schema validator package.
// ABOUTME: Replaces the CJS ajv package that cannot run in workerd's ESM-only runtime.

/**
 * Minimal Ajv stub for use in Cloudflare Workers test environment.
 *
 * The real ajv package is CJS-only and uses code generation (new Function/eval)
 * which is not available in workerd. This stub provides the interface expected
 * by @modelcontextprotocol/sdk's AjvJsonSchemaValidator so the server can be
 * loaded in tests. Validation always passes (returns valid: true) since tests
 * focus on routing and auth logic, not schema validation.
 */
export class Ajv {
	constructor(_options) {
		// No-op: options are irrelevant for the stub
	}

	compile(_schema) {
		// Return a validator function that always passes
		const validate = (_data) => true
		validate.errors = null
		return validate
	}

	getSchema(_id) {
		return undefined
	}

	errorsText(_errors) {
		return 'validation error'
	}
}

export default Ajv
