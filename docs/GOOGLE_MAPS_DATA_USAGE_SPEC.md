# AI Consumer Decision Assistant — Data Usage Specification

- **Document status:** Draft for compliance review
- **Repository:** `fly0331/GoogleMapReview-Denoiser`
- **Branch reviewed:** `master`
- **Review date:** 2026-11-26
- **Product:** Chrome Extension + FastAPI backend + Gemini API
- **Important:** This document describes observed implementation behavior. It is not a legal opinion and does not establish permission from Google or any other rights holder.

## 1. Product purpose and user interaction

AI Consumer Decision Assistant is a Chrome Extension that summarizes Google Maps reviews into decision guidance, practical visit information, recommended dishes, and aspect analysis. The user opens a Google Maps place page and explicitly clicks **「分析目前商家」** in the extension. The extension then collects review information from the currently displayed Google Maps page, sends it to the configured FastAPI backend, and displays the resulting analysis.

The intended product is free to use, with no advertisements, subscription fees, sale of review data, or direct monetization of review data.

## 2. Data collection

### 2.1 Source and trigger

- Source: review cards rendered in the user's current Google Maps page.
- Trigger: user clicks the extension's analysis action.
- Collection behavior: the content script locates review cards, expands available review text, scrolls the review container, deduplicates by review ID, and collects up to 50 reviews.
- The implementation does not establish that the reviews are sorted by newest. The extension should not claim newest-first collection.
- Collection relies partly on Google Maps DOM selectors and may break if the page structure changes.

### 2.2 Fields collected

| Field | Description | Observed use |
|---|---|---|
| `place_id` | Place identifier parsed from the Google Maps page URL | Backend cache key and request context |
| `review_id` | Review identifier from the review card's `data-review-id` attribute | Deduplication, evidence linking, Gemini input |
| `rating` | Star rating parsed from an accessibility label | Gemini input and original review display |
| `text` | Expanded review text, capped at 5,000 Unicode characters and shortened further when required by the request budget | Review selection, Gemini input, and evidence display use the transmitted text |
| `relative_time` | Relative date text displayed in the review card | Original review display |
| `author_reviews_count` | Review count shown for the review author, when parseable | Retained in the request and fingerprint; not used for selection |
| `review_date` | Absolute review date field | Currently always set to `null` by the content script |
| `scraped_at` | UTC timestamp generated when collection completes | Request timestamp |

The current implementation does not collect reviewer names, profile photos, email addresses, phone numbers, or precise user location as explicit review fields. This statement is limited to the inspected collection code and should be rechecked if the implementation changes.

## 3. Data transmission

### 3.1 Extension to backend

The extension sends an `AnalyzeRequest` to the configured API endpoint. The request contains:

- `place_id`
- `scraped_at`
- `reviews[]`, with `review_id`, `rating`, `text`, `relative_time`, `author_reviews_count`, and `review_date`

The currently reviewed `master` version uses `http://127.0.0.1:8000` as its API base URL. This is a development configuration, not a production deployment endpoint. A production release must use a secured production endpoint and must not include the localhost host permission.

The request is user-triggered. The inspected code does not show continuous/background collection or an analytics event pipeline.

### 3.2 Backend processing

The FastAPI backend:

1. Validates the request, including a maximum of 120 reviews, a maximum review text length of 5,000 characters, and a maximum `place_id` length of 256 characters.
2. Creates a SHA-256 fingerprint from the place ID and serialized review payload.
3. Checks the SQLite cache.
4. On a cache miss, selects reviews with unique nonblank IDs and usable text within the Gemini budget.
5. Sends eligible reviews to the configured LLM analysis implementation.
6. Returns analysis results and stores the response in the SQLite cache.

A cache hit returns the cached analysis response without repeating selection or Gemini analysis.

### 3.3 Backend to Gemini

When `MOCK_LLM` is not enabled, the backend sends the selected reviews with non-empty text to the Gemini API in a single call. When none qualify, it skips the call.

The Gemini input contains only:

- `review_id`
- `rating`
- `text`

It does not include the `place_id`, `scraped_at`, `relative_time`, `author_reviews_count`, or `review_date` fields in the inspected implementation.

The extension checks the complete serialized request against a 512 KiB UTF-8 budget and applies a uniform character cap to review texts when needed. Review identifiers are kept intact. The backend allocates the Gemini selection budget in a deterministic ID-based order and skips reviews that do not fit the 50-review and 20,000 review-text character limits. It separately checks the serialized Gemini request size and configures an output token cap. The configured model defaults to `gemini-3.5-flash-lite`, and the API key is read by the backend from `GEMINI_API_KEY`; it is not embedded in the extension code.

The actual Gemini account tier, applicable service terms, retention settings, and data-use settings are operational/account facts and cannot be established from repository code. They must be verified before release.

## 4. Analysis and derived data

Gemini returns a decision summary, practical visit information, recommended dishes, positive and negative aspect summaries, and aspect scores in one Structured Output response. Practical categories cover budget, wait time, reservations, parking, dining time limits, payment, and other actionable details.

