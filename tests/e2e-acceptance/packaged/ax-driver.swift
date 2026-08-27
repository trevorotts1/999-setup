// Accessibility driver for the packaged tier.
//
// WHY THIS EXISTS
//
// The packaged legs drove the app through System Events with a hardcoded
// element path:
//
//     text field 1 of group 1 of window 1 whose ... "AXDescription" is "TYPE ANSWER"
//
// That path asserts the control is a DIRECT child of the window's first
// group. It is not, and it never was: the real tree is
//
//     AXWindow > AXGroup > AXGroup > AXScrollArea > AXWebArea > ... > AXTextField
//
// because the UI is web content inside a WKWebView, and a scrollable region
// adds an AXScrollArea of its own. So every packaged leg failed at the same
// step -- "answer controls never appeared in the packaged a11y tree" -- and
// the whole PACKAGED_AUTOMATED tier read FAIL while the controls were sitting
// in the tree, correctly labelled, the entire time. A dump proved it: the
// element is there, with `AXDescription = "TYPE ANSWER"`, exactly as the UI
// code intends.
//
// The obvious AppleScript repair, `entire contents of window 1`, cannot be
// filtered by element class -- System Events returns a flat list and
// `every text field of (entire contents of ...)` is a -1700 type error. That
// leaves iterating the flat list in AppleScript, two attribute reads per
// element, inside a polling loop.
//
// So the search moved here instead. This walks the real AX tree by role and
// description, which is what the driver meant all along, and it does it
// without caring how deeply WebKit nests things -- so a future layout change
// (another scroll container, a wrapper div) cannot silently un-find a control
// again.
//
// This drives the SAME public accessibility surface a screen reader uses. It
// reads no DOM internals and injects no test-only hooks, which is the FIX-014
// boundary the packaged tier is required to respect.
//
// Typing still goes through real key events, exactly as before: this focuses
// the field and `osascript ... keystroke` types into whatever is focused.
// Setting AXValue directly was tried and does NOT work -- it changes the
// field's accessibility value without firing the DOM input events the view
// listens to, so the app never learns the text, the submit validates an empty
// answer, and askUser hangs forever. That failure mode is silent, which is
// exactly the kind that ships.
//
// Usage (exit 0 = found/done, 1 = not found, 2 = error):
//   ax-driver <pid> find     <role> <label>
//   ax-driver <pid> contains <role> <substring>
//   ax-driver <pid> focused
//   ax-driver <pid> value  <role> <label>
//   ax-driver <pid> rect   <role> <label>
//   ax-driver <pid> click  <role> <label>   (a REAL pointer click, not AXPress)
//   ax-driver <pid> focus  <role> <label>
//   ax-driver <pid> press  <role> <label>
//   ax-driver <pid> dump
//
// <role> is an AX role such as AXTextField or AXButton, or `*` for any role.
// <label> matches AXDescription OR AXTitle: a WKWebView surfaces aria-label as
// one or the other depending on the element, and requiring the right one is
// how a working control gets reported missing.

import Foundation
import ApplicationServices

func fail(_ msg: String, _ code: Int32) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(code)
}

let argv = CommandLine.arguments
guard argv.count >= 3, let pid = Int32(argv[1]) else {
    fail("usage: ax-driver <pid> <find|settext|press|dump> [args...]", 2)
}
let command = argv[2]
let app = AXUIElementCreateApplication(pid)

func attr(_ el: AXUIElement, _ name: String) -> String? {
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success else { return nil }
    if let s = v as? String { return s }
    if let n = v as? NSNumber { return n.stringValue }
    return nil
}

func kids(_ el: AXUIElement) -> [AXUIElement] {
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &v) == .success,
          let arr = v as? [AXUIElement] else { return [] }
    return arr
}

/// Depth-first search for the first element matching role (optional) and a
/// description or title. Menus are skipped: the app's menu bar carries 150+
/// system items that can never be an answer control, and walking them turns a
/// millisecond search into a slow one.
func find(_ el: AXUIElement, role: String?, label: String, exact: Bool = true, depth: Int = 0) -> AXUIElement? {
    if depth > 40 { return nil }
    let r = attr(el, kAXRoleAttribute as String) ?? ""
    if r == "AXMenuBar" || r == "AXMenu" { return nil }
    let matchesRole = role == nil || r == role!
    if matchesRole {
        let d = attr(el, kAXDescriptionAttribute as String) ?? ""
        let t = attr(el, kAXTitleAttribute as String) ?? ""
        if exact {
            if d == label || t == label { return el }
        } else if d.contains(label) || t.contains(label) {
            // Substring, for labels that carry decoration the caller should
            // not have to reproduce -- the PTT control is "\u{1F399} HOLD TO
            // TALK", and pinning a test to an emoji is how a label change
            // becomes a mystery failure.
            return el
        }
    }
    for c in kids(el) {
        if let hit = find(c, role: role, label: label, exact: exact, depth: depth + 1) { return hit }
    }
    return nil
}


/// Screen rectangle of an element, in the top-left origin coordinate space
/// that both AXPosition and CGEvent use.
func rectOf(_ el: AXUIElement) -> CGRect? {
    var pv: CFTypeRef?
    var sv: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &pv) == .success,
          AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sv) == .success
    else { return nil }
    var origin = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(pv as! AXValue, .cgPoint, &origin),
          AXValueGetValue(sv as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: origin, size: size)
}

