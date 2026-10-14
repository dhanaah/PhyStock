import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Animated, Easing, Pressable, View, Text, StyleSheet, LayoutAnimation, Platform, UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, type as fonts } from '../theme/theme';

// Motion kit — every animation in the app comes from here so timing and
// feel stay consistent. All transforms run on the native driver.
//
//  <PressScale>  — press-squeeze for any button (scale 0.96 on press-in,
//                  springs back on release)
//  <FadeRise>    — fade in + rise 14px; `index` staggers siblings so a
//                  column of buttons/cards appears one after another
//  <Collapsible> — group with a header row, rotating chevron and smooth
//                  height animation for expand/collapse

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const EASE_OUT = Easing.bezier(0.2, 0.8, 0.2, 1);

export function PressScale({ onPress, onLongPress, disabled, style, containerStyle, children, scaleTo = 0.96, hitSlop, testID }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(scale, {
    toValue: v, useNativeDriver: true, speed: 40, bounciness: v === 1 ? 8 : 0,
  }).start();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      testID={testID}
      onPressIn={() => to(scaleTo)}
      onPressOut={() => to(1)}
      style={containerStyle}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

export function FadeRise({ index = 0, delay = 0, step = 70, duration = 320, distance = 14, style, children }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1, duration, delay: delay + index * step, easing: EASE_OUT, useNativeDriver: true,
    }).start();
  }, [v, delay, index, step, duration]);
  return (
    <Animated.View style={[style, {
      opacity: v,
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
    }]}>
      {children}
    </Animated.View>
  );
}

export function animateLayout(duration = 260) {
  LayoutAnimation.configureNext({
    duration,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

export function Chevron({ open, size = 18, color = colors.textDim }) {
  const rot = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(rot, { toValue: open ? 1 : 0, duration: 220, easing: EASE_OUT, useNativeDriver: true }).start();
  }, [open, rot]);
  return (
    <Animated.View style={{ transform: [{ rotate: rot.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] }) }] }}>
      <Ionicons name="chevron-down" size={size} color={color} />
    </Animated.View>
  );
}

export function Collapsible({ title, subtitle, right, defaultOpen = true, open: controlledOpen, onToggle, children, style, headerStyle }) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const open = controlledOpen ?? innerOpen;
  const toggle = useCallback(() => {
    animateLayout();
    if (onToggle) onToggle(!open);
    if (controlledOpen === undefined) setInnerOpen((v) => !v);
  }, [open, onToggle, controlledOpen]);
  return (
    <View style={[styles.group, style]}>
      <PressScale onPress={toggle} scaleTo={0.985} style={[styles.header, headerStyle]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
        {right}
        <Chevron open={open} />
      </PressScale>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: 14 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10,
  },
  title: { fontFamily: fonts.bodySemi, color: colors.text, fontSize: 15 },
  subtitle: { fontFamily: fonts.body, color: colors.textFaint, fontSize: 11.5, marginTop: 1 },
  body: { paddingTop: 2 },
});
