export type GradeLevel = 7 | 8 | 9;

export type RankNumber = 1 | 2 | 3 | 4;

export type StarPoints = 4 | 3 | 2 | 1;

export interface ClassDefinition {
  className: string;
  grade: GradeLevel;
  label: string;
}

export type PhotoKind = 'artwork' | 'group';

export interface ArtworkMetadataOverride {
  photoUrl?: string | null;
  photoUpdatedAt?: string | null;
  originalFileName?: string | null;
  originalFileSize?: number | null;
  originalMimeType?: string | null;
  driveFileId?: string | null;
  driveWebViewLink?: string | null;
  driveSyncedAt?: string | null;
  groupPhotoUrl?: string | null;
  groupPhotoUpdatedAt?: string | null;
  groupOriginalFileName?: string | null;
  groupOriginalFileSize?: number | null;
  groupOriginalMimeType?: string | null;
  groupDriveFileId?: string | null;
  groupDriveWebViewLink?: string | null;
  groupDriveSyncedAt?: string | null;
  memberNames?: string;
  artworkTitle?: string;
  technique?: string;
  leaves?: string;
  fabric?: string;
  mordant?: string;
  description?: string;
  metadataUpdatedAt?: string | null;
}

export type DriveOpenAccessStatus =
  | 'anyone-writer'
  | 'anyone-reader'
  | 'restricted'
  | 'unknown';

export interface DriveArchiveConfig {
  driveFolderId: string | null;
  driveFolderUrl: string | null;
  driveOwnerEmail: string | null;
  driveOpenAccessStatus?: DriveOpenAccessStatus | null;
  classFolderIds?: Record<string, string>;
  manifestFileId: string | null;
  csvFileId?: string | null;
  driveWebhookUrl?: string | null;
  lastSyncedAt: string | null;
}

export interface ArtworkGroup {
  groupId: string;
  className: string;
  grade: GradeLevel;
  groupNumber: number;
  memberNames: string;
  artworkTitle: string;
  technique: string;
  leaves: string;
  fabric: string;
  mordant: string;
  description: string;
  photoUrl: string | null;
  photoUpdatedAt: string | null;
  originalFileName: string | null;
  originalFileSize: number | null;
  originalMimeType: string | null;
  driveFileId: string | null;
  driveWebViewLink: string | null;
  driveSyncedAt: string | null;
  groupPhotoUrl: string | null;
  groupPhotoUpdatedAt: string | null;
  groupOriginalFileName: string | null;
  groupOriginalFileSize: number | null;
  groupOriginalMimeType: string | null;
  groupDriveFileId: string | null;
  groupDriveWebViewLink: string | null;
  groupDriveSyncedAt: string | null;
}

export interface GroupPasswordItem {
  groupId: string;
  className: string;
  grade: GradeLevel;
  groupNumber: number;
  password: string;
}

export interface RankedVoteInput {
  artworkGroupId: string;
  rank: RankNumber;
}

export interface RankedVote extends RankedVoteInput {
  stars: StarPoints;
  points: StarPoints;
  artworkClassName: string;
  artworkGrade: GradeLevel;
}

export interface AssessmentSubmission {
  evaluatorGroupId: string;
  evaluatorClassName: string;
  evaluatorGrade: GradeLevel;
  votes: RankedVote[];
  submittedAt: string;
  locked: true;
  isDemoSeed?: boolean;
}

export interface ArtworkScoreRow {
  artwork: ArtworkGroup;
  totalPoints: number;
  pointsFromGrade7: number;
  pointsFromGrade8: number;
  pointsFromGrade9: number;
  votesCount: number;
  rank1Count: number; // 4 stars
  rank2Count: number; // 3 stars
  rank3Count: number; // 2 stars
  rank4Count: number; // 1 star
  gradeRank: number;
  isTop2Winner: boolean;
}

export interface GradeRecapitulation {
  grade: GradeLevel;
  title: string;
  classesLabel: string;
  classes: string[];
  rows: ArtworkScoreRow[];
  top2Winners: ArtworkScoreRow[];
}

export interface RecapitulationSummary {
  totalGroups: number;
  submittedGroupsCount: number;
  uploadedPhotosCount: number;
  uploadedGroupPhotosCount: number;
  driveSyncedCount: number;
  totalVotesCast: number;
  totalPointsDistributed: number;
  byGrade: Record<GradeLevel, GradeRecapitulation>;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  code?:
    | 'INVALID_EVALUATOR'
    | 'ALREADY_LOCKED'
    | 'INCOMPLETE_COUNT'
    | 'INVALID_ARTWORK'
    | 'SAME_CLASS_FORBIDDEN'
    | 'DUPLICATE_ARTWORK'
    | 'INVALID_RANK'
    | 'DUPLICATE_RANK';
}

