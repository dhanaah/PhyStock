import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { colors, type as fonts, radius, space } from '../theme/theme';

// Predefined warehouse/location list. Extend this array as new locations
// come online — the "+ Other" option covers anything not listed yet
// without needing a code change first.
export const DEFAULT_WAREHOUSES = [
  { code: 'Loc1', label: 'Loc1 · Old W/H' },
  { code: 'Loc2', label: 'Loc2 · New W/H' },
  { code: 'Loc3', label: 'Loc3 · Outside W/H' },
  { code: 'Loc4', label: 'Loc4' },
  { code: 'Loc5', label: 'Loc5 · QCFG' },
  { code: 'Loc6', label: 'Loc6 · PDI' },
];

export default function WarehousePicker({ value, onChange }) {
  const isKnown = DEFAULT_WAREHOUSES.some((w) => w.code === value);
  const [showCustom, setShowCustom] = useState(value && !isKnown);
  const [customValue, setCustomValue] = useState(showCustom ? value : '');

  const pick = (code) => {
    setShowCustom(false);
    onChange(code);
  };

  const openCustom = () => {
    setShowCustom(true);
    onChange(customValue.trim() || null);
  };

  const onCustomChange = (v) => {
    setCustomValue(v);
    onChange(v.trim() || null);
  };

  return (
    <View>
      <View style={styles.grid}>
        {DEFAULT_WAREHOUSES.map((w) => {
          const selected = !showCustom && value === w.code;
          return (
            <Pressable
              key={w.code}
              onPress={() => pick(w.code)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{w.label}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={openCustom} style={[styles.chip, showCustom && styles.chipSelected]}>
          <Text style={[styles.chipText, showCustom && styles.chipTextSelected]}>+ Other</Text>
        </Pressable>
      </View>
      {showCustom && (
        <TextInput
          value={customValue}
          onChangeText={onCustomChange}
          placeholder="Enter warehouse / location name"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panelAlt,
  },
  chipSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 13.5 },
  chipTextSelected: { color: colors.accent },
  input: {
    marginTop: space(2),
    backgroundColor: colors.panelAlt, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontFamily: fonts.bodyMed, fontSize: 15,
  },
});
