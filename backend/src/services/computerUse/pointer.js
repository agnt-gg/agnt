// pointer.js — raw OS pointer primitives: mouse_down / mouse_move / mouse_up.
//
// WHY THIS EXISTS. The Cua Driver deliberately ships no press/move/release
// primitives: its `drag` is one atomic gesture, and everything else routes
// through UIA Invoke or PostMessage per window. That is the right design for
// buttons, and it cannot paint. A canvas (Paint, Photoshop, WebGL, a game)
// takes mouse CAPTURE on button-down and then reads a continuous stream of
// real pointer motion until button-up. PostMessage cannot produce capture,
// and a single drag cannot produce a path with more than one segment, a held
// button across several calls, or a stroke whose shape is decided mid-way
// from a screenshot. Every serious computer-use demo (Claude's `computer`
// tool, OpenAI's CUA, Agent S) drives painting through exactly three verbs:
// press, move, release, at screen coordinates. This is that layer.
//
// HOW. Windows: SendInput via a tiny PowerShell P/Invoke shim, one process per
// call, no daemon and no extra dependency. Coordinates are screen-absolute,
// normalized to the 0..65535 virtual-desktop space SendInput expects, so
// multi-monitor and negative-origin layouts work. macOS: CGEvent via a Swift
// one-liner. Linux: xdotool. Each platform is one function; none share code
// paths, so a platform gap is a clear "not supported here", never a silent
// PostMessage that lands nowhere.
//
// COORDINATES. Everything here is SCREEN space. Window-local coordinates from
// a screenshot are translated by the caller using the window's bounds -- the
// same bounds get_window_state / list_windows report -- so the pointer lands
// on the pixel the model pointed at in the image it was shown.
import { spawnSync } from '../security/toolProcess.js';
import os from 'node:os';

const BUTTONS = new Set(['left', 'right', 'middle']);

function requireButton(button) {
  const b = String(button || 'left').toLowerCase();
  if (!BUTTONS.has(b)) throw new Error(`button must be left, right or middle (got "${button}")`);
  return b;
}

function requireXY(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('x and y must be finite screen coordinates');
  return { x: Math.round(x), y: Math.round(y) };
}

// ── Windows: SendInput ─────────────────────────────────────────────────────

const WIN_SHIM = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Ptr {
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MI mi; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  const uint MOVE=0x0001, LD=0x0002, LU=0x0004, RD=0x0008, RU=0x0010, MD=0x0020, MU=0x0040, ABS=0x8000, VDESK=0x4000;
  static INPUT Mk(uint flags, int dx, int dy) { var i = new INPUT(); i.type = 0; i.mi.dwFlags = flags; i.mi.dx = dx; i.mi.dy = dy; return i; }
  static void Norm(int x, int y, out int nx, out int ny) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    nx = (int)Math.Round((x - vx) * 65535.0 / (vw - 1));
    ny = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
  }
  public static uint Move(int x, int y) { int nx, ny; Norm(x, y, out nx, out ny); return SendInput(1, new[]{ Mk(MOVE|ABS|VDESK, nx, ny) }, Marshal.SizeOf(typeof(INPUT))); }
  public static uint Down(string b) { uint f = b=="right"?RD: b=="middle"?MD: LD; return SendInput(1, new[]{ Mk(f,0,0) }, Marshal.SizeOf(typeof(INPUT))); }
  public static uint Up(string b)   { uint f = b=="right"?RU: b=="middle"?MU: LU; return SendInput(1, new[]{ Mk(f,0,0) }, Marshal.SizeOf(typeof(INPUT))); }
}
"@
`;

function winRun(body) {
  const script = `${WIN_SHIM}\n${body}`;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8', timeout: 20000, windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`SendInput shim failed: ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
  return (r.stdout || '').trim();
}

/**
 * A whole stroke in ONE process: move to start, press, sweep through every
 * point with a real delay so the app's capture loop sees motion, release.
 * Spawning per event would put ~40ms between samples; a stroke needs ~5.
 */
function winStroke(points, button, stepMs) {
  const pts = points.map((p) => `@(${p.x},${p.y})`).join(',');
  const body = `
$pts = @(${pts})
[Ptr]::Move($pts[0][0], $pts[0][1]) | Out-Null
Start-Sleep -Milliseconds 30
[Ptr]::Down('${button}') | Out-Null
Start-Sleep -Milliseconds 20
foreach ($p in $pts) { [Ptr]::Move($p[0], $p[1]) | Out-Null; Start-Sleep -Milliseconds ${stepMs} }
[Ptr]::Up('${button}') | Out-Null
Write-Output "ok ${points.length}"
`;
  return winRun(body);
}

// ── macOS: CGEvent ─────────────────────────────────────────────────────────

