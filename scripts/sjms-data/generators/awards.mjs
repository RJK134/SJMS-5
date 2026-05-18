/**
 * awards generator (D8)
 *
 * Graduation chain for the 12k alumni emitted in D6, plus the document
 * family used across student-facing artefacts (transcripts, certificates,
 * CAS letters, offer letters).
 *
 * Volumes:
 *   GraduationCohort              ~5 (per AY 2020/21–2024/25)
 *   GraduationCeremony            ~5 (one per AY)
 *   GraduationRegistration       ~12,000 (alumni)
 *   GraduandRecord              ~12,000
 *   DegreeAward                  ~12,000
 *   Transcript                   ~12,000 (full transcript per alumnus)
 *   Certificate                  ~12,000
 *   Document                    ~25,000 (~2 per alumnus + offer letters)
 *   DocumentGeneration           ~25,000
 *   GeneratedDocument            ~25,000
 *   BatchDocumentGeneration      ~30 (5 cohorts × 6 batches)
 *   DocumentPermission           ~50,000 (~2 per document for student + admin)
 *   DocumentSharePointMapping     ~5,000 (sample subset SharePoint-synced)
 *   SharePointGroupMapping          ~50 (role → SharePoint group)
 *   PermissionSyncLog             ~500
 */

import { modelsByDomain } from '../lib/domain-map.mjs';
import { ACADEMIC_YEARS, ayEndDate } from '../lib/academic-calendar.mjs';

export const domain = 'awards';

const CLASSIFICATION_DISTRIBUTION = [
  ['FIRST', 25], ['UPPER_SECOND', 50], ['LOWER_SECOND', 20], ['THIRD', 4], ['PASS', 1],
];

