#!/usr/bin/env python3
"""
FIX-008 QC — live macOS Accessibility (AX) tree exporter.

Walks the AXUIElement tree of the packaged candidate app directly through
the ApplicationServices framework (ctypes, no System Events, no JXA). The
System Events scripting bridge caches window geometry and web-area
children; this exporter reads the live AX server, so positions, sizes,
roles, labels, and the focus order are what the WindowServer actually
exposes to assistive technology right now.

Output: JSON with the same shape the ax-export-check.mjs parser expects:

  {
    "capturedAt": ISO-8601,
    "process": { "name", "pid" },
    "window": { depth, role, subrole, title, description, value, help,
                enabled, focused, position {x,y}, size {width,height},
                children: [...] },
    "focusOrder": [ { role, subrole, title, description, value, focused } ]
  }

focusOrder is the depth-first traversal order of the tree — the order a
linear assistive-technology reader (VoiceOver/Narrator) walks. Nodes with
focused=true are marked; the candidate's full pass-through policy means
the list is expected to contain no interactive roles.

Usage: python3 ax-export.py <pid> [out.json]
Exit 0 on success, 1 on AX error, 2 on usage error.
"""

import ctypes
import ctypes.util
import json
import sys
import time

# ---- framework loading ------------------------------------------------------

def _load():
    path = ctypes.util.find_library("ApplicationServices")
    if not path:
        path = "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
    lib = ctypes.CDLL(path)

    lib.AXUIElementCreateApplication.argtypes = [ctypes.c_int32]
    lib.AXUIElementCreateApplication.restype = ctypes.c_void_p

    lib.AXUIElementCopyAttributeValue.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    lib.AXUIElementCopyAttributeValue.restype = ctypes.c_int32

    lib.AXIsProcessTrusted.restype = ctypes.c_int

    lib.CFGetTypeID.argtypes = [ctypes.c_void_p]
    lib.CFGetTypeID.restype = ctypes.c_ulong

    lib.CFStringGetTypeID.restype = ctypes.c_ulong
    lib.CFNumberGetTypeID.restype = ctypes.c_ulong
    lib.CFBooleanGetTypeID.restype = ctypes.c_ulong
    lib.CFArrayGetTypeID.restype = ctypes.c_ulong
    lib.AXUIElementGetTypeID.restype = ctypes.c_ulong
    lib.AXValueGetTypeID.restype = ctypes.c_ulong

    lib.CFStringGetLength.argtypes = [ctypes.c_void_p]
    lib.CFStringGetLength.restype = ctypes.c_long
    lib.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
    lib.CFStringGetCString.restype = ctypes.c_int

    lib.CFNumberGetValue.argtypes = [ctypes.c_void_p, ctypes.c_int32, ctypes.c_void_p]
    lib.CFNumberGetValue.restype = ctypes.c_int

    lib.CFBooleanGetValue.argtypes = [ctypes.c_void_p]
    lib.CFBooleanGetValue.restype = ctypes.c_ubyte

    lib.CFArrayGetCount.argtypes = [ctypes.c_void_p]
    lib.CFArrayGetCount.restype = ctypes.c_long
    lib.CFArrayGetValueAtIndex.argtypes = [ctypes.c_void_p, ctypes.c_long]
    lib.CFArrayGetValueAtIndex.restype = ctypes.c_void_p

    lib.AXValueGetType.argtypes = [ctypes.c_void_p]
    lib.AXValueGetType.restype = ctypes.c_int32
    lib.AXValueGetValue.argtypes = [ctypes.c_void_p, ctypes.c_int32, ctypes.c_void_p]
    lib.AXValueGetValue.restype = ctypes.c_int

    lib.CFRelease.argtypes = [ctypes.c_void_p]
    lib.CFRelease.restype = None

    lib.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
    lib.CFStringCreateWithCString.restype = ctypes.c_void_p

    return lib


AX = _load()

kCFStringEncodingUTF8 = 0x08000100

# ---- attribute name constants ------------------------------------------------
# AX attribute names are CFStringRef objects, not C strings. Create real
# CFStrings once and keep them alive for the process lifetime.

_CF_STRINGS = []  # keep CFStringRefs alive for the lifetime of the process

def _cf(s):
    ref = AX.CFStringCreateWithCString(None, s.encode("utf-8"), kCFStringEncodingUTF8)
    if not ref:
        raise RuntimeError("CFStringCreateWithCString failed for " + s)
    _CF_STRINGS.append(ref)
    return ref

kAXRole = _cf("AXRole")
kAXSubrole = _cf("AXSubrole")
kAXTitle = _cf("AXTitle")
kAXDescription = _cf("AXDescription")
kAXValue = _cf("AXValue")
kAXHelp = _cf("AXHelp")
kAXEnabled = _cf("AXEnabled")
kAXFocused = _cf("AXFocused")
kAXPosition = _cf("AXPosition")
kAXSize = _cf("AXSize")
kAXChildren = _cf("AXChildren")
kAXWindows = _cf("AXWindows")
kAXFocusedUIElement = _cf("AXFocusedUIElement")

kAXErrorSuccess = 0
kAXErrorCannotComplete = -25204
kAXErrorAPIDisabled = -25211
kAXErrorNoValue = -25212
kAXErrorAttributeUnsupported = -25205

kCFNumberSInt32Type = 3
kCFNumberSInt64Type = 4
kCFNumberFloat64Type = 6
kAXValueCGPointType = 1
kAXValueCGSizeType = 2
kCFStringEncodingUTF8 = 0x08000100

# ---- value decoding -----------------------------------------------------------

def _type_id(ref):
    return AX.CFGetTypeID(ref) if ref else 0

