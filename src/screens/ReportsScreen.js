import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { colors, type as fonts, radius, space } from '../theme/theme';
import { useAppData } from '../context/AppDataContext';
import { exportAndShareCsv, exportAndShareBackupJson, readBackupJson } from '../utils/exportFiles';
import AdminPinModal from '../components/AdminPinModal';
import BayTargetEditorModal from '../components/BayTargetEditorModal';
import ServerSheet, { syncStatusMeta } from '../components/ServerSheet';
import { useSync } from '../context/SyncContext';
import { Ionicons } from '@expo/vector-icons';
import { PressScale, FadeRise, Collapsible } from '../components/motion';

export default function ReportsScreen() {
  const { scans, stats, bay, addManyScans, wipeAllScans, bayProgress, serverConfig } = useAppData();
  const { status: syncStatus, pendingCount, lastSyncAt, linked } = useSync();
  const [serverSheetOpen, setServerSheetOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [targetsPinOpen, setTargetsPinOpen] = useState(false);
  const [targetsModalOpen, setTargetsModalOpen] = useState(false);

  const doExportCsv = async () => {
    if (scans.length === 0) {
      Alert.alert('Nothing to export', 'No scans logged yet.');
      return;
    }
    setBusy('csv');
    try {
      const { exportedCount, skippedCount } = await exportAndShareCsv(scans, bay, bayProgress);
      if (skippedCount > 0) {
        setTimeout(() => Alert.alert(
          'Report ready',
          `Exported ${exportedCount} unique record${exportedCount === 1 ? '' : 's'}. Skipped ${skippedCount} duplicate-flagged scan${skippedCount === 1 ? '' : 's'}.`
        ), 400);
      }
    } catch (e) {
      Alert.alert('Export failed', String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  const doExportBackup = async () => {
    if (scans.length === 0) {
      Alert.alert('Nothing to export', 'No scans logged yet.');
      return;
    }
    setBusy('backup');
    try {
      await exportAndShareBackupJson(scans);
    } catch (e) {
      Alert.alert('Export failed', String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  const doImportMerge = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;
      setBusy('import');
      const incoming = await readBackupJson(uri);
      const added = await addManyScans(incoming);
      Alert.alert('Merged', `Added ${added} new record${added === 1 ? '' : 's'} from that file.${incoming.length - added > 0 ? ` (${incoming.length - added} already existed and were skipped.)` : ''}`);
    } catch (e) {
      Alert.alert('Import failed', String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  const confirmClear = () => {
    Alert.alert(
      'Clear all scans?',
      'This removes every scan stored on this device. Export a backup first if you need it. Admin PIN required on the next step.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: () => setPinModalOpen(true) },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: space(5) }}>
      <Text style={styles.title}>Reports</Text>
      <Text style={styles.subtitle}>
        {stats.total} scan{stats.total === 1 ? '' : 's'} logged on this device
        {stats.duplicates > 0 ? ` · ${stats.duplicates} duplicate${stats.duplicates === 1 ? '' : 's'} flagged` : ''}.
      </Text>

      <Section index={0} title="Data center">
        {(() => { const m = syncStatusMeta(syncStatus, pendingCount); return (
          <PressScale onPress={() => setServerSheetOpen(true)} scaleTo={0.98} style={[styles.serverCard, { borderColor: m.color }]}>
            <Ionicons name={m.icon} size={24} color={m.color} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.serverLabel, { color: m.color }]}>{m.label}</Text>
              <Text style={styles.serverSub}>
                {linked ? `${serverConfig.url} · ${serverConfig.deviceName}` : 'Not linked — tap to enter the server address or scan its QR from the Scan screen.'}
                {lastSyncAt ? ` · last sync ${lastSyncAt.toLocaleTimeString()}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </PressScale>
        ); })()}
        <Text style={styles.blurb}>
          Every scan is pushed to the data center the moment it is logged and marked with the server's
          receipt number. Anything that could not be sent stays queued on this device and goes up
          automatically when the network is back — or press Sync now. Nothing is lost either way.
        </Text>
      </Section>

      <Section index={1} title="Send to team">
        <Text style={styles.blurb}>
          Produces a spreadsheet with Timestamp, User, Warehouse, Bay, LPN, Part Number, Qty, Phy. Qty, Segment and
          QR Type — unique records only (duplicate-flagged scans are excluded automatically) — ready
          to forward on WhatsApp, email, or save to Drive from the share sheet.
        </Text>
        <ActionButton
          label="Download report (.csv)"
          onPress={doExportCsv}
          loading={busy === 'csv'}
          primary
        />
      </Section>

      <Section index={2} title="Combine multiple bays">
        <Text style={styles.blurb}>
          With a data center linked, consolidation is automatic — export the full count from its
          dashboard. These backups remain as a fallback when no server is available: export on every
          phone, then import each file into a single device.
        </Text>
        <ActionButton label="Export backup (.json)" onPress={doExportBackup} loading={busy === 'backup'} />
        <View style={{ height: 10 }} />
        <ActionButton label="Import & merge a backup" onPress={doImportMerge} loading={busy === 'import'} />
      </Section>

      <Section index={3} title="Bay progress">
        {bayProgress.filter((p) => p.target !== null).length === 0 ? (
          <Text style={styles.blurb}>No bay targets set yet. An admin can set an expected physical
            count per bay — the Scan screen then alerts when that bay still has pallets pending.</Text>
        ) : (
          <View style={{ gap: 8, marginBottom: space(4) }}>
            {bayProgress.filter((p) => p.target !== null).map((p) => (
              <View key={p.bay} style={[styles.progressRow, p.pending > 0 ? styles.progressRowPending : styles.progressRowDone]}>
                <Text style={styles.progressBay}>{p.bay}</Text>
                <Text style={styles.progressCounts}>
                  {p.scanned} / {p.target}{p.pending > 0 ? ` · ${p.pending} pending` : ' · complete'}
                </Text>
              </View>
            ))}
          </View>
        )}
        {linked ? (
          <Text style={styles.blurb}>Bay targets are managed on the data center dashboard (Edit targets) while this device is linked — they refresh here automatically.</Text>
        ) : (
          <ActionButton label="Manage bay targets (Admin)" onPress={() => setTargetsPinOpen(true)} />
        )}
      </Section>

      <Section index={4} title="Danger zone" defaultOpen={false}>
        <ActionButton label="Clear all scans on this device" onPress={confirmClear} danger />
      </Section>

      <AdminPinModal
        visible={pinModalOpen}
        title="Confirm clear all"
        message="Enter the admin PIN to permanently delete every scan on this device."
        onConfirm={() => { setPinModalOpen(false); wipeAllScans(); }}
        onCancel={() => setPinModalOpen(false)}
      />

      <AdminPinModal
        visible={targetsPinOpen}
        title="Admin PIN required"
        message="Enter the admin PIN to set expected physical counts per bay."
        onConfirm={() => { setTargetsPinOpen(false); setTargetsModalOpen(true); }}
        onCancel={() => setTargetsPinOpen(false)}
      />

      <BayTargetEditorModal visible={targetsModalOpen} onClose={() => setTargetsModalOpen(false)} />
      <ServerSheet visible={serverSheetOpen} onClose={() => setServerSheetOpen(false)} />
    </ScrollView>
  );
}

function Section({ title, children, defaultOpen = true, index = 0 }) {
  // Each group fades up a beat after the previous one on first render;
  // tapping the header expands/collapses with the chevron turning.
  return (
    <FadeRise index={index}>
      <Collapsible title={title} defaultOpen={defaultOpen} style={styles.section}>
        {children}
      </Collapsible>
    </FadeRise>
  );
}

function ActionButton({ label, onPress, loading, primary, danger }) {
  return (
    <PressScale
      onPress={onPress}
      disabled={!!loading}
      containerStyle={{ alignSelf: 'stretch' }}
      style={[
        styles.btn,
        primary && styles.btnPrimary,
        danger && styles.btnDanger,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.onAccent : colors.text} />
      ) : (
        <Text style={[
          styles.btnText,
          primary && styles.btnTextPrimary,
          danger && styles.btnTextDanger,
        ]}>{label}</Text>
      )}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: { fontFamily: fonts.displayBold, color: colors.text, fontSize: 32, marginTop: space(3) },
  subtitle: { fontFamily: fonts.body, color: colors.textDim, fontSize: 13, marginTop: 2, marginBottom: space(7) },
  section: { marginBottom: space(8) },
  sectionTitle: {
    fontFamily: fonts.bodySemi, color: colors.text, fontSize: 15, marginBottom: 8,
  },
  blurb: { fontFamily: fonts.body, color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginBottom: space(4) },
  btn: {
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panel,
    borderRadius: radius.md, paddingVertical: 14, alignItems: 'center',
  },
  btnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnDanger: { borderColor: colors.danger },
  btnText: { fontFamily: fonts.bodySemi, color: colors.text, fontSize: 14 },
  btnTextPrimary: { color: colors.onAccent },
  btnTextDanger: { color: colors.danger },
  serverCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: radius.md,
    backgroundColor: colors.panel, padding: 12, marginBottom: space(3),
  },
  serverLabel: { fontFamily: fonts.bodyBold, fontSize: 14 },
  serverSub: { fontFamily: fonts.body, color: colors.textDim, fontSize: 11.5, marginTop: 2, lineHeight: 15 },
  progressRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1.5, borderRadius: radius.md, padding: 12,
  },
  progressRowPending: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  progressRowDone: { borderColor: colors.success, backgroundColor: colors.successSoft },
  progressBay: { fontFamily: fonts.monoBold, color: colors.text, fontSize: 15 },
  progressCounts: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 12 },
});
