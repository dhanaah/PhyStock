// Photo of the bay count sheet → table → (review) → bay targets.
//
// Flow:  Take photo ─► read (server OCR, else on-device ML Kit) ─► review table
//        ─► Admin PIN ─► apply (data center when linked, else this device only)
//
// Rows the reader was not sure about are shown in red and must be edited or
// removed before the table can be applied, so nothing doubtful becomes a target.
import React, { useCallback, useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, Image, ActivityIndicator, StyleSheet, Alert, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { colors, type as fonts, radius, space } from '../theme/theme';
import { useAppData } from '../context/AppDataContext';
import { useSync } from '../context/SyncContext';
import { extractRows, fragmentsFromMlKit, validateReviewedRows } from '../utils/countSheet';
import AdminPinModal from './AdminPinModal';
import { PressScale } from './motion';

async function recognizeOnDevice(uri) {
  // Loaded lazily: the native module only exists in a full build, and the
  // modal must still open (server path) if it is ever missing.
  let TextRecognition;
  try {
    TextRecognition = require('@react-native-ml-kit/text-recognition').default;
  } catch (e) {
    throw new Error('On-device reader is not available in this build');
  }
  const result = await TextRecognition.recognize(uri);
  return extractRows(fragmentsFromMlKit(result));
}

export default function CountSheetModal({ visible, onClose }) {
  const { importBayTargets } = useAppData();
  const { linked, status, ocrCountSheet, applyCountSheet } = useSync();

  const [step, setStep] = useState('capture'); // capture | reading | review | applying
  const [photo, setPhoto] = useState(null);     // { uri, width, height }
  const [rows, setRows] = useState([]);
  const [engine, setEngine] = useState(null);   // 'server' | 'device'
  const [sheetId, setSheetId] = useState(null);
  const [note, setNote] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [replace, setReplace] = useState(false);

  const reset = useCallback(() => {
    setStep('capture'); setPhoto(null); setRows([]); setEngine(null); setSheetId(null); setNote(''); setReplace(false);
  }, []);
  const close = () => { reset(); onClose(); };

  const readPhoto = useCallback(async (asset) => {
    setStep('reading');
    // Downscale for upload / recognition speed; 1800 px is plenty for a sheet.
    let uri = asset.uri;
    try {
      const m = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1800 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
      uri = m.uri;
    } catch (e) { /* keep original */ }
    setPhoto({ uri });

    let result = null; let used = null; let why = '';
    if (linked && status !== 'offline') {
      setNote('Reading on the data center…');
      try {
        const r = await ocrCountSheet(uri);
        result = r.rows; used = 'server'; setSheetId(r.sheetId || null);
      } catch (e) { why = e.message || 'server unreachable'; }
    }
    if (!result) {
      setNote(linked ? `Data center not reachable (${why}) — reading on this device…` : 'Reading on this device…');
      try {
        result = await recognizeOnDevice(uri); used = 'device'; setSheetId(null);
      } catch (e) {
        Alert.alert('Could not read the sheet', `${why ? `Data center: ${why}\n` : ''}Device: ${e.message}`);
        setStep('capture'); return;
      }
    }
    if (!result.length) {
      Alert.alert('No bay rows found', 'Retake with the whole sheet flat and in frame, in good light. Bay codes must look like A01 and the count must be to the right of the bay.');
      setStep('capture'); return;
    }
    setRows(result.map((r, i) => ({ key: `${i}`, bay: r.bay || '', count: r.count === null || r.count === undefined ? '' : String(r.count), review: !!r.needsReview, raw: r.raw })));
    setEngine(used);
    setNote(used === 'server' ? 'Read on the data center' : 'Read on this device (offline reader)');
    setStep('review');
  }, [linked, status, ocrCountSheet]);

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Camera permission needed', 'Allow camera access to photograph the count sheet.'); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: false, exif: false });
    if (res.canceled || !res.assets?.length) return;
    readPhoto(res.assets[0]);
  };
  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.9, mediaTypes: ['images'], allowsEditing: false });
    if (res.canceled || !res.assets?.length) return;
    readPhoto(res.assets[0]);
  };

  const edit = (key, field, value) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: field === 'bay' ? value.toUpperCase() : value.replace(/[^0-9]/g, ''), review: false } : r)));
  const remove = (key) => setRows((prev) => prev.filter((r) => r.key !== key));
  const addRow = () => setRows((prev) => [...prev, { key: `n${Date.now()}`, bay: '', count: '', review: false, raw: '' }]);

  const unresolved = rows.filter((r) => r.review).length;

  const requestApply = () => {
    if (unresolved) { Alert.alert('Check the red rows first', `${unresolved} row${unresolved === 1 ? '' : 's'} could not be read with confidence. Correct or remove them before applying.`); return; }
    const v = validateReviewedRows(rows);
    if (!v.ok) { Alert.alert('Fix the table', v.error); return; }
    setPinOpen(true);
  };

  const apply = async (pin) => {
    setPinOpen(false);
    const v = validateReviewedRows(rows);
    if (!v.ok) return;
    setStep('applying');
    try {
      if (linked && status !== 'offline') {
        await applyCountSheet({ pin, sheetId, rows: v.rows, engine, replace });
        Alert.alert('Targets updated', `${v.rows.length} bay${v.rows.length === 1 ? '' : 's'} applied on the data center. Every linked device picks them up within 15 s.`);
      } else {
        await importBayTargets(v.rows.filter((r) => r.count !== null).map((r) => ({ bay: r.bay, target: r.count })));
        Alert.alert('Targets updated on this device', `${v.rows.length} bay${v.rows.length === 1 ? '' : 's'} applied locally.${linked ? ' The data center was not reachable — apply again from the dashboard when back online.' : ''}`);
      }
      close();
    } catch (e) {
      Alert.alert('Could not apply', e.message || String(e));
      setStep('review');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Photo count sheet</Text>
          <Pressable onPress={close} hitSlop={12}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
        </View>

        {step === 'capture' && (
          <View style={styles.center}>
            <Ionicons name="document-text-outline" size={56} color={colors.textFaint} />
            <Text style={styles.blurb}>Photograph the bay count sheet flat, in good light, with the whole sheet in frame.
              Each line should read <Text style={styles.mono}>BAY  COUNT</Text> — e.g. <Text style={styles.mono}>A01  120</Text>.
              The printed template from the dashboard (Edit targets → Print sheet) reads best; a neat handwritten list also works.</Text>
            <PressScale onPress={takePhoto} style={styles.primaryBtn} containerStyle={{ alignSelf: 'stretch' }}>
              <Ionicons name="camera" size={20} color={colors.onAccent} /><Text style={styles.primaryText}>Take photo</Text>
            </PressScale>
            <PressScale onPress={pickPhoto} style={styles.ghostBtn} containerStyle={{ alignSelf: 'stretch' }}>
              <Ionicons name="images-outline" size={18} color={colors.text} /><Text style={styles.ghostText}>Choose from gallery</Text>
            </PressScale>
            <Text style={styles.hint}>{linked ? 'Reads on the data center; falls back to this device if it is not reachable.' : 'Not linked — reads on this device and applies targets to this device only.'}</Text>
          </View>
        )}

        {(step === 'reading' || step === 'applying') && (
          <View style={styles.center}>
            {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" /> : null}
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.blurb}>{step === 'applying' ? 'Applying targets…' : note || 'Reading…'}</Text>
          </View>
        )}

        {step === 'review' && (
          <>
            <View style={styles.reviewTop}>
              {photo ? <Image source={{ uri: photo.uri }} style={styles.thumb} resizeMode="cover" /> : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.sub}>{rows.length} row{rows.length === 1 ? '' : 's'} · {note}</Text>
                {unresolved ? <Text style={styles.warn}>{unresolved} in red need a check before applying</Text>
                  : <Text style={styles.ok}>All rows read clearly — check against the sheet, then apply</Text>}
              </View>
            </View>
            <View style={styles.thead}>
              <Text style={[styles.th, { width: 92 }]}>Bay</Text><Text style={[styles.th, { flex: 1 }]}>Count</Text><Text style={[styles.th, { width: 40 }]} />
            </View>
            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
              {rows.map((r) => (
                <View key={r.key} style={[styles.tr, r.review && styles.trReview]}>
                  <View style={{ width: 92 }}>
                    <TextInput value={r.bay} onChangeText={(v) => edit(r.key, 'bay', v)} placeholder="A01" placeholderTextColor={colors.textFaint}
                      style={[styles.input, r.review && !r.bay && styles.inputBad]} autoCapitalize="characters" maxLength={4} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextInput value={r.count} onChangeText={(v) => edit(r.key, 'count', v)} placeholder="count" placeholderTextColor={colors.textFaint}
                      style={[styles.input, r.review && r.count === '' && styles.inputBad]} keyboardType="number-pad" maxLength={6} />
                    {r.raw ? <Text style={styles.raw} numberOfLines={1}>read: {r.raw}</Text> : null}
                  </View>
                  <Pressable onPress={() => remove(r.key)} hitSlop={10} style={{ width: 40, alignItems: 'center' }}>
                    <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  </Pressable>
                </View>
              ))}
              <Pressable onPress={addRow} style={styles.addRow}><Ionicons name="add" size={18} color={colors.accent} /><Text style={styles.addText}>Add bay</Text></Pressable>
            </ScrollView>
            <View style={styles.footer}>
              <Pressable onPress={() => setReplace((v) => !v)} style={styles.check} hitSlop={6}>
                <Ionicons name={replace ? 'checkbox' : 'square-outline'} size={20} color={replace ? colors.accent : colors.textFaint} />
                <Text style={styles.checkText}>Replace all existing targets (otherwise merge by bay)</Text>
              </Pressable>
              <View style={styles.footerBtns}>
                <PressScale onPress={reset} style={styles.ghostBtn} containerStyle={{ flex: 1 }}>
                  <Ionicons name="camera-reverse-outline" size={18} color={colors.text} /><Text style={styles.ghostText}>Retake</Text>
                </PressScale>
                <PressScale onPress={requestApply} style={[styles.primaryBtn, unresolved ? styles.primaryDisabled : null]} containerStyle={{ flex: 1.4 }}>
                  <Ionicons name="shield-checkmark-outline" size={18} color={colors.onAccent} />
                  <Text style={styles.primaryText}>{linked && status !== 'offline' ? 'Apply to data center' : 'Apply on device'}</Text>
                </PressScale>
              </View>
            </View>
          </>
        )}

        <AdminPinModal
          visible={pinOpen}
          title="Admin PIN required"
          message={`Apply ${rows.length} bay target${rows.length === 1 ? '' : 's'} from this count sheet?`}
          onConfirm={apply}
          onCancel={() => setPinOpen(false)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: Platform.OS === 'android' ? 28 : 54 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space(4), paddingBottom: space(2) },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(5), gap: 14 },
  blurb: { fontFamily: fonts.body, fontSize: 13.5, color: colors.textDim, textAlign: 'center', lineHeight: 20 },
  mono: { fontFamily: fonts.mono, color: colors.text },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.textFaint, textAlign: 'center' },
  preview: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.panel },
  primaryBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 16 },
  primaryDisabled: { opacity: 0.45 },
  primaryText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.onAccent },
  ghostBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 16 },
  ghostText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  reviewTop: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: space(4), paddingBottom: space(2) },
  thumb: { width: 64, height: 48, borderRadius: radius.sm, backgroundColor: colors.panel },
  sub: { fontFamily: fonts.body, fontSize: 12, color: colors.textDim },
  warn: { fontFamily: fonts.bodyMed, fontSize: 12, color: colors.danger, marginTop: 2 },
  ok: { fontFamily: fonts.bodyMed, fontSize: 12, color: colors.success, marginTop: 2 },
  thead: { flexDirection: 'row', paddingHorizontal: space(4), paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.border, gap: 10 },
  th: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.textFaint, textTransform: 'uppercase', letterSpacing: 0.6 },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space(4), paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.border },
  trReview: { backgroundColor: 'rgba(239,68,68,0.10)' },
  input: { fontFamily: fonts.mono, fontSize: 16, color: colors.text, backgroundColor: colors.panelAlt, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10 },
  inputBad: { borderColor: colors.danger },
  raw: { fontFamily: fonts.body, color: colors.textFaint, fontSize: 10.5, marginTop: 2 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: space(4) },
  addText: { fontFamily: fonts.bodyMed, fontSize: 14, color: colors.accent },
  footer: { padding: space(4), borderTopWidth: 1, borderColor: colors.border, gap: 10, paddingBottom: space(6) },
  check: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkText: { fontFamily: fonts.body, fontSize: 12, color: colors.textDim, flex: 1 },
  footerBtns: { flexDirection: 'row', gap: 10 },
});