def _cfstring(ref):
    n = AX.CFStringGetLength(ref)
    buf = ctypes.create_string_buffer(n * 4 + 1)
    if AX.CFStringGetCString(ref, buf, n * 4 + 1, kCFStringEncodingUTF8):
        return buf.value.decode("utf-8", "replace")
    return ""

def _cfnumber(ref):
    # try int64, then double
    v = ctypes.c_longlong(0)
    if AX.CFNumberGetValue(ref, kCFNumberSInt64Type, ctypes.byref(v)):
        return v.value
    d = ctypes.c_double(0.0)
    if AX.CFNumberGetValue(ref, kCFNumberFloat64Type, ctypes.byref(d)):
        return d.value
    return None

def _axvalue(ref):
    t = AX.AXValueGetType(ref)
    if t == kAXValueCGPointType:
        class CGPoint(ctypes.Structure):
            _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]
        p = CGPoint()
        if AX.AXValueGetValue(ref, t, ctypes.byref(p)):
            return {"x": p.x, "y": p.y}
    elif t == kAXValueCGSizeType:
        class CGSize(ctypes.Structure):
            _fields_ = [("width", ctypes.c_double), ("height", ctypes.c_double)]
        s = CGSize()
        if AX.AXValueGetValue(ref, t, ctypes.byref(s)):
            return {"width": s.width, "height": s.height}
    return None

def _decode(ref):
    """Decode a CFTypeRef into a plain Python value (or None)."""
    if not ref:
        return None
    t = _type_id(ref)
    if t == AX.CFStringGetTypeID():
        return _cfstring(ref)
    if t == AX.CFNumberGetTypeID():
        return _cfnumber(ref)
    if t == AX.CFBooleanGetTypeID():
        return bool(AX.CFBooleanGetValue(ref))
    if t == AX.AXValueGetTypeID():
        return _axvalue(ref)
    if t == AX.AXUIElementGetTypeID():
        return "<AXUIElement>"
    if t == AX.CFArrayGetTypeID():
        n = AX.CFArrayGetCount(ref)
        return [_decode(AX.CFArrayGetValueAtIndex(ref, i)) for i in range(n)]
    return "<CFType %d>" % t

# ---- attribute access ----------------------------------------------------------

def _attr(el, name):
    out = ctypes.c_void_p(0)
    err = AX.AXUIElementCopyAttributeValue(el, name, ctypes.byref(out))
    if err != kAXErrorSuccess:
        return None
    try:
        return _decode(out.value)
    finally:
        if out.value:
            AX.CFRelease(out.value)

def _attr_raw(el, name):
    """Return the raw CFTypeRef (caller must release) or None."""
    out = ctypes.c_void_p(0)
    err = AX.AXUIElementCopyAttributeValue(el, name, ctypes.byref(out))
    if err != kAXErrorSuccess:
        return None
    return out.value

# ---- tree walk ----------------------------------------------------------------

def _node(el, depth, focus_order):
    n = {"depth": depth}
    for key, attr in [
        ("role", kAXRole), ("subrole", kAXSubrole), ("title", kAXTitle),
        ("description", kAXDescription), ("value", kAXValue), ("help", kAXHelp),
        ("enabled", kAXEnabled), ("focused", kAXFocused),
    ]:
        v = _attr(el, attr)
        n[key] = v if v is not None else None
    pos = _attr(el, kAXPosition)
    n["position"] = pos if isinstance(pos, dict) else None
    size = _attr(el, kAXSize)
    n["size"] = size if isinstance(size, dict) else None

    focus_order.append({
        "role": n["role"], "subrole": n["subrole"], "title": n["title"],
        "description": n["description"], "value": n["value"],
        "focused": n["focused"],
    })

    kids = _attr_raw(el, kAXChildren)
    n["children"] = []
    if kids:
        try:
            count = AX.CFArrayGetCount(kids)
            for i in range(count):
                child = AX.CFArrayGetValueAtIndex(kids, i)
                n["children"].append(_node(child, depth + 1, focus_order))
        finally:
            AX.CFRelease(kids)
    return n

# ---- main ----------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("usage: ax-export.py <pid> [out.json]", file=sys.stderr)
        sys.exit(2)
    pid = int(sys.argv[1])
    out_path = sys.argv[2] if len(sys.argv) > 2 else None

    if not AX.AXIsProcessTrusted():
        print("FAIL AX API not trusted — grant Accessibility permission to the "
              "terminal running this script (System Settings > Privacy & "
              "Security > Accessibility)", file=sys.stderr)
        sys.exit(1)

    app = AX.AXUIElementCreateApplication(pid)
    if not app:
        print("FAIL AXUIElementCreateApplication returned null", file=sys.stderr)
        sys.exit(1)

    wins = _attr_raw(app, kAXWindows)
    if not wins:
        print("FAIL no AX windows for pid %d" % pid, file=sys.stderr)
        sys.exit(1)
    try:
        count = AX.CFArrayGetCount(wins)
        if count == 0:
            print("FAIL no AX windows for pid %d" % pid, file=sys.stderr)
            sys.exit(1)
        win = AX.CFArrayGetValueAtIndex(wins, 0)
        focus_order = []
        tree = _node(win, 0, focus_order)
    finally:
        AX.CFRelease(wins)

    out = {
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "process": {"name": "candice-companion", "pid": pid},
        "window": tree,
        "focusOrder": focus_order,
    }
    text = json.dumps(out, indent=2)
    if out_path:
        with open(out_path, "w") as f:
            f.write(text + "\n")
    else:
        print(text)
    sys.exit(0)

if __name__ == "__main__":
    main()
