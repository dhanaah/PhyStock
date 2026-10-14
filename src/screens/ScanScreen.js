import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  Vibration, Platform, Alert, KeyboardAvoidingView, AppState, Keyboard,
} from 'react-native';
import {
  Camera as VisionCamera, useCameraDevice, useCameraPermission, useCodeScanner,
} from 'react-native-vision-camera';
import { Ionicons } from '@expo/vector-icons';
import { LightSensor } from 'expo-sensors';
import { useIsFocused } from '@react-navigation/native';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { colors, type as fonts, radius, space } from '../theme/theme';
import { useAppData } from '../context/AppDataContext';
import ScannerFrame from '../components/ScannerFrame';
import TicketCard from '../components/TicketCard';
import ChangeBayModal from '../components/ChangeBayModal';
import HardwareScanInput from '../components/HardwareScanInput';
import RawScanDebugPanel from '../components/RawScanDebugPanel';
import ServerSheet, { syncStatusMeta } from '../components/ServerSheet';
import { useSync, isSetupCode } from '../context/SyncContext';
import { PressScale, FadeRise, animateLayout } from '../components/motion';
import { useScanSounds } from '../utils/useScanSounds';
import { parseCode } from '../utils/qrParser';

// Camera re-arm: once a code has been logged, the same code is not logged
// again until it has been OUT of view for this long. Lingering over the
// same pallet for a few seconds therefore never produces a second
// (duplicate) record — the operator has to move away and come back,
// which is the deliberate "scan it again" gesture.
const CAMERA_REARM_MS = 1500;
// Hardware/manual: same code again within this window is treated as the
// same trigger pull (double terminator, bounce, trigger held in
// continuous-read mode), not a second scan.
const SCAN_COOLDOWN_MS = 3000;
// Pallet-level guard. Every AIS label carries BOTH a QR and a Data
// Matrix for the same pallet; the camera sees both in one frame and a
// hardware scanner can decode either on successive pulls. They are
// different raw strings, so the raw-string guards above don't catch it
// and the second one was being logged as an instant DUPLICATE of the
// first. Once an LPN has been recorded, any further code resolving to
// the SAME LPN is ignored for this long — a genuine re-scan of one
// pallet back-to-back is never intentional. The one exception: a
// Detailed code arriving right after an LPN-only code for the same
// pallet is an upgrade (full data), not a repeat, and goes through.
const SAME_LPN_SUPPRESS_MS = 4000;
const MAX_LOG_ENTRIES = 50;
// Raw-log UI refresh cap. The camera reports the same code on every
// frame it's in view (up to 30×/s); each report used to trigger a
// setState → full screen re-render. Counting now happens in a ref and
// the visible log refreshes at most this often.
const RAW_LOG_FLUSH_MS = 400;
const OUTCOME_BANNER_MS = 2500;

function formatLogTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export default function ScanScreen() {
  const { userName, bay, warehouse, recordScan, updateScanFields, stats, scanMode, setScanMode, bayProgress } = useAppData();
  const { status: syncStatus, pendingCount, linkFromSetupCode, subscribeGlobalDup } = useSync();
  const [serverSheetOpen, setServerSheetOpen] = useState(false);
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraDevice = useCameraDevice('back');
  const isFocused = useIsFocused();
  const [cameraKey, setCameraKey] = useState(0);
  const [lastScan, setLastScan] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [manualError, setManualError] = useState(null);
  const [flashMsg, setFlashMsg] = useState(null);
  const [bayModalOpen, setBayModalOpen] = useState(false);
  const [physQtyDraft, setPhysQtyDraft] = useState('');
  const [remarksDraft, setRemarksDraft] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [rawLog, setRawLog] = useState([]);
  const [liveBuffer, setLiveBuffer] = useState('');
  const [flashMode, setFlashMode] = useState('off'); // 'off' | 'auto' | 'on'
  const [autoTorchActive, setAutoTorchActive] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraMountError, setCameraMountError] = useState(null);
  const [cameraLayoutSize, setCameraLayoutSize] = useState(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [noteEditing, setNoteEditing] = useState(false);
  const [outcomeBanner, setOutcomeBanner] = useState(null); // { kind, text }
  const outcomeTimerRef = useRef(null);

  // Screen stays on while the Scan tab is open — a stock take is minutes
  // of continuous scanning with no screen touches, and the OS would
  // otherwise dim/lock mid-bay.
  useKeepAwake();

  // Release the camera when the app goes to the background (home button,
  // incoming call, screen lock) and re-acquire it on return. Holding the
  // camera while backgrounded is both a battery drain and the classic
  // cause of a preview that comes back frozen.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => sub.remove();
  }, []);

  const playFor = useScanSounds();
  const lastRawRef = useRef(null);
  const scrollRef = useRef(null);
  const scrollToNoteFields = () => {
    // The Phy. Qty / Remarks fields sit near the bottom of the scroll
    // content, right after the ticket. Without this, the on-screen
    // keyboard can cover them entirely while typing — you're not
    // missing anything, you just can't see the field (or what you've
    // typed into it) until the keyboard closes. Scrolling to the end on
    // focus, alongside the KeyboardAvoidingView wrapper, keeps the field
    // visible above the keyboard.
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };
  const lastTimeRef = useRef(0);
  const lastSeenRef = useRef(0);
  const lastLpnRef = useRef({ lpn: null, qrType: null, at: 0 });
  const busyRef = useRef(false);
  const rawLogRef = useRef([]);
  const rawLogFlushRef = useRef(null);

  // Torch should never stay on by accident — the camera itself already
  // unmounts when we leave camera mode or the tab loses focus (see the
  // !isFocused branch below), which naturally stops the torch too.
  //
  // "Auto" mode uses the device's real ambient light sensor (lux) rather
  // than guessing — turns the torch on below ~15 lux (genuinely dark)
  // and back off above ~30 lux (a gap between the two thresholds avoids
  // flicker right at the boundary). Only active while actually in
  // Camera mode with the tab focused, matching the camera's own
  // lifecycle.
  const torchOn = flashMode === 'on' || (flashMode === 'auto' && autoTorchActive);

  useEffect(() => {
    if (flashMode !== 'auto' || scanMode !== 'camera' || !isFocused) return;
    let subscription;
    let cancelled = false;
    LightSensor.isAvailableAsync().then((available) => {
      if (cancelled) return;
      if (!available) {
        Alert.alert('Auto-flash unavailable', 'This device doesn\u2019t have an ambient light sensor. Switching to manual flash.');
        setFlashMode('off');
        return;
      }
      LightSensor.setUpdateInterval(500);
      subscription = LightSensor.addListener(({ illuminance }) => {
        setAutoTorchActive((prev) => {
          if (prev && illuminance > 30) return false;
          if (!prev && illuminance < 15) return true;
          return prev;
        });
      });
    });
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [flashMode, scanMode, isFocused]);

  const cycleFlashMode = () => {
    setFlashMode((m) => (m === 'off' ? 'auto' : m === 'auto' ? 'on' : 'off'));
  };

  useEffect(() => {
    if (!isFocused) {
      setCameraReady(false);
      setCameraMountError(null);
    }
  }, [isFocused]);

  const restartCamera = () => {
    setCameraReady(false);
    setCameraMountError(null);
    setCameraKey((k) => k + 1);
  };

  // Logs every capture attempt exactly as received, before any parsing —
  // including camera detections ignored by the cooldown — so the debug
  // panel reflects reality even when nothing "counts" as a new scan.
  // Consecutive identical (source+raw) events collapse into one row with
  // a growing count, so the log stays readable during continuous camera
  // decode bursts of the same code.
  const flushRawLog = useCallback(() => {
    rawLogFlushRef.current = null;
    setRawLog(rawLogRef.current.map((e) => ({ ...e })));
  }, []);

  const logRawEvent = useCallback((source, raw, barcodeType) => {
    const now = new Date();
    const list = rawLogRef.current;
    const top = list[0];
    if (top && top.source === source && top.raw === raw) {
      top.count += 1;
      top.time = formatLogTime(now);
    } else {
      list.unshift({
        id: `${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`,
        source, raw, barcodeType: barcodeType || null,
        count: 1, time: formatLogTime(now),
      });
      if (list.length > MAX_LOG_ENTRIES) list.length = MAX_LOG_ENTRIES;
    }
    if (!rawLogFlushRef.current) {
      rawLogFlushRef.current = setTimeout(flushRawLog, RAW_LOG_FLUSH_MS);
    }
  }, [flushRawLog]);

  useEffect(() => () => {
    if (rawLogFlushRef.current) clearTimeout(rawLogFlushRef.current);
    if (outcomeTimerRef.current) clearTimeout(outcomeTimerRef.current);
  }, []);

  const showOutcome = useCallback((kind, text) => {
    setOutcomeBanner({ kind, text });
    if (outcomeTimerRef.current) clearTimeout(outcomeTimerRef.current);
    outcomeTimerRef.current = setTimeout(() => setOutcomeBanner(null), OUTCOME_BANNER_MS);
  }, []);

  // Cross-device duplicate: the server ACK says another scanner already
  // logged this pallet. If it concerns the scan currently on screen, make
  // it unmissable — red strip, duplicate beep, warning haptic.
  useEffect(() => subscribeGlobalDup((d) => {
    setLastScan((prev) => (prev && prev.id === d.clientId ? { ...prev, globalDup: d } : prev));
    showOutcome('duplicate', `ALREADY SCANNED · ${d.deviceName || 'other device'}${d.bay ? ` @ ${d.bay}` : ''}`);
    playFor('duplicate');
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  }), [subscribeGlobalDup, showOutcome, playFor]);

  const handlePayload = useCallback(async (raw, source = 'camera', barcodeType = null) => {
    logRawEvent(source, raw, barcodeType);

    // Setup QR from the data-center dashboard — links this device.
    if (isSetupCode(raw)) {
      const now0 = Date.now();
      if (raw === lastRawRef.current && now0 - lastTimeRef.current < 4000) return;
      lastRawRef.current = raw; lastTimeRef.current = now0; lastSeenRef.current = now0;
      const url = await linkFromSetupCode(raw);
      if (url) {
        playFor('new');
        showOutcome('new', `DATA CENTER LINKED · ${url.replace(/^https?:\/\//, '')}`);
      } else {
        Alert.alert('Setup code not understood', raw);
      }
      return;
    }

    const now = Date.now();
    if (raw === lastRawRef.current) {
      if (source === 'camera') {
        // Same code still in view: refresh "last seen" and ignore. It
        // only re-arms after the code has been absent for CAMERA_REARM_MS.
        const sinceSeen = now - lastSeenRef.current;
        lastSeenRef.current = now;
        if (sinceSeen < CAMERA_REARM_MS) return;
      } else if (now - lastTimeRef.current < SCAN_COOLDOWN_MS) {
        return;
      }
    }
    if (busyRef.current) return;

    const pre = parseCode(raw);
    const last = lastLpnRef.current;
    if (pre.lpn && pre.lpn === last.lpn && now - last.at < SAME_LPN_SUPPRESS_MS) {
      const isUpgrade = pre.qrType === 'Slot1' && last.qrType !== 'Slot1';
      if (!isUpgrade) {
        if (source === 'camera') lastSeenRef.current = now;
        return;
      }
    }

    busyRef.current = true;
    lastRawRef.current = raw;
    lastTimeRef.current = now;
    lastSeenRef.current = now;

    // try/finally is essential here: without it, any error while
    // processing a scan (storage hiccup, unexpected data shape, etc.)
    // would leave busyRef stuck at true forever, silently blocking every
    // scan after that — across camera, hardware, and manual — until the
    // app restarts. That's exactly the "scanned once then nothing"
    // symptom, so this guard always has to run regardless of outcome.
    try {
      const scan = await recordScan(raw);
      if (scan.lpn) lastLpnRef.current = { lpn: scan.lpn, qrType: scan.qrType, at: Date.now() };
      setLastScan(scan);
      setPhysQtyDraft('');
      setRemarksDraft('');
      setNoteSaved(false);

      const outcome = scan.qrType === 'Unrecognized' ? 'error' : scan.isDuplicate ? 'duplicate' : 'new';
      playFor(outcome);
      const shownLpn = scan.palletNo && scan.lpn
        ? `${scan.palletNo}${scan.palletLpnDelimiter || '.'}${scan.lpn}`
        : (scan.lpn || '');
      showOutcome(
        outcome,
        outcome === 'error' ? 'UNREADABLE CODE'
          : outcome === 'duplicate' ? `DUPLICATE · ${shownLpn}`
          : `${scan.stockNote ? 'LPN STOCK' : 'NEW'} · ${shownLpn}`
      );

      if (Platform.OS !== 'web') {
        try {
          if (outcome === 'error') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          } else if (outcome === 'duplicate') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        } catch (e) {
          Vibration.vibrate(outcome === 'error' ? [0, 150] : outcome === 'duplicate' ? [0, 80, 60, 80] : 40);
        }
      }
    } catch (e) {
      Alert.alert('Scan error', String(e?.message || e || 'Something went wrong processing that scan.'));
    } finally {
      busyRef.current = false;
    }
  }, [recordScan, playFor, logRawEvent, showOutcome, linkFromSetupCode]);

  const onCodesScanned = useCallback((codes) => {
    // vision-camera reports every code visible in the frame. A label
    // shows its QR and its Data Matrix together, so order the frame so
    // the Detailed (full-data) code is processed first — the pallet
    // guard in handlePayload then drops its LPN-only twin.
    const valid = codes.filter((c) => c.value);
    if (valid.length > 1) {
      valid.sort((a, b) => {
        const ra = parseCode(a.value).qrType === 'Slot1' ? 0 : 1;
        const rb = parseCode(b.value).qrType === 'Slot1' ? 0 : 1;
        return ra - rb;
      });
    }
    for (const code of valid) {
      handlePayload(code.value, 'camera', code.type);
    }
  }, [handlePayload]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr', 'data-matrix'],
    onCodeScanned: onCodesScanned,
  });

  const submitManual = () => {
    const value = manualValue.trim();
    if (!value) return;
    // Manual entries skip the camera/scanner's decode step, so nothing
    // guarantees the text actually follows the LPN structure (P + 11
    // digits) the way a real scanned code does. Check before logging it
    // rather than silently recording an "Unrecognized" scan.
    const parsed = parseCode(value);
    if (!parsed.lpn) {
      logRawEvent('manual', value, null);
      setManualError('No valid LPN found (expected "P" followed by 11 digits somewhere in the code). Check the value and try again.');
      return;
    }
    setManualError(null);
    handlePayload(value, 'manual');
    setManualValue('');
    setManualOpen(false);
    setFlashMsg('Logged from manual entry');
    setTimeout(() => setFlashMsg(null), 1800);
  };

  const saveNote = async () => {
    if (!lastScan) return;
    const patch = {};
    if (physQtyDraft.trim()) patch.physQty = physQtyDraft.trim();
    if (remarksDraft.trim()) patch.remarks = remarksDraft.trim();
    if (Object.keys(patch).length === 0) return;
    const result = await updateScanFields(lastScan.id, patch);
    Keyboard.dismiss();
    if (result.ok) {
      setNoteSaved(true);
      setLastScan((prev) => (prev ? { ...prev, ...patch } : prev));
    } else {
      Alert.alert('Could not save', String(result.error?.message || result.error || 'Unknown error — try again.'));
    }
  };

  const showNoteFields = lastScan && lastScan.qrType !== 'Unrecognized';

  const currentBayProgress = bayProgress.find((p) => p.bay === bay);

  const clearLastScan = () => {
    setLastScan(null);
    setPhysQtyDraft('');
    setRemarksDraft('');
    setNoteSaved(false);
  };

  const clearRawLog = () => setRawLog([]);

  const shareRawLog = async () => {
    if (rawLog.length === 0) {
      Alert.alert('Nothing to share', 'No scan events captured yet.');
      return;
    }
    try {
      const lines = rawLog.map((e) =>
        `[${e.time}] ${e.source.toUpperCase()}${e.barcodeType ? ` (${e.barcodeType})` : ''}${e.count > 1 ? ` x${e.count}` : ''}: ${e.raw || '(empty)'}`
      );
      const text = lines.join('\n');
      const fileUri = FileSystem.documentDirectory + 'RawScanLog.txt';
      await FileSystem.writeAsStringAsync(fileUri, text, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/plain', dialogTitle: 'Raw scan log' });
      }
    } catch (e) {
      Alert.alert('Share failed', String(e?.message || e));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerUser}>{userName}</Text>
          <Text style={styles.headerBay}>{warehouse} · {bay}</Text>
        </View>
        <View style={styles.headerRight}>
          {(() => { const m = syncStatusMeta(syncStatus, pendingCount); return (
            <Pressable onPress={() => setServerSheetOpen(true)} style={[styles.cloudChip, { borderColor: m.color }]} hitSlop={6}>
              <Ionicons name={m.icon} size={15} color={m.color} />
              <Text style={[styles.cloudChipText, { color: m.color }]} numberOfLines={1}>{m.label}</Text>
            </Pressable>
          ); })()}
          <Pressable onPress={() => setBayModalOpen(true)} style={styles.changeBtn}>
            <Text style={styles.changeBtnText}>Change</Text>
          </Pressable>
        </View>
      </View>

      <ChangeBayModal visible={bayModalOpen} onClose={() => setBayModalOpen(false)} />
      <ServerSheet visible={serverSheetOpen} onClose={() => setServerSheetOpen(false)} />

      {/* Mode toggle + camera/hardware panel are deliberately OUTSIDE the
          ScrollView below (a scrolling ancestor can break native camera
          preview compositing on Android — kept this structural fix even
          after switching camera libraries, since it's cheap insurance). */}
      <View style={styles.modeToggleRow}>
        <ModeButton label="Camera" active={scanMode === 'camera'} onPress={() => setScanMode('camera')} />
        <ModeButton label="Hardware Scanner" active={scanMode === 'hardware'} onPress={() => setScanMode('hardware')} />
      </View>

      {/* NOTE: the preview uses androidPreviewViewType="texture-view".
          The default SurfaceView is composited by the OS underneath the
          app window through a punched hole and cannot be clipped — a
          rounded/overflow-hidden parent left that hole unpunched, which
          was the long "scans but preview is black" bug shared by both
          camera libraries. TextureView lives in the normal view tree, so
          the box can clip the cover-scaled preview like any other view. */}
      <View
        style={styles.cameraWrap}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setCameraLayoutSize((prev) => (
            prev && prev.width === width && prev.height === height ? prev : { width, height }
          ));
        }}
      >
        {scanMode === 'hardware' ? (
          <View style={styles.hardwareWrap}>
            <HardwareScanInput
              active={scanMode === 'hardware'}
              suspended={noteEditing}
              onScan={(raw) => handlePayload(raw, 'hardware')}
              onBufferChange={setLiveBuffer}
            />
          </View>
        ) : !hasPermission ? (
          <View style={styles.cameraFallback}>
            <Text style={styles.permText}>Camera access is needed to scan pallet labels.</Text>
            <Pressable onPress={requestPermission} style={styles.permBtn}>
              <Text style={styles.permBtnText}>Grant camera access</Text>
            </Pressable>
          </View>
        ) : !cameraDevice ? (
          <View style={styles.cameraFallback}>
            <Text style={styles.permText}>No back camera detected on this device.</Text>
          </View>
        ) : !isFocused ? (
          // Unmounted while the tab isn't focused, so switching back to
          // Scan always gets a fresh camera session instead of a stale
          // one whose preview stopped rendering (decode can go stale
          // silently on some devices even though the view stays mounted).
          <View style={styles.cameraFallback} />
        ) : (
          <>
            <VisionCamera
              key={cameraKey}
              style={[
                styles.camera,
                // Explicit numeric dimensions from the real measured
                // layout, rather than trusting flex/absoluteFill to
                // resolve correctly — removes any ambiguity about
                // whether the camera is actually getting screen space
                // to render into.
                cameraLayoutSize ? { width: cameraLayoutSize.width, height: cameraLayoutSize.height } : null,
              ]}
              device={cameraDevice}
              isActive={scanMode === 'camera' && isFocused && appActive}
              torch={torchOn ? 'on' : 'off'}
              codeScanner={codeScanner}
              // TextureView composites inside the normal view hierarchy
              // (supports clipping/overlays) instead of SurfaceView's
              // punch-through — the documented fix for a black preview
              // inside styled containers on Android.
              androidPreviewViewType="texture-view"
              resizeMode="cover"
              enableZoomGesture={false}
              onInitialized={() => {
                setCameraReady(true);
                setCameraMountError(null);
                logRawEvent('camera', '(camera ready)', null);
              }}
              onError={(e) => {
                const msg = e?.message || 'Unknown camera error';
                setCameraMountError(msg);
                logRawEvent('camera', `(mount error: ${msg})`, null);
              }}
            />
            <View style={styles.overlay} pointerEvents="none">
              <ScannerFrame
                active
                size={cameraLayoutSize ? Math.max(100, Math.min(cameraLayoutSize.width - 60, cameraLayoutSize.height - 28)) : 160}
              />
            </View>
            {!cameraReady && !cameraMountError && (
              <View style={styles.cameraLoadingOverlay} pointerEvents="none">
                <Text style={styles.cameraLoadingText}>Starting camera…</Text>
              </View>
            )}
            {cameraMountError && (
              <View style={styles.cameraLoadingOverlay}>
                <Text style={styles.cameraErrorText}>Camera failed to start:</Text>
                <Text style={styles.cameraErrorDetail}>{cameraMountError}</Text>
                <Pressable onPress={restartCamera} style={styles.cameraErrorRetryBtn}>
                  <Text style={styles.cameraErrorRetryText}>Try again</Text>
                </Pressable>
              </View>
            )}
            <Pressable
              onPress={cycleFlashMode}
              style={[styles.torchBtn, torchOn && styles.torchBtnActive]}
            >
              <Ionicons
                name={flashMode === 'off' ? 'flash-off' : 'flash'}
                size={16}
                color={torchOn ? colors.bg : colors.text}
              />
              {flashMode === 'auto' && (
                <Text style={[styles.torchAutoLabel, torchOn && styles.torchAutoLabelActive]}>AUTO</Text>
              )}
            </Pressable>
            <Pressable
              onPress={restartCamera}
              style={styles.restartCameraBtn}
            >
              <Text style={styles.restartCameraBtnText}>Restart camera</Text>
            </Pressable>
            {debugOpen && (
            <View style={styles.debugBadge} pointerEvents="none">
              <Text style={styles.debugBadgeText}>
                {cameraLayoutSize ? `${Math.round(cameraLayoutSize.width)}×${Math.round(cameraLayoutSize.height)}` : 'measuring…'}
                {' · '}{cameraReady ? 'ready' : cameraMountError ? 'error' : 'loading'}
              </Text>
            </View>
            )}
          </>
        )}
        <View style={styles.cameraBorder} pointerEvents="none" />
      </View>

      {/* Big, glanceable result strip — readable at arm's length without
          looking down at the ticket details. */}
      {outcomeBanner && (
        <View style={[
          styles.outcomeBanner,
          outcomeBanner.kind === 'new' ? styles.outcomeNew
            : outcomeBanner.kind === 'duplicate' ? styles.outcomeDup : styles.outcomeErr,
        ]}>
          <Ionicons
            name={outcomeBanner.kind === 'new' ? 'checkmark-circle' : outcomeBanner.kind === 'duplicate' ? 'copy' : 'alert-circle'}
            size={18}
            color={colors.onAccent}
          />
          <Text style={styles.outcomeText} numberOfLines={1} adjustsFontSizeToFit>{outcomeBanner.text}</Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.scrollAll}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.scrollAll}
          contentContainerStyle={styles.scrollAllContent}
          keyboardShouldPersistTaps="handled"
        >
        {currentBayProgress && currentBayProgress.target !== null && (
          <View style={[
            styles.progressBanner,
            currentBayProgress.pending > 0 ? styles.progressBannerPending : styles.progressBannerDone,
          ]}>
            <Text style={styles.progressBannerText}>
              {currentBayProgress.pending > 0
                ? `${currentBayProgress.pending} pending to scan in ${bay} (${currentBayProgress.scanned}/${currentBayProgress.target})`
                : `Target reached for ${bay} (${currentBayProgress.scanned}/${currentBayProgress.target})`}
            </Text>
          </View>
        )}

        <View style={styles.counters}>
          <CounterPill index={0} label="Scanned" value={stats.total} />
          <CounterPill index={1} label="Unique LPN" value={stats.uniqueLpns} accent={colors.success} />
          <CounterPill index={2} label="Duplicates" value={stats.duplicates} accent={stats.duplicates > 0 ? colors.danger : colors.textDim} />
        </View>

        {flashMsg && (
          <View style={styles.flashBanner}>
            <Text style={styles.flashBannerText}>{flashMsg}</Text>
          </View>
        )}

        <View style={styles.toggleLinksRow}>
          <Pressable onPress={() => { animateLayout(); setManualOpen((v) => !v); }}>
            <Text style={styles.manualToggleText}>
              {manualOpen ? 'Hide manual entry' : "Can't scan? Enter code manually"}
            </Text>
          </Pressable>
          <Pressable onPress={() => { animateLayout(); setDebugOpen((v) => !v); }}>
            <Text style={styles.manualToggleText}>
              {debugOpen ? 'Hide raw scan log' : 'Show raw scan log (debug)'}
            </Text>
          </Pressable>
        </View>

        {manualOpen && (
          <View style={styles.manualBlock}>
            <View style={styles.manualRow}>
              <TextInput
                value={manualValue}
                onChangeText={(v) => { setManualValue(v); setManualError(null); }}
                onFocus={() => setNoteEditing(true)}
                onBlur={() => setNoteEditing(false)}
                placeholder="Paste or type raw code value"
                placeholderTextColor={colors.textFaint}
                style={[styles.manualInput, manualError && styles.manualInputError]}
                autoCapitalize="characters"
              />
              <Pressable onPress={submitManual} style={styles.manualBtn}>
                <Text style={styles.manualBtnText}>Log</Text>
              </Pressable>
            </View>
            {manualError && <Text style={styles.manualErrorText}>{manualError}</Text>}
          </View>
        )}

        {debugOpen && (
          <RawScanDebugPanel
            log={rawLog}
            liveBuffer={liveBuffer}
            scanMode={scanMode}
            onClear={clearRawLog}
            onShare={shareRawLog}
          />
        )}

        <View style={styles.resultBlock}>
          {lastScan ? (
            <>
              <View style={styles.resultHeaderRow}>
                <Text style={styles.resultHeaderLabel}>Last scan</Text>
                <Pressable onPress={clearLastScan} style={styles.clearBtn}>
                  <Text style={styles.clearBtnText}>Clear</Text>
                </Pressable>
              </View>
              <TicketCard scan={lastScan} />
              {showNoteFields && (
                <View style={styles.noteBlock}>
                  <View style={styles.physQtyRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.physQtyLabel}>Phy. Qty (optional — only if count differs)</Text>
                      <TextInput
                        value={physQtyDraft}
                        onChangeText={(v) => { setPhysQtyDraft(v); setNoteSaved(false); }}
                        onFocus={() => { setNoteEditing(true); scrollToNoteFields(); }}
                        onBlur={() => setNoteEditing(false)}
                        placeholder={`System qty: ${lastScan.quantity ?? '—'}`}
                        placeholderTextColor={colors.textFaint}
                        style={styles.physQtyInput}
                        keyboardType="numeric"
                      />
                    </View>
                  </View>
                  <View style={styles.remarksRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.physQtyLabel}>Remarks (optional)</Text>
                      <TextInput
                        value={remarksDraft}
                        onChangeText={(v) => { setRemarksDraft(v); setNoteSaved(false); }}
                        onFocus={() => { setNoteEditing(true); scrollToNoteFields(); }}
                        onBlur={() => setNoteEditing(false)}
                        placeholder="Any additional note for this scan"
                        placeholderTextColor={colors.textFaint}
                        style={styles.remarksInput}
                        multiline
                      />
                    </View>
                  </View>
                  <PressScale onPress={saveNote} style={styles.physQtySaveBtn}>
                    <Text style={styles.physQtySaveText}>{noteSaved ? 'Saved' : 'Save'}</Text>
                  </PressScale>
                </View>
              )}
            </>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>
                {scanMode === 'hardware' ? 'Pull the trigger on a pallet label' : 'Point the camera at a pallet label'}
              </Text>
              <Text style={styles.emptyBody}>Scanned details will appear here with an instant duplicate check.</Text>
            </View>
          )}
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function CounterPill({ label, value, accent, index = 0 }) {
  return (
    <FadeRise index={index} style={styles.pill}>
      <Text style={[styles.pillValue, accent && { color: accent }]}>{value}</Text>
      <Text style={styles.pillLabel}>{label}</Text>
    </FadeRise>
  );
}

