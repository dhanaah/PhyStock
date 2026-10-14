import React, { useState, useEffect, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Modal, View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  Platform, ScrollView, Keyboard, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, type as fonts, radius, space } from '../theme/theme';
import { useAppData } from '../context/AppDataContext';
import { useSync } from '../context/SyncContext';
import { PressScale } from './motion';

// Data-center link sheet: address, device name, Test, Sync now, status.
// Reachable from the cloud chip in the Scan header and from Reports.

export function syncStatusMeta(status, pendingCount) {
  if (status === 'off') return { color: colors.textFaint, icon: 'cloud-offline-outline', label: 'No data center' };
  if (status === 'syncing') return { color: colors.info, icon: 'cloud-upload-outline', label: 'Syncing…' };
  if (status === 'offline') return { color: colors.danger, icon: 'cloud-offline-outline', label: pendingCount > 0 ? `Offline · ${pendingCount} pending` : 'Offline' };
  return pendingCount > 0
    ? { color: colors.accent, icon: 'cloud-upload-outline', label: `${pendingCount} pending` }
    : { color: colors.success, icon: 'cloud-done-outline', label: 'Synced' };
}

export default function ServerSheet({ visible, onClose }) {
  const { serverConfig, saveServerConfig } = useAppData();
  const { status, lastSyncAt, lastError, pendingCount, pushNow, testConnection, serverInfo, heartbeat } = useSync();
  const [url, setUrl] = useState(serverConfig.url || '');
  const [name, setName] = useState(serverConfig.deviceName || '');
  const [busy, setBusy] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const { height: screenH } = useWindowDimensions();
  // Android (edge-to-edge, inside a Modal) no longer resizes the window
  // for the keyboard, so KeyboardAvoidingView/adjustResize can't be relied
  // on here. Track the keyboard height ourselves and shrink the sheet by
  // exactly that much — the sticky footer with the action buttons then
  // always sits just above the keyboard, and above the gesture bar when
  // the keyboard is closed.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEv, (e) => setKbHeight(e?.endCoordinates?.height || 0));
    const b = Keyboard.addListener(hideEv, () => setKbHeight(0));
    return () => { a.remove(); b.remove(); };
  }, []);
  useEffect(() => { if (!visible) setKbHeight(0); }, [visible]);
  const bottomInset = Math.max(insets.bottom, 12);
  const sheetMaxH = Math.max(260, screenH - kbHeight - 40);
  // The sheet lives in a Modal, outside the app's SafeAreaView — so it
  // has to add the gesture-bar inset itself, and bring the action buttons
  // above the keyboard when an input is focused.
  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);

  useEffect(() => {
    if (visible) {
      setUrl(serverConfig.url || '');
      setName(serverConfig.deviceName || '');
      setTestResult(null);
    }
  }, [visible, serverConfig.url, serverConfig.deviceName]);

  const meta = syncStatusMeta(status, pendingCount);

  const doTest = async () => {
    setBusy('test');
    const r = await testConnection(url);
    setTestResult(r);
    setBusy(null);
  };

  const doSave = async () => {
    setBusy('save');
    await saveServerConfig({ url: url.trim(), deviceName: name.trim() || serverConfig.deviceName });
    setBusy(null);
    setTimeout(() => { heartbeat(); pushNow(); }, 50);
  };

  const doSync = async () => {
    setBusy('sync');
    const r = await pushNow({ manual: true });
    setBusy(null);
    if (r.ok) setTestResult({ ok: true, info: { serverName: `Sent ${r.sent} record${r.sent === 1 ? '' : 's'}` } });
    else if (r.reason === 'error') setTestResult({ ok: false, error: String(r.error?.message || r.error) });
  };

  const doUnlink = async () => {
    setBusy('save');
    await saveServerConfig({ url: '' });
    setUrl('');
    setBusy(null);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={() => { Keyboard.dismiss(); onClose(); }} />
        <View style={[styles.sheet, { maxHeight: sheetMaxH, marginBottom: Platform.OS === 'android' ? kbHeight : 0 }]}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Data center</Text>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={colors.textDim} /></Pressable>
          </View>
          <ScrollView
            ref={scrollRef}
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >

            <View style={[styles.statusCard, { borderColor: meta.color }]}>
              <Ionicons name={meta.icon} size={22} color={meta.color} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusLabel, { color: meta.color }]}>{meta.label}</Text>
                <Text style={styles.statusSub}>
                  {serverInfo?.serverName ? `${serverInfo.serverName}` : (serverConfig.url ? serverConfig.url : 'Not linked')}
                  {serverInfo?.stocktake?.name ? ` · ${serverInfo.stocktake.name}` : ''}
                </Text>
                <Text style={styles.statusSub}>
                  {lastSyncAt ? `Last sync ${lastSyncAt.toLocaleTimeString()}` : 'No sync yet'}
                  {lastError ? ` · ${lastError}` : ''}
                </Text>
              </View>
            </View>

            <PressScale onPress={doSync} disabled={!!busy || !serverConfig.url} style={[styles.btn, styles.btnPrimary, (!serverConfig.url) && styles.btnDisabled]}>
              {busy === 'sync' ? <ActivityIndicator color={colors.onAccent} /> : (
                <Text style={styles.btnTextPrimary}>
                  <Ionicons name="sync" size={14} color={colors.onAccent} /> {'  '}Sync now{pendingCount > 0 ? ` (${pendingCount} pending)` : ''}
                </Text>
              )}
            </PressScale>

            <Text style={styles.label}>Server address</Text>
            <TextInput
              value={url}
              onChangeText={(v) => { setUrl(v); setTestResult(null); }}
              placeholder="e.g. 192.168.1.20:8765"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onFocus={scrollToEnd}
            />
            <Text style={styles.hint}>
              Tip: on the Scan screen, scan the QR shown on the data center dashboard — the address fills in automatically.
            </Text>

            <Text style={styles.label}>This device's name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. TC22-Bay-A"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              autoCapitalize="characters"
              onFocus={scrollToEnd}
            />

            {testResult && (
              <View style={[styles.result, testResult.ok ? styles.resultOk : styles.resultBad]}>
                <Ionicons name={testResult.ok ? 'checkmark-circle' : 'alert-circle'} size={16} color={testResult.ok ? colors.success : colors.danger} />
                <Text style={[styles.resultText, { color: testResult.ok ? colors.success : colors.danger }]}>
                  {testResult.ok
                    ? `${testResult.info?.serverName || 'Connected'}${testResult.info?.serverVersion ? ` · v${testResult.info.serverVersion}` : ''}`
                    : testResult.error}
                </Text>
              </View>
            )}

            {!!serverConfig.url && (
              <Pressable onPress={doUnlink} disabled={!!busy} style={styles.unlink}>
                <Text style={styles.unlinkText}>Unlink this device (records stay on the device)</Text>
              </Pressable>
            )}
            <Text style={styles.footnote}>Device ID {serverConfig.deviceId}</Text>
          </ScrollView>

          {/* Sticky footer — never scrolls away, never under the keyboard or gesture bar. */}
          <View style={[styles.footer, { paddingBottom: bottomInset }]}>
            <PressScale onPress={doTest} disabled={!!busy} containerStyle={{ flex: 1 }} style={styles.btn}>
              {busy === 'test' ? <ActivityIndicator color={colors.text} /> : <Text style={styles.btnText}>Test connection</Text>}
            </PressScale>
            <PressScale onPress={() => { Keyboard.dismiss(); doSave(); }} disabled={!!busy} containerStyle={{ flex: 1 }} style={[styles.btn, styles.btnPrimary]}>
              {busy === 'save' ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.btnTextPrimary}>Save & link</Text>}
            </PressScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderTopWidth: 1.5, borderColor: colors.border,
  },
  footer: {
    flexDirection: 'row', gap: 8, paddingHorizontal: space(5), paddingTop: space(3),
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bgElevated,
  },
  sheetContent: { paddingHorizontal: space(5), paddingBottom: space(4) },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space(5), paddingTop: space(4), paddingBottom: space(2) },
  title: { fontFamily: fonts.displayBold, color: colors.text, fontSize: 22 },
  statusCard: {
    flexDirection: 'row', gap: 12, alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md,
    backgroundColor: colors.panel, padding: 12, marginBottom: space(3),
  },
  statusLabel: { fontFamily: fonts.bodyBold, fontSize: 14 },
  statusSub: { fontFamily: fonts.body, color: colors.textDim, fontSize: 11.5, marginTop: 1 },
  label: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 11.5, marginTop: space(3), marginBottom: 6 },
  input: {
    backgroundColor: colors.panelAlt, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 11, color: colors.text, fontFamily: fonts.mono, fontSize: 14,
  },
  hint: { fontFamily: fonts.body, color: colors.textFaint, fontSize: 11, marginTop: 6, lineHeight: 15 },
  row: { flexDirection: 'row', gap: 8, marginTop: space(4) },
  btn: {
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panel, borderRadius: radius.md,
    paddingVertical: 13, alignItems: 'center', justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontFamily: fonts.bodySemi, color: colors.text, fontSize: 13.5 },
  btnTextPrimary: { fontFamily: fonts.bodyBold, color: colors.onAccent, fontSize: 13.5 },
  result: { flexDirection: 'row', gap: 8, alignItems: 'center', borderRadius: radius.sm, padding: 10, marginTop: space(3), borderWidth: 1 },
  resultOk: { backgroundColor: colors.successSoft, borderColor: colors.success },
  resultBad: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  resultText: { fontFamily: fonts.bodyMed, fontSize: 12.5, flex: 1 },
  unlink: { alignItems: 'center', marginTop: space(4) },
  unlinkText: { fontFamily: fonts.bodyMed, color: colors.textFaint, fontSize: 12, textDecorationLine: 'underline' },
  footnote: { fontFamily: fonts.mono, color: colors.textFaint, fontSize: 10, textAlign: 'center', marginTop: space(4) },
});
