import React, { useState, useEffect } from 'react';
import { Modal, View, Text, Pressable, TextInput, Alert, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { colors, type as fonts, radius, space, qrTypeMeta } from '../theme/theme';
import { useAppData } from '../context/AppDataContext';
import Badge from './Badge';

export default function EditScanModal({ scan, onClose }) {
  const { updateScanFields } = useAppData();
  const [physQty, setPhysQty] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (scan) {
      setPhysQty(scan.physQty ? String(scan.physQty) : '');
      setRemarks(scan.remarks || '');
    }
  }, [scan]);

  if (!scan) return null;

  const meta = qrTypeMeta[scan.qrType] || qrTypeMeta.Other;
  const combined = scan.palletNo && scan.lpn
    ? `${scan.palletNo}${scan.palletLpnDelimiter || '.'}${scan.lpn}`
    : (scan.lpn || 'NO LPN');

  const save = async () => {
    setSaving(true);
    const patch = {
      physQty: physQty.trim() || null,
      remarks: remarks.trim() || null,
    };
    const result = await updateScanFields(scan.id, patch);
    setSaving(false);
    if (result.ok) {
      onClose();
    } else {
      Alert.alert('Could not save', String(result.error?.message || result.error || 'Unknown error — try again.'));
    }
  };

  return (
    <Modal visible={!!scan} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.sheet}
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerRow}>
            <Badge label={meta.label} color={meta.color} soft={meta.soft} />
            {scan.isDuplicate && <Badge label="DUPLICATE" color={colors.danger} soft={colors.dangerSoft} />}
          </View>
          <Text style={styles.lpnValue}>{combined}</Text>
          <Text style={styles.metaLine}>
            {scan.timestampDisplay} · {scan.warehouse ? `${scan.warehouse} · ` : ''}{scan.bay} · {scan.user}
          </Text>
          {!!scan.partNumber && (
            <Text style={styles.metaLine}>
              {scan.modelCode || scan.partNumber} · System Qty {scan.quantity ?? '—'}
            </Text>
          )}

          <Text style={styles.label}>Phy. Qty</Text>
          <TextInput
            value={physQty}
            onChangeText={setPhysQty}
            placeholder={`System qty: ${scan.quantity ?? '—'}`}
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            keyboardType="numeric"
          />

          <Text style={[styles.label, { marginTop: space(4) }]}>Remarks</Text>
          <TextInput
            value={remarks}
            onChangeText={setRemarks}
            placeholder="Any additional note for this scan"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, styles.remarksInput]}
            multiline
          />

          <View style={styles.footerRow}>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={save} style={styles.saveBtn} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    borderTopWidth: 1.5, borderColor: colors.border,
  },
  sheetContent: {
    padding: space(6), paddingBottom: space(8),
  },
  headerRow: { flexDirection: 'row', gap: 8 },
  lpnValue: { fontFamily: fonts.monoBold, color: colors.text, fontSize: 24, marginTop: space(3) },
  metaLine: { fontFamily: fonts.body, color: colors.textDim, fontSize: 12.5, marginTop: 4 },
  label: {
    fontFamily: fonts.bodySemi, color: colors.text, fontSize: 13, marginTop: space(5), marginBottom: 8,
  },
  input: {
    backgroundColor: colors.panelAlt, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontFamily: fonts.bodyMed, fontSize: 15,
  },
  remarksInput: { minHeight: 70, textAlignVertical: 'top' },
  footerRow: { flexDirection: 'row', gap: 10, marginTop: space(6) },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md },
  cancelBtnText: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 14 },
  saveBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, backgroundColor: colors.accent, borderRadius: radius.md },
  saveBtnText: { fontFamily: fonts.bodyBold, color: colors.onAccent, fontSize: 14 },
});