export const GRADE_CLASSES: Record<GradeLevel, string[]> = {
  7: ['71', '72', '73'],
  8: ['81', '82', '83', '84', '85'],
  9: ['91', '92', '93', '94', '95'],
};

export const ALL_CLASSES: ClassDefinition[] = [
  ...GRADE_CLASSES[7].map((c) => ({ className: c, grade: 7 as GradeLevel, label: `Kelas ${c}` })),
  ...GRADE_CLASSES[8].map((c) => ({ className: c, grade: 8 as GradeLevel, label: `Kelas ${c}` })),
  ...GRADE_CLASSES[9].map((c) => ({ className: c, grade: 9 as GradeLevel, label: `Kelas ${c}` })),
];

export const RANK_CONFIG: ReadonlyArray<{
  rank: RankNumber;
  stars: StarPoints;
  label: string;
  shortLabel: string;
}> = [
  { rank: 1, stars: 4, label: '★★★★', shortLabel: '★★★★' },
  { rank: 2, stars: 3, label: '★★★', shortLabel: '★★★' },
  { rank: 3, stars: 2, label: '★★', shortLabel: '★★' },
  { rank: 4, stars: 1, label: '★', shortLabel: '★' },
];

export function rankToStars(rank: RankNumber): StarPoints {
  switch (rank) {
    case 1:
      return 4;
    case 2:
      return 3;
    case 3:
      return 2;
    case 4:
      return 1;
  }
}

const ARTWORK_TITLES = [
  'Jejak Jati Senja',
  'Simfoni Pakis & Kenikir',
  'Pelangi Tanin Eucalyptus',
  'Siluet Besi Daun Lanang',
  'Rona Ketapang Nusantara',
  'Harmoni Jarak & Tunjung',
  'Lembayung Jati Pesisir',
  'Kanvas Hutan Tropis',
  'Mozaik Daun Pepaya',
  'Embrio Serat Alam',
  'Pijar Okra di Linen',
  'Gema Hutan Hujan',
  'Kala Daun Gugur',
  'Tinta Bumi & Tawas',
  'Garis Urat Jati Tua',
  'Cahaya Pagi Eucalyptus',
  'Taman Kenikir Simetris',
  'Bara Tanin Ketapang',
  'Senandung Pakis Hijau',
  'Batu Tulis Iron Blanket',
  'Aroma Kukus Rimba',
  'Serat Sutra Daun Lanang',
  'Tarian Klorofil & Besi',
  'Puspa Latar Blacu',
  'Ombak Daun Kersen',
  'Kepingan Flora Sekolah',
  'Peta Urat Daun Jati',
  'Teduh Hutan Jawa',
  'Sinar Kuning Marigold',
  'Jaring Halus Pakis Gunung',
  'Jejak Tumbuk Organik',
  'Surya di Serat Katun',
  'Lapisan Tanin Alami',
  'Ranting Senja & Embun',
  'Bayangan Kayu Manis',
  'Selimut Besi & Tawas',
  'Komposisi Daun Singkong',
  'Pola Klasik Daun Belimbing',
  'Aura Natural Primisima',
  'Ritme Alam Nusantara',
  'Spektrum Daun Mangga',
  'Arsip Botani Kelas Sembilan',
  'Goresan Tanin Pekat',
  'Sajak Daun Ketapang',
  'Bunga Kenikir & Pakis',
  'Kukus Pagi di Sutra',
  'Harmoni Dua Mordant',
  'Ekspresi Daun Afrika',
  'Tapak Rimba Tropika',
  'Cetak Alam Berkelanjutan',
  'Pelita Serat Tradisional',
  'Kanvas Hijau Lestari',
];

const TECHNIQUES = [
  'Kukus (Steaming)',
  'Iron Blanket',
  'Pukul (Pounding)',
  'Kukus Dua Lapis',
];

const LEAF_SETS = [
  'Daun Jati, Kenikir',
  'Eucalyptus, Daun Lanang',
  'Pakis Gunung, Marigold',
  'Daun Ketapang, Jarak Merah',
  'Daun Pepaya, Singkong Karet',
  'Daun Kersen, Belimbing Wuluh',
];

