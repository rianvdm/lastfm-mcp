import { describe, it, expect } from 'vitest'
import { hasMoodContent, analyzeMoodQuery } from '../../src/utils/moodMapping'

describe('Mood Mapping', () => {
	describe('hasMoodContent', () => {
		it('should detect genuine mood queries', () => {
			expect(hasMoodContent('mellow jazz for studying')).toBe(true)
			expect(hasMoodContent('dark ambient music')).toBe(true)
			expect(hasMoodContent('energetic workout music')).toBe(true)
			expect(hasMoodContent('something melancholy and introspective')).toBe(true)
			expect(hasMoodContent('chill Sunday evening vibes')).toBe(true)
		})

		it('should NOT trigger mood detection for specific album searches', () => {
			// Famous albums that contain mood words in their titles
			expect(hasMoodContent('Dark Side of the Moon')).toBe(false)
			expect(hasMoodContent('The Dark Side of the Moon')).toBe(false)
			expect(hasMoodContent('dark side of the moon')).toBe(false)
			expect(hasMoodContent('Pink Floyd Dark Side of the Moon')).toBe(false)

			// Other album title patterns
			expect(hasMoodContent('The Bright Side of Life')).toBe(false)
			expect(hasMoodContent('Dark Star')).toBe(false)
			expect(hasMoodContent('Blue Moon')).toBe(false)
			expect(hasMoodContent('White Light')).toBe(false)
			expect(hasMoodContent('Dark Night of the Soul')).toBe(false)
			expect(hasMoodContent('Sad Songs and Waltzes')).toBe(false)
		})

		it('should NOT trigger mood detection for artist - album format', () => {
			expect(hasMoodContent('Pink Floyd - Dark Side of the Moon')).toBe(false)
			expect(hasMoodContent('Beatles - Something Dark')).toBe(false)
			expect(hasMoodContent('Artist - Happy Songs')).toBe(false)
		})

		it('should NOT trigger mood detection for queries with specific music terms', () => {
			expect(hasMoodContent('dark album')).toBe(false)
			expect(hasMoodContent('dark vinyl')).toBe(false)
			expect(hasMoodContent('dark songs')).toBe(false)
			expect(hasMoodContent('sad ballad')).toBe(false)
			expect(hasMoodContent('happy track')).toBe(false)
		})

		it('should NOT trigger for concrete genre terms', () => {
			expect(hasMoodContent('rock')).toBe(false)
			expect(hasMoodContent('jazz')).toBe(false)
			expect(hasMoodContent('electronic')).toBe(false)
			expect(hasMoodContent('metal')).toBe(false)
		})

		it('should trigger for genuine contextual queries', () => {
			expect(hasMoodContent('something for Sunday evening')).toBe(true)
			expect(hasMoodContent('music for working out')).toBe(true)
			expect(hasMoodContent('good for studying')).toBe(true)
			expect(hasMoodContent('rainy day music')).toBe(true)
		})

		it('should trigger for mood adjectives in longer queries', () => {
			expect(hasMoodContent('I want something really mellow')).toBe(true)
			expect(hasMoodContent('find me some energetic music')).toBe(true)
			expect(hasMoodContent('looking for melancholy indie rock')).toBe(true)
		})
	})

	describe('analyzeMoodQuery', () => {
		it('should detect dark mood correctly', () => {
			const result = analyzeMoodQuery('dark ambient music')
			expect(result.detectedMoods).toContain('dark')
			expect(result.suggestedGenres).toContain('Metal')
			expect(result.confidence).toBeGreaterThan(0)
		})

		it('should detect mellow mood correctly', () => {
			const result = analyzeMoodQuery('mellow jazz for studying')
			expect(result.detectedMoods).toContain('mellow')
			expect(result.suggestedGenres).toContain('Jazz')
			expect(result.confidence).toBeGreaterThan(0)
		})

		it('should detect dark even in album titles but hasMoodContent should filter it', () => {
			const result = analyzeMoodQuery('Dark Side of the Moon')
			// analyzeMoodQuery will detect "dark" regardless
			expect(result.detectedMoods).toContain('dark')
			expect(result.confidence).toBeGreaterThan(0)

			// But hasMoodContent should prevent this from being used
			expect(hasMoodContent('Dark Side of the Moon')).toBe(false)
		})
	})
})
