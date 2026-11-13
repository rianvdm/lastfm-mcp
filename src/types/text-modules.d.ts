// ABOUTME: Module declarations for the non-code files that wrangler.toml's [[rules]] bundle into the Worker.
// ABOUTME: .html and .md files import as their text (Text rule); .png files import as their bytes (Data rule).

declare module '*.html' {
	const text: string
	export default text
}

declare module '*.md' {
	const text: string
	export default text
}

declare module '*.png' {
	const data: ArrayBuffer
	export default data
}
