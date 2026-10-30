# AIS Stock Take

Native Android app (Expo / React Native) for QR-based pallet stock-taking.

## What it does

- **Setup**: requires a user name and bay before scanning can start.
- **Scan**: camera-based QR scanning. Every code is parsed into one of three
  categories and shown as a "ticket" with its fields bifurcated out:
  - **Slot1** — the big `@`-delimited QR (Part No, Model Code, Work Order,
    Quantity, Pallet No, Plant, Mfg Date, LPN).
  - **Type-B** — the small `PalletNo.LPN` QR.
  - **Other** — anything else (e.g. the white "TM BWL" Data Matrix label).
    The parser still tries to pull out an LPN using the universal
    `P` + 11-digit pattern so uniqueness checking keeps working even for
    formats not fully mapped yet — see `src/utils/qrParser.js` to extend
    this once you send over the raw decoded string for that label.
  - Duplicate LPNs are flagged **live**, checked across the whole
    stock-take (all bays combined), not just the current bay.
- **Dashboard**: live totals, breakdown by QR type, filter by bay/user,
  search, duplicate-only view.
- **Reports**: download a `.csv` (Timestamp, User, Bay, LPN, Part No, Qty,
  QR Type) to send to the team via the normal Android share sheet
  (WhatsApp, email, Drive, etc.). Also supports exporting a full `.json`
  backup and importing/merging backups from other phones/bays into one
  consolidated dashboard — since there's no server, this is how multiple
  bays get combined into a single count.

All data is stored on-device only (`AsyncStorage`) — nothing leaves the
phone except when you deliberately export a file.

## Project structure

```
App.js                     Navigation root, font loading, session gate
src/theme/theme.js          Colors, type scale, spacing tokens
src/context/AppDataContext  Session + scans state, duplicate detection
src/storage/storage.js      AsyncStorage read/write helpers
src/utils/qrParser.js       Raw QR string -> structured record
src/utils/exportFiles.js    CSV/JSON export + import/merge
src/screens/                Setup, Scan, Dashboard, Reports
src/components/             TicketCard, StatCard, Badge, ScannerFrame, ChangeBayModal
```

## Running it yourself

You'll need Node.js installed, and an Expo account (free) for EAS builds.

```bash
npm install

# Run on your own phone during development (Expo Go app or a dev client)
npx expo start

# Build a real installable APK in the cloud (no Android Studio needed)
npm install -g eas-cli
eas login
eas build:configure          # links this project to your Expo account,
                              # fills in the real eas.projectId
eas build -p android --profile preview
```

The `preview` build profile in `eas.json` produces a direct `.apk` you can
side-load onto any Android phone — no Play Store submission needed. The
`production` profile produces an `.aab` for the Play Store if you want to
distribute it that way later.

## Recent changes

### v1.5.1 — Photo count sheet: clearer fallback, boxed digits

- Always tries the data center first; when it falls back to the on-device
  reader it now says why (e.g. "data center: HTTP 500 …") and that handwriting
  reads better on the data center (server v1.4.3+ reads table cells one by one).
- On-device reader joins one-digit-per-box tokens into a single number.

### v1.5.0 — Photo count sheet → bay targets

- **Reports → Bay progress → "Photo count sheet → targets".** Photograph
  the paper count sheet (or pick it from the gallery). It is read into a
  `Bay | Count` table: on the data center when linked (RapidOCR), otherwise
  — or if the server is unreachable — on the device with ML Kit text
  recognition, fully offline.
- **Review before anything is applied.** Rows the reader was not sure
  about are red and must be corrected or removed; bay codes are validated
  (`A01` form), duplicates refused. *Apply* asks for the admin PIN, then
  sends the reviewed rows to the data center (which keeps the photo for
  audit and pushes the targets to every device) or, when not linked,
  applies them to this device only. Optional *Replace all* vs merge by bay.
- New deps: `expo-image-picker`, `expo-image-manipulator` (downscale to
  1800 px before upload), `@react-native-ml-kit/text-recognition`. Needs a
  new EAS build (native modules).

### v1.4.1 — Zebra: keying via predictive keyboard, and pairing camera

- **Keying slipped through on Zebra.** The TC22's keyboard composes words
  predictively; after the gate cleared a stray keystroke, the keyboard's
  own composition re-committed the whole word as ONE chunk on the next
  key — indistinguishable from a scanner burst. Now: `keyboardType=
  "visible-password"` (Android disables composition/suggestions for it),
  every rejection also calls `clear()` and cycles blur/focus to drop the
  keyboard's composition, and any chunk arriving within 600 ms of a
  rejection is treated as human.
- **Camera couldn't detect in the pairing scanner.** Opening the Data
  center sheet from the Scan screen started a second camera while the
  Scan screen's camera was still live; Zebra's camera stack refuses the
  second session. The main camera is paused while the sheet is open.

### v1.4.0 — duplicates refused at scan time, content-anchored label parser, scanner-only input

- **Duplicates are REFUSED, not recorded.** A second scan of a pallet
  already counted — on this device, or (while the data center is
  reachable) on any other device, checked live via `GET /api/v1/lpn-check`
  before accepting — is rejected at scan time: red *REFUSED · DUPLICATE* /
  *REFUSED · ALREADY COUNTED BY TC22-A @ A01* strip, duplicate tone,
  error haptic, ticket marked REFUSED, no Phy.Qty/Remarks. Nothing is
  stored in the count. Each refusal is logged (`dupAttempts`, persisted,
  synced to the server with every push/heartbeat) so the dashboard and
  both CSVs show an audit block. The type-aware rule is unchanged. If the
  server check can't answer within 1.5 s the scan is accepted locally and
  the later ACK flags it (shown as "flagged after sync" on the dashboard).
- **Label parser rewritten to identify fields by content, not position**
  (`qrParser.js`). The QR and the Data Matrix on one label can list
  fields in different orders and some labels omit a field; the old
  positional read put quantities into the item-code column depending on
  which code decoded first. Now: the LPN segment anchors everything,
  quantity is the short number right before it, date and plant/segment
  are recognised by pattern, part number is the leading segment, model
  code / work order fill from what remains, leftovers go to *Other*. GS1
  group separators and trailing CR/LF are normalised. Verified against
  the Bawal Data Matrix, the reference QR format, a shuffled order, a
  missing work order and a GS1-separated string.
