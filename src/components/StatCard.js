import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, type as fonts, radius } from '../theme/theme';

export default function StatCard({ label, value, accent, small, icon }) {
  const tint = accent || colors.text;
  return (
    <View style={[styles.card, small && styles.cardSmall]}>
      <LinearGradient
        colors={[`${tint}22`, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {icon && <Ionicons name={icon} size={small ? 15 : 17} color={tint} style={styles.icon} />}
      <Text style={[styles.value, small && styles.valueSmall, { color: tint }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={[styles.label, small && styles.labelSmall]} numberOfLines={2}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 16,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  cardSmall: {
    flexBasis: '30%',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  icon: { marginBottom: 6 },
  value: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
  },
  valueSmall: {
    fontSize: 19,
  },
  label: {
    fontFamily: fonts.bodySemi,
    color: colors.textDim,
    fontSize: 11.5,
    letterSpacing: 0.5,
    marginTop: 3,
    textTransform: 'uppercase',
  },
  labelSmall: {
    fontSize: 9.5,
    letterSpacing: 0.3,
    marginTop: 2,
  },
});