The backend checks evidence IDs against the reviews actually sent to Gemini. It also verifies that each practical item's source quote occurs in the corresponding review, checks written numbers and common adjacent units against the verified quotes, and omits unsupported items. Source quotes are used during validation and are not included in the API response.

## 5. Data returned to the extension

The backend response includes:

- `cache_hit` and `analysis_mode`
- Number of reviews selected for analysis
- Decision summary, recommended dishes, pros and cons, and aspect scores
- Verified practical visit information and its evidence review IDs

The extension retains the collected reviews in React application state and displays original evidence for Pros / Cons. Practical visit information shows the derived summary and categorization in the side panel. The inspected code does not show the extension writing review content to `chrome.storage`.

## 6. Storage and retention

### 6.1 SQLite analysis cache

The backend SQLite cache stores:

- `place_id`
- a JSON envelope containing cache format version, request fingerprint, and serialized analysis response
- cache timestamp

The cached response contains derived analysis results and evidence review IDs. The response does not include a separate original review text or verification quote field. Derived summaries, including deterministic Mock summaries, may reproduce excerpts from the reviews.

The application enforces a seven-day cache TTL and deletes expired entries during initialization, cache writes, and expired cache reads. This is an application-level expiry policy; it is not a guarantee that all filesystem, SQLite WAL/SHM, backup, snapshot, or infrastructure copies are immediately and irreversibly erased.

The inspected cache implementation enables SQLite WAL mode and a five-second busy timeout. No explicit database encryption is shown in the inspected code.

### 6.2 Browser memory and logs

- The extension keeps review data in application memory to support analysis and evidence display.
- The content script currently logs the full collected review objects to the browser console (`Collected reviews`). This should be removed before a public release.
- No use of `chrome.storage` for review persistence was identified in the inspected files. Recheck the complete repository before making a definitive privacy-policy statement.
- Server, hosting-provider, proxy, crash, and third-party service logs have not been audited in this repository review.

## 7. Permissions and network scope

The inspected Manifest V3 manifest declares `activeTab`, `sidePanel`, and `storage` permissions, and host permissions for Google Maps domains plus the local development API. The `storage` permission appears unused in the inspected code and should be reviewed. The localhost permission is development-only and must be removed or replaced for production.

The extension communicates with the backend over HTTP in the current local-development configuration. A public release must use HTTPS and an appropriately secured backend.

## 8. Monetization and sharing

The intended product model is:

- Free to use
- No advertisements
- No subscription fees
- No sale or licensing of review data or analysis results
- No direct revenue generated from review data

The product sends eligible review content to a third-party AI provider (Gemini) for its core analysis function. This transfer must be clearly disclosed to users and assessed against applicable provider terms and platform policies. A free, ad-free model does not itself establish rights to collect, process, transmit, or create derived works from third-party content.

## 9. User disclosure and consent requirements before release

Before public distribution, provide a clear and accessible disclosure explaining, at minimum:

1. What review fields are collected.
2. That collection starts when the user initiates analysis.
3. That review content is sent to the service backend.
4. That eligible review text, rating, and review ID are sent to Gemini for analysis.
5. What analysis results are cached, where, and for how long at the application level.
6. Whether any operational logs or backups may retain information and their retention periods.
7. How users can contact the operator and request support or data deletion, where applicable.
8. The applicable privacy policy and terms.

The disclosure must accurately reflect the deployed architecture, provider settings, and actual operational retention—not just the source-code behavior described here.

## 10. Unresolved compliance and operational questions

The following are not answered by the inspected code:

- Whether Google authorizes this collection method and the creation/display of review-derived analysis for general users and arbitrary businesses.
- Whether review identifiers and original review text may be transmitted to Gemini and displayed again as evidence.
- Which Gemini API terms, data-use settings, and retention rules apply to the actual project account and selected service tier.
- Whether backend hosting, database, logs, backups, and monitoring introduce additional processors or retention.
- Whether the planned Chrome Web Store disclosures and Limited Use declarations fully describe all data collection and third-party transfers.
- Whether the final production deployment has suitable access controls, rate limits, abuse prevention, deletion procedures, and incident response.

## 11. Release gate

**Do not publicly launch or submit the extension to the Chrome Web Store until:**

- Google Maps content-use authorization has been clarified through reliable written guidance and/or legal review.
- Gemini API terms and account data-use settings have been verified.
- Production data flows, processors, logs, storage, backups, and retention have been documented.
- Full-review console logging has been removed.
- The privacy policy, in-product disclosure, and Chrome Web Store privacy declarations match the actual production behavior.
- Production API transport and security controls are in place.

---

## Implementation references reviewed

The following files on the `master` branch were inspected for this draft:

- `extension/manifest.json`
- `extension/src/App.tsx`
- `extension/src/api.ts`
- `extension/src/content.ts`
- `extension/src/types.ts`
- `backend/app/main.py`
- `backend/app/core/schemas.py`
- `backend/app/cache.py`
- `backend/app/services/llm_absa.py`
- `backend/app/services/review_selection.py`

This inventory should be updated whenever collection, transmission, storage, provider, or deployment behavior changes.
