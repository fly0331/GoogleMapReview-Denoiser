# Google Maps Review Denoiser — Google Permission Inquiry

- **Document status:** Draft for legal/compliance review; not yet sent
- **Product:** Google Maps Review Denoiser
- **Format:** Chrome Extension
- **Purpose:** Request clarification on permitted use of Google Maps user reviews

## 1. Important sending note

This draft is a request for policy clarification, not an assumption that Google offers an exception or that a support response will grant permission. Before sending, identify the appropriate official Google channel and consider review by qualified counsel. Do not include API keys, user review samples, personal data, or confidential credentials.

## 2. Draft email

**Subject:** Request for clarification on a free Chrome extension that analyzes Google Maps reviews

Hello Google Maps / Google Legal or Policy Team,

I am an independent developer working on a free Chrome Extension called **Google Maps Review Denoiser**. I am seeking written clarification about whether the product concept and its proposed data handling are permitted under the applicable Google Maps terms and policies.

The extension is intended for general users who want to better understand customer feedback about a business they are viewing on Google Maps.

### How the extension works

1. A user opens a business/place page on Google Maps.
2. The user explicitly clicks an analysis button in the Chrome Extension.
3. The extension reads review information rendered in the currently open page. The current prototype collects up to 50 reviews and extracts the review identifier, star rating, review text, relative time, and the review author's displayed review count when available.
4. The extension sends the collected fields, together with the place identifier and collection timestamp, to a backend service operated for the extension.
5. The backend filters potentially promotional or suspicious reviews, calculates review trends, and sends eligible review identifiers, ratings, and review text to the Gemini API for aspect-based sentiment analysis.
6. The extension displays aggregate trends, positive and negative themes, aspect scores, and links from the analysis back to supporting review text.

The extension does not currently use the Google Maps Platform Places API to obtain these reviews. It reads review information rendered in the user's browser session. The collection is initiated by an explicit user action; the prototype does not continuously collect reviews in the background.

### Business model and data handling

The intended product is completely free. It has no advertisements, subscriptions, paid tiers, or sale/licensing of review data or analysis results. The developer does not intend to monetize the review content.

The current prototype uses a backend SQLite cache with a seven-day application-level TTL. The cache stores the place identifier, a request fingerprint, and the derived analysis response; the response schema does not contain the original review text. Original review text is processed in memory by the backend and is sent to Gemini for eligible reviews. The production architecture, provider settings, logging, and retention controls will be finalized only after the applicable requirements are understood.

### Questions

Could you please clarify the following:

1. Do the applicable Google Maps terms and policies permit a user-triggered Chrome Extension to read review content rendered on a Google Maps page for the purpose described above?
2. Do those terms permit transmitting the review identifiers, ratings, and review text to the extension operator's backend for processing?
3. Do they permit sending eligible review identifiers, ratings, and review text to a third-party AI provider (Google Gemini) to generate sentiment summaries and aspect scores?
4. Do they permit displaying derived outputs such as monthly review trends, positive/negative themes, aspect scores, and evidence links that show the supporting review text?
5. Are there specific restrictions on caching, retention, displaying, or deleting the source review content and derived analysis in this use case?
6. Is there an official policy, review process, license, or other authorization path that applies to this type of product? If this use case is not permitted, could you point me to the relevant policy provisions and any compliant alternative?

I understand that the product must comply with applicable Google terms, third-party rights, Chrome Web Store policies, and Gemini API terms. I am seeking clarification before making the extension publicly available and will not treat this inquiry as authorization unless Google explicitly confirms the relevant permitted use in writing.

Thank you for your time and guidance.

Best regards,

[Developer name]  
[Contact email]  
[Extension or project URL, if appropriate]

---

## 3. Details to confirm before sending

- Developer's legal name or preferred sender name.
- Contact email address.
- Public project or demo URL, if one exists and is safe to share.
- Exact current and planned production data flow.
- Actual Gemini API product, account tier, data-use settings, and applicable terms.
- Intended countries/regions of distribution.
- Whether any third-party hosting, logging, monitoring, or analytics providers will process data.

## 4. Guidance for interpreting a response

- A generic support response or link to public terms is not necessarily a grant of permission.
- A response about Google Maps Platform API usage may not directly answer whether browser-based extraction from Google Maps pages is permitted.
- Ask for clarification on each activity separately: collection, backend transfer, Gemini transfer, caching, derived analysis, and evidence display.
- Preserve the complete response and the policy version/date it references.
- If the response is ambiguous, do not infer approval; seek a more specific answer or legal advice.