const FABRICS = [
  'Katun Primisima',
  'Linen Organik',
  'Kain Blacu Halus',
  'Sutra Alam',
];

const MORDANTS = [
  'Tawas & Kapur Sirih',
  'Tunjung (Fero Sulfat)',
  'Tawas & Cuka Apel',
  'Soda Ash & Tunjung',
];

export const BASE_ARTWORK_CATALOG: ArtworkGroup[] = (() => {
  const list: ArtworkGroup[] = [];
  let idx = 0;

  for (const cls of ALL_CLASSES) {
    for (let g = 1; g <= 4; g++) {
      const groupId = `${cls.className}-${g}`;
      const title = ARTWORK_TITLES[idx % ARTWORK_TITLES.length];
      const technique = TECHNIQUES[(idx + g) % TECHNIQUES.length];
      const leaves = LEAF_SETS[(idx * 3 + g) % LEAF_SETS.length];
      const fabric = FABRICS[(idx + cls.grade) % FABRICS.length];
      const mordant = MORDANTS[(idx + g * 2) % MORDANTS.length];

      list.push({
        groupId,
        className: cls.className,
        grade: cls.grade,
        groupNumber: g,
        memberNames: '',
        artworkTitle: title,
        technique,
        leaves,
        fabric,
        mordant,
        description: `Karya ecoprint Kelompok ${groupId} menggunakan teknik ${technique.toLowerCase()} pada media ${fabric.toLowerCase()} dengan fiksasi ${mordant.toLowerCase()}.`,
        photoUrl: null,
        photoUpdatedAt: null,
        originalFileName: null,
        originalFileSize: null,
        originalMimeType: null,
        driveFileId: null,
        driveWebViewLink: null,
        driveSyncedAt: null,
        groupPhotoUrl: null,
        groupPhotoUpdatedAt: null,
        groupOriginalFileName: null,
        groupOriginalFileSize: null,
        groupOriginalMimeType: null,
        groupDriveFileId: null,
        groupDriveWebViewLink: null,
        groupDriveSyncedAt: null,
      });
      idx++;
    }
  }

  return list;
})();

export function buildCatalogWithOverrides(
  overrides: Record<string, ArtworkMetadataOverride> = {},
): ArtworkGroup[] {
  return BASE_ARTWORK_CATALOG.map((base) => {
    const ov = overrides[base.groupId];
    if (!ov) return base;
    return {
      ...base,
      memberNames: ov.memberNames !== undefined ? ov.memberNames.trim() : base.memberNames,
      artworkTitle: ov.artworkTitle?.trim() || base.artworkTitle,
      technique: ov.technique?.trim() || base.technique,
      leaves: ov.leaves?.trim() || base.leaves,
      fabric: ov.fabric?.trim() || base.fabric,
      mordant: ov.mordant?.trim() || base.mordant,
      description: ov.description?.trim() || base.description,
      photoUrl: ov.photoUrl ?? null,
      photoUpdatedAt: ov.photoUpdatedAt ?? null,
      originalFileName: ov.originalFileName ?? null,
      originalFileSize: ov.originalFileSize ?? null,
      originalMimeType: ov.originalMimeType ?? null,
      driveFileId: ov.driveFileId ?? null,
      driveWebViewLink: ov.driveWebViewLink ?? null,
      driveSyncedAt: ov.driveSyncedAt ?? null,
      groupPhotoUrl: ov.groupPhotoUrl ?? null,
      groupPhotoUpdatedAt: ov.groupPhotoUpdatedAt ?? null,
      groupOriginalFileName: ov.groupOriginalFileName ?? null,
      groupOriginalFileSize: ov.groupOriginalFileSize ?? null,
      groupOriginalMimeType: ov.groupOriginalMimeType ?? null,
      groupDriveFileId: ov.groupDriveFileId ?? null,
      groupDriveWebViewLink: ov.groupDriveWebViewLink ?? null,
      groupDriveSyncedAt: ov.groupDriveSyncedAt ?? null,
    };
  });
}

export function getGroupById(
  groupId: string,
  catalog: ArtworkGroup[] = BASE_ARTWORK_CATALOG,
): ArtworkGroup | undefined {
  return catalog.find((item) => item.groupId === groupId);
}

export function canAssessArtwork(evaluatorClassName: string, artworkClassName: string): boolean {
  return evaluatorClassName !== artworkClassName;
}

