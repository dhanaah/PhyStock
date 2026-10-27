// Change this before rolling the app out to your team. There's no login
// system in this app (it's single-device, offline-first), so this PIN is
// just a light guard against someone accidentally wiping a shift's scans
// from the Reports screen — not a real security boundary.
export const ADMIN_PIN = '2468';

// Shown on the Setup screen signature and sent to the data center with
// every heartbeat so the dashboard can show which build each device runs.
export const APP_VERSION = '1.4.1';

// How often a linked device tells the data center it is alive (seconds).
// The dashboard shows a device as online if it has heard from it within
// three of these intervals.
export const HEARTBEAT_SECONDS = 15;