function ModeButton({ label, active, onPress }) {
  return (
    <PressScale onPress={onPress} containerStyle={{ flex: 1 }} style={[styles.modeBtn, active && styles.modeBtnActive]}>
      <Text style={[styles.modeBtnText, active && styles.modeBtnTextActive]}>{label}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space(5),
    paddingTop: space(3),
    paddingBottom: space(2),
  },
  headerUser: { fontFamily: fonts.bodySemi, color: colors.text, fontSize: 15 },
  headerBay: { fontFamily: fonts.body, color: colors.textDim, fontSize: 12.5, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cloudChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1.5, borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 6, maxWidth: 170,
  },
  cloudChipText: { fontFamily: fonts.bodySemi, fontSize: 11.5 },
  changeBtn: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  changeBtnText: { fontFamily: fonts.bodyMed, color: colors.accent, fontSize: 12.5 },

  scrollAll: { flex: 1 },
  scrollAllContent: { paddingTop: space(3), paddingBottom: space(10) },

  modeToggleRow: { flexDirection: 'row', gap: 8, paddingHorizontal: space(5), marginBottom: space(3) },
  modeBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panel,
  },
  modeBtnActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  modeBtnText: { fontFamily: fonts.bodySemi, color: colors.textDim, fontSize: 12.5 },
  modeBtnTextActive: { color: colors.accent },
  hardwareWrap: { flex: 1, justifyContent: 'center', padding: space(4) },

  counters: { flexDirection: 'row', gap: 8, paddingHorizontal: space(5), marginBottom: space(3) },
  pill: {
    flex: 1, backgroundColor: colors.panel, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, paddingVertical: 10, alignItems: 'center',
  },
  pillValue: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.text },
  pillLabel: { fontFamily: fonts.bodyMed, fontSize: 10, color: colors.textDim, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 1 },

  cameraWrap: {
    marginHorizontal: space(5),
    height: 232,
    position: 'relative',
    backgroundColor: colors.panel,
    // The preview runs in "cover" mode, which scales the camera image
    // larger than the box to fill it edge to edge — the overflow must be
    // clipped or it bleeds over the counters below. Clipping is safe now
    // that the preview is a TextureView (androidPreviewViewType); it was
    // only SurfaceView that could not be clipped (the black-preview bug).
    overflow: 'hidden',
    borderRadius: radius.sm,
  },
  cameraBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  camera: { ...StyleSheet.absoluteFillObject },
  outcomeBanner: {
    marginHorizontal: space(5), marginTop: space(2),
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 12,
  },
  outcomeNew: { backgroundColor: colors.success },
  outcomeDup: { backgroundColor: colors.danger },
  outcomeErr: { backgroundColor: colors.accent },
  outcomeText: { flex: 1, fontFamily: fonts.displayBold, color: colors.onAccent, fontSize: 17, letterSpacing: 0.4 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  restartCameraBtn: {
    position: 'absolute', bottom: 10, right: 10,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.pill,
    paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: colors.border,
  },
  restartCameraBtnText: { fontFamily: fonts.bodyMed, color: colors.text, fontSize: 11.5 },
  torchBtn: {
    position: 'absolute', top: 10, right: 10,
    minWidth: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 3, paddingHorizontal: 9,
    backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: colors.border,
  },
  torchBtnActive: {
    backgroundColor: colors.accent, borderColor: colors.accent,
  },
  torchAutoLabel: { fontFamily: fonts.bodyBold, fontSize: 9.5, color: colors.text, letterSpacing: 0.5 },
  torchAutoLabelActive: { color: colors.bg },
  debugBadge: {
    position: 'absolute', bottom: 10, left: 10,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.sm,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  debugBadgeText: { fontFamily: fonts.mono, fontSize: 10, color: colors.accent },
  cameraLoadingOverlay: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(11,14,17,0.85)', padding: space(5),
  },
  cameraLoadingText: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 13 },
  cameraErrorText: { fontFamily: fonts.bodyBold, color: colors.danger, fontSize: 13.5, marginBottom: 4 },
  cameraErrorDetail: { fontFamily: fonts.body, color: colors.textDim, fontSize: 11.5, textAlign: 'center', marginBottom: 12 },
  cameraErrorRetryBtn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 9 },
  cameraErrorRetryText: { fontFamily: fonts.bodyBold, color: colors.bg, fontSize: 12.5 },
  cameraFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(5), gap: 12 },
  permText: { fontFamily: fonts.body, color: colors.textDim, fontSize: 13, textAlign: 'center' },
  permBtn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 10 },
  permBtnText: { fontFamily: fonts.bodyBold, color: colors.onAccent, fontSize: 13 },

  flashBanner: {
    marginHorizontal: space(5), marginTop: space(3),
    backgroundColor: colors.successSoft, borderRadius: radius.sm,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  flashBannerText: { fontFamily: fonts.bodyMed, color: colors.success, fontSize: 12.5 },

  toggleLinksRow: { flexDirection: 'row', justifyContent: 'center', gap: space(6), marginTop: space(3) },
  manualToggleText: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 12.5, textDecorationLine: 'underline' },
  manualBlock: { marginTop: space(1) },
  manualRow: { flexDirection: 'row', gap: 8, paddingHorizontal: space(5), marginTop: space(2) },
  manualInput: {
    flex: 1, backgroundColor: colors.panelAlt, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: colors.text,
    fontFamily: fonts.mono, fontSize: 13,
  },
  manualBtn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: 18, justifyContent: 'center' },
  manualBtnText: { fontFamily: fonts.bodyBold, color: colors.onAccent, fontSize: 13.5 },
  manualInputError: { borderColor: colors.danger },
  manualErrorText: {
    color: colors.danger, fontFamily: fonts.bodyMed, fontSize: 11.5,
    marginTop: 6, marginHorizontal: space(5), lineHeight: 16,
  },

  resultBlock: { padding: space(5), paddingTop: space(3) },
  resultHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: space(2),
  },
  resultHeaderLabel: {
    fontFamily: fonts.bodySemi, color: colors.textDim, fontSize: 12,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  clearBtn: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  clearBtnText: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 11.5 },
  emptyState: { alignItems: 'center', paddingTop: space(3), paddingBottom: space(2), paddingHorizontal: space(6) },
  emptyTitle: { fontFamily: fonts.displayMed, color: colors.text, fontSize: 14.5, textAlign: 'center' },
  emptyBody: { fontFamily: fonts.body, color: colors.textFaint, fontSize: 11.5, textAlign: 'center', marginTop: 4, lineHeight: 15 },

  physQtyRow: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-end',
  },
  physQtyLabel: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 11.5, marginBottom: 6 },
  physQtyInput: {
    backgroundColor: colors.panelAlt, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: colors.text,
    fontFamily: fonts.monoBold, fontSize: 14,
  },
  physQtySaveBtn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', marginTop: space(2) },
  physQtySaveText: { fontFamily: fonts.bodyBold, color: colors.onAccent, fontSize: 13 },

  noteBlock: { marginTop: space(3), gap: space(3) },
  remarksRow: { flexDirection: 'row' },
  remarksInput: {
    backgroundColor: colors.panelAlt, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: colors.text,
    fontFamily: fonts.bodyMed, fontSize: 13.5, minHeight: 60, textAlignVertical: 'top',
  },

  progressBanner: {
    marginHorizontal: space(5), marginBottom: space(3),
    borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1.5,
  },
  progressBannerPending: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  progressBannerDone: { backgroundColor: colors.successSoft, borderColor: colors.success },
  progressBannerText: { fontFamily: fonts.bodySemi, color: colors.text, fontSize: 12.5 },
});