- **Manual keying closed off.** The scanner field's own text is
  transparent; what you see is an overlay shown only once a burst of 2+
  characters has arrived, so a stray keystroke never appears at all.
  "Enter code manually" now requires the admin PIN and closes after one
  entry.
- **Mode buttons are icons**: barcode = Scanner (native), camera = Camera.
- Dashboard / Reports tiles read "Dup. refused".

### v1.3.3 — "Scan QR on dashboard to link" button

- The Data center sheet (cloud chip on Scan, or Reports → Data center)
  now has an explicit **Scan QR on dashboard to link** button that opens
  its own scanner (`LinkQrModal`): camera live and hardware trigger
  captured at the same time, independent of the Scan screen's mode.
  Accepts only the dashboard's setup code; links, heartbeats and pushes
  the backlog immediately. Scanning the QR from the main Scan screen still
  works as before.

### v1.3.2 — camera preview bleeding over the content below

- The preview runs in `resizeMode="cover"`, which scales the camera image
  larger than its box; the box had lost `overflow: 'hidden'` in the
  black-preview fix, so the image spilled over the counters. Clipping is
  restored — safe now because the preview is a TextureView (only
  SurfaceView could not be clipped).

### v1.3.1 — native scanner back, device-based default mode

- **Regression fix (v1.2.2–1.3.0): hardware scanner delivered nothing.**
  v1.2.2 hid the on-screen keyboard on the scan field by default
  (`showSoftInputOnFocus=false`). Zebra DataWedge (and some other scan
  services) stop injecting keystrokes into such a field — the same thing
  seen once before. Keyboard is allowed again by default; typing is still
  discarded by the gate, so nothing is lost. "Hide keyboard" remains an
  opt-in link under the card for devices verified to keep scanning.
- **Regression fix (v1.3.0): Camera / Hardware Scanner buttons shrank.**
  The press-squeeze wrapper had taken `flex: 1` off the touchable. Fixed
  (`PressScale` now has `containerStyle`); same for Reports and sheet
  buttons.
- **Default mode by device.** First launch on a rugged scanner (Zebra,
  Honeywell, Urovo, Datalogic, Newland, CipherLab, Chainway, Point Mobile,
  Unitech, M3, …, detected via `expo-device` manufacturer/model) starts in
  **Hardware Scanner** mode; phones start in **Camera**. The toggle is
  always shown and the operator's choice is remembered.

### v1.3.0 — motion

New `src/components/motion.js` (all native-driver):
- **Screens slide in** — bottom tabs use `animation: 'shift'` (260 ms), so
  Scan / Dashboard / Reports slide from the side they sit on.
- **Groups expand/collapse smoothly, chevron rotates** — `Collapsible`
  (LayoutAnimation + rotating chevron). Reports sections are now
  collapsible groups (Danger zone starts collapsed). Manual-entry and
  raw-log toggles on Scan animate their layout too.
- **Buttons fade and rise one after another** — `FadeRise` with a
  per-item `index` stagger (70 ms): Setup form blocks + Start button,
  Reports groups, Scan counters.
- **Press-squeeze** — `PressScale` (0.96 spring) on every primary action:
  mode toggle, Save, Reports action buttons, Data-center card and sheet
  buttons, Start Scanning.

### v1.2.2 — scanner field: keyboard really off

- The hardware-scanner capture field now **hides the on-screen keyboard**
  (`showSoftInputOnFocus=false`). Scanner keystrokes arrive through the
  input connection and don't need it. A small link under the card can
  re-allow the keyboard, persisted per device — only for the case where a
  particular scanner build stops delivering with the keyboard suppressed
  (seen once on an older Urovo).
- The typing gate also catches the **first** keystroke now: a lone
  character into an empty buffer is held 160 ms; if nothing follows (a
  scanner always follows within a few ms) it is discarded with the red
  "Keyboard input ignored" notice. Previously the first character stayed
  visible until the next key was pressed, which looked like the field
  accepting typing. Physical keypad keys are caught the same way.

### v1.2.1 — Data center sheet buttons (again)

- With Expo's Android edge-to-edge, a Modal no longer gets window
  resizing for the keyboard, so KeyboardAvoidingView / safe-area padding
  alone could still leave *Test connection* / *Save & link* under the
  keyboard or gesture bar. The sheet now measures the keyboard itself
  (`Keyboard` events) and shrinks by that height, and the two action
  buttons live in a **sticky footer** outside the scroll area — always
  visible, keyboard open or closed.

### v1.2.0 — renamed to AIS PhyStock, new logo & icon

- App name **AIS PhyStock** (launcher label, `app.json`), version 1.2.0.
- New identity: stacked glass sheets (isometric) inside scanner brackets
  with an amber scan line — the same visual language as the camera
  viewfinder. Applied to launcher icon (adaptive + monochrome/themed),
  splash, favicon, Setup screen (PhyStock mark + wordmark; the real AIS
  diamond stays as the brand mark beside it).
- CSV / backup filenames now `PhyStock_…`. Setup-QR scheme
  (`aisstocktake://`) and storage keys are unchanged, so existing installs
  upgrade in place and keep their data and server link.
- Brand sources (SVG + PNG) are in the separate `AIS_PhyStock_Brand.zip`.

### v1.1.1 — hotfix after first on-device test of the data-center link

- **"CLEARTEXT communication … not permitted by network security policy"**
  — Android (9+) refuses plain `http://` connections from apps unless the
  app opts in. The server runs over HTTP on the LAN, so the app now
  declares `usesCleartextTraffic: true` via the `expo-build-properties`
  plugin (`app.json`). This is a native config change, so a **new EAS
  build** is required — a JS-only update would not fix it.
