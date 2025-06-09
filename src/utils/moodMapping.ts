/**
 * Mood to Genre/Style Mapping Utility
 * Maps emotional descriptors and contextual cues to relevant Discogs genres and styles
 */

export interface MoodMappingResult {
	detectedMoods: string[]
	suggestedGenres: string[]
	suggestedStyles: string[]
	contextualHints: string[]
	confidence: number
}

// Primary mood to genres/styles mapping
const MOOD_MAPPINGS: Record<string, { genres: string[]; styles: string[]; weight: number }> = {
	// Calm/Relaxed moods
	mellow: {
		genres: ['Jazz', 'Ambient', 'Folk', 'Chillout', 'Downtempo'],
		styles: ['Smooth Jazz', 'Soft Rock', 'Adult Contemporary', 'Lounge', 'Easy Listening'],
		weight: 1.0,
	},
	chill: {
		genres: ['Chillout', 'Downtempo', 'Ambient', 'Trip Hop'],
		styles: ['Lounge', 'Chillwave', 'Nu Jazz'],
		weight: 1.0,
	},
	relaxing: {
		genres: ['Ambient', 'New Age', 'Chillout', 'Classical'],
		styles: ['Meditation', 'Nature Sounds', 'Minimal', 'Drone'],
		weight: 1.0,
	},
	peaceful: {
		genres: ['Ambient', 'Folk', 'Classical', 'New Age'],
		styles: ['Acoustic', 'Chamber Music', 'Pastoral'],
		weight: 1.0,
	},
	soothing: {
		genres: ['Ambient', 'Classical', 'Jazz', 'Folk'],
		styles: ['Lullaby', 'Smooth Jazz', 'Acoustic'],
		weight: 1.0,
	},

	// Melancholic/Sad moods
	melancholy: {
		genres: ['Indie Rock', 'Folk', 'Alternative Rock'],
		styles: ['Singer/Songwriter', 'Slowcore', 'Sadcore', 'Dream Pop', 'Shoegaze'],
		weight: 1.0,
	},
	melancholic: {
		genres: ['Indie Rock', 'Folk', 'Alternative Rock'],
		styles: ['Singer/Songwriter', 'Slowcore', 'Sadcore', 'Dream Pop'],
		weight: 1.0,
	},
	sad: {
		genres: ['Folk', 'Indie Rock', 'Blues'],
		styles: ['Singer/Songwriter', 'Sadcore', 'Delta Blues', 'Ballad'],
		weight: 1.0,
	},
	somber: {
		genres: ['Folk', 'Classical', 'Ambient'],
		styles: ['Requiem', 'Funeral Doom', 'Dark Ambient'],
		weight: 1.0,
	},
	nostalgic: {
		genres: ['Indie Rock', 'Folk', 'Synthwave'],
		styles: ['Dream Pop', 'Shoegaze', 'Retro', 'Vintage'],
		weight: 1.0,
	},
	wistful: {
		genres: ['Folk', 'Indie Rock', 'Ambient'],
		styles: ['Singer/Songwriter', 'Dream Pop', 'Atmospheric'],
		weight: 1.0,
	},

	// Energetic/Upbeat moods
	energetic: {
		genres: ['Rock', 'Electronic', 'Punk', 'Dance', 'Hip Hop'],
		styles: ['Hard Rock', 'Techno', 'House', 'Breakbeat', 'Hardcore'],
		weight: 1.0,
	},
	upbeat: {
		genres: ['Pop', 'Dance', 'Funk', 'Disco', 'Soul'],
		styles: ['Pop Rock', 'Nu-Disco', 'Motown', 'Gospel'],
		weight: 1.0,
	},
	happy: {
		genres: ['Pop', 'Funk', 'Soul', 'Reggae'],
		styles: ['Sunshine Pop', 'Bubblegum', 'Motown', 'Ska'],
		weight: 1.0,
	},
	cheerful: {
		genres: ['Pop', 'Folk', 'Country'],
		styles: ['Folk Pop', 'Indie Pop', 'Alt-Country'],
		weight: 1.0,
	},
	vibrant: {
		genres: ['Electronic', 'Dance', 'Pop'],
		styles: ['Synthpop', 'New Wave', 'Electro'],
		weight: 1.0,
	},

	// Dark/Intense moods
	dark: {
		genres: ['Metal', 'Industrial', 'Darkwave', 'Gothic'],
		styles: ['Black Metal', 'Doom', 'Dark Ambient', 'EBM'],
		weight: 1.0,
	},
	brooding: {
		genres: ['Post-Rock', 'Doom', 'Dark Ambient'],
		styles: ['Sludge', 'Drone', 'Atmospheric'],
		weight: 1.0,
	},
	intense: {
		genres: ['Metal', 'Hardcore', 'Industrial'],
		styles: ['Thrash', 'Grindcore', 'Power Electronics'],
		weight: 1.0,
	},
	moody: {
		genres: ['Alternative Rock', 'Post-Punk', 'Shoegaze'],
		styles: ['Goth Rock', 'Darkwave', 'Coldwave'],
		weight: 1.0,
	},

	// Romantic/Intimate moods
	romantic: {
		genres: ['Soul', 'R&B', 'Jazz'],
		styles: ['Smooth Jazz', 'Neo-Soul', 'Ballad', 'Love Song'],
		weight: 1.0,
	},
	intimate: {
		genres: ['Folk', 'Jazz', 'R&B'],
		styles: ['Singer/Songwriter', 'Acoustic', 'Bedroom Pop'],
		weight: 1.0,
	},
	sensual: {
		genres: ['R&B', 'Soul', 'Trip Hop'],
		styles: ['Neo-Soul', 'Quiet Storm', 'Downtempo'],
		weight: 1.0,
	},
}

