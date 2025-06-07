# Discogs MCP Server Specification

## Overview
The Discogs MCP Server is a Cloudflare Workers-based service that allows authenticated users to interact with their personal Discogs music collection via natural language commands using the MCP protocol. The server will process plain-text queries and return rich, markdown-formatted responses suitable for display in natural language clients like ChatGPT or Claude.

## Key Features
- Authenticate users via Discogs OAuth  
- Query Discogs API live (no persistent local storage)  
- Respond to natural language commands  
- Return basic and detailed release information  
- Perform collection-based search queries  
- Provide stats about user collections  
- Offer listening recommendations based on mood, genre, and metadata  
- Optional Last.fm integration for play history-based recommendations  
- No caching or persistence (except logging)  
- Rate limiting and detailed request logging via Workers KV  

---

## Architecture

### Platform
- **Runtime**: Cloudflare Workers  
- **Protocol**: MCP (text-based command protocol)  
- **Storage**:  
  - Workers KV for request logs  
  - No persistent cache or user data  

### External Integrations
- **Discogs API** (OAuth authentication and data access)  
- **Last.fm API** (optional user play history)  

### Input & Output
- **Input**: Natural language text over MCP  
- **Output**: Markdown-formatted text for conversational clients  

---

## Functional Requirements

### Authentication
- OAuth-based login flow via Discogs  
- Access limited to the authenticated user's own collection  
- Each user tracked via their OAuth user ID  

### Basic Release Lookup
Returns the following fields:
- Title  
- Artist(s)  
- Release year  
- Format (e.g. Vinyl, LP)  
- Genres / Styles  
- Discogs release URL  
- Cover image URL  
- Notes or summary  

### Detailed Release Lookup
Includes everything in basic release plus:
- Track listing (position, title, duration)  
- Credits (e.g. producers, engineers)  
- External links  
- Summarized and filterable user reviews/comments  

### Search
- Natural language queries (e.g. "search miles davis bitches brew")  
- Defaults to master releases unless user specifies detail (e.g. year, country, format)  
- Returns up to 3 results, expandable  
- Each result includes:  
  - Title  
  - Artist  
  - Release year  
  - Format  
  - Thumbnail URL  
  - Discogs release URL  
  - Optional snippet  

### Collection Stats
Returns:
- Total number of items  
- Most common genres/styles  
- Most collected artists  
- Most frequent formats  
- Oldest / newest releases  
- Recently added items  
- Items per decade  
- Most common labels and countries  
- Duplicate releases or reissues  

### Recommendations ("What Should I Listen To?")
Inputs:
- Mood  
- Genre/style  
- Decade/era  
- Play count (via optional Last.fm)  
- Tags or notes (if available in Discogs)  
- Random draw with filters  

Returns:
- Up to 3 recommended releases with metadata  

### Last.fm Integration (Optional)
- User can link Last.fm account  
- Enables filtering/sorting by play count  
- Used in recommendation feature  

---

## Non-Functional Requirements

### Rate Limiting
- Enforced per user ID  
- Configurable thresholds (e.g. X requests/min, Y/hour)  

### Logging
- Stored in Workers KV  
- Logged per request:  
  - Timestamp  
  - User ID  
  - Original query  
  - Parsed intent  
  - Result metadata (status, count, latency)  

### Error Handling
- Friendly messages on API failure:  
  - e.g. "Sorry, Discogs isn’t responding right now. Please try again in a few minutes."  
- No retries or fallbacks at this stage  

### Unsupported Queries
- Return help-style fallback:  
  - "Sorry, I couldn’t figure that out. Try asking about an album, your stats, or what to listen to."  

### Response Formatting
- Markdown-rich output  
- Clear headers, bullet points, labeled sections  
- Optimized for ChatGPT, Claude, and other natural language clients  

---

## Testing Plan

### Unit Tests
- Command parsing logic  
- Response formatting  
- Discogs API response shaping  
- Last.fm API integration fallback  

### Integration Tests
- Full end-to-end flow:  
  - OAuth login  
  - Search and release lookup  
  - Stats computation  
  - Recommendation flow with/without Last.fm  

### Rate Limiting Tests
- Simulate overuse by a single user  
- Validate throttling and error message  

### Failure Mode Tests
- Simulate Discogs/Last.fm downtime  
- Check fallback messages  

### Linting & QA
- Use TypeScript ESLint or equivalent  
- Response formatting regression tests  
- Markdown output snapshot tests  

---

## Future Enhancements (Deferred)
- Caching (Workers KV or Durable Objects)  
- Persistent user preferences and command history  
- More advanced NLP query handling  
- Realtime search suggestion support  
- Mobile app or web client front-end  

---

This document is ready for development.