/// A real mouse click at a screen point. This is the only way to test what a
/// user's click does: an AXPress reaches the element directly and therefore
/// proves nothing about whether the pointer could have got there. On a
/// transparent, click-through window the difference between those two is the
/// entire bug.
func clickAt(_ p: CGPoint) {
    let src = CGEventSource(stateID: .hidSystemState)
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(120_000)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(60_000)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
}

func dump(_ el: AXUIElement, _ depth: Int) {
    let r = attr(el, kAXRoleAttribute as String) ?? "?"
    if r == "AXMenuBar" || r == "AXMenu" { return }
    if depth > 40 { return }
    let d = attr(el, kAXDescriptionAttribute as String) ?? ""
    let t = attr(el, kAXTitleAttribute as String) ?? ""
    let v = attr(el, kAXValueAttribute as String) ?? ""
    var line = String(repeating: "  ", count: depth) + r
    if !d.isEmpty { line += "  desc=\"\(d)\"" }
    if !t.isEmpty { line += "  title=\"\(t)\"" }
    if !v.isEmpty { line += "  value=\"\(v.prefix(60))\"" }
    print(line)
    for c in kids(el) { dump(c, depth + 1) }
}

switch command {
case "dump":
    dump(app, 0)
    exit(0)

case "find":
    guard argv.count >= 5 else { fail("find needs <role> <label>", 2) }
    if find(app, role: argv[3] == "*" ? nil : argv[3], label: argv[4]) != nil { print("found"); exit(0) }
    print("absent"); exit(1)

case "value":
    guard argv.count >= 5 else { fail("value needs <role> <label>", 2) }
    guard let el = find(app, role: argv[3] == "*" ? nil : argv[3], label: argv[4]) else { print("absent"); exit(1) }
    print(attr(el, kAXValueAttribute as String) ?? "")
    exit(0)

case "contains":
    guard argv.count >= 5 else { fail("contains needs <role> <substring>", 2) }
    if find(app, role: argv[3] == "*" ? nil : argv[3], label: argv[4], exact: false) != nil { print("found"); exit(0) }
    print("absent"); exit(1)

case "focused":
    // "<description>|<role>" of whatever currently holds focus, so a keyboard
    // traversal test can name where focus actually landed.
    var fv: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &fv) == .success,
          CFGetTypeID(fv!) == AXUIElementGetTypeID()
    else { print(""); exit(1) }
    let focusedEl = fv as! AXUIElement
    let fd = attr(focusedEl, kAXDescriptionAttribute as String)
        ?? attr(focusedEl, kAXTitleAttribute as String) ?? ""
    let fr = attr(focusedEl, kAXRoleAttribute as String) ?? ""
    print("\(fd)|\(fr)")
    exit(0)

case "rect":
    guard argv.count >= 5 else { fail("rect needs <role> <label>", 2) }
    guard let el = find(app, role: argv[3] == "*" ? nil : argv[3], label: argv[4]) else { print("absent"); exit(1) }
    guard let r = rectOf(el) else { fail("no AXPosition/AXSize", 2) }
    print("\(Int(r.origin.x)) \(Int(r.origin.y)) \(Int(r.size.width)) \(Int(r.size.height))")
    exit(0)

case "click":
    guard argv.count >= 5 else { fail("click needs <role> <label>", 2) }
    guard let el = find(app, role: argv[3] == "*" ? nil : argv[3], label: argv[4]) else { print("absent"); exit(1) }
    guard let r = rectOf(el), r.width > 0, r.height > 0 else { fail("element has no clickable rectangle", 2) }
    let mid = CGPoint(x: r.midX, y: r.midY)
    clickAt(mid)
    print("clicked \(Int(mid.x)),\(Int(mid.y))")
    exit(0)

case "focus":
    guard argv.count >= 5 else { fail("focus needs <role> <label>", 2) }
    guard let el = find(app, role: argv[3] == "*" ? nil : argv[3], label: argv[4]) else { print("absent"); exit(1) }
    let ferr = AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    if ferr != .success { fail("AXFocused set failed: \(ferr.rawValue)", 2) }
    print("focused")
    exit(0)

case "press-contains":
    // Same as `press`, but the accessible name need only CONTAIN the
    // substring. Required for controls whose label is parameterised at
    // runtime -- "Answer in Claude instead" / "Answer in Claude-Nine
    // instead" / "Answer in your terminal instead" are one control whose
    // name varies with the harness the app was launched from. Pressing it
    // by an exact string only works on one of the three.
    guard argv.count >= 5 else { fail("press-contains needs <role> <substring>", 2) }
    guard let el = find(app, role: argv[3] == "*" ? nil : argv[3], label: argv[4], exact: false)
    else { print("absent"); exit(1) }
    let pcerr = AXUIElementPerformAction(el, kAXPressAction as CFString)
    if pcerr != .success { fail("AXPress failed: \(pcerr.rawValue)", 2) }
    print("pressed")
    exit(0)

case "press":
    guard argv.count >= 5 else { fail("press needs <role> <label>", 2) }
    // The role matters here. The answer surface carries BOTH a text field and
    // a button labelled "TYPE ANSWER"; a role-blind depth-first search finds
    // the field, presses it, and reports success while submitting nothing.
    guard let el = find(app, role: argv[3] == "*" ? nil : argv[3], label: argv[4]) else { print("absent"); exit(1) }
    let perr = AXUIElementPerformAction(el, kAXPressAction as CFString)
    if perr != .success { fail("AXPress failed: \(perr.rawValue)", 2) }
    print("pressed")
    exit(0)

default:
    fail("unknown command \(command)", 2)
}