// Contextual mappings (time, activity, season)
const CONTEXTUAL_MAPPINGS: Record<string, { genres: string[]; styles: string[]; context: string }> = {
	// Time contexts
	sunday: {
		genres: ['Folk', 'Jazz', 'Classical', 'Ambient'],
		styles: ['Acoustic', 'Sunday Morning', 'Contemplative'],
		context: 'Sunday relaxation',
	},
	evening: {
		genres: ['Jazz', 'Ambient', 'Chillout', 'Folk'],
		styles: ['Smooth Jazz', 'Lounge', 'Downtempo'],
		context: 'Evening wind-down',
	},
	morning: {
		genres: ['Folk', 'Pop', 'Classical'],
		styles: ['Acoustic', 'Light Rock', 'Pastoral'],
		context: 'Morning energy',
	},
	night: {
		genres: ['Ambient', 'Electronic', 'Trip Hop'],
		styles: ['Dark Ambient', 'Nocturne', 'Atmospheric'],
		context: 'Nighttime atmosphere',
	},
	midnight: {
		genres: ['Ambient', 'Electronic', 'Jazz'],
		styles: ['Dark Ambient', 'Late Night', 'Noir'],
		context: 'Late night listening',
	},

	// Activity contexts
	working: {
		genres: ['Ambient', 'Classical', 'Electronic'],
		styles: ['Minimal', 'Focus', 'Instrumental'],
		context: 'Background music for work',
	},
	studying: {
		genres: ['Classical', 'Ambient', 'Post-Rock'],
		styles: ['Minimal', 'Instrumental', 'Atmospheric'],
		context: 'Study music',
	},
	cooking: {
		genres: ['Jazz', 'Soul', 'World'],
		styles: ['Bossa Nova', 'Latin Jazz', 'Lounge'],
		context: 'Kitchen atmosphere',
	},
	driving: {
		genres: ['Rock', 'Electronic', 'Pop'],
		styles: ['Classic Rock', 'Road Trip', 'Synthwave'],
		context: 'Driving music',
	},

	// Seasonal contexts
	winter: {
		genres: ['Folk', 'Ambient', 'Classical'],
		styles: ['Cozy', 'Fireside', 'Contemplative'],
		context: 'Winter atmosphere',
	},
	summer: {
		genres: ['Reggae', 'Pop', 'Electronic'],
		styles: ['Tropical', 'Beach', 'Festival'],
		context: 'Summer vibes',
	},
	autumn: {
		genres: ['Folk', 'Indie Rock', 'Jazz'],
		styles: ['Acoustic', 'Contemplative', 'Mellow'],
		context: 'Autumn reflection',
	},
	fall: {
		genres: ['Folk', 'Indie Rock', 'Jazz'],
		styles: ['Acoustic', 'Contemplative', 'Mellow'],
		context: 'Fall atmosphere',
	},
}

// Common synonyms and variations
const MOOD_SYNONYMS: Record<string, string> = {
	chilled: 'chill',
	chilling: 'chill',
	calm: 'mellow',
	tranquil: 'peaceful',
	serene: 'peaceful',
	contemplative: 'melancholy',
	pensive: 'melancholy',
	uplifting: 'upbeat',
	joyful: 'happy',
	gloomy: 'dark',
	atmospheric: 'moody',
	cozy: 'mellow',
}

/**
 * Analyze a query for mood words and contextual cues
 */