export function validateAssessmentSubmission(
  evaluatorGroupId: string,
  votesInput: RankedVoteInput[],
  existingSubmissions: AssessmentSubmission[],
): ValidationResult {
  const evaluator = getGroupById(evaluatorGroupId);
  if (!evaluator) {
    return {
      valid: false,
      code: 'INVALID_EVALUATOR',
      error: `Identitas kelompok penilai "${evaluatorGroupId}" tidak ditemukan.`,
    };
  }

  const alreadySubmitted = existingSubmissions.some(
    (s) => s.evaluatorGroupId === evaluatorGroupId && s.locked,
  );
  if (alreadySubmitted) {
    return {
      valid: false,
      code: 'ALREADY_LOCKED',
      error: `Penilaian untuk Kelompok ${evaluatorGroupId} sudah terkunci dan tidak dapat diubah.`,
    };
  }

  if (!Array.isArray(votesInput) || votesInput.length !== 4) {
    return {
      valid: false,
      code: 'INCOMPLETE_COUNT',
      error:
        'Penilaian hanya dapat dikirim setelah memilih tepat 4 karya dan memberikan semua peringkat (1–4).',
    };
  }

  const seenArtworks = new Set<string>();
  const seenRanks = new Set<number>();

  for (const vote of votesInput) {
    const artwork = getGroupById(vote.artworkGroupId);
    if (!artwork) {
      return {
        valid: false,
        code: 'INVALID_ARTWORK',
        error: `Karya dengan kode "${vote.artworkGroupId}" tidak ditemukan.`,
      };
    }

    if (!canAssessArtwork(evaluator.className, artwork.className)) {
      return {
        valid: false,
        code: 'SAME_CLASS_FORBIDDEN',
        error: `DILARANG: Kelompok ${evaluator.groupId} (Kelas ${evaluator.className}) tidak boleh menilai karya dari kelasnya sendiri (${artwork.groupId}).`,
      };
    }

    if (seenArtworks.has(artwork.groupId)) {
      return {
        valid: false,
        code: 'DUPLICATE_ARTWORK',
        error: `Setiap kelompok hanya boleh memberikan satu suara kepada karya ${artwork.groupId}.`,
      };
    }
    seenArtworks.add(artwork.groupId);

    if (![1, 2, 3, 4].includes(vote.rank)) {
      return {
        valid: false,
        code: 'INVALID_RANK',
        error: 'Peringkat harus bernilai 1, 2, 3, atau 4.',
      };
    }

    if (seenRanks.has(vote.rank)) {
      return {
        valid: false,
        code: 'DUPLICATE_RANK',
        error: `Peringkat ${vote.rank} ganda terdeteksi. Tidak boleh ada nilai peringkat yang sama dalam satu sesi penilaian.`,
      };
    }
    seenRanks.add(vote.rank);
  }

  return { valid: true };
}

export function buildLockedSubmission(
  evaluatorGroupId: string,
  votesInput: RankedVoteInput[],
  isDemoSeed = false,
): AssessmentSubmission {
  const evaluator = getGroupById(evaluatorGroupId)!;
  const sortedVotes: RankedVote[] = [...votesInput]
    .sort((a, b) => a.rank - b.rank)
    .map((v) => {
      const artwork = getGroupById(v.artworkGroupId)!;
      const stars = rankToStars(v.rank);
      return {
        artworkGroupId: artwork.groupId,
        rank: v.rank,
        stars,
        points: stars,
        artworkClassName: artwork.className,
        artworkGrade: artwork.grade,
      };
    });

  return {
    evaluatorGroupId: evaluator.groupId,
    evaluatorClassName: evaluator.className,
    evaluatorGrade: evaluator.grade,
    votes: sortedVotes,
    submittedAt: new Date().toISOString(),
    locked: true,
    isDemoSeed,
  };
}

