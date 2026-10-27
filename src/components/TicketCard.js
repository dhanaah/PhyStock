import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, type as fonts, radius, shadow, qrTypeMeta } from '../theme/theme';
import Badge from './Badge';
import { formatFieldRows } from '../utils/qrParser';

// Signature element: a "ticket stub" that visually echoes the physical
// pallet labels this data comes from — a perforated top edge, a big bold
// code, and a bordered field grid, same bones as the real AIS tickets.

export default function TicketCard({ scan }) {
  const meta = qrTypeMeta[scan.qrType] || qrTypeMeta.Other;
  const rows = formatFieldRows(scan);
  const isBad = scan.qrType === 'Unrecognized';
  const refused = !!scan.rejected;
  // Same combined "PalletNo<delimiter>LPN" reconstruction used on the
  // Dashboard and in the CSV report, so the LPN shown here matches
  // exactly what's shown everywhere else — original punctuation intact.
  const combinedLpn = scan.palletNo && scan.lpn
    ? `${scan.palletNo}${scan.palletLpnDelimiter || '.'}${scan.lpn}`
    : (scan.lpn || 'NOT FOUND');

  return (
    <View style={[styles.card, (isBad || refused) && styles.cardBad]}>
      <View style={[styles.edgeStripe, { backgroundColor: (scan.isDuplicate || scan.globalDup) ? colors.danger : meta.color }]} />
      <View style={styles.perforationRow}>
        {Array.from({ length: 18 }).map((_, i) => (
          <View key={i} style={styles.perfDot} />
        ))}
      </View>

      <View style={styles.headerRow}>
        <Badge label={meta.label} color={meta.color} soft={meta.soft} />
        {refused ? (
          <Badge label={scan.globalDup ? `REFUSED · ${scan.globalDup.deviceName || 'OTHER DEVICE'}` : 'REFUSED · DUPLICATE'} color={colors.danger} soft={colors.dangerSoft} />
        ) : scan.isDuplicate ? (
          <Badge label="DUPLICATE LPN" color={colors.danger} soft={colors.dangerSoft} />
        ) : scan.globalDup ? (
          <Badge label={`ALREADY SCANNED · ${scan.globalDup.deviceName || 'OTHER DEVICE'}`} color={colors.danger} soft={colors.dangerSoft} />
        ) : scan.stockNote ? (
          <Badge label="LPN STOCK" color={colors.info} soft="#13293A" />
        ) : scan.qrType !== 'Unrecognized' ? (
          <Badge label="NEW" color={colors.success} soft={colors.successSoft} />
        ) : null}
      </View>

      <Text style={styles.lpnLabel}>LPN</Text>
      <Text style={[styles.lpnValue, isBad && { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>
        {combinedLpn}
      </Text>

      {rows.length > 0 && (
        <View style={styles.grid}>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.gridRow}>
              <Text style={styles.gridLabel}>{label}</Text>
              <Text style={styles.gridValue} numberOfLines={1}>{value}</Text>
            </View>
          ))}
        </View>
      )}

      {isBad && (
        <Text style={styles.warnText}>
          No LPN pattern recognized in this code. Logged for review — verify manually.
        </Text>
      )}
      {refused && (
        <Text style={styles.warnText}>
          This pallet is already counted{scan.globalDup ? ` by ${scan.globalDup.user || scan.globalDup.deviceName || 'another device'}${scan.globalDup.bay ? ` in ${scan.globalDup.bay}` : ''}` : ' on this device'}. Not recorded.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingBottom: 16,
    paddingLeft: 5,
    overflow: 'hidden',
    ...shadow.card,
  },
  cardBad: {
    borderColor: colors.danger,
    borderWidth: 2,
  },
  edgeStripe: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: 5,
  },
  perforationRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingTop: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderBottomColor: colors.border,
  },
  perfDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 12,
  },
  lpnLabel: {
    fontFamily: fonts.bodyMed,
    color: colors.textFaint,
    fontSize: 11,
    letterSpacing: 1.2,
    marginTop: 14,
    paddingHorizontal: 16,
  },
  lpnValue: {
    fontFamily: fonts.monoBold,
    color: colors.text,
    fontSize: 32,
    paddingHorizontal: 16,
    marginTop: 2,
  },
  grid: {
    marginTop: 14,
    marginHorizontal: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.panelAlt,
  },
  gridLabel: {
    fontFamily: fonts.body,
    color: colors.textDim,
    fontSize: 12.5,
  },
  gridValue: {
    fontFamily: fonts.bodySemi,
    color: colors.text,
    fontSize: 12.5,
    maxWidth: '60%',
  },
  warnText: {
    marginTop: 12,
    marginHorizontal: 16,
    color: colors.danger,
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
  },
});
