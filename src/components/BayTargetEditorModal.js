import React, { useState } from 'react';
import { Modal, View, Text, Pressable, TextInput, ScrollView, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { colors, type as fonts, radius, space } from '../theme/theme';
import { useAppData } from '../context/AppDataContext';
import BayPicker from './BayPicker';
import { parseBayTargetsCsv, buildBayTargetsTemplateCsv } from '../utils/bayTargetsCsv';

export default function BayTargetEditorModal({ visible, onClose }) {
  const { bayProgress, setBayTarget, importBayTargets } = useAppData();
  const [pickBay, setPickBay] = useState(null);
  const [countDraft, setCountDraft] = useState('');
  const [busy, setBusy] = useState(null);

  const save = () => {
    if (!pickBay || !countDraft.trim()) return;
    setBayTarget(pickBay, countDraft.trim());
    setCountDraft('');
    setPickBay(null);
  };

  const remove = (bayCode) => {
    setBayTarget(bayCode, null);
  };

  const importCsv = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/csv', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;
      setBusy('import');
      const text = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
      const { entries, errors } = parseBayTargetsCsv(text);
      if (entries.length > 0) {
        await importBayTargets(entries);
      }
      const errorPreview = errors.slice(0, 5).join('\n') + (errors.length > 5 ? `\n…and ${errors.length - 5} more` : '');
      if (entries.length === 0) {
        Alert.alert('Nothing imported', errorPreview || 'No valid rows found in that file.');
      } else if (errors.length > 0) {
        Alert.alert('Imported with some issues', `Set targets for ${entries.length} bay${entries.length === 1 ? '' : 's'}.\n\nSkipped ${errors.length} row${errors.length === 1 ? '' : 's'}:\n${errorPreview}`);
      } else {
        Alert.alert('Imported', `Set targets for ${entries.length} bay${entries.length === 1 ? '' : 's'}.`);
      }
    } catch (e) {
      Alert.alert('Import failed', String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  const shareTemplate = async () => {
    try {
      setBusy('template');
      const csv = buildBayTargetsTemplateCsv();
      const fileUri = FileSystem.documentDirectory + 'BayTargets_Template.csv';
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Bay targets CSV template' });
      }
    } catch (e) {
      Alert.alert('Couldn\'t share template', String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Bay targets</Text>
          <Text style={styles.subtitle}>
            Set the expected physical count for a bay. The Scan screen alerts when that bay still has
            pallets pending, and Reports shows progress across all bays.
          </Text>

          <ScrollView style={{ maxHeight: 420 }}>
            <Text style={styles.subLabel}>Bulk upload</Text>
            <View style={styles.bulkRow}>
              <Pressable onPress={importCsv} style={[styles.bulkBtn, styles.bulkBtnPrimary]} disabled={!!busy}>
                {busy === 'import' ? <ActivityIndicator color={colors.onAccent} /> : (
                  <Text style={styles.bulkBtnTextPrimary}>Import CSV</Text>
                )}
              </Pressable>
              <Pressable onPress={shareTemplate} style={styles.bulkBtn} disabled={!!busy}>
                {busy === 'template' ? <ActivityIndicator color={colors.text} /> : (
                  <Text style={styles.bulkBtnText}>Get template</Text>
                )}
              </Pressable>
            </View>
            <Text style={styles.hint}>CSV format: two columns, "Bay,Target" — one bay per row (e.g. A01,50). Header row optional.</Text>

            <Text style={[styles.subLabel, { marginTop: space(6) }]}>Or set one bay manually</Text>
            <BayPicker value={pickBay} onChange={setPickBay} />

            <Text style={[styles.subLabel, { marginTop: space(4) }]}>Expected count</Text>
            <TextInput
              value={countDraft}
              onChangeText={(v) => setCountDraft(v.replace(/[^0-9]/g, ''))}
              placeholder="e.g. 50"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              keyboardType="number-pad"
            />
            <Pressable onPress={save} style={styles.saveBtn}>
              <Text style={styles.saveBtnText}>Save target</Text>
            </Pressable>

            {bayProgress.filter((p) => p.target !== null).length > 0 && (
              <>
                <Text style={[styles.subLabel, { marginTop: space(6) }]}>Current targets</Text>
                {bayProgress.filter((p) => p.target !== null).map((p) => (
                  <View key={p.bay} style={styles.progressRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.progressBay}>{p.bay}</Text>
                      <Text style={styles.progressCounts}>
                        {p.scanned} / {p.target} scanned
                        {p.pending > 0 ? ` · ${p.pending} pending` : ' · complete'}
                      </Text>
                    </View>
                    <Pressable onPress={() => remove(p.bay)} style={styles.removeBtn}>
                      <Text style={styles.removeBtnText}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: space(6), paddingBottom: space(8),
    borderTopWidth: 1.5, borderColor: colors.border,
  },
  title: { fontFamily: fonts.displayBold, color: colors.text, fontSize: 22 },
  subtitle: { fontFamily: fonts.body, color: colors.textDim, fontSize: 12.5, marginTop: 6, marginBottom: space(4), lineHeight: 18 },
  subLabel: {
    fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 12,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
  },
  input: {
    backgroundColor: colors.panelAlt, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontFamily: fonts.monoBold, fontSize: 16, width: 120,
  },
  saveBtn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', marginTop: space(3) },
  saveBtnText: { fontFamily: fonts.bodyBold, color: colors.onAccent, fontSize: 14 },
  progressRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.panel, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, padding: 12, marginBottom: 8,
  },
  progressBay: { fontFamily: fonts.monoBold, color: colors.text, fontSize: 15 },
  progressCounts: { fontFamily: fonts.body, color: colors.textDim, fontSize: 11.5, marginTop: 2 },
  removeBtn: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1.5, borderColor: colors.danger, borderRadius: radius.sm },
  removeBtnText: { fontFamily: fonts.bodyMed, color: colors.danger, fontSize: 11.5 },
  closeBtn: { alignItems: 'center', paddingVertical: 13, marginTop: space(4) },
  closeBtnText: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 13.5 },
  bulkRow: { flexDirection: 'row', gap: 8 },
  bulkBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panel,
  },
  bulkBtnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  bulkBtnText: { fontFamily: fonts.bodySemi, color: colors.text, fontSize: 13.5 },
  bulkBtnTextPrimary: { fontFamily: fonts.bodyBold, color: colors.onAccent, fontSize: 13.5 },
  hint: { fontFamily: fonts.body, color: colors.textFaint, fontSize: 11.5, marginTop: 8, lineHeight: 16 },
});