- **Data center sheet** — action buttons could sit under the gesture bar
  or the keyboard. The sheet (a Modal, outside the app's SafeAreaView)
  now adds the bottom inset itself and scrolls to its end when an input
  is focused.

### v1.1.0 — Data center sync (server + live dashboard)

New companion: **AIS Stock Take Server** (separate folder/zip) — the "data
center" PC on the warehouse network. The app is still fully offline-first;
the server is an additional destination, never a dependency.

- **Instant push.** Every scan (and every Phy. Qty / Remarks edit) is sent
  to the server the moment it is saved locally. The server ACKs with a
  **receipt number** and **received-at timestamp**, both stored on the
  record (`syncReceipt`, `syncReceivedAt`, `syncStatus`) and included in
  the device CSV. Scanning never waits for the network.
- **No data loss.** A record is only marked *synced* after the ACK.
  Anything else stays *pending* and is retried automatically (on each new
  scan, every 15 s heartbeat, on app foreground, with backoff) — plus a
  **Sync now** button. Records are keyed by their device-generated ID, so
  a retry can never duplicate a record on the server. Records created
  before a server was linked are pushed as soon as one is.
- **Link by QR.** Scan the QR on the server dashboard (camera or trigger)
  — the app recognises the `aisstocktake://server?url=…` setup code and
  links itself. Or type the address under Reports → Data center. Device
  name is editable there; a stable device ID is generated per install.
- **Status everywhere.** Cloud chip in the Scan header (grey = not linked,
  green = synced, amber = N pending, red = offline · N pending; tap it for
  the Data center sheet with Test connection / Sync now / unlink). Each
  Dashboard row shows ✓ #receipt or "pending".
- **Cross-device duplicates.** If another scanner already sent the same
  pallet, the ACK says so: red *ALREADY SCANNED · TC22-A @ A01* strip,
  duplicate beep + haptic, badge on the ticket and Dashboard row, column
  in the CSV. Counted in the Dashboard subtitle.
- **Bay targets from the server.** While linked, targets set on the
  dashboard replace the local set on every heartbeat (server is master);
  the local editor is hidden while linked and returns when unlinked.
- **Clear all** on the device never touches the server.
- Version shown on the Setup screen signature (`Created by: DT · v1.1.0`)
  and reported in every heartbeat.
- Files: `src/context/SyncContext.js` (engine), `src/components/ServerSheet.js`
  (UI), `src/config.js` (`APP_VERSION`, `HEARTBEAT_SECONDS`),
  `storage.js` (`getServerConfig`/`saveServerConfig`),
  `AppDataContext` (`applyScanPatches`, `replaceBayTargets`, `serverConfig`,
  `stats.pendingSync`, `stats.crossDeviceDuplicates`).

v1.0.0 (the last build before this) is kept separately as the stable
fallback — `AISStockTake_v1.0.0_STABLE.zip`.

### Professional-grade pass (scanning technique, performance, UX)

- **Instant duplicate on every pallet — fixed.** Every AIS label carries
  *both* a QR and a Data Matrix for the same pallet. The camera sees both
  in one frame (and a hardware scanner can decode either on successive
  pulls); they're different raw strings, so the raw-string repeat guard
  never caught it and the second code was logged as an immediate
  DUPLICATE of the first. There is now a **pallet-level guard**: once an
  LPN is recorded, any further code resolving to the same LPN is ignored
  for 4 s (a camera frame with several codes is also ordered so the
  Detailed code is processed first). The one exception — a Detailed code
  arriving just after an LPN-only code for the same pallet — is treated
  as an upgrade and goes through. Hardware same-code cooldown raised to
  3 s to cover scanners in continuous-read mode with the trigger held.

- **Camera preview black-screen — root cause found and fixed.** The camera
  box had `overflow: 'hidden'` + `borderRadius`. Android camera previews
  in their default *SurfaceView* mode (expo-camera **and** vision-camera)
  are composited by the OS underneath the app window through a hole
  punched in it, and vision-camera's own docs state SurfaceView "doesn't
  support masks, transparency, rotations or **clipping**". A clipped,
  rounded parent can leave that hole unpunched — camera running and
  decoding perfectly while the preview area shows only the app
  background. It was the one thing the two different camera libraries
  had in common, which is why swapping libraries changed nothing. Two
  independent fixes, either of which should be sufficient on its own:
  (1) `androidPreviewViewType="texture-view"` on the Camera (composites
  inside the normal view hierarchy), and (2) the camera container no
  longer clips or rounds — the border is drawn as a separate overlay on
  top. The always-on size/ready badge is now only shown while the raw
  scan log is open.
- **Hardware mode is scanner-only now.** The capture field used to accept
  anything typed on the soft keyboard or the device's physical keypad. A
  typing-speed gate in `HardwareScanInput` now discards human keying: a
  scanner delivers its payload as one chunk or a burst of characters a
  few ms apart, whereas a person can't get under ~120 ms per keystroke.
  Any single character arriving at human speed (or any backspace/edit)
  clears the buffer and shows "Keyboard input ignored — use the scanner
  trigger" on the card for 2 s. Paste is blocked (context menu hidden)
  and the caret is hidden. Scanner bursts are never slowed by this. If a
  scanner profile has a large *inter-character delay* configured, set it
  to 0 (DataWedge → Keystroke output → Inter-character delay). Deliberate
  manual entry still exists via the explicit "Enter code manually" link,
  which validates the LPN structure before logging.
- **Tab terminator** accepted alongside CR / LF / CRLF (some scan
  profiles are set to send Tab as the suffix).
- **Auto-refocus no longer fights the operator.** The hardware capture
  field's refocus watchdog used to reclaim focus every 1.5 s — including
  while someone was typing Remarks / Phy. Qty / manual entry, snatching
  the cursor mid-word. The field now stands down (`suspended` prop)
  while any of those inputs has focus and takes focus back the moment
  they blur or Save is pressed (which also dismisses the keyboard).
- **Camera re-arm instead of a fixed cooldown.** Previously the same code
  was logged again after 2.5 s even if the phone never moved — a lingering
  aim over one pallet produced a spurious duplicate. Now a code is only
  eligible again after it has been *out of view* for 1.5 s; "scan it
  again" is a deliberate move-away-and-back gesture.
- **Big outcome strip** under the camera/scanner box after every scan:
  green `NEW · <LPN>`, red `DUPLICATE · <LPN>`, amber `UNREADABLE CODE`
  — readable at arm's length without reading the ticket.
- **Screen stays awake** on the Scan tab (`expo-keep-awake`) — no more
  dimming/locking mid-bay.
- **Camera released in background.** `isActive` now also tracks
  `AppState`, so a home-button press, call, or screen lock releases the
  camera and it re-initialises cleanly on return (frozen-preview-on-return
  was a known risk).
- **Performance — storage.** Every scan used to re-read and re-parse the
  entire scan array from AsyncStorage before writing it back, so the
  pull-to-beep latency grew linearly with the size of the stock take.
  The context now holds the authoritative in-memory array (`scansRef`),
  state updates first (instant beep/ticket), and the disk write is
  queued behind it through a **serialized write chain** in `storage.js`
  — two rapid scans can no longer race each other's `setItem` and drop a
  record. Duplicate detection reads the live array, not the last
  render's memoized maps, so two pulls landing before a re-render still
  see each other.
- **Performance — camera decode churn.** The camera reports a code on
  every frame it's in view (up to 30×/s); each report used to call
  `setState` for the raw log → a full Scan-screen re-render 30×/s while
  aiming. Counting now accumulates in a ref and the visible log refreshes
  at most every 400 ms.
- **Performance — Dashboard.** The record list is a virtualized
  `FlatList` (header holds the stats/filters so the page still scrolls as
  one piece); only visible rows are mounted and rows are memoized. Smooth
  at thousands of records and while typing in the search box.
- **Viewfinder** now sizes itself from the real camera box (the old fixed
  320 px frame was taller than the box and its lower corners were
  clipped). Camera box is taller (232 px) for a more comfortable aim.
- **Bottom tab bar polish** (Scan / Dashboard / Reports): fixed-size icon
  pill for every tab so nothing shifts on selection, filled icon variant
  when active, equal flex per item, consistent 6/8 px vertical rhythm,
  semibold labels, thinner top rule, and the bar hides while the keyboard
  is open so it never floats mid-screen during Remarks entry.

- **Admin PIN**: clearing all scans (Reports → Danger zone) now requires
  a PIN, set in `src/config.js` (`ADMIN_PIN`, default `2468`). Change this
  before rolling the app out.
- **Bay code format**: Zone letter (A–Z) + 2-digit number, e.g. `A01`,
  `X14`, `M05` — picked via `src/components/BayPicker.js`, used on Setup
  and in the "Change bay" modal.
- **Scan sounds**: distinct beep per outcome — new (`beep_new.wav`),
  duplicate (`beep_duplicate.wav`), unrecognized/error (`beep_error.wav`)
  in `assets/sounds/`, played via `src/utils/useScanSounds.js`. Swap the
  files for your own tones any time — same filenames, any short wav/mp3.
- **Physical Qty**: after a valid scan, an optional "Phy. Qty" field
  appears under the ticket to log a manual count if it differs from the
  system quantity. Not required, not shown for unrecognized codes. Stored
  per-scan and included in the CSV report.
- **Item Code**: "Part Number" relabeled to "Item Code" throughout the UI
  and report (the underlying field name, `partNumber`, is unchanged so
  nothing needs remapping if you're already parsing the CSV elsewhere).
- **Dashboard segments**: the QR-type breakdown (Slot-1/Type-B/Other) was
  replaced with business segments — OEM / OES / AFM / EXP / Other —
  derived from the Plant field on each scan (`classifySegment()` in
  `src/utils/qrParser.js`). QR-type is still shown as a small badge on
  each individual scan record, just not as a dashboard summary card.
- **"Unique only" filter**: replaced "Duplicates only" on the Dashboard —
  toggling it now hides duplicate rows instead of isolating them.

- **Hardware scanner mode**: a "Camera" / "Hardware Scanner" toggle now
  sits above the scan area on rugged devices (Zebra, Honeywell, etc.).
  Hardware mode uses the device's built-in trigger + laser/imager engine
  instead of the phone camera — see the setup note below, this needs a
  one-time device configuration.

- **Segment + Plant Code**: the label's "Plant" field (e.g. `OEM CHN`,
  `Spares BWL`, `Exports PAT`) is now parsed into two separate values —
  a normalized **Segment** (OEM / OES / AFM / EXP, matched via synonyms
  like "Spares"→OES, "Exports"→EXP) and a **Plant Code** (BWL, CHN, PAL,
  PAT, TAU). See `parsePlantField()` in `src/utils/qrParser.js` — add
  more synonyms or plant codes there if new ones show up.
- **Data Matrix scanning**: camera now decodes Data Matrix symbology in
  addition to QR, so the white "TM BWL" label type should scan directly
  now (still falls into the generic "Other" category until you send the
  real field layout for it).
- **LPN-only ("Simple") scans**: now tagged with a "LPN Stock (Oracle
  Pick)" note instead of just showing bare fields, and duplicate logic
  is now type-aware:
  - A **Detailed (Slot1)** scan is only flagged duplicate against another
    prior **Detailed** scan of the same LPN — an earlier LPN-only "stock"
    note doesn't block the real count from landing cleanly.
  - A **Simple (LPN-only)** scan is flagged duplicate if that LPN has
    been seen at all before (Detailed or Simple).
  - See the `recordScan()` duplicate logic in `src/context/AppDataContext.js`
    if this needs further tuning.
