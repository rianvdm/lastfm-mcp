# Initial Setup Prompts

Ask me one question at a time (up to 20 questions) so we can develop a thorough, step-by-step spec for this idea. Each question should build on my previous answers, and our end goal is to have a detailed specification I can hand off to a developer. Let’s do this iteratively and dig into every relevant detail. Remember, only one question at a time.

Here’s the idea:

I want to create a Discogs MCP server that can be used to search for and retrieve information about my own music collection. The server should be able to handle requests for various types of data, including:

- Basic metadata about a release, such as title, artist, and release date
- Detailed information about a release, such as track listings, credits, and reviews, including any external links to the release
- Search results for a given query
- Giving me stats about my collection
- Helping me with ideas of what to listen to based on mood, genre, etc.

The server should be able to authenticate a user with Discogs so that I can make this server open to use for anyone with a Discogs account. 

The server should be built using the MCP protocol, which allows it to be integrated with other applications that support MCP. It should be able to handle requests from both the command line and from other MCP clients. MCP is a fairly new protocol, so some web searching will be required to ensure information is accurate.

# Coding Prompt

1. Open **@prompt_plan.md** and identify any prompts not marked as completed.
2. For each incomplete prompt:
    - Double-check if it's truly unfinished (if uncertain, ask for clarification).
    - If you confirm it's already done, skip it.
    - Otherwise, implement it as described.
    - Make sure the tests pass, and the program builds/runs
    - Commit the changes to your repository with a clear commit message.
    - Update **@prompt_plan.md** to mark this prompt as completed.
3. After you finish each prompt, pause and wait for user review or feedback.
4. Repeat with the next unfinished prompt as directed by the user.