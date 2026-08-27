# UI/UX Guidelines

## 1. Design principle

FlyEye uses **workflow-first, safety-aware design**. The interface should make controlled work easy to complete correctly, show who is responsible for the next action, preserve source context, and make exceptional states visible. A polished dashboard is secondary to an understandable end-to-end workflow.

## 2. Device strategy

- Desktop/laptop: administration, dispatch desk, reports, configuration, audit review.
- Tablet: instructor review and assessment, dispatch preparation.
- Phone: student drafts, notifications, personal progress, instructor quick entries.
- PWA: installable shell and limited offline drafts; never imply offline approval authority.

## 3. Navigation

Use role-sensitive navigation, but never rely on it for authorization. Candidate areas: Home, Dispatch, Training, Aircraft, People, Documents, Reports, Audit, Administration. Show only relevant modules while allowing a clear access-denied state for direct URLs.

## 4. Reusable design system

Use the tokens, application-shell patterns, and component presentation in the [Visual Design System](DESIGN.md). Product components enforce FlyEye semantics, accessibility, error behavior, status vocabulary, and visual consistency. Any foundational component or icon library requires the normal dependency review; this guideline does not select one.

## 5. Form behavior

- Break long forms into named sections with a progress/summary view.
- Clearly distinguish required, optional, unavailable, and read-only values.
- Validate on appropriate interaction without overwhelming users.
- Preserve entered data when validation fails.
- Provide a top validation summary linked to individual fields.
- Explain corrective action in plain language.
- Autosave only drafts and show last-saved/sync status.
- Never silently change a user-entered or approved value.

## 6. Status and state transitions

Use plain labels and consistent colors/icons, but never color alone. Show current state, previous action, actor/time, permitted next actions, and why an action is unavailable. Destructive or authority-bearing actions require clear confirmation; high-risk actions may require reauthentication and a reason.

## 7. Source and freshness

Weather, NOTAM, aircraft documents, qualifications, aircraft configuration, and AI summaries show source, timestamp/effective period, freshness, and access to original information. Stale or unavailable information must not look current.

## 8. AI interaction

AI output is visibly labelled “suggested,” separated from original user/source text, editable, rejectable, and never pre-approved. Show relevant source excerpts or links where permitted, limitations, and an explicit accept/save step. The user can continue without AI.

## 9. Offline interaction

Display a persistent offline indicator and per-record states: local draft, queued, syncing, failed, conflict, synced. Actions requiring current server information are disabled with a reason. Do not show a final/approved appearance for locally stored drafts.

## 10. Accessibility

Target WCAG 2.2 AA review. Use semantic HTML, labelled inputs, keyboard navigation, visible focus, sufficient contrast, accessible dialogs/tables, text alternatives, predictable focus after errors, and announcements for dynamic status. Test with keyboard and screen-reader workflows, not automated checks alone.

## 11. Critical prototype scenarios

Test unassisted completion of:

1. Administrator invites an instructor.
2. Student creates and saves a dispatch draft.
3. Student corrects a server validation error.
4. Instructor returns a submitted record with a reason.
5. Student resubmits the preserved revision.
6. Dispatcher checks document validity and source freshness.
7. Instructor completes and finalizes an assessment.
8. Head of Training finds a repeated competency concern.
9. Quality user retrieves audit evidence.
10. User reconnects and resolves an offline draft conflict.

Prototype Gate 3 target: at least 85% critical-task success; before commercial release target: at least 95%, with no unresolved critical usability issue.

## 12. Content style

Use Philippine flight-school terminology validated by users. FlyEye's voice is professional, calm, direct, and respectful. Keep messages concise, actionable, non-accusatory, and free of raw technical errors, unexplained regulatory claims, conversational filler, jokes, or self-congratulatory language.

- Use sentence case and specific verb-plus-object actions such as “Save draft,” “Submit for review,” and “Confirm role change.” Avoid vague labels such as “Yes,” “Proceed,” or “Do it” when the action can be named.
- State what happened without a standalone “Success!” heading or an exclamation mark. Include the record, new state, and next owner/action when applicable.
- Explain errors in this order: what could not be completed, whether the user's work is preserved, and what to do next. Avoid “Oops,” “Something went wrong,” or blame-oriented wording.
- State permission and protected-action denials plainly without exposing restricted details.
- Use plain international English and avoid idioms. Follow the active [product-language scope](17_PRODUCT_AND_GOVERNANCE_DECISIONS.md#product-and-commercial-direction).

Examples:

| Situation | Preferred | Avoid |
|---|---|---|
| Saved draft | “Draft saved.” | “Awesome! Your data is safe!” |
| Empty filtered list | “No members match these filters.” | “Nothing to see here.” |
| Preserved error | “We couldn't save this change. Your entries are still here. Try again.” | “Oops! Something went wrong.” |
| Permission denial | “You don't have permission to change this role.” | “Access forbidden.” |
| Protected continuation | “Enter the code from your authenticator app to continue.” | “Verify now.” |

## 13. Responsive tables and reports

On small screens, convert dense rows to cards or prioritized columns; do not force users to decipher tiny tables. Preserve search/filter state. Exports are an explicit permissioned action, not a workaround for poor on-screen access.

## 14. UX evidence

For each critical feature retain the user flow, prototype/version, participants/roles, task script, success/error observations, decisions, and before/after screenshots where authorized. Link findings to feature specifications and the [QA Plan](11_QA_TEST_PLAN.md).