- **Unique-only export**: the CSV report now automatically excludes
  duplicate-flagged scans — the file sent to the team reflects clean,
  unique data only. The full history (including duplicates) is still
  preserved in the JSON backup for audit/merge purposes.

- **Visual pass for outdoor/warehouse glare**: near-black background
  (was mid-gray) so white text and the amber accent hold contrast in
  direct light; borders thickened app-wide (1.5px); bigger type on
  titles, LPN values, and record rows; added an AIS diamond logo mark
  (`src/components/LogoMark.js`), gradient depth on stat cards and the
  Setup screen hero, a colored edge-stripe on each scan ticket (green
  glance-check vs red duplicate), and filled tab-bar icon highlighting.

- **Remarks**: alongside the optional Phy. Qty field, each scan can now
  take an optional free-text Remarks note — same "Save" step, skippable,
  not shown for unrecognized codes. Included in the CSV report.
- **Bay targets & pending alerts**: an admin (PIN-gated, Reports → Bay
  progress → "Manage bay targets") can set the expected physical count
  for any bay. The Scan screen then shows a banner for the active bay —
  "N pending to scan" or "Target reached" — and Dashboard/Reports show a
  progress list across all bays. The exported CSV report gets a trailing
  "BAY PROGRESS SUMMARY" block so the target-vs-scanned picture travels
  with the same file the team receives.

- **CSV bulk upload for bay targets**: inside "Manage bay targets," an
  admin can now import a two-column CSV (`Bay,Target` — e.g. `A01,50`)
  to set every bay's expected count in one shot instead of entering them
  one at a time. A "Get template" button shares a ready-to-fill sample
  CSV. Invalid rows (bad bay code, non-numeric count) are skipped with a
  summary of what was skipped and why; valid rows still import. See
  `src/utils/bayTargetsCsv.js`.

