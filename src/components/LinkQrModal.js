import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, Platform, Alert } from 'react-native';
import { Camera as VisionCamera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, type as fonts, radius, space } from '../theme/theme';
import { useSync, isSetupCode } from '../context/SyncContext';
import HardwareScanInput from './HardwareScanInput';
import ScannerFrame from './ScannerFrame';
import { PressScale } from './motion';

// Dedicated "link this device" scanner. Opens from the Data center sheet
// so linking is discoverable and works regardless of the Scan screen's
// mode: the camera is live AND the hardware trigger is captured at the
// same time. Accepts only the dashboard's setup code
// (aisstocktake://server?url=...); anything else shows a hint.

export default function LinkQrModal({ visible, onClose, onLinked }) {
  const { linkFromSetupCode } = useSync();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const [hint, setHint] = useState(null);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState(null);
  const lastRef = useRef({ raw: null, at: 0 });

  useEffect(() => { if (visible) { setHint(null); setBusy(false); } }, [visible]);

  const handle = useCallback(async (raw) => {
    const now = Date.now();
    if (raw === lastRef.current.raw && now - lastRef.current.at < 3000) return;
    lastRef.current = { raw, at: now };
    if (!isSetupCode(raw)) {
      setHint('That is not the data-center QR. Scan the QR shown top-right on the dashboard.');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const url = await linkFromSetupCode(raw);
      if (!url) throw new Error('Setup code not understood');
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onLinked?.(url);
      onClose();
    } catch (e) {
      Alert.alert('Could not link', String(e?.message || e));
      setBusy(false);
    }
  }, [busy, linkFromSetupCode, onLinked, onClose]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => { for (const c of codes) if (c.value) handle(c.value); },
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Link to data center</Text>
            <Text style={styles.sub}>Point at the QR on the dashboard, or pull the trigger on it.</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={colors.textDim} /></Pressable>
        </View>

        <View
          style={styles.cameraBox}
          onLayout={(e) => { const { width, height } = e.nativeEvent.layout; setSize({ width, height }); }}
        >
          {!hasPermission ? (
            <View style={styles.center}>
              <Text style={styles.permText}>Camera access is needed to scan the dashboard QR.</Text>
              <PressScale onPress={requestPermission} style={styles.permBtn}><Text style={styles.permBtnText}>Grant camera access</Text></PressScale>
              <Text style={styles.permText}>Or just pull the scanner trigger on the QR — that works without the camera.</Text>
            </View>
          ) : !device ? (
            <View style={styles.center}><Text style={styles.permText}>No back camera on this device — use the trigger.</Text></View>
          ) : (
            <>
              <VisionCamera
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={visible}
                codeScanner={codeScanner}
                androidPreviewViewType="texture-view"
                resizeMode="cover"
              />
              <View style={styles.overlay} pointerEvents="none">
                <ScannerFrame active size={size ? Math.max(120, Math.min(size.width - 80, size.height - 60)) : 200} />
              </View>
            </>
          )}
        </View>

        {hint && <Text style={styles.hint}>{hint}</Text>}

        <View style={styles.hwWrap}>
          <HardwareScanInput active={visible} onScan={handle} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: Platform.OS === 'android' ? 28 : 54 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: space(5), paddingBottom: space(3) },
  title: { fontFamily: fonts.displayBold, color: colors.text, fontSize: 22 },
  sub: { fontFamily: fonts.body, color: colors.textDim, fontSize: 12.5, marginTop: 2, maxWidth: 300 },
  cameraBox: { marginHorizontal: space(5), height: 320, backgroundColor: colors.panel, borderRadius: radius.sm, overflow: 'hidden', borderWidth: 1.5, borderColor: colors.border },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(5), gap: 12 },
  permText: { fontFamily: fonts.body, color: colors.textDim, fontSize: 13, textAlign: 'center' },
  permBtn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 10 },
  permBtnText: { fontFamily: fonts.bodyBold, color: colors.onAccent, fontSize: 13 },
  hint: { fontFamily: fonts.bodyMed, color: colors.danger, fontSize: 12.5, marginHorizontal: space(5), marginTop: space(3), textAlign: 'center' },
  hwWrap: { marginTop: space(4) },
});
