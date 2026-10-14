import React from 'react';
import { Image, StyleSheet } from 'react-native';

// The real AIS diamond mark (red diamond, blue "AIS"), cropped from the
// brand logo — not a hand-drawn approximation. Aspect ratio ~1.44:1
// (width:height), so height is derived from the requested width.
const ASPECT_RATIO = 1476 / 1022;

export default function LogoMark({ size = 52 }) {
  const width = size * ASPECT_RATIO;
  return (
    <Image
      source={require('../../assets/ais-logo-mark.png')}
      style={[styles.image, { width, height: size }]}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  image: {},
});
