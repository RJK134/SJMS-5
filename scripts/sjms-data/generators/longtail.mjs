/**
 * longtail generator
 *
 * D1: empty CSVs for all 92 long-tail models.
 * D10: welfare (SupportTicket, MisconductCase, DisabilityAdjustment, WellbeingRecord,
 *      WelfareReferral, CounsellingRecord), placements (StudentPlacement, PlacementVisit,
 *      CareerEvent, GraduateOutcome + DLHE/GOS metrics, AlumniRecord + AlumniDonation),
 *      pgr (PgrRegistration, PgrSupervisor, PgrMilestone, PgrAnnualReview, PgrVivaRecord,
 *      PgrThesis), comms (StudentCommunication, Notification, NotificationPreference),
 *      research (RefSubmission/Output/ImpactCase/EnvironmentStatement/StaffReturn,
 *      KefMetric/Narrative/Perspective/DashboardSummary), regulatory (HesaReturn +
 *      HesaLearner + the full HESA submission snapshot tree, OfsCondition, TefMetric,
 *      VisaRecord, UkviReport, CasRecord, StatutoryReturn, DataQuality* + DataChangeLog),
 *      gdpr-audit (RetentionPolicy, DataSubjectRequest, DisclosureRecord, BreachIncident,
 *      ReportDefinition/Instance), misc (Survey*, SelfServiceRequest, WebhookSubscription,
 *      *WorkflowError, InterfaceLog), timetabling (RoomBooking, TimetableSlot,
 *      TimetableEvent), accommodation-booking (AccommodationBooking, AccommodationPreference),
 *      ai (AiConversation, AiIndexedDocument, AiDocumentChunk), vle (MoodleIntegrationMap,
 *      MoodleSyncLog).
 *
 * Will eventually split into per-sub-domain files; kept as one for D1 brevity.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';

export const domain = 'longtail';

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  ctx.log(domain, `${models.length} models declared (D1 stub — replaced in later phase)`);
}
