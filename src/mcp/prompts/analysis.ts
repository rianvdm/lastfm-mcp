/**
 * Last.fm MCP Prompts
 *
 * Prompt templates for common Last.fm analysis tasks.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

/**
 * Register all Last.fm prompts with the MCP server.
 */
export function registerPrompts(server: McpServer): void {
	// listening_insights - Get insights about user's listening habits
	server.prompt(
		'listening_insights',
		"Get insights about user's listening habits and patterns",
		{
			username: z.string().describe('Last.fm username to analyze'),
			period: z
				.string()
				.optional()
				.describe('Time period for analysis (7day, 1month, 3month, 6month, 12month, overall)'),
		},
		async ({ username, period }) => {
			const periodText = period ? ` over the ${period} period` : ''
			return {
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `Analyze the listening habits and patterns for Last.fm user "${username}"${periodText}. Use the available tools to gather their recent tracks, top artists, top albums, and listening statistics. Provide insights about their musical preferences, listening patterns, genre diversity, and any interesting trends. Identify their most played artists and tracks, and suggest what their listening data reveals about their musical taste.`,
						},
					},
				],
			}
		},
	)

	// music_discovery - Discover new music based on listening history
	server.prompt(
		'music_discovery',
		'Discover new music based on listening history',
		{
			username: z.string().describe('Last.fm username for personalized recommendations'),
			genre: z.string().optional().describe('Optional genre preference for recommendations'),
		},
		async ({ username, genre }) => {
			const genreText = genre ? ` focusing on ${genre} music` : ''
			return {
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `Help discover new music for Last.fm user "${username}"${genreText}. Analyze their listening history, top artists, and loved tracks to understand their musical preferences. Use similar artists and tracks data to recommend new music they might enjoy. Provide explanations for why each recommendation would suit their taste based on their listening patterns.`,
						},
					},
				],
			}
		},
	)

	// track_analysis - Get detailed analysis of a specific track
	server.prompt(
		'track_analysis',
		'Get detailed analysis of a specific track',
		{
			artist: z.string().describe('Artist name'),
			track: z.string().describe('Track name'),
		},
		async ({ artist, track }) => {
			return {
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `Provide a detailed analysis of the track "${track}" by ${artist}. Use the available tools to gather comprehensive information including track details, tags, similar tracks, and statistics. Analyze the track's musical characteristics, its place in the artist's catalog, its popularity, and what makes it distinctive. Include information about similar tracks and recommendations for listeners who enjoy this song.`,
						},
					},
				],
			}
		},
	)

	// album_analysis - Get detailed analysis of a specific album
	server.prompt(
		'album_analysis',
		'Get detailed analysis of a specific album',
		{
			artist: z.string().describe('Artist name'),
			album: z.string().describe('Album name'),
		},
		async ({ artist, album }) => {
			return {
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `Provide a detailed analysis of the album "${album}" by ${artist}. Use the available tools to gather comprehensive information including album details, track listing, tags, and statistics. Analyze the album's musical themes, its significance in the artist's discography, critical reception, and notable tracks. Include information about the album's style, influences, and recommendations for similar albums.`,
						},
					},
				],
			}
		},
	)

	// artist_analysis - Get detailed analysis of a specific artist
	server.prompt(
		'artist_analysis',
		'Get detailed analysis of a specific artist',
		{
			artist: z.string().describe('Artist name'),
		},
		async ({ artist }) => {
			return {
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `Provide a detailed analysis of the artist ${artist}. Use the available tools to gather comprehensive information including artist bio, top tracks, albums, tags, and similar artists. Analyze their musical style, career highlights, influences, and impact on music. Include information about their most popular works and recommendations for listeners new to this artist.`,
						},
					},
				],
			}
		},
	)

	// listening_habits - Analyze and summarize user's listening habits
	server.prompt(
		'listening_habits',
		"Analyze and summarize user's listening habits",
		{
			username: z.string().describe('Last.fm username to analyze'),
			timeframe: z.string().optional().describe('Optional timeframe for analysis (recent, historical, comparative)'),
		},
		async ({ username, timeframe }) => {
			const timeframeText = timeframe ? ` with a focus on ${timeframe} listening` : ''
			return {
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: `Analyze and summarize the listening habits of Last.fm user "${username}"${timeframeText}. Use the available tools to examine their recent activity, top artists and albums, loved tracks, and overall statistics. Identify patterns in their listening behavior, preferred genres, discovery habits, and music consumption patterns. Provide insights about their musical journey and evolution of taste over time.`,
						},
					},
				],
			}
		},
	)
}
