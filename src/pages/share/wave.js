// ABOUTME: Draws a still frame of the landing page's listening-history wave onto a canvas, for the share card and the icon.
// ABOUTME: Loaded with a classic <script src> by og-card.html and icon.html; never bundled into the Worker or served.

/* exported drawWave */

/**
 * Draws five stacked layers centred on a horizontal line, with the same colours, opacity and layer maths as the hero
 * wave in landing.html (which animates them). Stream position 0 is at the left edge.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} options
 * @param {number} options.centre y of the stream's centre line, in canvas pixels
 * @param {number} options.maxLayerThickness the most one layer can swell to, in canvas pixels
 * @param {number} options.columnWidth px between sampled columns
 * @param {number} [options.streamLength] stream positions shown across the canvas width; defaults to the width (no squeezing)
 */
function drawWave(canvas, { centre, maxLayerThickness, columnWidth, streamLength = canvas.width }) {
	const context = canvas.getContext('2d')
	const layerColors = ['#b8432f', '#d39b3f', '#8a9a72', '#6f8aa3', '#8c6278']
	const layerOpacity = 0.85
	const positionPerPixel = streamLength / canvas.width

	// Layer thickness at stream position x: two multiplied sines per layer, phase-shifted so the layers swell at different times
	const thickness = (x, layer) => {
		const swell = 0.5 + 0.5 * Math.sin(x * (0.006 + layer * 0.0017) + layer * 1.9) * Math.sin(x * 0.0033 + layer * 2.3)
		return Math.max(0.03, swell) * maxLayerThickness
	}

	// For each column, the y of every layer boundary from the top of the stream down, centred on the centre line
	const columns = []
	for (let x = 0; x <= canvas.width + columnWidth; x += columnWidth) {
		const boundaries = [0]
		layerColors.forEach((_, layer) => boundaries.push(boundaries[layer] + thickness(x * positionPerPixel, layer)))
		const top = centre - boundaries[boundaries.length - 1] / 2
		columns.push({ x, ys: boundaries.map((b) => top + b) })
	}

	context.globalAlpha = layerOpacity
	layerColors.forEach((color, layer) => {
		context.beginPath()
		// Along the layer's top edge left to right, then back along its bottom edge
		context.moveTo(columns[0].x, columns[0].ys[layer])
		for (let i = 1; i < columns.length; i++) context.lineTo(columns[i].x, columns[i].ys[layer])
		for (let i = columns.length - 1; i >= 0; i--) context.lineTo(columns[i].x, columns[i].ys[layer + 1])
		context.closePath()
		context.fillStyle = color
		context.fill()
	})
	context.globalAlpha = 1
}