export function analyzeMoodQuery(query: string): MoodMappingResult {
	const lowerQuery = query.toLowerCase()

	const detectedMoods: string[] = []
	const suggestedGenres: string[] = []
	const suggestedStyles: string[] = []
	const contextualHints: string[] = []
	let totalWeight = 0

	// Check for direct mood matches
	for (const [mood, mapping] of Object.entries(MOOD_MAPPINGS)) {
		if (lowerQuery.includes(mood.toLowerCase())) {
			detectedMoods.push(mood)
			suggestedGenres.push(...mapping.genres)
			suggestedStyles.push(...mapping.styles)
			totalWeight += mapping.weight
		}
	}

	// Check for mood synonyms
	for (const [synonym, canonicalMood] of Object.entries(MOOD_SYNONYMS)) {
		if (lowerQuery.includes(synonym) && MOOD_MAPPINGS[canonicalMood]) {
			const mapping = MOOD_MAPPINGS[canonicalMood]
			if (!detectedMoods.includes(canonicalMood)) {
				detectedMoods.push(canonicalMood)
				suggestedGenres.push(...mapping.genres)
				suggestedStyles.push(...mapping.styles)
				totalWeight += mapping.weight * 0.8 // Slightly lower weight for synonyms
			}
		}
	}

	// Check for contextual cues
	for (const [context, mapping] of Object.entries(CONTEXTUAL_MAPPINGS)) {
		if (lowerQuery.includes(context)) {
			contextualHints.push(mapping.context)
			suggestedGenres.push(...mapping.genres)
			suggestedStyles.push(...mapping.styles)
			totalWeight += 0.5 // Lower weight for contextual cues
		}
	}

	// Look for compound mood phrases
	const compoundPatterns = [
		{ pattern: /sunday.*evening|evening.*sunday/i, moods: ['mellow', 'peaceful'] },
		{ pattern: /late.*night|night.*late/i, moods: ['dark', 'ambient'] },
		{ pattern: /rainy.*day|day.*rainy/i, moods: ['melancholy', 'contemplative'] },
		{ pattern: /workout|exercise|gym/i, moods: ['energetic', 'upbeat'] },
		{ pattern: /chill.*out|chilling.*out/i, moods: ['chill', 'relaxing'] },
	]

	for (const { pattern, moods } of compoundPatterns) {
		if (pattern.test(query)) {
			for (const mood of moods) {
				if (MOOD_MAPPINGS[mood] && !detectedMoods.includes(mood)) {
					detectedMoods.push(mood)
					const mapping = MOOD_MAPPINGS[mood]
					suggestedGenres.push(...mapping.genres)
					suggestedStyles.push(...mapping.styles)
					totalWeight += mapping.weight * 0.7
				}
			}
		}
	}

	// Remove duplicates and calculate confidence
	const uniqueGenres = [...new Set(suggestedGenres)]
	const uniqueStyles = [...new Set(suggestedStyles)]
	const confidence = Math.min(totalWeight, 1.0)

	return {
		detectedMoods,
		suggestedGenres: uniqueGenres,
		suggestedStyles: uniqueStyles,
		contextualHints,
		confidence,
	}
}

// Common concrete music genres that shouldn't trigger mood mapping
const CONCRETE_GENRES = new Set([
	'rock',
	'pop',
	'jazz',
	'blues',
	'country',
	'electronic',
	'classical',
	'hip hop',
	'rap',
	'metal',
	'punk',
	'folk',
	'reggae',
	'soul',
	'funk',
	'r&b',
	'disco',
	'house',
	'techno',
	'ambient',
	'trance',
	'dubstep',
	'indie',
	'alternative',
	'grunge',
	'ska',
	'gospel',
	'world',
	'latin',
	'african',
	'asian',
	'experimental',
	'avant-garde',
	'progressive',
	'psychedelic',
	'garage',
	'post-rock',
	'post-punk',
	'new wave',
	'synthpop',
	'industrial',
])

/**
 * Check if a query contains mood or contextual language (avoiding concrete genres)
 */
export function hasMoodContent(query: string): boolean {
	const lowerQuery = query.toLowerCase().trim()

	// Don't trigger mood mapping for simple concrete genre queries
	if (CONCRETE_GENRES.has(lowerQuery)) {
		return false
	}

	// Don't trigger for simple single word concrete genre queries
	const words = lowerQuery.split(/\s+/)
	if (words.length === 1 && CONCRETE_GENRES.has(words[0])) {
		return false
	}

	const result = analyzeMoodQuery(query)
	return result.detectedMoods.length > 0 || result.contextualHints.length > 0
}

/**
 * Generate search terms from mood analysis
 */
export function generateMoodSearchTerms(query: string): string[] {
	const analysis = analyzeMoodQuery(query)

	if (analysis.confidence < 0.3) {
		return [] // Low confidence, don't modify search
	}

	const searchTerms: string[] = []

	// Combine genres and styles for search
	searchTerms.push(...analysis.suggestedGenres)
	searchTerms.push(...analysis.suggestedStyles)

	return [...new Set(searchTerms)] // Remove duplicates
}
