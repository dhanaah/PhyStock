import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, type as fonts, radius, space, qrTypeMeta } from '../theme/theme';
import { useAppData } from '../context/AppDataContext';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import EditScanModal from '../components/EditScanModal';
const SEGMENT_COLORS = {
  OEM: colors.accent,
  OES: colors.info,
  AFM: colors.success,
  EXP: '#C98BE0',
  TM: '#3DBFD9',
  UNSPEC: colors.textDim,
  UNKNOWN: colors.danger,
};

export default function DashboardScreen() {
  const { scans, stats, bayProgress } = useAppData();
  const [query, setQuery] = useState('');
  const [bayFilter, setBayFilter] = useState(null);
  const [warehouseFilter, setWarehouseFilter] = useState(null);
  const [onlyUnique, setOnlyUnique] = useState(false);
  const [editingScan, setEditingScan] = useState(null);

  const bays = useMemo(() => Array.from(new Set(scans.map((s) => s.bay).filter(Boolean))), [scans]);
  const warehouses = useMemo(() => Array.from(new Set(scans.map((s) => s.warehouse).filter(Boolean))), [scans]);

  const filtered = useMemo(() => {
    return scans.filter((s) => {
      if (bayFilter && s.bay !== bayFilter) return false;
      if (warehouseFilter && s.warehouse !== warehouseFilter) return false;
      if (onlyUnique && s.isDuplicate) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const hay = `${s.lpn || ''} ${s.partNumber || ''} ${s.user || ''} ${s.palletNo || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scans, bayFilter, warehouseFilter, onlyUnique, query]);

  const renderItem = useCallback(({ item }) => (
    <RowCard item={item} onPress={() => setEditingScan(item)} />
  ), []);
  const keyExtractor = useCallback((item) => item.id, []);

  // Everything above the record list lives in the FlatList header, so the
  // whole screen scrolls as one piece while only the visible rows are
  // actually mounted — a stock take of several thousand pallets stays
  // smooth instead of laying out every record on each keystroke.
  const header = (
    <View>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.subtitle}>
          Live count across all bays on this device.
          {stats.pendingSync > 0 ? ` ${stats.pendingSync} not yet sent to the data center.` : ''}
          {stats.crossDeviceDuplicates > 0 ? ` ${stats.crossDeviceDuplicates} also scanned on another device.` : ''}
        </Text>

        <View style={styles.statsRow}>
          <StatCard label="Total Scanned" value={stats.total} icon="scan-outline" />
          <StatCard label="Unique LPNs" value={stats.uniqueLpns} accent={colors.success} icon="checkmark-circle-outline" />
          <StatCard label="Duplicates" value={stats.duplicates} accent={stats.duplicates > 0 ? colors.danger : colors.textDim} icon="alert-circle-outline" />
        </View>

        <Text style={styles.sectionLabel}>By segment</Text>
        <View style={styles.statsRowSmall}>
          <StatCard label="OEM" value={stats.bySegment.OEM || 0} small accent={SEGMENT_COLORS.OEM} />
          <StatCard label="OES" value={stats.bySegment.OES || 0} small accent={SEGMENT_COLORS.OES} />
          <StatCard label="AFM" value={stats.bySegment.AFM || 0} small accent={SEGMENT_COLORS.AFM} />
          <StatCard label="EXP" value={stats.bySegment.EXP || 0} small accent={SEGMENT_COLORS.EXP} />
          <StatCard label="TM (Raw Mat.)" value={stats.bySegment.TM || 0} small accent={SEGMENT_COLORS.TM} />
          <StatCard label="No Data" value={stats.bySegment.UNSPEC || 0} small accent={SEGMENT_COLORS.UNSPEC} />
          <StatCard label="Unknown" value={stats.bySegment.UNKNOWN || 0} small accent={SEGMENT_COLORS.UNKNOWN} />
        </View>

        {(() => {
          const progressToShow = bayProgress.filter(
            (p) => p.target !== null && (!bayFilter || p.bay === bayFilter)
          );
          if (progressToShow.length === 0) return null;
          return (
            <>
              <Text style={styles.sectionLabel}>
                Bay progress · {bayFilter ? bayFilter : 'all bays'}
              </Text>
              <View style={{ gap: 8, marginBottom: space(6) }}>
                {progressToShow.map((p) => (
                  <View key={p.bay} style={[styles.progressRow, p.pending > 0 ? styles.progressRowPending : styles.progressRowDone]}>
                    <Text style={styles.progressBay}>{p.bay}</Text>
                    <Text style={styles.progressCounts}>
                      {p.scanned} / {p.target}{p.pending > 0 ? ` · ${p.pending} pending` : ' · complete'}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          );
        })()}

        <Text style={styles.sectionLabel}>Filter log</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by LPN or Pallet No..."
          placeholderTextColor={colors.textFaint}
          style={styles.search}
        />

        <View style={styles.filterRow}>
          {warehouses.length > 1 && (
            <>
              <Pressable
                onPress={() => setWarehouseFilter(null)}
                style={[styles.filterChip, !warehouseFilter && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, !warehouseFilter && styles.filterChipTextActive]}>All warehouses</Text>
              </Pressable>
              {warehouses.map((w) => (
                <Pressable
                  key={w}
                  onPress={() => setWarehouseFilter(w === warehouseFilter ? null : w)}
                  style={[styles.filterChip, warehouseFilter === w && styles.filterChipActive]}
                >
                  <Text style={[styles.filterChipText, warehouseFilter === w && styles.filterChipTextActive]}>{w}</Text>
                </Pressable>
              ))}
            </>
          )}
          <Pressable
            onPress={() => setBayFilter(null)}
            style={[styles.filterChip, !bayFilter && styles.filterChipActive]}
          >
            <Text style={[styles.filterChipText, !bayFilter && styles.filterChipTextActive]}>All bays</Text>
          </Pressable>
          {bays.map((b) => (
            <Pressable
              key={b}
              onPress={() => setBayFilter(b === bayFilter ? null : b)}
              style={[styles.filterChip, bayFilter === b && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, bayFilter === b && styles.filterChipTextActive]}>{b}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setOnlyUnique((v) => !v)}
            style={[styles.filterChip, onlyUnique && styles.filterChipSuccess]}
          >
            <Text style={[styles.filterChipText, onlyUnique && styles.filterChipTextSuccess]}>Unique only</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>{filtered.length} record{filtered.length === 1 ? '' : 's'} · tap a record to edit Phy. Qty / Remarks</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={filtered}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={header}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No scans match this filter yet.</Text>
          </View>
        )}
        contentContainerStyle={{ padding: space(5), paddingBottom: space(10) }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        initialNumToRender={15}
        maxToRenderPerBatch={20}
        windowSize={7}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />

      <EditScanModal scan={editingScan} onClose={() => setEditingScan(null)} />
    </View>
  );
}

const RowCard = React.memo(function RowCard({ item, onPress }) {
  const meta = qrTypeMeta[item.qrType] || qrTypeMeta.Other;
  const qtyParts = [];
  if (item.modelCode) qtyParts.push(item.modelCode);
  if (item.quantity) qtyParts.push(`Qty ${item.quantity}${item.physQty ? `/${item.physQty} Alt.` : ''}`);
  else if (item.physQty) qtyParts.push(`Alt. Qty ${item.physQty}`);
  const qtyLine = qtyParts.length > 0 ? qtyParts.join(' · ') : null;
  const combined = item.palletNo && item.lpn
    ? `${item.palletNo}${item.palletLpnDelimiter || '.'}${item.lpn}`
    : (item.lpn || 'NO LPN');
  return (
    <Pressable onPress={onPress} style={[styles.row, item.isDuplicate && styles.rowDup]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLpn} numberOfLines={1}>{combined}</Text>
        {!!qtyLine && (
          <Text style={styles.rowLine} numberOfLines={1}>{qtyLine}</Text>
        )}
        <Text style={styles.rowLine} numberOfLines={1}>
          {item.timestampDisplay} · {item.warehouse ? `${item.warehouse} · ` : ''}{item.bay}
        </Text>
        <Text style={styles.rowUser} numberOfLines={1}>{item.user}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Badge label={item.segment || 'UNSPEC'} color={SEGMENT_COLORS[item.segment] || colors.textDim} soft={colors.panelAlt} />
        {item.isDuplicate && <Badge label="DUP" color={colors.danger} soft={colors.dangerSoft} />}
        {!item.isDuplicate && item.globalDup && (
          <Badge label={`DUP · ${item.globalDup.deviceName || 'OTHER'}`} color={colors.danger} soft={colors.dangerSoft} />
        )}
        <View style={styles.syncRow}>
          <Ionicons
            name={item.syncStatus === 'synced' ? 'cloud-done-outline' : 'cloud-upload-outline'}
            size={13}
            color={item.syncStatus === 'synced' ? colors.success : colors.textFaint}
          />
          <Text style={styles.syncText}>{item.syncStatus === 'synced' ? `#${item.syncReceipt}` : 'pending'}</Text>
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: { fontFamily: fonts.displayBold, color: colors.text, fontSize: 32, marginTop: space(3) },
  subtitle: { fontFamily: fonts.body, color: colors.textDim, fontSize: 13, marginTop: 2, marginBottom: space(5) },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: space(3) },
  statsRowSmall: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: space(6) },
  sectionLabel: {
    fontFamily: fonts.bodySemi, color: colors.textDim, fontSize: 12,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8, marginTop: space(2),
  },
  search: {
    backgroundColor: colors.panelAlt, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 11,
    color: colors.text, fontFamily: fonts.bodyMed, fontSize: 14,
  },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: space(3) },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panel,
  },
  filterChipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  filterChipSuccess: { backgroundColor: colors.successSoft, borderColor: colors.success },
  filterChipText: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 12.5 },
  filterChipTextActive: { color: colors.accent },
  filterChipTextSuccess: { color: colors.success },
  empty: { paddingVertical: space(10), alignItems: 'center' },
  emptyText: { fontFamily: fonts.body, color: colors.textFaint, fontSize: 13 },
  table: { gap: 8 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: colors.panel, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, padding: 13, gap: 10,
  },
  rowDup: { borderColor: colors.danger, borderWidth: 2 },
  rowLpn: { fontFamily: fonts.monoBold, color: colors.text, fontSize: 16 },
  rowPallet: { fontFamily: fonts.mono, color: colors.textDim, fontSize: 13 },
  rowLine: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 12, marginTop: 3 },
  rowUser: { fontFamily: fonts.body, color: colors.textFaint, fontSize: 11.5, marginTop: 2 },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  syncText: { fontFamily: fonts.mono, color: colors.textFaint, fontSize: 10 },
  progressRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1.5, borderRadius: radius.md, padding: 12,
  },
  progressRowPending: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  progressRowDone: { borderColor: colors.success, backgroundColor: colors.successSoft },
  progressBay: { fontFamily: fonts.monoBold, color: colors.text, fontSize: 15 },
  progressCounts: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 12 },
});
