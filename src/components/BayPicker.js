import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView } from 'react-native';
import { colors, type as fonts, radius, space } from '../theme/theme';

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

function parseBayCode(code) {
  const m = /^([A-Z])(\d{1,2})$/.exec((code || '').trim().toUpperCase());
  if (!m) return { letter: null, number: '' };
  return { letter: m[1], number: m[2].padStart(2, '0') };
}

// Bay code format: one letter (A-Z) + two digits, e.g. "A01", "X14", "M05".
export default function BayPicker({ value, onChange }) {
  const initial = parseBayCode(value);
  const [letter, setLetter] = useState(initial.letter);
  const [number, setNumber] = useState(initial.number);

  useEffect(() => {
    if (letter && number.length === 2) {
      onChange(`${letter}${number}`);
    } else {
      onChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter, number]);

  const onNumberChange = (v) => {
    const digits = v.replace(/[^0-9]/g, '').slice(0, 2);
    setNumber(digits);
  };

  return (
    <View>
      <Text style={styles.subLabel}>Zone</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.letterRow}>
        {LETTERS.map((l) => {
          const selected = l === letter;
          return (
            <Pressable key={l} onPress={() => setLetter(l)} style={[styles.letterChip, selected && styles.letterChipSelected]}>
              <Text style={[styles.letterText, selected && styles.letterTextSelected]}>{l}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={[styles.subLabel, { marginTop: space(4) }]}>Bay number</Text>
      <TextInput
        value={number}
        onChangeText={onNumberChange}
        placeholder="01"
        placeholderTextColor={colors.textFaint}
        style={styles.numberInput}
        keyboardType="number-pad"
        maxLength={2}
      />

      {letter && number.length === 2 && (
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>Bay code</Text>
          <Text style={styles.previewValue}>{letter}{number}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  subLabel: {
    fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 12,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
  },
  letterRow: { gap: 6, paddingRight: 8 },
  letterChip: {
    width: 40, height: 40, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.panelAlt, alignItems: 'center', justifyContent: 'center',
  },
  letterChipSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  letterText: { fontFamily: fonts.bodyBold, color: colors.textDim, fontSize: 15 },
  letterTextSelected: { color: colors.accent },
  numberInput: {
    backgroundColor: colors.panelAlt, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontFamily: fonts.monoBold, fontSize: 18, width: 100, letterSpacing: 2,
  },
  preview: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: space(4),
    backgroundColor: colors.accentSoft, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  previewLabel: { fontFamily: fonts.bodyMed, color: colors.textDim, fontSize: 12 },
  previewValue: { fontFamily: fonts.monoBold, color: colors.accent, fontSize: 18, letterSpacing: 1 },
});
