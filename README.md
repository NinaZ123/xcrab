# X Trending Tracker (Tampermonkey Userscript)

A single-file userscript that adds a floating trend tracker ball on X (`x.com` / `twitter.com`) and a slide-out ranking panel.

## Features

- Floating ball in bottom-right corner (always visible on X pages)
- Live tracked trend count on the ball
- `🔥` fire animation when a **new topic enters Top 3**
- Slide-out panel (350px) with Top 10 trends
- Category tagging: `AI`, `Politics`, `Finance`, `Entertainment`, `Sports`, `Other`
- Trend velocity indicator (`🚀 surging`, `↗ rising`, `→ steady`, `↘ falling`, `• new`)
- Auto-refresh every 5 minutes
- Click any topic to open X search for that trend
- localStorage persistence across sessions
- Graceful fallback to last known snapshot when DOM scraping fails

## Files

- `x-trending-tracker.user.js` - Main userscript (Tampermonkey/Greasemonkey)
- `README.md` - This documentation

## Installation

1. Install Tampermonkey (or Greasemonkey) in your browser.
2. Open Tampermonkey dashboard.
3. Create a new script.
4. Replace the template content with the contents of `x-trending-tracker.user.js`.
5. Save and enable the script.
6. Visit `https://x.com/home` and wait a few seconds for first scrape.

## Usage

1. Open X.
2. Find the floating ball in the bottom-right corner.
3. Click the ball to open/close the trending panel.
4. Click `Refresh` in the panel for manual refresh.
5. Click any trend row to open a search page for that topic on X.

## Hot Topic Detection Logic

- Script stores previous Top 3 trend names in localStorage.
- On each refresh, if any new name appears in current Top 3 that was not in previous Top 3, fire animation is triggered.
- `NEW` badge is shown for newly discovered trends (never seen before) and newly entered Top 3 topics.

## Data Source / Scraping Strategy

The script scrapes links that match `a[href*="/search?q="]` in likely trend containers (sidebar and trend timeline areas). It then:

- Extracts topic keyword from URL query (`q`)
- Parses post/tweet count from nearby card text
- Guesses category from trend text keywords
- Falls back to stored snapshot if no trends can be parsed

Because X is a dynamic SPA and DOM can change frequently, selectors are intentionally heuristic and defensive.

## localStorage Keys

- `xTrendTracker:snapshot` - last scraped ranking payload + timestamp
- `xTrendTracker:seenTopics` - unique topic history for `NEW` detection
- `xTrendTracker:top3` - previous top 3 topic names
- `xTrendTracker:lastUrl` - last visited URL tracked by URL watcher

## Notes

- Works best on the Home page where "What's happening" is visible.
- If trend parsing fails due to X markup updates, panel still shows last cached snapshot.
- No external dependencies are used (pure vanilla JavaScript + CSS).

## Development

To tweak behavior:

- `REFRESH_MS` controls auto-refresh interval (default 5 minutes)
- `MAX_TOPICS` controls how many ranked items are shown (default 10)
- `CATEGORY_KEYWORDS` controls topic category classification