const BATCH = 5000;
const flush = (ctx, model, batch) => { if (batch.length) { ctx.append(model, batch); batch.length = 0; } };

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  const now = new Date('2026-05-17T08:00:00Z').toISOString();
  const audit = ctx.audit(now);
  const rng = ctx.rng.fork('awards');

  const cohortRows = [];
  const ceremonyRows = [];
  const alumniByCohort = new Map();   // cohortId → [studentIds...]
  const cohortIdByAyLabel = new Map();

  // 1. GraduationCohort + GraduationCeremony per AY 2020/21 .. 2024/25
  for (const ayLabel of ACADEMIC_YEARS.slice(0, 5)) {
    const id = `gcoh-${ayLabel.replace('/', '')}`;
    const cdate = ayEndDate(ayLabel);
    cohortIdByAyLabel.set(ayLabel, id);
    alumniByCohort.set(id, []);
    cohortRows.push({
      id, ...audit,
      name: `Graduation Cohort ${ayLabel}`,
      academicYear: ayLabel,
      ceremonyDate: cdate + 'T14:00:00Z',
      ceremonyLocation: 'Future Horizons Cathedral',
    });
    ceremonyRows.push({
      id: `gcer-${ayLabel.replace('/', '')}`, createdAt: now, updatedAt: now, deletedAt: null,
      name: `Graduation Ceremony ${ayLabel}`,
      date: cdate + 'T14:00:00Z',
      venue: 'Future Horizons Cathedral',
      maxCapacity: 1500, guestAllocation: 4,
      academicYear: ayLabel, status: 'COMPLETED',
      notes: null, orderOfEvents: 'Procession – Welcome – Presentation – Address – Recession',
    });
  }
  ctx.append('GraduationCohort', cohortRows);
  ctx.append('GraduationCeremony', ceremonyRows);

  // 2. Distribute alumni across cohorts (alumni are tagged isAlumni in studentIds)
  const alumni = ctx.ids.studentIds.filter(s => s.isAlumni);
  alumni.forEach((stu, i) => {
    const cohortKey = ACADEMIC_YEARS.slice(0, 5)[i % 5];
    const cohortId = cohortIdByAyLabel.get(cohortKey);
    alumniByCohort.get(cohortId).push(stu);
  });

  // 3. GraduationRegistration + GraduandRecord + DegreeAward + Transcript + Certificate per alumnus
  let regBatch = [], grandBatch = [], awardBatch = [], transcriptBatch = [], certBatch = [];
  let docBatch = [], docGenBatch = [], genDocBatch = [], docPermBatch = [];
  let docSPBatch = [], docSeq = 0;

  for (const [cohortId, list] of alumniByCohort) {
    const ayLabel = [...cohortIdByAyLabel.entries()].find(([, v]) => v === cohortId)[0];
    const ceremonyDate = ayEndDate(ayLabel);
    for (const stu of list) {
      const classification = rng.weighted(CLASSIFICATION_DISTRIBUTION);
      const grandId = `grand-${stu.id.slice(4)}`;
      const awardId = `award-${stu.id.slice(4)}`;
      const programmeId = stu.programmeId;
      const programme = ctx.ids.programmeIds.find(p => p.id === programmeId);

      regBatch.push({
        id: `greg-${stu.id.slice(4)}`, ...audit,
        cohortId, studentId: stu.id,
        registrationDate: ceremonyDate + 'T00:00:00Z',
        ceremonyAttendance: rng.weighted([['ATTENDING', 75], ['NOT_ATTENDING', 15], ['VIRTUAL', 10]]),
      });
      grandBatch.push({
        id: grandId, ...audit,
        cohortId, studentId: stu.id, classification,
        graduationDate: ceremonyDate + 'T00:00:00Z',
        ceremonyDate: ceremonyDate + 'T14:00:00Z',
        diplomaSent: true,
      });
      awardBatch.push({
        id: awardId, ...audit,
        graduandId: grandId,
        awardDate: ceremonyDate + 'T00:00:00Z',
        awardingBody: 'Future Horizons University',
        qualificationName: programme?.name ?? 'BSc Degree',
        classification, honours: classification !== 'FAIL' ? 'WITH_HONOURS' : null,
      });
      transcriptBatch.push({
        id: `tran-${stu.id.slice(4)}`, ...audit,
        studentId: stu.id,
        generatedDate: ceremonyDate + 'T00:00:00Z',
        academicYearFrom: ACADEMIC_YEARS[0],
        academicYearTo: ayLabel,
        fileName: `transcript-${stu.id.slice(4)}.pdf`,
        fileUrl: `minio://documents/transcripts/${stu.id.slice(4)}.pdf`,
        requestedBy: 'graduand', purpose: 'EMPLOYMENT',
        transcriptType: 'FULL', format: 'PDF', language: 'EN',
        certifiedAt: ceremonyDate + 'T00:00:00Z',
        certifiedBy: 'registrar@fhe.ac.uk',
      });
      certBatch.push({
        id: `cert-${stu.id.slice(4)}`, ...audit,
        graduandId: grandId, certificateType: 'DEGREE_CERTIFICATE',
        issuedDate: ceremonyDate + 'T00:00:00Z',
        fileName: `certificate-${stu.id.slice(4)}.pdf`,
        fileUrl: `minio://documents/certificates/${stu.id.slice(4)}.pdf`,
        serialNumber: `FHU-${ayLabel.replace('/', '')}-${stu.id.slice(-6)}`,
      });

      // Document records for the transcript + certificate
      for (const docKind of [
        { type: 'TRANSCRIPT', file: `transcript-${stu.id.slice(4)}.pdf` },
        { type: 'CERTIFICATE', file: `certificate-${stu.id.slice(4)}.pdf` },
      ]) {
        docSeq += 1;
        const docId = `doc-${docSeq.toString().padStart(7, '0')}`;
        docBatch.push({
          id: docId, ...audit,
          studentId: stu.id, documentType: docKind.type,
          fileName: docKind.file,
          fileUrl: `minio://documents/${docKind.type.toLowerCase()}/${docKind.file}`,
          fileSize: 250_000, mimeType: 'application/pdf',
          uploadedDate: ceremonyDate + 'T00:00:00Z', expiryDate: null,
          sensitivity: 'CONFIDENTIAL',
          ownerDepartmentId: programme?.departmentId ?? null,
          ownerFacultyId: programme?.facultyId ?? null,
          ownerProgrammeId: programmeId ?? null,
          restrictedToRoles: '["STUDENT", "REGISTRAR"]',
        });
        docGenBatch.push({
          id: `dg-${docSeq.toString().padStart(7, '0')}`, ...audit,
          templateId: docKind.type === 'TRANSCRIPT' ? 'doctpl-transcript' : 'doctpl-certificate',
          studentId: stu.id, generatedBy: 'graduation-batch',
          variables: JSON.stringify({ student: stu.id, classification }),
          outputFormat: 'PDF',
          outputPath: `minio://documents/${docKind.type.toLowerCase()}/${docKind.file}`,
          generatedAt: ceremonyDate + 'T00:00:00Z',
          sentTo: 'graduand@fhe.ac.uk',
        });
        genDocBatch.push({
          id: `gd-${docSeq.toString().padStart(7, '0')}`, ...audit,
          generationId: `dg-${docSeq.toString().padStart(7, '0')}`,
          studentId: stu.id, fileName: docKind.file,
          mimeType: 'application/pdf', fileSize: 250_000,
          storagePath: `minio://documents/${docKind.type.toLowerCase()}/${docKind.file}`,
        });
        docPermBatch.push({
          id: `dp-${docSeq.toString().padStart(7, '0')}-stu`, ...audit,
          documentId: docId, granteeType: 'STUDENT', granteeId: stu.id,
          accessLevel: 'READ', grantedVia: 'OWNERSHIP',
          expiresAt: null, revokedAt: null, revokedBy: null,
        });
      }

      if (regBatch.length >= BATCH) {
        flush(ctx, 'GraduationRegistration', regBatch);
        flush(ctx, 'GraduandRecord', grandBatch);
        flush(ctx, 'DegreeAward', awardBatch);
        flush(ctx, 'Transcript', transcriptBatch);
        flush(ctx, 'Certificate', certBatch);
        flush(ctx, 'Document', docBatch);
        flush(ctx, 'DocumentGeneration', docGenBatch);
        flush(ctx, 'GeneratedDocument', genDocBatch);
        flush(ctx, 'DocumentPermission', docPermBatch);
      }
    }
  }
  flush(ctx, 'GraduationRegistration', regBatch);
  flush(ctx, 'GraduandRecord', grandBatch);
  flush(ctx, 'DegreeAward', awardBatch);
  flush(ctx, 'Transcript', transcriptBatch);
  flush(ctx, 'Certificate', certBatch);
  flush(ctx, 'Document', docBatch);
  flush(ctx, 'DocumentGeneration', docGenBatch);
  flush(ctx, 'GeneratedDocument', genDocBatch);
  flush(ctx, 'DocumentPermission', docPermBatch);

  // 4. BatchDocumentGeneration — per cohort
  ctx.append('BatchDocumentGeneration', [...cohortIdByAyLabel.entries()].flatMap(([ay, cohortId]) =>
    ['TRANSCRIPT', 'CERTIFICATE', 'CAS_LETTER'].map((templateType, i) => ({
      id: `bdg-${cohortId.slice(5)}-${templateType.toLowerCase()}`, ...audit,
      templateId: `doctpl-${templateType.toLowerCase()}`,
      studentIds: '[]',
      status: 'COMPLETED',
      generatedCount: alumniByCohort.get(cohortId).length,
      failedCount: 0,
      startedAt: ayEndDate(ay) + 'T08:00:00Z',
      completedAt: ayEndDate(ay) + 'T12:00:00Z',
    }))));

  // 5. DocumentSharePointMapping — sample 5,000 documents synced to SharePoint
  ctx.append('DocumentSharePointMapping', Array.from({ length: 5000 }, (_, i) => ({
    id: `dsp-${(i + 1).toString().padStart(5, '0')}`,
    createdAt: now, updatedAt: now,
    documentId: `doc-${(i + 1).toString().padStart(7, '0')}`,
    sharepointSiteId: 'site-fhu-academic-records',
    sharepointDriveId: 'drive-graduation',
    sharepointItemId: `item-${i + 1}`,
    sharepointWebUrl: `https://futurehorizons.sharepoint.com/sites/academic-records/Documents/${i + 1}`,
    sharepointFolderId: 'folder-2025-graduation',
    lastPermSyncAt: now, permSyncStatus: 'SYNCED', syncErrorMessage: null,
  })));

  // 6. SharePointGroupMapping (~30 rows — one per role × scope)
  ctx.append('SharePointGroupMapping', [
    'REGISTRAR', 'PROFESSOR', 'LECTURER', 'STUDENT', 'ALUMNUS', 'EXTERNAL_EXAMINER',
  ].flatMap((role, i) => ['TENANT', 'FACULTY', 'DEPARTMENT', 'PROGRAMME', 'MODULE'].map((scope, j) => ({
    id: `spgm-${role.toLowerCase()}-${scope.toLowerCase()}`,
    createdAt: now, updatedAt: now, createdBy: ctx.seedActor, updatedBy: ctx.seedActor,
    sjmsRoleName: role, sjmsScope: scope, sjmsScopeId: 'tenant-fhe-001',
    sharepointGroupId: `sp-grp-${role.toLowerCase()}-${scope.toLowerCase()}`,
    sharepointGroupName: `${role} (${scope})`,
    libraryAccess: 'READ', isActive: true,
  }))));

  // 7. PermissionSyncLog — sample 500 sync events
  ctx.append('PermissionSyncLog', Array.from({ length: 500 }, (_, i) => ({
    id: `psl-${(i + 1).toString().padStart(4, '0')}`,
    createdAt: new Date(Date.UTC(2025, 9, 1 + (i % 28))).toISOString(),
    syncType: 'INCREMENTAL', triggerEvent: 'DOCUMENT_GENERATED',
    entityType: 'Document', entityId: `doc-${i + 1}`,
    operationType: 'GRANT', affectedDocs: 1, affectedUsers: 1,
    status: 'SUCCESS', errorDetails: null, durationMs: rng.int(50, 500),
  })));

  ctx.log(domain,
    `${cohortRows.length} cohorts, ${alumni.length} alumni → graduation, ${docSeq.toLocaleString()} documents`);
}
