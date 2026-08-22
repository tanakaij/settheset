#!/usr/bin/env python3
"""Make the native Android chrome match the app.

    python3 scripts/patch-android-theme.py

WHY THIS EXISTS
---------------
`<meta name="theme-color">` colours the status bar when the app is installed
from Chrome as a PWA. It does nothing in the APK. There, the status bar comes
from the Android theme, and Capacitor's default is a stock blue-grey — so the
APK ships with a band of the wrong colour above the top bar while the browser
install looks correct. Nobody notices until it's on a phone.

This rewrites the generated theme to use the same #1B1C21 as `--panel` and the
theme-color meta tag.

NOT EDGE-TO-EDGE, ON PURPOSE
----------------------------
The WebView is left sitting below the status bar rather than drawing under it.
That means `env(safe-area-inset-top)` is 0 inside the APK, which is correct:
there is nothing to inset past. The CSS insets still do their job for the
browser-installed PWA, where the page genuinely does go edge to edge.

If targetSdk is ever raised to 35 or above, Android forces edge-to-edge and
this approach stops applying — the app would then need real inset handling on
the native side. Capacitor 6 targets 34, so it holds for now.

Run AFTER `npx cap add android`, before `npx cap sync`.
"""
import pathlib
import re
import sys

PANEL = "#FF1B1C21"      # --panel, with alpha. Matches <meta name="theme-color">.
BG = "#FF303644"         # --bg, so the window behind the WebView isn't white
                         # on first paint.

ANDROID = pathlib.Path("android")
VALUES = ANDROID / "app/src/main/res/values"
STYLES = VALUES / "styles.xml"
COLORS = VALUES / "colors.xml"


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


EMPTY_RESOURCES = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n'


def patch_colors():
    # Capacitor's Android template does NOT ship values/colors.xml -- its
    # launcher colour lives in values/ic_launcher_background.xml instead. So
    # this file is normally absent on a fresh `cap add android`, and creating
    # it is correct rather than an error.
    if not VALUES.exists():
        fail(
            f"{VALUES} not found — `npx cap add android` did not produce an "
            f"Android project. Check the step before this one."
        )

    if not COLORS.exists():
        COLORS.write_text(EMPTY_RESOURCES)
        print(f"colors.xml did not exist (normal for Capacitor) — created it")

    text = COLORS.read_text()

    # A freshly created or oddly formatted file might have no closing tag to
    # insert before; normalise rather than silently writing nothing.
    if "</resources>" not in text:
        text = EMPTY_RESOURCES

    wanted = {
        "settheset_status": PANEL,
        "settheset_nav": PANEL,
        "settheset_window": BG,
    }

    for name, value in wanted.items():
        pattern = re.compile(rf'<color name="{name}">[^<]*</color>')
        entry = f'<color name="{name}">{value}</color>'
        if pattern.search(text):
            text = pattern.sub(entry, text)
        else:
            text = text.replace("</resources>", f"    {entry}\n</resources>")

    COLORS.write_text(text)
    print(f"colors.xml: status/nav {PANEL}, window {BG}")


def patch_styles():
    if not STYLES.exists():
        listing = "\n".join(sorted(p.name for p in VALUES.iterdir())) or "(empty)"
        fail(
            f"{STYLES} not found. Files actually present in {VALUES}:\n{listing}"
        )

    text = STYLES.read_text()

    # Capacitor's launch theme and main theme are separate. Patch the one the
    # activity actually uses, never the *Launch splash variant.
    match = re.search(
        r'(<style name="AppTheme\.NoActionBar"[^>]*>)(.*?)(</style>)',
        text,
        re.DOTALL,
    )

    if not match:
        # Fall back to any non-launch NoActionBar theme, so a template rename
        # doesn't break the build outright.
        for m in re.finditer(r'(<style name="([^"]+)"[^>]*>)(.*?)(</style>)', text, re.DOTALL):
            name = m.group(2)
            if "NoActionBar" in name and "Launch" not in name:
                match = re.match(
                    r'(<style name="[^"]+"[^>]*>)(.*?)(</style>)',
                    m.group(0),
                    re.DOTALL,
                )
                text_offset = m.start()
                print(f"note: AppTheme.NoActionBar absent, using {name} instead")
                break

    if not match:
        names = re.findall(r'<style name="([^"]+)"', text)
        fail(
            "No usable NoActionBar theme in styles.xml. Styles present: "
            + (", ".join(names) or "(none)")
            + ". Capacitor changed its template — update this script."
        )

    head, body, tail = match.groups()

    items = {
        "android:statusBarColor": "@color/settheset_status",
        "android:navigationBarColor": "@color/settheset_nav",
        "android:windowBackground": "@color/settheset_window",
        # Our status bar is dark, so its icons must stay light. Left true and a
        # DayNight theme on a light-mode phone draws dark icons on dark.
        "android:windowLightStatusBar": "false",
    }

    for name, value in items.items():
        pattern = re.compile(rf'<item name="{re.escape(name)}">[^<]*</item>')
        entry = f'<item name="{name}">{value}</item>'
        if pattern.search(body):
            body = pattern.sub(entry, body)
        else:
            body = body.rstrip() + f"\n        {entry}\n    "

    # Rebuild by locating the original block verbatim, which works whether the
    # match came from the direct search or the fallback scan.
    original = match.group(0)
    text = text.replace(original, head + body + tail, 1)
    STYLES.write_text(text)

    print("styles.xml: statusBarColor, navigationBarColor, windowBackground, "
          "windowLightStatusBar=false")


def verify():
    """Fail the build rather than ship a mismatched status bar silently."""
    styles = STYLES.read_text()
    colors = COLORS.read_text()
    problems = []
    if "settheset_status" not in styles:
        problems.append("styles.xml is not referencing the status bar colour")
    if PANEL not in colors:
        problems.append(f"colors.xml is missing {PANEL}")
    if problems:
        fail("; ".join(problems))
    print("verified: native chrome matches --panel")


if __name__ == "__main__":
    print("=== SETTHESET-THEME ===")
    patch_colors()
    patch_styles()
    verify()
