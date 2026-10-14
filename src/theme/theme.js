// AIS PhyStock — design tokens
// Direction: industrial control-panel, tuned for outdoor/warehouse glare —
// near-black chassis (not mid-gray) so white text and the amber signal
// color hold contrast even when the phone screen catches direct light.
// Display type is a condensed stencil-adjacent face echoing the bold
// stamped codes on the actual AIS pallet tickets (e.g. "RB2.LFH.N").

export const colors = {
  bg: '#0B0E11',          // chassis background — near-black for glare
  bgElevated: '#15191D',  // raised panel
  panel: '#1A1F24',       // card surface
  panelAlt: '#20262C',    // secondary card / input surface
  border: '#3A4550',      // brighter than before — visible under glare
  borderStrong: '#57646F',

  accent: '#FFC233',      // safety amber, boosted saturation/brightness
  accentDim: '#8A6118',
  accentSoft: '#3D2E10',
  accentGradientEnd: '#FF9500',

  success: '#3EE08A',
  successSoft: '#0F2A1C',
  danger: '#FF4F55',
  dangerSoft: '#3D1418',
  info: '#5CB4E0',

  text: '#FFFFFF',
  textDim: '#B7C0C9',     // brighter than a typical "dim" gray
  textFaint: '#7C8792',
  onAccent: '#14181C',
};

export const type = {
  display: 'Oswald_600SemiBold',
  displayBold: 'Oswald_700Bold',
  displayMed: 'Oswald_500Medium',
  body: 'Inter_400Regular',
  bodyMed: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
  mono: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
};

export const space = (n) => n * 4;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 6,
  },
  glow: {
    shadowColor: '#FFC233',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
};

// QR category badges — kept visually distinct at a glance
export const qrTypeMeta = {
  Slot1: { label: 'SLOT-1', color: colors.accent, soft: colors.accentSoft },
  Simple: { label: 'TYPE-B', color: colors.info, soft: '#122A3A' },
  Other: { label: 'OTHER', color: colors.textDim, soft: '#242C33' },
  Unrecognized: { label: 'UNREAD', color: colors.danger, soft: colors.dangerSoft },
};