- **Segment parsing made more robust**: handles hyphens/slashes/mixed
  case/no-separator label variants ("OEM-CHN", "oem chn", "OEMCHN"), and
  Simple (LPN-only) scans now inherit the segment from a matching
  Detailed scan of the same LPN when one exists, instead of always
  falling to "OTHER".
- **Dashboard record layout** restructured per feedback:
  Line 1: LPN + Pallet No · Line 2: Model Code + Qty/Alt. Qty (Phy. Qty)
  · Line 3: Timestamp + Bay · Line 4: User. Search now explicitly covers
  both LPN and Pallet No (it already matched Pallet No under the hood;
  the placeholder text just didn't say so).
- **Manual entry validation**: typing a code into "Enter code manually"
  now checks it actually contains a valid LPN (P + 11 digits) before
  logging it — invalid entries show an inline error instead of silently
  recording as Unrecognized.

- **Part Number**: relabeled back from "Item Code" per feedback — now
  "Part Number" again throughout the UI and report (field name
  internally is still `partNumber`, unchanged).
- **Pallet No + LPN delimiter preserved**: the Dashboard's combined
  "LPN + Pallet No" line now reconstructs the original label text
  exactly, using whichever character actually separated them on that
  scan — `.`, `-`, space, etc. — instead of a generic separator. Captured
  in `src/utils/qrParser.js` (`splitPalletAndLpn()`), stored per-scan as
  `palletLpnDelimiter`.

- **Warehouse selection**: a new required field alongside User Name and
  Bay. Defaults to Loc1 (Old W/H), Loc2 (New W/H), Loc3 (Outside W/H),
  Loc4 — plus a "+ Other" free-text option for anything added later. Set
  on the Setup screen, changeable mid-shift via the header's "Change"
  button (now covers both bay and warehouse). Included on every scan
  record, in the CSV report, and as a Dashboard filter. Edit the list in
  `src/components/WarehousePicker.js` (`DEFAULT_WAREHOUSES`) as real
  locations are added. Note: since this is a new required field, anyone
  with an existing session saved (from before this update) will be sent
  back to the Setup screen once to pick a warehouse — their scan history
  is untouched, only the session needs re-confirming.

- **Real AIS logo**: replaced the hand-drawn approximation with your
  actual brand mark (`assets/pngegg.png` you sent — colors sampled
  directly: red `#ED1C24`, blue `#0066B3`). Used in
  `src/components/LogoMark.js` on the Setup screen, and now also as the
  real app icon/adaptive icon/splash icon (previously the Expo
  placeholder) — see `assets/icon.png`, `android-icon-foreground.png`,
  `android-icon-background.png`, `android-icon-monochrome.png`.

- **Dashboard segments = unique only**: the OEM/OES/AFM/EXP/Other stat
  cards now count non-duplicate scans only, matching "Unique LPNs" and
  the CSV export's unique-only behavior. Duplicate-flagged scans no
  longer inflate the segment breakdown.
- **CSV report LPN column** now shows the same combined
  "PalletNo\<delimiter\>LPN" text as the Dashboard (e.g. `CN20082.P08266135317`)
  instead of the bare LPN — same original punctuation preserved.
- **Camera preview reliability**: the camera view now unmounts/remounts
  whenever you leave and return to the Scan tab, so switching tabs can't
  leave a stale session where decoding still runs but the preview goes
  dark. Added a small "Restart camera" button (bottom-right of the
  preview) as a manual fallback if it ever does happen.
- **Hardware scanner reliability**: the invisible capture field used for
  rugged-device trigger scans was previously 1×1px and fully transparent
  — some manufacturers' scan services skip delivering keystrokes to a
  field that visibility-checks as "not really there." It now has real,
  non-zero dimensions (text still invisible via matching color, not
  opacity/size tricks), refocuses automatically if it loses focus, and
  there's a "Tap here to refocus" fallback under the indicator if a
  particular device still won't cooperate.

- **Raw scan debug panel**: "Show raw scan log (debug)" link next to
  manual entry on the Scan screen. Logs every capture attempt exactly as
  received, before any parsing — including camera detections that get
  ignored by the cooldown, so you can tell whether the camera is
  decoding anything at all even if the preview looks wrong. In Hardware
  Scanner mode it also shows a **live buffer** that updates character-by
  -character as input arrives, before Enter — the fastest way to tell
  whether a rugged device's trigger is sending keystrokes at all versus
  sending them but not terminating with Enter. Includes a "Share" button
  to export the log as a text file (send it my way if something still
  looks wrong and I can debug from the actual captured bytes rather than
  guessing). See `src/components/RawScanDebugPanel.js`.

- **Scan screen scrolling fixed**: previously the mode toggle, progress
  banner, counters, camera panel, and manual/debug toggles were all in a
  fixed block above a separate inner scroll area — on shorter screens (or
  with the debug panel + progress banner both open) that fixed block
  could exceed the screen height with no way to reach what was below it.
  The whole screen now scrolls as one unit (only the user/bay header
  stays pinned at the top). Camera/hardware panel height also reduced
  (260 → 190) so more fits on screen without scrolling in the first
  place.

- **Zebra Suffix fix**: added explicit guidance for the DataWedge
  **Suffix** setting (Keystroke output → Basic data formatting → Suffix
  = Enter/CR/CRLF) — without it, decoded text lands in the field but
  never "submits." App-side, the hardware capture field now handles a
  bare CR, bare LF, or CRLF pair identically, with a duplicate-submit
  guard so a CRLF pair can never produce two records for one trigger
  pull — safe alongside other scanner brands already in use.
- **Clear button on Scan screen**: a "Clear" button next to "Last scan"
  dismisses the currently displayed ticket (and any unsaved Phy. Qty/
  Remarks draft) without touching stored data — for clearing old/stale
  results off the screen between scans. The full "clear all stored
  scans" action is still the separate, PIN-gated one in Reports.

- **Hardware scanner — trigger pull doing literally nothing**: removed
  `showSoftInputOnFocus={false}` from the capture field. On some Android
  versions/OEM skins this prop blocks all input delivery to a field, not
  just the soft keyboard — which fully explains "nothing happens" as
  opposed to garbled/partial data arriving. Trade-off: the on-screen
  keyboard may now flash briefly when the Scan screen opens in Hardware
  mode. **Please verify with the raw scan log** (Scan screen → "Show raw
  scan log (debug)") — watch the Live buffer while pulling the trigger;
  if it updates at all now, this was the fix. If it's still completely
  empty, the issue is upstream of the app (DataWedge/scan service not
  actually delivering keystrokes at all — worth double-checking Keystroke
  output is Enabled and the profile is actually scoped to this app).

- **Edit Phy. Qty/Remarks for any existing scan**: Dashboard rows are
  now tappable — opens an edit sheet (LPN, timestamp, bay, part info all
  shown for context) to update Phy. Qty and Remarks for that specific
  record by LPN, not just the scan you just made on the Scan screen.
  Search/filter by LPN or Pallet No first to find the record, then tap
  it. See `src/components/EditScanModal.js`.
- **Save error handling**: the Phy. Qty/Remarks save path (both on Scan
  screen and the new Dashboard edit sheet) now catches storage errors
  properly and shows an alert with the actual reason instead of failing
  silently or leaving you guessing. `storage.updateScan()` also now
  throws a clear error if the target record can't be found, rather than
  a silent no-op.

- **Scan screen ticket LPN fixed**: the big LPN value on the scan result
  ticket now shows the same combined "PalletNo\<delimiter\>LPN" string as
  the Dashboard and CSV report (e.g. `CN20082.P08266135317`), instead of
  the bare LPN with Pallet No only appearing separately in the field
  grid below. The redundant separate "Pallet No" row was removed from
  the grid since it's now part of the main LPN line — consistent
  everywhere the app shows this data.

- **Hardware scanner — Enter not registering, fixed differently**:
  confirmed characters *were* arriving (the earlier `showSoftInputOnFocus`
  fix worked) but the Enter/CR terminator wasn't reaching React Native in
  a form it recognizes as "submit" on this device — a known gap with
  hardware-injected key events on some Android versions. Rather than keep
  chasing Enter detection, the capture field now **auto-submits after a
  150ms pause** in incoming characters as the primary mechanism — scanner
  output arrives far faster than any human types, so a quiet buffer
  reliably means the scan finished, with no dependence on ever detecting
  Enter at all. Detected CR/LF and `onSubmitEditing`/`onKeyPress` still
  submit immediately when they do fire (better latency), and a duplicate
  -submit guard keeps multiple paths firing for the same scan from ever
  producing two records.

- **Alt. Qty (Phy. Qty) not showing on Dashboard for LPN-only scans**:
  found and fixed a real display bug — the Dashboard row's quantity line
  only showed Phy. Qty when the scan also had a system Qty, so any
  Simple/LPN-only ("stock pick") scan with Phy. Qty saved would never
  display it, even though the save itself worked correctly. It now
  shows "Alt. Qty N" on its own for those records.
- **Zebra auto-submit window widened**: Urovo devices work fine with the
  150ms pause-based auto-submit, but Zebra evidently sends scan output
  slower — widened to 350ms. If a specific device still cuts codes
  short or still doesn't submit, check the DataWedge profile's
  **Inter-character delay** setting (Keystroke output → Basic data
  formatting) — if it's been set to a non-zero value for some other
  app's compatibility needs, lower it toward 0.

- **Hardware scanner field made genuinely visible — likely the real
  fix**: the capture field was previously disguised as near-invisible
  (opacity 0.02, 1px font, absolutely positioned) to keep the screen
  clean. Since other apps on the same device work fine with the same
  DataWedge config, the issue was very likely this app specifically
  fighting Android's input delivery with that disguise — some
  manufacturers' scan services are strict about only injecting keystrokes
  into fields that are genuinely visible and unobstructed. The field is
  now a normal, visible text box (same style as the manual entry field)
  that briefly shows the scanned text as it arrives before auto
  -submitting and clearing — exactly what "other apps" that already work
  are doing under the hood.

- **"Scans once then nothing ever again" bug fixed**: found the actual
  cause — `handlePayload`'s busy-lock (`busyRef`, used to prevent
  overlapping scan processing) was set to `true` before processing and
  only reset to `false` at the very end, with no `try/finally`. Any
  error while processing a scan — a storage hiccup, an unexpected data
  shape, anything — would leave it stuck at `true` forever, silently
  blocking every scan after that across camera, hardware, and manual
  entry, until the app was restarted. Now wrapped in `try/finally` so
  the lock always releases regardless of outcome, and errors surface as
  an alert instead of silently wedging the whole scan flow.

- **Bay progress follows bay selection**: the Dashboard's Bay progress
  section now respects the bay filter chips — pick a specific bay to see
  just that bay's target/scanned/pending, or "All bays" to see every bay
  with a target set. Previously it always showed every bay regardless of
  filter.
- **Segment "Other" split into two meaningful buckets**: previously any
  scan that didn't match a known segment landed in one "Other" bucket
  with no way to tell why. Now split into **No Segment Data** (expected
  — Simple/LPN-only scans don't carry a Plant field at all, nothing to
  fix) and **Unrecognized** (the Plant field had text, but it didn't
  match any known segment word — worth checking, likely a new label
  -batch wording that needs adding to `SEGMENT_SYNONYMS` in
  `src/utils/qrParser.js`).
- **Scan screen empty-state matches the selected mode**: previously
  always said "Point the camera..." even in Hardware Scanner mode. Now
  says "Pull the trigger..." in that mode, and the whole block is
  smaller (less wasted vertical space before you've scanned anything).
- **Sample name updated** to "Kaviyarasan" on the Setup screen.
- **"Created by: DT"** signature added to the Setup screen footer.

- **New app icon**: replaced the AIS-logo launcher icon with a
  QR-code-and-scanner-viewfinder design — white background, green QR
  pattern (with proper finder squares), orange corner brackets echoing
  the actual in-app scan screen's `ScannerFrame` component. All variants
  regenerated (main icon, Android adaptive icon layers, themed
  monochrome icon, favicon, splash icon) — see `assets/icon.png` and
  siblings. **Note**: `LogoMark.js` (used separately on the Setup screen)
  still shows the real AIS brand logo — that's a different, deliberate
  choice and wasn't changed.

- **Hardware scanner refocus hardened**: after every scan, the capture
  field now fires several staggered refocus attempts (30ms/150ms/400ms)
  instead of one, plus a background watchdog that checks every 1.5s
  whether the field still has focus and reclaims it if not — for the
  case where a single refocus attempt loses a race against something
  else happening right after a scan.
- **White "TM BWL" label confirmed working** — tested against a real
  sample string (`37094@SF.ANF.LFG.G00400A000@503333076@157@VQ-52.P11254812358.@TM_BWL@28-Nov-2025@VQ-52`)
  and it parses cleanly through the existing Slot1 format with no
  structural changes needed. The one gap it surfaced: the Plant field's
  `TM_BWL` extracts Plant Code `BWL` correctly, but "TM" (Raw Material)
  wasn't a recognized segment — added as its own proper category
  (distinct from OEM/OES/AFM/EXP, since it's a different classification
  axis that can apply across any of them) rather than falling into
  "Unrecognized."

- **Segment cards resized**: the 7 segment stat cards (OEM/OES/AFM/EXP/TM
  /No Data/Unknown) are now smaller and arranged 3 per row instead of 2
  — with 7 cards that lands as 3+3+1 rather than a clean 2 rows exactly,
  since there's one more category than fits evenly into 2×3. Labels
  shortened to fit the narrower cards (e.g. "Raw Material (TM)" → "TM
  (Raw Mat.)").

- **LPN no longer truncated**: the LPN regex (`P` + 11 digits) was only
  ever meant to *locate* where the LPN starts in a field — but it was
  also being used to extract the value itself, silently dropping
  anything after the 11th digit. Confirmed with a real example:
  `VQ-52.P11254812358.` (Bawal/TM_BWL Data Matrix output) has a trailing
  `.` that's part of the actual LPN, and it was being cut off. Fixed —
  for Slot1 and Simple types (where the LPN is known to be the tail of
  an isolated field), the LPN now captures everything from that point to
  the end of the field, whole and unmanipulated, exactly as scanned.
  (Left the "Other"/unstructured fallback category alone deliberately —
  there, we don't know if there's unrelated trailing text after the LPN,
  so grabbing "the rest of the string" there could pull in garbage
  rather than fix anything.)

- **Camera flashlight/torch button**: a small flash button (top-right of
  the camera preview) controls the phone's torch while scanning in low
  light — see "Real auto-flash" below for the full Off/Auto/On behavior.
  Automatically stops (camera unmounts) when you leave Camera mode or
  navigate away from the Scan tab, so it never stays on draining the
  battery in the background.

- **Real auto-flash**: the flash button now cycles Off → Auto → On.
  "Auto" uses the device's actual ambient light sensor (`expo-sensors`'
  `LightSensor`, real lux readings — not a guess) to turn the torch on
  below ~15 lux and back off above ~30 lux, with that gap between
  thresholds specifically to avoid flicker right at the boundary. Shows
  an "AUTO" label on the button, highlighted amber whenever the torch is
  actually firing. Falls back to manual mode with a clear message if a
  device has no light sensor.

- **Camera preview not rendering — likely real fix**: the mode toggle and
  camera/hardware panel were inside the same big ScrollView as everything
  else (from an earlier fix for content getting cut off). Android's
  camera preview renders through a native `SurfaceView`, which has a
  well-documented issue where it fails to composite (shows blank/black,
  even though decoding and any overlay animation drawn on top of it keep
  working normally) when nested inside a scrolling container — this
  matches exactly the "scan line moves but no picture" symptom reported.
  The mode toggle and camera panel are now fixed outside the ScrollView,
  pinned at the top; everything else (progress banner, counters, ticket,
  debug panel, etc.) still scrolls below it as before.

- **Camera preview — most likely actual fix, found by comparing directly
  against the working "QR Code Validator" app**: this app had
  `newArchEnabled: true` (React Native's New Architecture / Fabric
  renderer); the proven working app doesn't use it at all. New
  Architecture fundamentally changes how native views — including the
  `SurfaceView` a camera preview actually is — get composited onto
  screen, and there are known compatibility issues between it and camera
  libraries on certain devices/Android versions. **Set to `false`** to
  match the working app's configuration. Also matched the working app's
  exact `CameraView` sizing approach (`StyleSheet.absoluteFill` instead
  of `flex: 1`) as a secondary alignment, though the architecture flag is
  the stronger suspect. Note: `overflow: 'hidden'` + `borderRadius` on
  the camera's container turned out NOT to be a problem — the working
  app uses that same combination — so rounded corners are back.

- **Camera diagnostics added — the actual next step**: after several
  fix attempts based on reasonable-but-unconfirmed theories didn't
  resolve it, checked expo-camera's own docs and found `onCameraReady`
  and `onMountError` callbacks that this app was never using at all —
  meaning if the camera was silently failing to start, we had zero
  visibility into why. Now wired up: a "Starting camera…" overlay shows
  while waiting for `onCameraReady`, and if `onMountError` fires instead,
  the **actual native error message** displays on screen with a retry
  button, instead of a silent black preview. Both also log to the raw
  scan debug panel. This should finally reveal the real cause on the
  next test — if a mount error appears, that message is the next thing
  to share; if the camera reports "ready" but still shows nothing, that
  narrows it to a rendering/compositing issue specifically, worth
  reporting upstream to Expo with your device model.

- **Camera preview — actual root cause found and fixed at the native
  level**: "ready" firing with no error (confirmed by testing the
  diagnostics above) meant the problem was specifically that camera
  frames weren't being *composited to the screen*, while decoding kept
  working normally (it reads frames directly, independent of what's
  drawn). Traced this to expo-camera's Android implementation
  (AndroidX CameraX's `PreviewView`) never explicitly setting
  `implementationMode` — meaning it silently runs on CameraX's
  `PERFORMANCE` default, which renders through a `SurfaceView` compositing
  through a separate hardware overlay layer outside the normal view
  hierarchy. This is a well-documented way for a preview to render
  nothing at all in more complex/animated layouts on some devices, while
  everything else about the camera (including barcode scanning) keeps
  working — an exact match for the symptom reported. **Fixed via
  `patch-package`** (`patches/expo-camera+57.0.3.patch`, applied
  automatically by a `postinstall` script on every `npm install`,
  verified end-to-end with a clean install) — forces CameraX's
  `COMPATIBLE` (TextureView-based) rendering mode instead, which
  composites as an ordinary view. This required an actual native Android
  code change, not something fixable from JavaScript/styling alone,
  which is why the earlier attempts didn't resolve it.

- **Camera library replaced entirely — `expo-camera` → `react-native-vision-camera`**:
  after four targeted fixes to expo-camera (ScrollView nesting, container
  clipping, New Architecture, a native `patch-package` fix forcing
  TextureView rendering) all failed to resolve a blank camera preview
  that reproduced consistently across multiple different devices —
  ruling out a device-specific cause — switched to a different, widely
  used camera library rather than continue guessing at expo-camera
  -specific causes. Using the stable v4 line (`4.7.3`), not the newer
  v5/"Nitro" rewrite, to avoid trading one set of unknowns for another
  right before a deadline. Uses the library's built-in `useCodeScanner`
  hook (native QR + Data Matrix support, no custom frame processor or
  the heavier optional dependencies like `react-native-reanimated`
  needed). Hardware Scanner mode is untouched by this change — it never
  depended on expo-camera at all, which is why it kept working reliably
  throughout this whole investigation. **This is a bigger change than
  anything else in this project** — new native dependency, new config
  plugin, a rewritten camera screen — so please test thoroughly on an
  actual device once built. `onInitialized`/`onError` diagnostics (the
  "Starting camera…" / real error message UI) were preserved using this
  library's equivalent callbacks.

- **Camera dimension diagnostics added**: since switching camera libraries
  entirely didn't change the symptom (identical failure across two
  structurally different implementations, and confirmed working on the
  same device in other apps), that pointed back at this app's own layout
  code around the camera rather than either camera library. Added a
  small always-visible badge (bottom-left of the camera box) showing the
  actual measured container size in real pixels (e.g. "343×190") and
  ready/error state, plus the camera now receives that measured size as
  an explicit numeric width/height instead of relying on flex/absoluteFill
  to resolve it — removing any ambiguity about whether the camera
  container is actually getting real screen space. If the badge reports
  a sane size (roughly matching the visible box) and "ready", that rules
  out a layout/sizing bug too and points toward something more unusual
  in the environment; if it reports 0 or a tiny size, that's the actual
  bug, finally caught directly.

- **Hardware scanner — touch interference fixed**: since the capture
  field is now a genuinely visible, tappable TextInput (needed for the
  Zebra delivery fix), an accidental touch on it *while the scanner is
  still injecting characters* would reposition the cursor or select
  text — a normal, expected behavior for any text field, but here it
  corrupts the capture with a misplaced insertion point or an
  overwritten selection, producing occasional garbled/wrong LPNs on fast
  reads. Added an invisible touch guard directly on top of the field
  that intercepts all taps and just re-confirms focus instead of letting
  them reach the TextInput's native touch handling. Has zero effect on
  the scanner's own input — that arrives through the OS input
  connection/IME, not through touch events, so it's completely
  unaffected by this.

- **Two more warehouse locations added**: Loc5 (QCFG) and Loc6 (PDI),
  alongside the existing Loc1–Loc4. Edit
  `DEFAULT_WAREHOUSES` in `src/components/WarehousePicker.js` for any
  future additions.
- **Typed text hidden behind the keyboard while editing Phy. Qty/Remarks
  — fixed**: neither the Scan screen's inline note fields nor the
  Dashboard's tap-to-edit sheet shifted anything when the keyboard
  opened, so on smaller screens the keyboard could cover the very field
  you were typing into — the text was being entered correctly the whole
  time, you just couldn't see it. Both now use `KeyboardAvoidingView`
  (the Dashboard edit sheet had the import sitting there unused before,
  never actually wired in), and the Scan screen also auto-scrolls to
  bring those fields above the keyboard the moment you tap into either
  one.

## Known follow-ups (flagged, not blocking)

- Camera preview: confirm on-device that the preview now renders (see
  the root-cause note at the top of *Recent changes*). If a device still
  shows a blank preview with texture-view **and** an unclipped container,
  share the raw scan log (it will contain `(camera ready)` / mount
  errors) — at that point the next step is the Zebra/Honeywell *Intent
  output* native module rather than further preview work.

## Setting up rugged scanner devices (Zebra / Honeywell / etc.)

"Hardware Scanner" mode in the app assumes the device's scan engine is set
to **keyboard wedge / keystroke output** — the out-of-box default on most
rugged Android devices. Pulling the trigger types the decoded value into
whatever field is focused, followed by Enter. No app-side pairing needed —
just make sure the device is configured this way:

**Zebra devices (DataWedge):**
1. Open the **DataWedge** app (pre-installed on all Zebra devices).
2. Open the active profile (or create one scoped to package
   `com.aisglass.stocktake` for cleanliness).
3. Under **Keystroke output**, make sure it's **Enabled**.
4. Under **Barcode input**, confirm the QR Code / QR symbology is enabled.
5. **This is the step that actually matters and is easy to miss:** open
   **Keystroke output → Basic data formatting**, and set the **Suffix**
   to **Enter** (CR, or CR/LF depending on your DataWedge version — some
   versions show this as a "Send ENTER key" toggle instead of a manual
   suffix field; either way, make sure a line-ending character is being
   sent after the scanned data). Without this, the decoded text lands in
   the field but never "submits," so the app never sees it. The app
   itself doesn't need this configured any particular way — it now
   handles a bare CR, bare LF, or CRLF pair identically and guards
   against a CRLF pair ever producing two records for one scan, so this
   is safe to enable without affecting any other scanner brand you're
   also using.
6. Open the AIS Stock Take app, switch to "Hardware Scanner" mode on the
   Scan screen, and pull the trigger on a label — it should log instantly.

**Honeywell devices:**
1. Open the **Scanner Settings** / **Data Collection** app.
2. Ensure output mode is set to **Keyboard emulation** (sometimes called
   "Keyboard Wedge" or "Text Injection").
3. Confirm Enter/Return is set as the terminating (suffix) character —
   same underlying requirement as the Zebra Suffix setting above.
4. Switch the app to "Hardware Scanner" mode and test.

Other brands (Datalogic, Newland, CipherLab, etc.) use the same underlying
mechanism under slightly different menu names — look for "keyboard
emulation", "keyboard wedge", or "HID output" in the scanner settings app.

If your specific device instead needs Zebra's **Intent output** mode (more
robust for background scanning, but requires a native Android intent
receiver rather than keyboard wedge), let me know the exact model and I'll
add a small native module for it — that's a different, deeper integration
than what's built here.
