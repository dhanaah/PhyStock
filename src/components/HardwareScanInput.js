import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, type as fonts, radius, space } from '../theme/theme';

// Rugged Android scanners (Zebra, Honeywell, Datalogic, Newland, CipherLab,
// etc.) default to "keyboard wedge" output: pulling the trigger decodes the
// code and types it into whatever field is focused, terminated by Enter.
//
// IMPORTANT — this field is a genuinely normal, visible TextInput, not a
// disguised/near-invisible one. An earlier version tried to hide it
// (near-zero opacity, 1px font, absolutely positioned under other views)
// to keep the screen clean, but that's almost certainly what broke
// delivery on some devices (Zebra specifically) while other apps on the
// same device — which just use plain, visible text fields — worked fine.
// Some manufacturers' scan/input-delivery services are strict about only
// injecting keystrokes into fields that are genuinely visible and
// unobstructed (a reasonable anti-tapjacking-style precaution), so
// fighting that with visual tricks was the wrong move. This field now
// looks like what it is: a live input showing scanned text as it
// arrives, briefly, before auto-submitting and clearing.
//
// The Enter/terminator signal is still the least reliable part of this
// to catch — some devices inject a literal CR/LF character into the text
// buffer (handled in handleChangeText), some fire a proper IME submit
// action (onSubmitEditing/onKeyPress), and some send it as a raw key
// event that reaches neither RN callback. Rather than depend on any one
// of those, the PRIMARY mechanism is a pause-based auto-submit: scanner
// output arrives character-by-character far faster than any human types,
// so a quiet buffer for AUTO_SUBMIT_DEBOUNCE_MS reliably means the scan
// finished. The window is deliberately generous since devices vary in
// how fast they send characters (Zebra, depending on the DataWedge
// profile's "Inter-character delay" setting, can be noticeably slower
// than others) — lower that DataWedge setting toward 0 if a specific
// device still cuts codes short.

const DUPLICATE_SUBMIT_WINDOW_MS = 400;
const AUTO_SUBMIT_DEBOUNCE_MS = 350;

// Scanner-only gate. A keyboard-wedge scanner delivers its payload either
// as one chunk (whole string in a single text change) or as a rapid burst
// of single characters a few milliseconds apart. A person — on the soft
// keyboard or a rugged device's physical keypad — can't get below roughly
// 100 ms between keystrokes. So: a single-character change that arrives
// more than HUMAN_TYPING_GAP_MS after the previous one is human keying,
// and the whole buffer is discarded with a visible notice. Scanner bursts
// are never slowed by this. If a specific scanner is configured with an
// unusually large "inter-character delay", lower that setting to 0 in
// its scan profile (DataWedge → Keystroke output → Inter-character delay).
const HUMAN_TYPING_GAP_MS = 120;
// After a rejection, the keyboard's own composition buffer may re-commit
// the whole typed word as ONE chunk on the next key (predictive
// keyboards — Zebra's included — do this). Any multi-character chunk
// landing within this window of a rejection is therefore also human.
const POST_REJECT_WINDOW_MS = 600;
// A single character landing in an EMPTY buffer can't be judged by the
// gap to a previous one, so it is held for this long: a scanner always
// follows it with the rest of the code within a few ms; a lone key that
// nothing follows is a person, and is discarded.
const LONE_KEY_HOLD_MS = 160;
const KEYBOARD_PREF_KEY = 'ais_stocktake_hw_keyboard_v1';
const REJECT_NOTICE_MS = 2200;

