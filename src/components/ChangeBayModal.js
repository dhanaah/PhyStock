import React, { useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, type as fonts, radius, space } from '../theme/theme';
import { useAppData } from '../context/AppDataContext';
import BayPicker from './BayPicker';
import WarehousePicker from './WarehousePicker';

export default function ChangeBayModal({ visible, onClose }) {
  const { bay, warehouse, changeBay, changeWarehouse, endSession } = useAppData();
  const [pendingBay, setPendingBay] = useState(bay);
  const [pendingWarehouse, setPendingWarehouse] = useState(warehouse);

  const apply = () => {
    if (!pendingBay || !pendingWarehouse) return;
    if (pendingBay !== bay) changeBay(pendingBay);
    if (pendingWarehouse !== warehouse) changeWarehouse(pendingWarehouse);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Change bay / warehouse</Text>
          <Text style={styles.currentLabel}>
            Current: <Text style={{ color: colors.accent }}>{warehouse} · {bay}</Text>
          </Text>

          <Text style={styles.subLabel}>Warehouse</Text>
          <WarehousePicker value={pendingWarehouse} onChange={setPendingWarehouse} />

          <Text style={[styles.subLabel, { marginTop: space(5) }]}>Bay</Text>
          <BayPicker value={pendingBay} onChange={setPendingBay} />

          <View style={styles.footerRow}>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={apply} style={styles.applyFullBtn}>
              <Text style={styles.applyFullBtnText}>Apply</Text>
            </Pressable>
            <Pressable
              onPress={() => { onClose(); endSession(); }}
              style={styles.endBtn}
            >
              <Text style={styles.endBtnText}>End shift / switch user</Text>
            </Pressable>
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
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: space(6), paddingBottom: space(8),
    borderTopWidth: 1.5, borderColor: colors.border,
  },
  title: { fontFamily: fonts.displayBold, color: colors.text, fontSize: 22 },
  currentLabel: { fontFamily: fonts.body, color: colors.textDim, fontSize: 13, marginTop: 4, marginBottom: space(4) },
  subLabel: {
    fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 12,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
  },
  footerRow: { marginTop: space(6), gap: 10 },
  cancelBtn: { alignItems: 'center', paddingVertical: 12 },
  cancelBtnText: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 13.5 },
  applyFullBtn: { alignItems: 'center', paddingVertical: 13, backgroundColor: colors.accent, borderRadius: radius.md },
  applyFullBtnText: { fontFamily: fonts.bodyBold, color: colors.onAccent, fontSize: 14 },
  endBtn: { alignItems: 'center', paddingVertical: 12, borderWidth: 1.5, borderColor: colors.danger, borderRadius: radius.md },
  endBtnText: { fontFamily: fonts.bodySemi, color: colors.danger, fontSize: 13.5 },
});
