import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { colors } from '../theme/theme';

const CORNER = 26;

// Viewfinder brackets + sweeping scan line. `size` is supplied by the
// parent from its real measured container so the frame always fits
// inside the camera box (an earlier fixed 320px frame was taller than
// the camera box itself and the lower corners were being clipped off).
export default function ScannerFrame({ active = true, size = 160 }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loop;
    if (active) {
      anim.setValue(0);
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 1500, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 1500, useNativeDriver: true }),
        ])
      );
      loop.start();
    }
    return () => loop && loop.stop();
  }, [active, anim]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [6, size - 8] });

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      <View style={[styles.corner, styles.tl]} />
      <View style={[styles.corner, styles.tr]} />
      <View style={[styles.corner, styles.bl]} />
      <View style={[styles.corner, styles.br]} />
      {active && (
        <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center' },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: colors.accent,
  },
  tl: { top: 0, left: 0, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 4 },
  tr: { top: 0, right: 0, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 4 },
  bl: { bottom: 0, left: 0, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 4 },
  br: { bottom: 0, right: 0, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 4 },
  scanLine: {
    position: 'absolute',
    left: 6,
    right: 6,
    height: 2,
    backgroundColor: colors.accent,
    opacity: 0.9,
  },
});
