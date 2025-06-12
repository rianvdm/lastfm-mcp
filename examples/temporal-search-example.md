# Temporal Search Examples

The Last.fm MCP server supports intelligent temporal query interpretation for listening history. When you use temporal keywords in your queries, the system will automatically interpret them and apply appropriate time filtering.

## How It Works

Temporal keywords are automatically detected and processed:

### "Recent" Keywords
- `recent`, `recently`, `new`, `newest`, `latest`
- **Effect**: Sorts results by date added (newest first)
- **Query processing**: These words are removed from the search terms and used for sorting

### "Old" Keywords  
- `old`, `oldest`, `earliest`
- **Effect**: Sorts results by date added (oldest first)
- **Query processing**: These words are removed from the search terms and used for sorting

## Example Queries

### Before the Fix
```
Query: "rock vinyl recent"
Result: 0 results (because no releases had "recent" in their metadata)
```

### After the Fix
```
Query: "rock vinyl recent"
Processing: 
- Detected temporal keyword: "recent"
- Search terms: "rock vinyl" (without "recent")
- Sorting: By date added, newest first

Result: All rock vinyl releases in your collection, sorted by most recently added
```

## More Examples

| Query | Search Terms | Sorting |
|-------|--------------|---------|
| `"jazz recent"` | `"jazz"` | Date added (newest first) |
| `"beatles vinyl oldest"` | `"beatles vinyl"` | Date added (oldest first) |
| `"hip hop latest"` | `"hip hop"` | Date added (newest first) |
| `"rock 1970s new"` | `"rock 1970s"` | Date added (newest first) |

## Search Strategy Feedback

The system now provides feedback about how your query was interpreted:

```
Found 15 results for "rock vinyl recent" in your collection (showing 15 items):

**Search Strategy:** Interpreted "rock vinyl recent" as searching for items with "recent" meaning "most recently added". Sorting by date added (newest first).

• [ID: 12345] Led Zeppelin - Physical Graffiti (1975)
  Format: Vinyl | Genre: Rock | Styles: Hard Rock ⭐5

• [ID: 67890] Pink Floyd - The Wall (1979)  
  Format: Vinyl | Genre: Rock | Styles: Progressive Rock ⭐4

...
```

This makes it much easier to find recently added items in your collection without having to remember exact dates! 