// `suspended` — true while the operator is deliberately typing somewhere
// else on the screen (Phy. Qty, Remarks, manual entry). While suspended,
// every automatic refocus path (initial focus, post-scan refocus, the
// watchdog) stands down so the capture field can't yank focus away from
// the field being typed into. The moment the other field blurs,
// `suspended` drops and focus comes straight back here.
export default function HardwareScanInput({ onScan, active, onBufferChange, suspended = false }) {
  const [value, setValue] = useState('');
  const [pulse, setPulse] = useState(false);
  const [rejected, setRejected] = useState(false);
  const valueRef = useRef('');
  const lastChangeAtRef = useRef(0);
  const rejectTimerRef = useRef(null);
  const loneTimerRef = useRef(null);
  // On-screen keyboard stays ALLOWED by default. Suppressing it
  // (showSoftInputOnFocus=false) stops some scan services — Zebra
  // DataWedge included — from delivering keystrokes at all; that was
  // v1.2.2's "native scanner not working". Typing is harmless anyway:
  // the gate below discards every human keystroke. Hiding the keyboard is
  // an opt-in per device, for devices verified to keep scanning with it
  // hidden.
  const [keyboardAllowed, setKeyboardAllowed] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem(KEYBOARD_PREF_KEY).then((v) => { if (v === '0') setKeyboardAllowed(false); }).catch(() => {});
  }, []);
  const toggleKeyboard = () => {
    setKeyboardAllowed((v) => {
      AsyncStorage.setItem(KEYBOARD_PREF_KEY, v ? '0' : '1').catch(() => {});
      return !v;
    });
    setTimeout(() => { inputRef.current?.blur(); setTimeout(focusNow, 80); }, 0);
  };
  const inputRef = useRef(null);
  const lastSubmitRef = useRef({ text: null, at: 0 });
  const debounceRef = useRef(null);

  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;

  const focusNow = () => {
    if (suspendedRef.current) return;
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (active && !suspended) {
      const t = setTimeout(focusNow, 150);
      return () => clearTimeout(t);
    }
  }, [active, suspended]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (rejectTimerRef.current) clearTimeout(rejectTimerRef.current);
    if (loneTimerRef.current) clearTimeout(loneTimerRef.current);
  }, []);

  const lastRejectAtRef = useRef(0);
  const rejectManualInput = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    lastRejectAtRef.current = Date.now();
    valueRef.current = '';
    setValue('');
    onBufferChange?.('');
    // Reset the keyboard's input connection too — clearing React state
    // alone leaves a predictive keyboard's composition intact, and it
    // would re-insert the word on the next keystroke. clear() + a
    // blur/focus cycle drops that composition.
    try { inputRef.current?.clear(); } catch (e) { /* ignore */ }
    try { inputRef.current?.blur(); } catch (e) { /* ignore */ }
    setTimeout(focusNow, 60);
    setRejected(true);
    if (rejectTimerRef.current) clearTimeout(rejectTimerRef.current);
    rejectTimerRef.current = setTimeout(() => setRejected(false), REJECT_NOTICE_MS);
  };

  // Refocus after every scan is genuinely critical here — this field
  // has to be ready to catch the very next trigger pull with zero
  // manual interaction. A single refocus attempt can lose a race against
  // other things that happen right after a scan (a re-render from the
  // new scan data landing, an Alert popping up for an error/duplicate,
  // etc.), so this fires several staggered attempts instead of just one.
  const refocus = () => {
    [30, 150, 400].forEach((delay) => setTimeout(focusNow, delay));
  };

  // Backstop: while this mode is active, periodically check whether the
  // field actually still has focus and reclaim it if something knocked
  // it out — catches any case the staggered refocus() calls above miss
  // (e.g. the person's thumb grazed another element on screen).
  useEffect(() => {
    if (!active || suspended) return;
    const watchdog = setInterval(() => {
      if (inputRef.current && inputRef.current.isFocused && !inputRef.current.isFocused()) {
        focusNow();
      }
    }, 1500);
    return () => clearInterval(watchdog);
  }, [active, suspended]);

  const submit = useCallback((text) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const trimmed = (text || '').trim();
    valueRef.current = '';
    setValue('');
    onBufferChange?.('');
    if (!trimmed) {
      refocus();
      return;
    }
    const now = Date.now();
    if (lastSubmitRef.current.text === trimmed && now - lastSubmitRef.current.at < DUPLICATE_SUBMIT_WINDOW_MS) {
      // Same content submitted again within the guard window — almost
      // certainly a second terminator signal for the same trigger pull,
      // not a genuine second scan.
      refocus();
      return;
    }
    lastSubmitRef.current = { text: trimmed, at: now };
    setPulse(true);
    setTimeout(() => setPulse(false), 300);
    onScan(trimmed);
    refocus();
  }, [onScan, onBufferChange]);

  const handleChangeText = (text) => {
    const now = Date.now();
    const prev = valueRef.current;
    const added = text.length - prev.length;
    const gap = now - lastChangeAtRef.current;
    lastChangeAtRef.current = now;

    // Human keying: a backspace/edit, or a lone character arriving at
    // typing speed after the previous one. Scanner bursts never trip this.
    const isEdit = added < 0 || (added === 0 && text !== prev);
    const isSlowSingleKey = added === 1 && prev.length > 0 && gap > HUMAN_TYPING_GAP_MS;
    const isRecommitAfterReject = added >= 1 && prev.length === 0 && (now - lastRejectAtRef.current) < POST_REJECT_WINDOW_MS;
    if (isEdit || isSlowSingleKey || isRecommitAfterReject) {
      rejectManualInput();
      return;
    }
    if (loneTimerRef.current) { clearTimeout(loneTimerRef.current); loneTimerRef.current = null; }
    if (added === 1 && prev.length === 0 && !/[\r\n\t]/.test(text)) {
      // First character into an empty buffer: hold judgement briefly.
      loneTimerRef.current = setTimeout(() => {
        loneTimerRef.current = null;
        if (valueRef.current.length === 1) rejectManualInput();
      }, LONE_KEY_HOLD_MS);
    }

    // CR, LF, CRLF or Tab — all four are common scanner suffix
    // configurations (DataWedge / EZConfig / Urovo scan settings).
    const termIndex = text.search(/[\r\n\t]/);
    if (termIndex !== -1) {
      submit(text.slice(0, termIndex));
      return;
    }
    valueRef.current = text;
    setValue(text);
    onBufferChange?.(text);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      submit(text);
    }, AUTO_SUBMIT_DEBOUNCE_MS);
  };

  return (
    <View style={styles.wrap}>
      <Pressable onPress={focusNow} style={[styles.card, pulse && styles.cardPulse, rejected && styles.cardRejected]}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, pulse && styles.dotPulse, rejected && styles.dotRejected]} />
          <Text style={[styles.statusText, rejected && styles.statusTextRejected]}>
            {rejected
              ? 'Keyboard input ignored — use the scanner trigger'
              : pulse ? 'Captured' : 'Ready — pull the trigger to scan'}
          </Text>
        </View>
        <View style={styles.inputWrap}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={handleChangeText}
          onSubmitEditing={(e) => submit(e.nativeEvent.text)}
          onKeyPress={({ nativeEvent }) => {
            if (nativeEvent.key === 'Enter') submit(value);
          }}
          blurOnSubmit={false}
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="off"
          keyboardType="visible-password"
          importantForAutofill="no"
          returnKeyType="done"
          submitBehavior="submit"
          contextMenuHidden
          caretHidden
          showSoftInputOnFocus={keyboardAllowed}
          placeholder={value ? '' : 'Scanned text appears here'}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          autoFocus={active && !suspended}
        />
        {/* The field's own text is transparent (style.input). What the
            operator sees is this overlay, shown only once the buffer is a
            confirmed burst (2+ characters) — so a stray human keystroke
            never even flashes on screen before the gate discards it. */}
        {value.length >= 2 && (
          <View pointerEvents="none" style={styles.echo}><Text style={styles.echoText} numberOfLines={1}>{value}</Text></View>
        )}
        </View>
        {/* Invisible touch guard, sitting exactly on top of the field.
            A direct tap on a live TextInput repositions the cursor or
            selects text — completely fine for a normal text field, but
            here it can land mid-stream while the scanner is still
            injecting characters (very fast, but not instantaneous),
            corrupting the capture with a misplaced cursor or an
            overwritten selection. This guard intercepts all touches
            and just calls focusNow() instead of letting them reach the
            TextInput's native touch handling — harmless if it's already
            focused. This has zero effect on the scanner's own input:
            that arrives through the OS input connection/IME, not
            through touch/gesture events at all, so it's untouched by
            this. */}
        <Pressable onPress={focusNow} style={StyleSheet.absoluteFillObject} />
      </Pressable>
      <Pressable onPress={toggleKeyboard} hitSlop={8} style={styles.kbToggle}>
        <Text style={styles.kbToggleText}>
          {keyboardAllowed ? 'Typing is ignored here. On-screen keyboard shown · tap to hide (test scanning after!)' : 'On-screen keyboard hidden · tap to show (if scans stop arriving)'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: space(5) },
  kbToggle: { alignItems: 'center', marginTop: 6 },
  kbToggleText: { fontFamily: fonts.body, color: colors.textFaint, fontSize: 10.5, textDecorationLine: 'underline' },
  card: {
    backgroundColor: colors.panel, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.lg, padding: space(4),
  },
  cardPulse: { borderColor: colors.success, backgroundColor: colors.successSoft },
  cardRejected: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  dot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.accent },
  dotPulse: { backgroundColor: colors.success },
  dotRejected: { backgroundColor: colors.danger },
  statusTextRejected: { color: colors.danger },
  statusText: { fontFamily: fonts.bodySemi, color: colors.text, fontSize: 13.5 },
  input: {
    backgroundColor: colors.panelAlt, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    color: 'transparent', fontFamily: fonts.monoBold, fontSize: 16,
  },
  inputWrap: { position: 'relative' },
  echo: { ...StyleSheet.absoluteFillObject, paddingHorizontal: 14, justifyContent: 'center' },
  echoText: { color: colors.text, fontFamily: fonts.monoBold, fontSize: 16 },
});
