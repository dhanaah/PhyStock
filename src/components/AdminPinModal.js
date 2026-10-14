import React, { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { colors, type as fonts, radius, space } from '../theme/theme';
import { ADMIN_PIN } from '../config';

export default function AdminPinModal({ visible, title, message, onConfirm, onCancel }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const submit = () => {
    if (pin === ADMIN_PIN) {
      setPin('');
      setError(false);
      onConfirm();
    } else {
      setError(true);
    }
  };

  const close = () => {
    setPin('');
    setError(false);
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title || 'Admin PIN required'}</Text>
          <Text style={styles.message}>{message || 'This action needs admin approval.'}</Text>
          <TextInput
            value={pin}
            onChangeText={(v) => { setPin(v); setError(false); }}
            placeholder="Enter admin PIN"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, error && styles.inputError]}
            secureTextEntry
            keyboardType="number-pad"
            autoFocus
          />
          {error && <Text style={styles.errorText}>Incorrect PIN. Try again.</Text>}
          <View style={styles.row}>
            <Pressable onPress={close} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} style={styles.confirmBtn}>
              <Text style={styles.confirmText}>Confirm</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: space(6) },
  card: {
    width: '100%', backgroundColor: colors.bgElevated, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border, padding: space(6),
  },
  title: { fontFamily: fonts.displayBold, color: colors.text, fontSize: 20 },
  message: { fontFamily: fonts.body, color: colors.textDim, fontSize: 13, marginTop: 6, marginBottom: space(4), lineHeight: 18 },
  input: {
    backgroundColor: colors.panelAlt, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontFamily: fonts.monoBold, fontSize: 16, letterSpacing: 2,
  },
  inputError: { borderColor: colors.danger },
  errorText: { color: colors.danger, fontFamily: fonts.body, fontSize: 12, marginTop: 6 },
  row: { flexDirection: 'row', gap: 10, marginTop: space(5) },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md },
  cancelText: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 13.5 },
  confirmBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: colors.danger, borderRadius: radius.md },
  confirmText: { fontFamily: fonts.bodyBold, color: colors.text, fontSize: 13.5 },
});