export function computeRecapitulation(
  submissions: AssessmentSubmission[],
  catalog: ArtworkGroup[] = BASE_ARTWORK_CATALOG,
): RecapitulationSummary {
  const scoreMap = new Map<string, ArtworkScoreRow>();

  for (const artwork of catalog) {
    scoreMap.set(artwork.groupId, {
      artwork,
      totalPoints: 0,
      pointsFromGrade7: 0,
      pointsFromGrade8: 0,
      pointsFromGrade9: 0,
      votesCount: 0,
      rank1Count: 0,
      rank2Count: 0,
      rank3Count: 0,
      rank4Count: 0,
      gradeRank: 0,
      isTop2Winner: false,
    });
  }

  let totalVotesCast = 0;
  let totalPointsDistributed = 0;

  for (const submission of submissions) {
    for (const vote of submission.votes) {
      const row = scoreMap.get(vote.artworkGroupId);
      if (!row) continue;

      const pts = rankToStars(vote.rank);
      row.totalPoints += pts;
      row.votesCount += 1;
      totalVotesCast += 1;
      totalPointsDistributed += pts;

      if (submission.evaluatorGrade === 7) row.pointsFromGrade7 += pts;
      if (submission.evaluatorGrade === 8) row.pointsFromGrade8 += pts;
      if (submission.evaluatorGrade === 9) row.pointsFromGrade9 += pts;

      if (vote.rank === 1) row.rank1Count += 1;
      if (vote.rank === 2) row.rank2Count += 1;
      if (vote.rank === 3) row.rank3Count += 1;
      if (vote.rank === 4) row.rank4Count += 1;
    }
  }

  const buildGradeRecap = (grade: GradeLevel): GradeRecapitulation => {
    const classes = GRADE_CLASSES[grade];
    const rows = Array.from(scoreMap.values())
      .filter((r) => r.artwork.grade === grade)
      .sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
        if (b.rank1Count !== a.rank1Count) return b.rank1Count - a.rank1Count;
        if (b.rank2Count !== a.rank2Count) return b.rank2Count - a.rank2Count;
        if (b.rank3Count !== a.rank3Count) return b.rank3Count - a.rank3Count;
        if (b.votesCount !== a.votesCount) return b.votesCount - a.votesCount;
        return a.artwork.groupId.localeCompare(b.artwork.groupId);
      });

    rows.forEach((row, index) => {
      row.gradeRank = index + 1;
      row.isTop2Winner = index < 2 && row.totalPoints > 0;
    });

    return {
      grade,
      title: `TOP 2 BEST ECOPRINT GRADE ${grade}`,
      classesLabel:
        grade === 7
          ? 'Kelas 71, 72, dan 73'
          : grade === 8
            ? 'Kelas 81, 82, 83, 84, dan 85'
            : 'Kelas 91, 92, 93, 94, dan 95',
      classes,
      rows,
      top2Winners: rows.slice(0, 2),
    };
  };

  return {
    totalGroups: catalog.length,
    submittedGroupsCount: submissions.length,
    uploadedPhotosCount: catalog.filter((a) =>
      Boolean(a.photoUrl || a.driveWebViewLink || a.driveFileId),
    ).length,
    uploadedGroupPhotosCount: catalog.filter((a) =>
      Boolean(a.groupPhotoUrl || a.groupDriveWebViewLink || a.groupDriveFileId),
    ).length,
    driveSyncedCount: catalog.filter((a) => Boolean(a.driveFileId)).length,
    totalVotesCast,
    totalPointsDistributed,
    byGrade: {
      7: buildGradeRecap(7),
      8: buildGradeRecap(8),
      9: buildGradeRecap(9),
    },
  };
}

export function generateAdditionalDemoSubmissions(
  existingSubmissions: AssessmentSubmission[],
  count = 10,
): AssessmentSubmission[] {
  const lockedIds = new Set(existingSubmissions.map((s) => s.evaluatorGroupId));
  const candidates = BASE_ARTWORK_CATALOG.filter(
    (g) => !lockedIds.has(g.groupId) && g.groupId !== '71-1',
  );
  const pickedEvaluators = candidates.slice(0, count);
  const updated = [...existingSubmissions];

  for (let i = 0; i < pickedEvaluators.length; i++) {
    const evaluator = pickedEvaluators[i];
    const eligible = BASE_ARTWORK_CATALOG.filter((a) =>
      canAssessArtwork(evaluator.className, a.className),
    );
    const chosen: ArtworkGroup[] = [];
    const offset = (i * 7 + evaluator.groupNumber * 3) % eligible.length;
    for (let step = 0; step < eligible.length && chosen.length < 4; step++) {
      const candidate = eligible[(offset + step * 5) % eligible.length];
      if (!chosen.some((c) => c.groupId === candidate.groupId)) {
        chosen.push(candidate);
      }
    }

    if (chosen.length === 4) {
      const votesInput: RankedVoteInput[] = chosen.map((art, idx) => ({
        artworkGroupId: art.groupId,
        rank: (idx + 1) as RankNumber,
      }));
      const check = validateAssessmentSubmission(evaluator.groupId, votesInput, updated);
      if (check.valid) {
        updated.push(buildLockedSubmission(evaluator.groupId, votesInput, true));
      }
    }
  }

  return updated;
}
