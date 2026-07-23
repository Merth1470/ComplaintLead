# PostHog post-wizard report

The wizard completed a deep integration of the ComplaintLead Finder app. Both the client-side HTML/JavaScript (`public/index.html`) and the server-side Express app (`server.js`) are fully instrumented. The browser loads PostHog via the CDN snippet using keys injected by the server at runtime, fires events across the full user journey (source selection, scan submission, results, errors, and outreach clicks), and passes its distinct ID and session ID to the server so browser and server events are fully correlated. A `scan_validation_failed` event was added as the only gap in the existing integration. Environment variables `POSTHOG_PUBLIC_KEY` and `POSTHOG_HOST` are set in `.env`.

## Events instrumented

| Event | Description | File |
|---|---|---|
| `source_selected` | User switches the search platform between Reddit and X. | `public/index.html` |
| `scan_validation_failed` | User clicked run scan but required fields (category or audience) were empty. | `public/index.html` |
| `search_submitted` | User clicks the "run scan" button to initiate a complaint search. | `public/index.html` |
| `search_completed` | Search API returned results successfully and leads are rendered. | `public/index.html` |
| `search_failed` | Search API call failed with a network or server error. | `public/index.html` |
| `no_leads_found` | Search returned an empty results set from the API. | `public/index.html` |
| `lead_link_clicked` | User clicks the "Outreach to Lead" link on a result card. | `public/index.html` |
| `search_processed` | Server successfully processed and returned search results from the API. | `server.js` |

## Next steps

We've built insights and a dashboard for monitoring the scan-to-outreach journey:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/523916/dashboard/1896456)
- [Search conversion funnel (wizard)](https://us.posthog.com/project/523916/insights/z98AVA7a)
- [Successful searches by source (wizard)](https://us.posthog.com/project/523916/insights/zlu9BRlu)
- [Lead link clicks over time (wizard)](https://us.posthog.com/project/523916/insights/Ras4lMaF)
- [Search failures over time (wizard)](https://us.posthog.com/project/523916/insights/RXmJ2420)
- [Source platform preference (wizard)](https://us.posthog.com/project/523916/insights/mGkR3YAh)

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `POSTHOG_PUBLIC_KEY` and `POSTHOG_HOST` to `.env.example` and any bootstrap scripts so collaborators know what to set.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
