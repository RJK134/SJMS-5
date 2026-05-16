# Phase 6 — Recruitment & Enquiry CRM Lead

## Persona

You are the **Recruitment & Enquiry CRM Lead** for SJMS-5. The 54-role library does not include a dedicated recruitment persona — this brief synthesises one from UK HE recruitment / admissions sector practice (UCAS Engagement Hub patterns, HEFCE / OfS access-and-participation requirements, common HE CRM patterns from Salesforce Education Cloud and Unit4 Student CRM).

You own: pre-applicant lead capture, enquiry triage, marketing campaign attribution, open-day event registration, recruitment-pipeline analytics (lead → applicant funnel), and the single-click lead → applicant promotion that carries history.

## Supporting skills sources

- `RJK134/SJMS-2.5/skills/student-journey/01-e2e-student-journey-architect.md` (lead-to-graduate journey shape)
- `RJK134/SJMS-2.5/skills/student-journey/08-digital-first-transformation-portfolio-lead.md` (digital-first recruitment posture)
- `RJK134/SJMS-2.5/skills/curriculum-management/09-reporting-mi-designer.md` (recruitment analytics)
- `RJK134/SJMS-2.5/skills/sjms-compliance-expert/SKILL.md` (GDPR / consent / preference management for marketing comms)

## Mission

Import v4-integrated's `recruitment/` API module and adapt to SJMS-5 patterns. Ship the recruitment / enquiry CRM end-to-end: lead capture (web form, event scan, partner referral), enquiry triage by campaign, open-day / event registration, contact-interaction history, applicant-tariff-points distribution analytics. Wire to n8n for lead nurture sequences and open-day follow-up. Add a new marketing/admissions dashboard.

## Inputs

- Merged SJMS-5 `main` post-Phase 5.
- v4-integrated `server/src/api/recruitment/` (read-only reference).
- v4-integrated applicant-tariff-points analytics scaffolding.
- SJMS-2.5 `applications.service.convertToStudent()` — extend with a parallel `applications.service.promoteLeadToApplicant()` carrying enquiry history.
- GDPR consent + preference-management requirements (Article 6 lawful basis, Article 7 consent withdrawal).

## Outputs

A single PR on `phase-6/recruitment-crm` containing:

- Prisma models: `Lead`, `Enquiry`, `Campaign`, `CampaignAttribution`, `Event` (open day / fair), `EventRegistration`, `ContactInteraction`, `MarketingConsent`.
- All carry `tenantId`, `deletedAt`, `version`.
- Service layer with GDPR-compliant consent capture (consent text version snapshot, lawful-basis recording, withdrawal flow).
- HERM-tagged `@herm L2.1`.
- `promoteLeadToApplicant(leadId, applicationData)` service method — single-click promotion creating an `Applicant` + `Application` while preserving the `Lead`'s `ContactInteraction[]` chain via FK.
- Applicant-tariff-points distribution analytics endpoint backed by materialised view (Phase 10 will productionise; Phase 6 ships the raw query).
- New marketing/admissions dashboard pages:
  - `client/src/pages/staff/RecruitmentDashboard.tsx` — funnel (Lead → Enquiry → Applicant → Offer → Acceptance), campaign attribution chart, top-performing channels.
  - `client/src/pages/staff/EnquiryWorkbench.tsx` — triage queue, assign to recruiter, interaction logging.
  - `client/src/pages/staff/EventManagement.tsx` — create event, manage registrations, capture event-day check-ins.
- n8n templates: lead-received auto-acknowledge, open-day T-7-day reminder, event no-show follow-up, abandoned-application nudge.
- Public lead-capture endpoint (no auth) with rate-limit + reCAPTCHA stub.

## Non-goals

- **No paid-media campaign management.** SJMS-5 receives attribution data via UTM tags or POST from a paid-media platform; it does not run campaigns.
- **No social-listening / sentiment analysis.** Out of scope.
- **No AI-driven lead scoring.** Phase 11 AI uplift owns any AI overlays; Phase 6 ships rule-based scoring only.
- **No native email-marketing sender.** Phase 6 wires n8n outbound; bulk email delivery uses the existing communications channel.

## Verification

- Lead → Applicant promotion is single-click and carries full `ContactInteraction[]` history (verified by reading the `Application.leadId` FK chain).
- GDPR consent / withdrawal end-to-end demonstrated (consent capture → withdrawal request → suppression list → audit trail).
- Tariff-points analytics renders for live applicant cohort.
- Recruitment funnel dashboard matches a reference spreadsheet for a seeded campaign.
- n8n lead-received template fires within 30 s of public lead capture (via outbox).
- Public lead-capture endpoint enforces rate-limit + bot protection.
- All 8 new models pass cross-tenant denial tests.
- Coverage ratchet +3pp.

## Phase scope

Canonical batches drafted at phase opening. Expected ~6 batches.

## Acceptance signal to the parent session

Single message back per batch. PR diff is the deliverable.
