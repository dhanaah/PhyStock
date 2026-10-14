import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable, ScrollView,
  KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { APP_VERSION } from '../config';
import { PressScale, FadeRise } from '../components/motion';
import { colors, type as fonts, radius, space } from '../theme/theme';
import { useAppData } from '../context/AppDataContext';
import BayPicker from '../components/BayPicker';
import WarehousePicker from '../components/WarehousePicker';
import LogoMark from '../components/LogoMark';

export default function SetupScreen() {
  const { startSession } = useAppData();
  const [name, setName] = useState('');
  const [warehouse, setWarehouse] = useState(null);
  const [bay, setBay] = useState(null);
  const [touched, setTouched] = useState(false);

  const canStart = name.trim().length > 0 && !!warehouse && !!bay;

  const handleStart = () => {
    setTouched(true);
    if (!canStart) return;
    startSession(name.trim(), bay, warehouse);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <LinearGradient
          colors={[`${colors.accent}26`, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.7, y: 1 }}
          style={styles.heroGlow}
        />
        <View style={styles.brandRow}>
          <Image source={require('../../assets/phystock-mark.png')} style={styles.brandMark} resizeMode="contain" />
          <LogoMark size={34} />
        </View>
        <View style={styles.eyebrowRow}>
          <View style={styles.eyebrowDot} />
          <Text style={styles.eyebrow}>AIS GLASS · PHYSICAL STOCK TAKE</Text>
        </View>
        <Text style={styles.title}><Text style={styles.titleAccent}>Phy</Text>Stock</Text>
        <Text style={styles.subtitle}>
          Scan pallet labels, catch duplicate LPNs before they leave the floor, and send a clean count to the team.
        </Text>

        <FadeRise index={1} style={styles.section}>
          <Text style={styles.label}>Your name <Text style={styles.req}>*</Text></Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Ramkumar"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            autoCapitalize="words"
            returnKeyType="done"
          />
          {touched && name.trim().length === 0 && (
            <Text style={styles.error}>Name is required to start scanning.</Text>
          )}
        </FadeRise>

        <FadeRise index={2} style={styles.section}>
          <Text style={styles.label}>Warehouse <Text style={styles.req}>*</Text></Text>
          <WarehousePicker value={warehouse} onChange={setWarehouse} />
          {touched && !warehouse && (
            <Text style={styles.error}>Select a warehouse to continue.</Text>
          )}
        </FadeRise>

        <FadeRise index={3} style={styles.section}>
          <Text style={styles.label}>Bay <Text style={styles.req}>*</Text></Text>
          <BayPicker value={bay} onChange={setBay} />
          {touched && !bay && (
            <Text style={styles.error}>Select a zone and bay number to continue.</Text>
          )}
        </FadeRise>

        <FadeRise index={4}>
          <PressScale
            onPress={handleStart}
            style={[styles.startBtn, !canStart && styles.startBtnDisabled]}
          >
            <Text style={styles.startBtnText}>Start Scanning</Text>
          </PressScale>
        </FadeRise>

        <Text style={styles.footnote}>
          Scans save to this device. Export and merge with other bays anytime from Reports.
        </Text>
        <Text style={styles.signature}>Created by: DT · v{APP_VERSION}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    padding: space(6),
    paddingTop: space(14),
  },
  heroGlow: {
    position: 'absolute',
    top: 0, left: 0, right: 0, height: 260,
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 10 },
  eyebrowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    color: colors.accent,
    fontSize: 12,
    letterSpacing: 1.6,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandMark: { width: 72, height: 72 },
  titleAccent: { color: colors.accent },
  title: {
    fontFamily: fonts.displayBold,
    color: colors.text,
    fontSize: 46,
    lineHeight: 50,
  },
  subtitle: {
    fontFamily: fonts.body,
    color: colors.textDim,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    marginBottom: space(9),
  },
  section: { marginBottom: space(7) },
  label: {
    fontFamily: fonts.bodySemi,
    color: colors.text,
    fontSize: 15,
    marginBottom: 8,
  },
  req: { color: colors.accent },
  input: {
    backgroundColor: colors.panelAlt,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.text,
    fontFamily: fonts.bodyMed,
    fontSize: 16,
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.bodyMed,
    fontSize: 12.5,
    marginTop: 6,
  },
  startBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: space(4),
  },
  startBtnDisabled: {
    backgroundColor: colors.panelAlt,
  },
  startBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.onAccent,
    letterSpacing: 0.3,
  },
  footnote: {
    fontFamily: fonts.body,
    color: colors.textFaint,
    fontSize: 12,
    textAlign: 'center',
    marginTop: space(5),
    lineHeight: 17,
  },
  signature: {
    fontFamily: fonts.bodyMed,
    color: colors.textFaint,
    fontSize: 11,
    textAlign: 'center',
    marginTop: space(3),
    letterSpacing: 0.5,
  },
});
