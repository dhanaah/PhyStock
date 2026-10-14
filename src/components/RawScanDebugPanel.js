import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { colors, type as fonts, radius, space } from '../theme/theme';

const SOURCE_META = {
  camera: { label: 'CAMERA', color: colors.accent },
  hardware: { label: 'HARDWARE', color: colors.info },
  manual: { label: 'MANUAL', color: colors.textDim },
};

export default function RawScanDebugPanel({ log, liveBuffer, scanMode, onClear, onShare }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Raw scan log</Text>
        <View style={styles.headerBtns}>
          <Pressable onPress={onShare} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Share</Text>
          </Pressable>
          <Pressable onPress={onClear} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Clear</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.subtitle}>
        Shows exactly what's captured, before any parsing — use this to check whether the camera is
        decoding anything at all, or whether hardware trigger keystrokes are arriving.
      </Text>

      {scanMode === 'hardware' && (
        <View style={styles.liveBox}>
          <Text style={styles.liveLabel}>Live buffer (updates as characters arrive, before Enter)</Text>
          <Text style={styles.liveValue} numberOfLines={2}>
            {liveBuffer ? liveBuffer : '(empty — nothing received yet)'}
          </Text>
        </View>
      )}

      <ScrollView style={styles.logScroll} nestedScrollEnabled>
        {log.length === 0 ? (
          <Text style={styles.emptyText}>No scan events captured yet.</Text>
        ) : (
          log.map((entry) => {
            const meta = SOURCE_META[entry.source] || SOURCE_META.manual;
            return (
              <View key={entry.id} style={styles.entryRow}>
                <View style={styles.entryHeader}>
                  <View style={[styles.sourceBadge, { borderColor: meta.color }]}>
                    <Text style={[styles.sourceBadgeText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  {!!entry.barcodeType && (
                    <Text style={styles.typeTag}>{entry.barcodeType}</Text>
                  )}
                  {entry.count > 1 && (
                    <Text style={styles.countTag}>×{entry.count}</Text>
                  )}
                  <Text style={styles.timeText}>{entry.time}</Text>
                </View>
                <Text style={styles.rawText} selectable>{entry.raw || '(empty string)'}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: space(5), marginTop: space(3),
    backgroundColor: colors.panel, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.lg, padding: space(4),
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: fonts.displayMed, color: colors.text, fontSize: 16 },
  headerBtns: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  headerBtnText: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 11.5 },
  subtitle: { fontFamily: fonts.body, color: colors.textFaint, fontSize: 11.5, marginTop: 6, lineHeight: 16 },
  liveBox: {
    marginTop: space(3), backgroundColor: colors.panelAlt, borderWidth: 1.5, borderColor: colors.accent,
    borderRadius: radius.md, padding: 10,
  },
  liveLabel: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 10.5, marginBottom: 4 },
  liveValue: { fontFamily: fonts.monoBold, color: colors.accent, fontSize: 15 },
  logScroll: { maxHeight: 260, marginTop: space(3) },
  emptyText: { fontFamily: fonts.body, color: colors.textFaint, fontSize: 12, paddingVertical: space(4), textAlign: 'center' },
  entryRow: {
    borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 9,
  },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sourceBadge: { borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  sourceBadgeText: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.4 },
  typeTag: { fontFamily: fonts.bodyMed, color: colors.textFaint, fontSize: 10.5 },
  countTag: { fontFamily: fonts.bodyBold, color: colors.danger, fontSize: 10.5 },
  timeText: { fontFamily: fonts.body, color: colors.textFaint, fontSize: 10.5, marginLeft: 'auto' },
  rawText: { fontFamily: fonts.mono, color: colors.text, fontSize: 12.5, lineHeight: 17 },
});
