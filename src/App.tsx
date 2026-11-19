import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Lock,
  Search,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { AdminEditGroupModal } from './components/AdminEditGroupModal';
import { AdminView } from './components/AdminView';
import { ArtworkCard } from './components/ArtworkCard';
import { ArtworkDetailModal } from './components/ArtworkDetailModal';
import { AssessmentPanel } from './components/AssessmentPanel';
import { GroupSelectorModal } from './components/GroupSelectorModal';
import { MyArtworkUploadModal } from './components/MyArtworkUploadModal';
import { PrintablePasswordsModal } from './components/PrintablePasswordsModal';
import { RecapitulationView } from './components/RecapitulationView';
import { RulesGuideView } from './components/RulesGuideView';
import { TopBar, type ActiveTab } from './components/TopBar';
import { WinnersView } from './components/WinnersView';
import {
  clearCachedDriveToken,
  initGoogleDriveAuth,
  signInWithGoogleDrive,
  signOutGoogleDrive,
  TARGET_FOLDER_NAME,
  type DriveUploadedFileInfo,
} from './lib/googleDriveAuth';
import {
  ALL_CLASSES,
  BASE_ARTWORK_CATALOG,
  GRADE_CLASSES,
  canAssessArtwork,
  computeRecapitulation,
  getGroupById,
  type ArtworkGroup,
  type AssessmentSubmission,
  type DriveArchiveConfig,
  type GradeLevel,
  type RankNumber,
  type RecapitulationSummary,
} from './shared/ecoprint';

interface RuntimeStorageInfo {
  isVercel: boolean;
  storagePersistent: boolean;
  storageProvider: 'local-disk' | 'upstash-redis' | 'vercel-tmp';
}

interface ApiStateResponse {
  catalog: ArtworkGroup[];
  submissions: AssessmentSubmission[];
  recapitulation: RecapitulationSummary;
  driveConfig: DriveArchiveConfig;
  driveBridgeConnected?: boolean;
  revision?: number;
  updatedAt: string;
  runtimeInfo?: RuntimeStorageInfo;
}

const SESSION_TOKEN_KEY = 'ecoprint_group_token';
const SESSION_GROUP_KEY = 'ecoprint_group_id';
const ADMIN_TOKEN_KEY = 'ecoprint_admin_token';