function macEvent(kind, x, y, button) {
  const map = {
    move: 'mouseMoved',
    down: button === 'right' ? 'rightMouseDown' : 'leftMouseDown',
    up: button === 'right' ? 'rightMouseUp' : 'leftMouseUp',
  };
  const btn = button === 'right' ? 'right' : 'left';
  const swift = `
import Foundation
import CoreGraphics
let p = CGPoint(x: ${x}, y: ${y})
let e = CGEvent(mouseEventSource: nil, mouseType: .${map[kind]}, mouseCursorPosition: p, mouseButton: .${btn})
e?.post(tap: .cghidEventTap)
`;
  const r = spawnSync('swift', ['-e', swift], { encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`CGEvent failed: ${(r.stderr || '').trim().slice(0, 300)}`);
}

// ── Linux: xdotool ─────────────────────────────────────────────────────────

function xdo(args) {
  const r = spawnSync('xdotool', args, { encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`xdotool failed (${args[0]}): ${(r.stderr || 'is xdotool installed?').trim().slice(0, 300)}`);
}

const XDO_BUTTON = { left: '1', middle: '2', right: '3' };

// ── Public surface ─────────────────────────────────────────────────────────

export function pointerMove(x, y) {
  const p = requireXY(x, y);
  switch (os.platform()) {
    case 'win32': winRun(`[Ptr]::Move(${p.x},${p.y}) | Out-Null; Write-Output ok`); break;
    case 'darwin': macEvent('move', p.x, p.y, 'left'); break;
    case 'linux': xdo(['mousemove', String(p.x), String(p.y)]); break;
    default: throw new Error(`pointer input is not supported on ${os.platform()}`);
  }
  return { ok: true, x: p.x, y: p.y };
}

export function pointerDown(x, y, button = 'left') {
  const p = requireXY(x, y);
  const b = requireButton(button);
  switch (os.platform()) {
    case 'win32': winRun(`[Ptr]::Move(${p.x},${p.y}) | Out-Null; Start-Sleep -Milliseconds 20; [Ptr]::Down('${b}') | Out-Null; Write-Output ok`); break;
    case 'darwin': macEvent('move', p.x, p.y, b); macEvent('down', p.x, p.y, b); break;
    case 'linux': xdo(['mousemove', String(p.x), String(p.y), 'mousedown', XDO_BUTTON[b]]); break;
    default: throw new Error(`pointer input is not supported on ${os.platform()}`);
  }
  return { ok: true, x: p.x, y: p.y, button: b };
}

export function pointerUp(x, y, button = 'left') {
  const p = requireXY(x, y);
  const b = requireButton(button);
  switch (os.platform()) {
    case 'win32': winRun(`[Ptr]::Move(${p.x},${p.y}) | Out-Null; Start-Sleep -Milliseconds 20; [Ptr]::Up('${b}') | Out-Null; Write-Output ok`); break;
    case 'darwin': macEvent('move', p.x, p.y, b); macEvent('up', p.x, p.y, b); break;
    case 'linux': xdo(['mousemove', String(p.x), String(p.y), 'mouseup', XDO_BUTTON[b]]); break;
    default: throw new Error(`pointer input is not supported on ${os.platform()}`);
  }
  return { ok: true, x: p.x, y: p.y, button: b };
}

/**
 * Press at the first point, sweep through all of them, release at the last.
 * `points` is an array of {x,y} in SCREEN space; 2..500 of them. `stepMs` is
 * the dwell between samples -- 4-8ms reads as a natural stroke to a canvas.
 */
export function pointerStroke(points, { button = 'left', stepMs = 6 } = {}) {
  if (!Array.isArray(points) || points.length < 2) throw new Error('stroke needs at least 2 points');
  if (points.length > 500) throw new Error('stroke is capped at 500 points; split it');
  const pts = points.map((p) => requireXY(p.x, p.y));
  const b = requireButton(button);
  const dwell = Math.min(50, Math.max(1, Number(stepMs) || 6));

  switch (os.platform()) {
    case 'win32': winStroke(pts, b, dwell); break;
    case 'darwin': {
      macEvent('move', pts[0].x, pts[0].y, b);
      macEvent('down', pts[0].x, pts[0].y, b);
      for (const p of pts) {
        const swift = `
import Foundation
import CoreGraphics
let e = CGEvent(mouseEventSource: nil, mouseType: .${b === 'right' ? 'rightMouseDragged' : 'leftMouseDragged'}, mouseCursorPosition: CGPoint(x: ${p.x}, y: ${p.y}), mouseButton: .${b === 'right' ? 'right' : 'left'})
e?.post(tap: .cghidEventTap)
usleep(${dwell * 1000})
`;
        spawnSync('swift', ['-e', swift], { encoding: 'utf8', timeout: 20000 });
      }
      macEvent('up', pts[pts.length - 1].x, pts[pts.length - 1].y, b);
      break;
    }
    case 'linux': {
      const args = ['mousemove', String(pts[0].x), String(pts[0].y), 'mousedown', XDO_BUTTON[b]];
      for (const p of pts) args.push('mousemove', '--sync', String(p.x), String(p.y), 'sleep', String(dwell / 1000));
      args.push('mouseup', XDO_BUTTON[b]);
      xdo(args);
      break;
    }
    default: throw new Error(`pointer input is not supported on ${os.platform()}`);
  }
  return { ok: true, points: pts.length, button: b, from: pts[0], to: pts[pts.length - 1] };
}