const INITIAL_DRIVE_CONFIG: DriveArchiveConfig = {
  driveFolderId: null,
  driveFolderUrl: null,
  driveOwnerEmail: null,
  manifestFileId: null,
  driveWebhookUrl: null,
  lastSyncedAt: null,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('assess');
  const [catalog, setCatalog] = useState<ArtworkGroup[]>(BASE_ARTWORK_CATALOG);
  const [submissions, setSubmissions] = useState<AssessmentSubmission[]>([]);
  const [recapitulation, setRecapitulation] = useState<RecapitulationSummary>(() =>
    computeRecapitulation([], BASE_ARTWORK_CATALOG),
  );
  const [driveConfig, setDriveConfig] = useState<DriveArchiveConfig>(INITIAL_DRIVE_CONFIG);
  const [driveBridgeConnected, setDriveBridgeConnected] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeStorageInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Authenticated evaluator group & token
  const [authToken, setAuthToken] = useState<string | null>(() =>
    sessionStorage.getItem(SESSION_TOKEN_KEY),
  );
  const [loggedInGroupId, setLoggedInGroupId] = useState<string | null>(() =>
    sessionStorage.getItem(SESSION_GROUP_KEY),
  );

  // Authenticated teacher admin token
  const [adminToken, setAdminToken] = useState<string | null>(() =>
    sessionStorage.getItem(ADMIN_TOKEN_KEY),
  );

  // Google Drive Auth state (access token cached in React memory ONLY)
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveActivationUrl, setDriveActivationUrl] = useState<string | null>(null);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);
  const [driveFolderFiles, setDriveFolderFiles] = useState<DriveUploadedFileInfo[]>([]);
  const syncingRef = useRef(false);
  const initialAdminDrivePullDoneRef = useRef(false);

  // Modals
  const [groupSelectorOpen, setGroupSelectorOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [printablePasswordsOpen, setPrintablePasswordsOpen] = useState(false);
  const [inspectedGroupId, setInspectedGroupId] = useState<string | null>(null);
  const [editingGroupIdAdmin, setEditingGroupIdAdmin] = useState<string | null>(null);

  // Draft votes stored per evaluatorGroupId
  const [draftsByGroup, setDraftsByGroup] = useState<
    Record<string, Map<RankNumber, string>>
  >({});

  // Gallery filters
  const [gradeFilter, setGradeFilter] = useState<GradeLevel | 'all'>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [hideOwnClass, setHideOwnClass] = useState(false);

  // Submission & UI feedback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const latestRevisionRef = useRef<number>(0);

  const applyApiState = useCallback(
    (data: ApiStateResponse, options?: { fromPoll?: boolean }) => {
      const incomingRev = data.revision ?? 0;
      const isColdEmptyVercelPoll =
        Boolean(options?.fromPoll) &&
        data.runtimeInfo?.storagePersistent === false &&
        incomingRev === 0 &&
        latestRevisionRef.current > 0;

      if (isColdEmptyVercelPoll) {
        return;
      }

      if (incomingRev > latestRevisionRef.current) {
        latestRevisionRef.current = incomingRev;
      }

      setCatalog(data.catalog);
      setSubmissions(data.submissions);
      setRecapitulation(data.recapitulation);
      if (data.driveConfig) {
        setDriveConfig(data.driveConfig);
      }
      if (typeof data.driveBridgeConnected === 'boolean') {
        setDriveBridgeConnected(data.driveBridgeConnected);
      }
      if (data.runtimeInfo) {
        setRuntimeInfo(data.runtimeInfo);
      }
    },
    [],
  );

  const fetchState = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await fetch('/api/state');
      if (!res.ok) {
        throw new Error('Gagal memuat data penilaian dari server.');
      }
      const data = (await res.json()) as ApiStateResponse;
      applyApiState(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Terjadi kesalahan jaringan.');
    } finally {
      setIsLoading(false);
    }
  }, [applyApiState]);

  useEffect(() => {
    fetchState();

    const savedGroupToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (savedGroupToken) {
      fetch('/api/auth/session', {
        headers: { Authorization: `Bearer ${savedGroupToken}` },
      })
        .then(async (res) => {
          if (!res.ok) {
            sessionStorage.removeItem(SESSION_TOKEN_KEY);
            sessionStorage.removeItem(SESSION_GROUP_KEY);
            setAuthToken(null);
            setLoggedInGroupId(null);
          } else {
            const data = (await res.json()) as { valid: boolean; groupId?: string };
            if (data.valid && data.groupId) {
              setAuthToken(savedGroupToken);
              setLoggedInGroupId(data.groupId);
            }
          }
        })
        .catch(() => {});
    }

    const savedAdminToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
    if (savedAdminToken) {
      fetch('/api/admin/session', {
        headers: { Authorization: `Bearer ${savedAdminToken}` },
      })
        .then((res) => {
          if (!res.ok) {
            sessionStorage.removeItem(ADMIN_TOKEN_KEY);
            setAdminToken(null);
          }
        })
        .catch(() => {});
    }

    const unsubscribe = initGoogleDriveAuth(
      (user, token) => {
        setDriveUser(user);
        setDriveAccessToken(token);
      },
      () => {
        setDriveUser(null);
        setDriveAccessToken(null);
      },
    );
    return () => unsubscribe();
  }, [fetchState]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const syncPendingPhotosToDrive = useCallback(
    async (
      tokenOverride?: string,
      userEmailOverride?: string | null,
      showToast = false,
      applyOpenAccess = true,
      forceArchiveDocs = false,
    ) => {
      const accessToken = tokenOverride ?? driveAccessToken;
      if (!accessToken || !adminToken || syncingRef.current) return;

      syncingRef.current = true;
      setIsSyncingDrive(true);
      setDriveError(null);
      setDriveActivationUrl(null);
      try {
        const res = await fetch('/api/admin/drive-sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
            'X-Drive-Token': accessToken,
          },
          body: JSON.stringify({
            ownerEmail: userEmailOverride ?? driveUser?.email ?? null,
            applyOpenAccess,
            forceArchiveDocs: forceArchiveDocs || showToast,
          }),
        });

        const payload = (await res.json()) as {
          state?: ApiStateResponse;
          syncedCount?: number;
          pulledGroupsCount?: number;
          pulledVotesCount?: number;
          driveFiles?: DriveUploadedFileInfo[];
          error?: string;
          activationUrl?: string | null;
        };

        if (!res.ok) {
          const msg = payload.error || 'Gagal menyinkronkan ke Google Drive.';
          setDriveError(msg);
          if (payload.activationUrl) {
            setDriveActivationUrl(payload.activationUrl);
          }
          if (res.status === 401) {
            clearCachedDriveToken();
            setDriveAccessToken(null);
          }
          if (showToast) {
            setToastMessage(msg);
          }
          return;
        }

        if (payload.state) {
          applyApiState(payload.state);
        }
        if (payload.driveFiles) {
          setDriveFolderFiles(payload.driveFiles);
        }

        const syncedCount = payload.syncedCount ?? 0;
        const pulledGroups = payload.pulledGroupsCount ?? 0;
        const pulledVotes = payload.pulledVotesCount ?? 0;
        const hasPulled = pulledGroups > 0 || pulledVotes > 0;

        if (showToast) {
          if (hasPulled || syncedCount > 0) {
            const parts: string[] = [];
            if (hasPulled) {
              parts.push(
                `${pulledGroups} data karya & ${pulledVotes} suara ditarik dari Drive`,
              );
            }
            if (syncedCount > 0) {
              parts.push(`${syncedCount} foto baru dikirim ke Drive`);
            }
            setToastMessage(
              `Sinkronisasi "${TARGET_FOLDER_NAME}" selesai: ${parts.join(', ')}.`,
            );
          } else {
            setToastMessage(
              `Terhubung ke folder "${TARGET_FOLDER_NAME}". Seluruh data & foto sudah sinkron.`,
            );
          }
        } else if (hasPulled || syncedCount > 0) {
          setToastMessage(
            hasPulled
              ? `Sinkronisasi otomatis: ${pulledGroups} data karya & ${pulledVotes} suara dipulihkan dari Drive${syncedCount > 0 ? `, ${syncedCount} foto baru dikirim.` : '.'}`
              : `${syncedCount} foto baru otomatis tersimpan di folder "${TARGET_FOLDER_NAME}" sesuai kelas.`,
          );
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Gagal menyinkronkan ke Google Drive.';
        setDriveError(msg);
        if (showToast) {
          setToastMessage(msg);
        }
      } finally {
        syncingRef.current = false;
        setIsSyncingDrive(false);
      }
    },
    [driveAccessToken, adminToken, driveUser?.email, applyApiState],
  );


  // Auto-pull & sync from Google Drive once when Admin session + Drive token are both active
  useEffect(() => {
    if (!adminToken || !driveAccessToken) {
      initialAdminDrivePullDoneRef.current = false;
      return;
    }
    if (!initialAdminDrivePullDoneRef.current && !driveActivationUrl && !syncingRef.current) {
      initialAdminDrivePullDoneRef.current = true;
      syncPendingPhotosToDrive(driveAccessToken, driveUser?.email ?? null, false, false, false);
    }
  }, [
    adminToken,
    driveAccessToken,
    driveUser?.email,
    driveActivationUrl,
    syncPendingPhotosToDrive,
  ]);

  // Instant sync whenever a new artwork or group photo appears in catalog while teacher Drive is connected
  useEffect(() => {
    if (!adminToken || !driveAccessToken || driveActivationUrl) return;
    const hasPending = catalog.some(
      (art) =>
        (Boolean(art.photoUrl) && !art.driveFileId) ||
        (Boolean(art.groupPhotoUrl) && !art.groupDriveFileId),
    );
    if (hasPending && !syncingRef.current) {
      syncPendingPhotosToDrive(undefined, undefined, false, false);
    }
  }, [adminToken, driveAccessToken, driveActivationUrl, catalog, syncPendingPhotosToDrive]);

  // Live connected dashboard polling every 5s for ALL 52 student groups & teacher admin
  useEffect(() => {
    const interval = window.setInterval(async () => {
      if (
        document.hidden ||
        uploadModalOpen ||
        Boolean(editingGroupIdAdmin) ||
        groupSelectorOpen ||
        isSubmitting
      ) {
        return;
      }
      try {
        const res = await fetch('/api/state');
        if (res.ok) {
          const data = (await res.json()) as ApiStateResponse;
          applyApiState(data, { fromPoll: true });
          if (adminToken && driveAccessToken && !driveActivationUrl) {
            const hasPending = data.catalog.some(
              (art) =>
                (Boolean(art.photoUrl) && !art.driveFileId) ||
                (Boolean(art.groupPhotoUrl) && !art.groupDriveFileId),
            );
            if (hasPending && !syncingRef.current) {
              await syncPendingPhotosToDrive(undefined, undefined, false, false);
            }
          }
        }
      } catch {
        // Ignore transient poll error
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [
    adminToken,
    driveAccessToken,
    driveActivationUrl,
    uploadModalOpen,
    editingGroupIdAdmin,
    groupSelectorOpen,
    isSubmitting,
    applyApiState,
    syncPendingPhotosToDrive,
  ]);

  const handleGoogleDriveSignIn = async () => {
    setDriveError(null);
    setDriveActivationUrl(null);
    try {
      const { user, accessToken } = await signInWithGoogleDrive();
      setDriveUser(user);
      setDriveAccessToken(accessToken);
      if (adminToken) {
        await fetch('/api/admin/drive-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
            'X-Drive-Token': accessToken,
          },
          body: JSON.stringify({ ownerEmail: user.email }),
        }).catch(() => {});
      }
      await syncPendingPhotosToDrive(accessToken, user.email, true, true, true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Login Google Drive dibatalkan.';
      setDriveError(msg);
      setToastMessage(msg);
    }
  };

  const handleRetryDriveSync = async () => {
    if (driveAccessToken) {
      await syncPendingPhotosToDrive(undefined, undefined, true, true, true);
    } else {
      await handleGoogleDriveSignIn();
    }
  };

  const handleConfigureOpenAccess = async () => {
    if (!driveAccessToken || !adminToken) return;
    setDriveError(null);
    setDriveActivationUrl(null);
    setIsSyncingDrive(true);
    try {
      const res = await fetch('/api/admin/drive-open-access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'X-Drive-Token': driveAccessToken,
        },
        body: JSON.stringify({
          ownerEmail: driveUser?.email ?? driveConfig.driveOwnerEmail,
        }),
      });
      const payload = (await res.json()) as {
        state?: ApiStateResponse;
        status?: string;
        message?: string | null;
        error?: string;
        activationUrl?: string | null;
      };

      if (!res.ok) {
        if (payload.activationUrl) setDriveActivationUrl(payload.activationUrl);
        if (res.status === 401) {
          clearCachedDriveToken();
          setDriveAccessToken(null);
        }
        const msg = payload.error || 'Gagal mengatur Open Access folder Drive.';
        setDriveError(msg);
        setToastMessage(msg);
        return;
      }

      if (payload.state) {
        applyApiState(payload.state);
      }
      setToastMessage(
        payload.message ??
          `Folder "${TARGET_FOLDER_NAME}" berhasil diatur ke Open Access (${payload.status}).`,
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Gagal mengatur Open Access folder Drive.';
      setDriveError(msg);
      setToastMessage(msg);
    } finally {
      setIsSyncingDrive(false);
    }
  };

  const handleGoogleDriveSignOut = async () => {
    await signOutGoogleDrive();
    if (adminToken) {
      await fetch('/api/admin/drive-disconnect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      })
        .then(async (res) => {
          if (res.ok) {
            const d = (await res.json()) as { state?: ApiStateResponse };
            if (d.state) applyApiState(d.state);
          }
        })
        .catch(() => {});
    }
    setDriveUser(null);
    setDriveAccessToken(null);
    setDriveError(null);
    setDriveActivationUrl(null);
    setDriveFolderFiles([]);
    setToastMessage('Akun Google Drive telah diputus dari sesi ini.');
  };

  const handleSaveDriveWebhook = async (driveWebhookUrl: string): Promise<boolean> => {
    if (!adminToken) return false;
    setDriveError(null);
    try {
      const res = await fetch('/api/admin/drive-webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ driveWebhookUrl }),
      });
      const payload = (await res.json()) as {
        state?: ApiStateResponse;
        error?: string;
      };
      if (!res.ok) {
        const msg = payload.error || 'Gagal menyimpan URL Bridge Apps Script.';
        setDriveError(msg);
        setToastMessage(msg);
        return false;
      }
      if (payload.state) {
        applyApiState(payload.state);
      }
      setToastMessage(
        driveWebhookUrl.trim()
          ? 'Bridge Apps Script 24 jam berhasil diaktifkan.'
          : 'Bridge Apps Script dinonaktifkan.',
      );
      return true;
    } catch {
      setToastMessage('Gagal menghubungi server saat menyimpan URL Bridge.');
      return false;
    }
  };

  const handlePullFromDrive = async () => {
    if (!driveAccessToken || !adminToken) {
      setToastMessage('Hubungkan Google Drive terlebih dahulu melalui Sign in with Google.');
      return;
    }
    setIsSyncingDrive(true);
    setDriveError(null);
    setDriveActivationUrl(null);
    try {
      const res = await fetch('/api/admin/drive-pull', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'X-Drive-Token': driveAccessToken,
        },
      });
      const payload = (await res.json()) as {
        state?: ApiStateResponse;
        pulledGroupsCount?: number;
        pulledVotesCount?: number;
        syncedCount?: number;
        driveFiles?: DriveUploadedFileInfo[];
        error?: string;
        activationUrl?: string | null;
      };
      if (!res.ok) {
        const msg = payload.error || 'Gagal menarik data dari Google Drive.';
        setDriveError(msg);
        if (payload.activationUrl) setDriveActivationUrl(payload.activationUrl);
        setToastMessage(msg);
        return;
      }
      if (payload.state) {
        applyApiState(payload.state);
      }
      if (payload.driveFiles) {
        setDriveFolderFiles(payload.driveFiles);
      }
      const pGroups = payload.pulledGroupsCount ?? 0;
      const pVotes = payload.pulledVotesCount ?? 0;
      setToastMessage(
        `Tarik data Google Drive berhasil: ${pGroups} data karya & ${pVotes} suara berhasil ditarik dari Drive ke server.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menarik data dari Google Drive.';
      setDriveError(msg);
      setToastMessage(msg);
    } finally {
      setIsSyncingDrive(false);
    }
  };

  const handleRefreshDriveFiles = async () => {
    if (!driveAccessToken || !adminToken || !driveConfig.driveFolderId) return;
    setDriveError(null);
    setDriveActivationUrl(null);
    try {
      const res = await fetch('/api/admin/drive-files', {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'X-Drive-Token': driveAccessToken,
        },
      });
      const payload = (await res.json()) as {
        files?: DriveUploadedFileInfo[];
        error?: string;
        activationUrl?: string | null;
      };
      if (!res.ok) {
        if (payload.activationUrl) setDriveActivationUrl(payload.activationUrl);
        if (res.status === 401) {
          clearCachedDriveToken();
          setDriveAccessToken(null);
        }
        const msg = payload.error || 'Gagal membaca isi folder Google Drive.';
        setDriveError(msg);
        setToastMessage(msg);
        return;
      }
      const files = payload.files ?? [];
      setDriveFolderFiles(files);
      setToastMessage(`Ditemukan ${files.length} file di folder "${TARGET_FOLDER_NAME}".`);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Gagal membaca isi folder Google Drive.';
      setDriveError(msg);
      setToastMessage(msg);
    }
  };

  const activeGroup = useMemo(
    () => (loggedInGroupId ? getGroupById(loggedInGroupId, catalog) ?? null : null),
    [loggedInGroupId, catalog],
  );

  const inspectedArtwork = useMemo(
    () => (inspectedGroupId ? getGroupById(inspectedGroupId, catalog) ?? null : null),
    [inspectedGroupId, catalog],
  );

  const adminEditingGroup = useMemo(
    () => (editingGroupIdAdmin ? getGroupById(editingGroupIdAdmin, catalog) ?? null : null),
    [editingGroupIdAdmin, catalog],
  );

  const lockedGroupIds = useMemo(
    () => new Set(submissions.map((s) => s.evaluatorGroupId)),
    [submissions],
  );

  const activeLockedSubmission = useMemo(
    () =>
      activeGroup
        ? submissions.find((s) => s.evaluatorGroupId === activeGroup.groupId)
        : undefined,
    [submissions, activeGroup],
  );

  const isActiveGroupLocked = Boolean(activeLockedSubmission);

  const currentDraftMap = useMemo(() => {
    if (!activeGroup) return new Map<RankNumber, string>();
    if (activeLockedSubmission) {
      const m = new Map<RankNumber, string>();
      activeLockedSubmission.votes.forEach((v) => m.set(v.rank, v.artworkGroupId));
      return m;
    }
    return draftsByGroup[activeGroup.groupId] ?? new Map<RankNumber, string>();
  }, [activeGroup, activeLockedSubmission, draftsByGroup]);

  const artworkToRankMap = useMemo(() => {
    const m = new Map<string, RankNumber>();
    currentDraftMap.forEach((artId, rank) => {
      m.set(artId, rank);
    });
    return m;
  }, [currentDraftMap]);

  const handleLoginSuccess = (groupId: string, token: string) => {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    sessionStorage.setItem(SESSION_GROUP_KEY, groupId);
    setAuthToken(token);
    setLoggedInGroupId(groupId);
    setSubmitError(null);
    setToastMessage(`Berhasil masuk sebagai Kelompok ${groupId}.`);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_GROUP_KEY);
    setAuthToken(null);
    setLoggedInGroupId(null);
    setSubmitError(null);
    setToastMessage('Anda telah keluar dari sesi kelompok.');
  };

  const handleAdminLoginSuccess = (
    token: string,
    loginMeta?: {
      autoPulled?: boolean;
      pulledGroupsCount?: number;
      pulledVotesCount?: number;
      syncedCount?: number;
      state?: unknown;
    },
  ) => {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    setAdminToken(token);
    if (loginMeta?.state) {
      applyApiState(loginMeta.state as ApiStateResponse);
    }
    if (loginMeta?.autoPulled) {
      initialAdminDrivePullDoneRef.current = true;
      const pulledG = loginMeta.pulledGroupsCount ?? 0;
      const pulledV = loginMeta.pulledVotesCount ?? 0;
      const synced = loginMeta.syncedCount ?? 0;
      setToastMessage(
        pulledG > 0 || pulledV > 0 || synced > 0
          ? `Admin login & sinkron Drive otomatis: ${pulledG} karya dan ${pulledV} suara ditarik dari Drive${synced > 0 ? `, ${synced} foto diunggah` : ''}.`
          : 'Berhasil masuk Panel Admin Guru & data Google Drive sudah sinkron.',
      );
    } else {
      setToastMessage('Berhasil masuk ke Panel Admin Guru.');
    }
  };

  const handleAdminLogout = () => {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken(null);
    setPrintablePasswordsOpen(false);
    setEditingGroupIdAdmin(null);
    initialAdminDrivePullDoneRef.current = false;
    setToastMessage('Anda telah keluar dari Panel Admin Guru.');
  };

  const handleAssignRank = (artworkGroupId: string, rank: RankNumber) => {
    if (!activeGroup || isActiveGroupLocked) return;
    const targetArt = getGroupById(artworkGroupId, catalog);
    if (!targetArt) return;

    if (!canAssessArtwork(activeGroup.className, targetArt.className)) {
      setSubmitError(
        `Dilarang: Kelompok ${activeGroup.groupId} (Kelas ${activeGroup.className}) tidak boleh menilai karya kelasnya sendiri.`,
      );
      return;
    }

    setSubmitError(null);
    setDraftsByGroup((prev) => {
      const existing = new Map(prev[activeGroup.groupId] ?? new Map<RankNumber, string>());
      for (const [r, artId] of existing.entries()) {
        if (artId === artworkGroupId) {
          existing.delete(r);
        }
      }
      existing.set(rank, artworkGroupId);
      return {
        ...prev,
        [activeGroup.groupId]: existing,
      };
    });
  };

  const handleClearArtworkRank = (artworkGroupId: string) => {
    if (!activeGroup || isActiveGroupLocked) return;
    setSubmitError(null);
    setDraftsByGroup((prev) => {
      const existing = new Map(prev[activeGroup.groupId] ?? new Map<RankNumber, string>());
      for (const [r, artId] of existing.entries()) {
        if (artId === artworkGroupId) {
          existing.delete(r);
        }
      }
      return {
        ...prev,
        [activeGroup.groupId]: existing,
      };
    });
  };

  const handleRemoveRankSlot = (rank: RankNumber) => {
    if (!activeGroup || isActiveGroupLocked) return;
    setSubmitError(null);
    setDraftsByGroup((prev) => {
      const existing = new Map(prev[activeGroup.groupId] ?? new Map<RankNumber, string>());
      existing.delete(rank);
      return {
        ...prev,
        [activeGroup.groupId]: existing,
      };
    });
  };

  const handleClearAllDraft = () => {
    if (!activeGroup || isActiveGroupLocked) return;
    setSubmitError(null);
    setDraftsByGroup((prev) => ({
      ...prev,
      [activeGroup.groupId]: new Map<RankNumber, string>(),
    }));
  };

  const handleSubmitAssessment = async (): Promise<boolean> => {
    if (!activeGroup || !authToken) {
      setGroupSelectorOpen(true);
      return false;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const votes: Array<{ artworkGroupId: string; rank: RankNumber }> = [];
    currentDraftMap.forEach((artworkGroupId, rank) => {
      votes.push({ artworkGroupId, rank });
    });

    try {
      const res = await fetch('/api/assessments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          evaluatorGroupId: activeGroup.groupId,
          votes,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setSubmitError(payload.error ?? 'Gagal mengirim penilaian.');
        return false;
      }

      applyApiState(payload.state);
      setToastMessage(
        `Penilaian Kelompok ${activeGroup.groupId} berhasil dikirim dan dikunci permanen.`,
      );
      return true;
    } catch {
      setSubmitError('Gagal menghubungi server saat mengirim penilaian.');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSeedDemo = async () => {
    if (!adminToken) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/seed-demo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ count: 10 }),
      });
      if (res.ok) {
        const data = (await res.json()) as ApiStateResponse;
        applyApiState(data);
        setToastMessage('Simulasi 10 suara lintas jenjang berhasil ditambahkan.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetAll = async () => {
    if (!adminToken) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        const data = (await res.json()) as ApiStateResponse;
        applyApiState(data);
        setDraftsByGroup({});
        setToastMessage('Seluruh data penilaian telah direset untuk sesi baru.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnlockGroup = async (groupId: string) => {
    if (!adminToken) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/unlock-group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ groupId }),
      });
      if (res.ok) {
        const data = (await res.json()) as ApiStateResponse;
        applyApiState(data);
        setToastMessage(`Kunci penilaian Kelompok ${groupId} telah dibuka kembali.`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLockGroup = async (groupId: string) => {
    if (!adminToken) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/lock-group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ groupId }),
      });
      if (res.ok) {
        const data = (await res.json()) as ApiStateResponse;
        applyApiState(data);
        setToastMessage(`Penilaian Kelompok ${groupId} berhasil dikunci.`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const availableClassOptions = useMemo(() => {
    if (gradeFilter === 'all') return ALL_CLASSES;
    return ALL_CLASSES.filter((c) => c.grade === gradeFilter);
  }, [gradeFilter]);

  const filteredArtworks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalog.filter((art) => {
      if (gradeFilter !== 'all' && art.grade !== gradeFilter) return false;
      if (classFilter !== 'all' && art.className !== classFilter) return false;
      if (
        hideOwnClass &&
        activeGroup &&
        !canAssessArtwork(activeGroup.className, art.className)
      ) {
        return false;
      }
      if (q) {
        const matches =
          art.groupId.toLowerCase().includes(q) ||
          art.memberNames.toLowerCase().includes(q) ||
          art.artworkTitle.toLowerCase().includes(q) ||
          art.leaves.toLowerCase().includes(q) ||
          art.technique.toLowerCase().includes(q) ||
          art.className.includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [catalog, gradeFilter, classFilter, hideOwnClass, activeGroup, searchQuery]);

  const handleSelectGradeFilter = (g: GradeLevel | 'all') => {
    setGradeFilter(g);
    if (g !== 'all' && classFilter !== 'all' && !GRADE_CLASSES[g].includes(classFilter)) {
      setClassFilter('all');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F6F1] text-[#1A1917]">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        activeGroup={activeGroup}
        isActiveGroupLocked={isActiveGroupLocked}
        onOpenGroupSelector={() => setGroupSelectorOpen(true)}
      />

      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-40 max-w-md bg-[#1B4332] text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2.5 text-sm font-medium no-print"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#86EFAC]" aria-hidden="true" />
          <span>{toastMessage}</span>
        </div>
      )}

      <main className="flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-8 py-8 no-print">
        {loadError ? (
          <div className="bg-white border border-[#FECACA] rounded-xl p-8 text-center max-w-lg mx-auto my-12">
            <AlertCircle className="w-8 h-8 text-[#991B1B] mx-auto mb-3" aria-hidden="true" />
            <h2 className="font-editorial text-xl font-semibold text-[#1A1917]">
              Gagal Memuat Data
            </h2>
            <p className="text-sm text-[#5E5A52] mt-1">{loadError}</p>
            <button
              type="button"
              onClick={fetchState}
              className="mt-4 px-4 py-2 text-sm font-semibold rounded-lg bg-[#1B4332] text-white hover:bg-[#143326]"
            >
              Coba Lagi
            </button>
          </div>
        ) : isLoading ? (
          <div className="py-20 text-center text-sm text-[#5E5A52]">
            Memuat galeri karya ecoprint dan data rekapitulasi...
          </div>
        ) : activeTab === 'winners' ? (
          <WinnersView recapitulation={recapitulation} />
        ) : activeTab === 'recap' ? (
          <RecapitulationView
            catalog={catalog}
            recapitulation={recapitulation}
            submissions={submissions}
          />
        ) : activeTab === 'rules' ? (
          <RulesGuideView />
        ) : activeTab === 'admin' ? (
          <AdminView
            adminToken={adminToken}
            catalog={catalog}
            submissions={submissions}
            recapitulation={recapitulation}
            driveConfig={driveConfig}
            driveBridgeConnected={driveBridgeConnected}
            runtimeInfo={runtimeInfo}
            driveUser={driveUser}
            driveAccessToken={driveAccessToken}
            driveError={driveError}
            driveActivationUrl={driveActivationUrl}
            isSyncingDrive={isSyncingDrive}
            driveFolderFiles={driveFolderFiles}
            isBusy={isSubmitting}
            onAdminLoginSuccess={handleAdminLoginSuccess}
            onAdminLogout={handleAdminLogout}
            onGoogleDriveSignIn={handleGoogleDriveSignIn}
            onGoogleDriveSignOut={handleGoogleDriveSignOut}
            onSyncAllToDrive={() => syncPendingPhotosToDrive(undefined, undefined, true, true)}
            onRetryDriveSync={handleRetryDriveSync}
            onConfigureOpenAccess={handleConfigureOpenAccess}
            onRefreshDriveFiles={handleRefreshDriveFiles}
            onSaveDriveWebhook={handleSaveDriveWebhook}
            onOpenPrintablePasswords={() => setPrintablePasswordsOpen(true)}
            onSeedDemo={handleSeedDemo}
            onResetAll={handleResetAll}
            onUnlockGroup={handleUnlockGroup}
            onEditGroup={(group) => setEditingGroupIdAdmin(group.groupId)}
          />
        ) : (
          <div className="space-y-8">
            <section className="bg-white border border-[#E3DED4] rounded-xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
              <div className="max-w-3xl">
                <div className="text-xs font-medium text-[#1B4332]">
                  Dashboard Terhubung Real-Time · 52 Kelompok (Kelas 7, 8, &amp; 9)
                </div>
                <h1 className="font-editorial text-3xl sm:text-4xl font-semibold text-[#1A1917] mt-1.5 leading-tight">
                  Galeri &amp; Penilaian Ecoprint Lintas Jenjang
                </h1>
                <p className="text-sm sm:text-base text-[#5E5A52] mt-2.5 leading-relaxed">
                  Seluruh kelompok terhubung pada satu galeri langsung. Siswa dapat melihat karya dan foto semua kelompok, namun{' '}
                  <strong className="text-[#1A1917]">hanya dapat mengedit &amp; mengupload karya kelompoknya sendiri</strong>{' '}
                  (tanpa perlu login Google), lalu menilai{' '}
                  <strong className="text-[#1A1917]">4 karya terbaik</strong> dari kelas lain.
                </p>

                <div className="mt-4 pt-4 border-t border-[#ECE7DE] flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#5E5A52]">
                  {activeGroup ? (
                    <>
                      <span>
                        Kelompok aktif:{' '}
                        <strong className="font-mono text-[#1A1917]">
                          {activeGroup.groupId}
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Status suara:{' '}
                        <strong
                          className={
                            isActiveGroupLocked ? 'text-[#1B4332]' : 'text-[#B45309]'
                          }
                        >
                          {isActiveGroupLocked ? 'Sudah Terkunci' : 'Belum Mengirim'}
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-[#7C2D12] font-medium">
                        <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Kelas {activeGroup.className} otomatis diblokir</span>
                      </span>
                    </>
                  ) : (
                    <span>
                      Foto diupload:{' '}
                      <strong className="font-mono text-[#1A1917] tabular-nums">
                        {recapitulation.uploadedPhotosCount}/{recapitulation.totalGroups}
                      </strong>{' '}
                      kelompok
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                {activeGroup ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setUploadModalOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg bg-[#1B4332] hover:bg-[#143326] text-white transition-colors whitespace-nowrap shrink-0"
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Edit Nama, Judul, Daun &amp; Foto</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setGroupSelectorOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg border border-[#E3DED4] bg-white text-[#1A1917] hover:bg-[#F8F6F1] transition-colors whitespace-nowrap shrink-0"
                    >
                      <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Ganti / Keluar</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setGroupSelectorOpen(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-[#1B4332] hover:bg-[#143326] text-white transition-colors whitespace-nowrap shrink-0"
                  >
                    <KeyRound className="w-4 h-4" aria-hidden="true" />
                    <span>Masuk dengan Password Kelompok</span>
                  </button>
                )}
              </div>
            </section>

            {/* Two-Zone Assessment Workspace */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
              <div className="lg:col-span-8 space-y-5">
                <div className="bg-white border border-[#E3DED4] rounded-xl p-4 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-1 p-1 bg-[#EAE5DC] rounded-lg w-fit overflow-x-auto">
                      {(['all', 7, 8, 9] as const).map((g) => {
                        const isSelected = gradeFilter === g;
                        return (
                          <button
                            key={String(g)}
                            type="button"
                            onClick={() => handleSelectGradeFilter(g)}
                            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                              isSelected
                                ? 'bg-white text-[#1A1917] shadow-sm'
                                : 'text-[#5E5A52] hover:text-[#1A1917]'
                            }`}
                          >
                            {g === 'all' ? 'Semua Jenjang' : `Kelas ${g}`}
                          </button>
                        );
                      })}
                    </div>

                    <div className="text-xs text-[#5E5A52] tabular-nums">
                      Menampilkan <strong className="text-[#1A1917]">{filteredArtworks.length}</strong> karya
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div className="relative flex-1">
                      <Search
                        className="w-4 h-4 text-[#5E5A52] absolute left-3 top-1/2 -translate-y-1/2"
                        aria-hidden="true"
                      />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Cari kelompok, nama siswa, judul karya, atau jenis daun..."
                        className="w-full pl-9 pr-3 py-2 text-sm bg-[#F8F6F1] border border-[#E3DED4] rounded-lg text-[#1A1917] placeholder:text-[#8A8479]"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <SlidersHorizontal className="w-4 h-4 text-[#5E5A52] shrink-0" aria-hidden="true" />
                      <select
                        aria-label="Filter berdasarkan kelas"
                        value={classFilter}
                        onChange={(e) => setClassFilter(e.target.value)}
                        className="px-3 py-2 text-sm bg-[#F8F6F1] border border-[#E3DED4] rounded-lg text-[#1A1917]"
                      >
                        <option value="all">Semua Kelas</option>
                        {availableClassOptions.map((c) => (
                          <option key={c.className} value={c.className}>
                            Kelas {c.className}
                            {activeGroup && c.className === activeGroup.className
                              ? ' (Kelas Sendiri)'
                              : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {activeGroup && (
                      <label className="inline-flex items-center gap-2 text-xs font-medium text-[#1A1917] cursor-pointer select-none whitespace-nowrap shrink-0">
                        <input
                          type="checkbox"
                          checked={hideOwnClass}
                          onChange={(e) => setHideOwnClass(e.target.checked)}
                          className="rounded border-[#C9C1B2] accent-[#1B4332] w-4 h-4"
                        />
                        <span>Sembunyikan kelas {activeGroup.className}</span>
                      </label>
                    )}
                  </div>
                </div>

                {filteredArtworks.length === 0 ? (
                  <div className="bg-white border border-[#E3DED4] rounded-xl p-10 text-center">
                    <p className="text-sm font-medium text-[#1A1917]">
                      Tidak ada karya yang sesuai dengan filter saat ini.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setGradeFilter('all');
                        setClassFilter('all');
                        setSearchQuery('');
                        setHideOwnClass(false);
                      }}
                      className="mt-3 text-xs font-semibold text-[#1B4332] hover:underline"
                    >
                      Tampilkan Semua Karya
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredArtworks.map((artwork) => {
                      const assignedRank = artworkToRankMap.get(artwork.groupId);
                      const usedByOther = new Map<RankNumber, string>();
                      currentDraftMap.forEach((artId, r) => {
                        if (artId !== artwork.groupId) {
                          usedByOther.set(r, artId);
                        }
                      });

                      return (
                        <ArtworkCard
                          key={artwork.groupId}
                          artwork={artwork}
                          evaluatorGroup={activeGroup}
                          isEvaluatorLocked={isActiveGroupLocked}
                          assignedRank={assignedRank}
                          usedRanksByOther={usedByOther}
                          onAssignRank={handleAssignRank}
                          onClearRank={handleClearArtworkRank}
                          onInspect={(art) => setInspectedGroupId(art.groupId)}
                          onOpenUploadMyPhoto={() => setUploadModalOpen(true)}
                          onOpenLogin={() => setGroupSelectorOpen(true)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="lg:col-span-4">
                <AssessmentPanel
                  catalog={catalog}
                  evaluatorGroup={activeGroup}
                  lockedSubmission={activeLockedSubmission}
                  draftVotes={currentDraftMap}
                  existingSubmissions={submissions}
                  isSubmitting={isSubmitting}
                  submitError={submitError}
                  onRemoveRank={handleRemoveRankSlot}
                  onClearAllDraft={handleClearAllDraft}
                  onSubmitAssessment={handleSubmitAssessment}
                  onSwitchGroup={() => setGroupSelectorOpen(true)}
                  onOpenUploadMyPhoto={() => setUploadModalOpen(true)}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-[#E3DED4] bg-[#F8F6F1] mt-12 no-print">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-8 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-[#5E5A52]">
          <span>
            Galeri Penilaian Ecoprint · Sistem Cross-Grade Peer Assessment Kelas 7, 8, dan 9
          </span>
          <span className="font-mono tabular-nums">
            {recapitulation.uploadedPhotosCount}/{recapitulation.totalGroups} foto ·{' '}
            {recapitulation.driveSyncedCount} di Drive ·{' '}
            {recapitulation.submittedGroupsCount}/{recapitulation.totalGroups} suara terkunci
          </span>
        </div>
      </footer>

      <GroupSelectorModal
        isOpen={groupSelectorOpen}
        onClose={() => setGroupSelectorOpen(false)}
        catalog={catalog}
        activeGroup={activeGroup}
        lockedGroupIds={lockedGroupIds}
        onLoginSuccess={handleLoginSuccess}
        onLogout={handleLogout}
      />

      <MyArtworkUploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        group={activeGroup}
        authToken={authToken}
        onUpdated={(payload) => applyApiState(payload as ApiStateResponse)}
        onSuccessToast={(msg) => setToastMessage(msg)}
      />

      <PrintablePasswordsModal
        isOpen={printablePasswordsOpen}
        adminToken={adminToken}
        onClose={() => setPrintablePasswordsOpen(false)}
      />

      <AdminEditGroupModal
        isOpen={Boolean(editingGroupIdAdmin)}
        onClose={() => setEditingGroupIdAdmin(null)}
        group={adminEditingGroup}
        adminToken={adminToken}
        onUpdated={(payload) => applyApiState(payload as ApiStateResponse)}
        onSuccessToast={(msg) => setToastMessage(msg)}
      />

      <ArtworkDetailModal
        artwork={inspectedArtwork}
        evaluatorGroup={activeGroup}
        isEvaluatorLocked={isActiveGroupLocked}
        assignedRank={
          inspectedArtwork ? artworkToRankMap.get(inspectedArtwork.groupId) : undefined
        }
        onAssignRank={handleAssignRank}
        onClearRank={handleClearArtworkRank}
        onOpenUploadMyPhoto={() => setUploadModalOpen(true)}
        onOpenLogin={() => setGroupSelectorOpen(true)}
        onClose={() => setInspectedGroupId(null)}
      />
    </div>
  );
}
