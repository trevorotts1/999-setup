#!/usr/bin/env python3
"""Measure this box's per-workflow agent cap from RAM, logical cores and container limits. Stdlib only.

per_workflow_cap = clamp(1, 10, min(floor(effective_ram_gb / GB_PER_AGENT), effective_cores)).
A container (cgroup) limit, when present, wins over the host number. The cap is MEASURED, never typed.
CLI: capacity_probe.py            -> JSON {ram_gb, cores, source, per_workflow_cap, max_working_agents, measured_at}
     capacity_probe.py --selftest
"""
import ctypes
import datetime
import json
import math
import os
import platform
import subprocess
import sys

GB_PER_AGENT = 1.5
CAP_MIN, CAP_MAX, AGENTS_PER_CAP, TOTAL_MAX = 1, 10, 50, 500
GIB = 1024 ** 3
UNLIMITED = 1 << 60  # cgroup "no limit" values are far above any real host


def _read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return None


def _sysctl(name):
    return int(subprocess.run(["sysctl", "-n", name], capture_output=True, text=True, timeout=5, check=True).stdout.strip())


def host_darwin():
    return _sysctl("hw.memsize") / GIB, _sysctl("hw.logicalcpu"), "macos-sysctl"


def host_linux():
    ram = None
    for line in (_read("/proc/meminfo") or "").splitlines():
        if line.startswith("MemTotal:"):
            ram = int(line.split()[1]) / (1024 ** 2)
    if ram is None:
        raise OSError("MemTotal not found in /proc/meminfo")
    return ram, os.cpu_count() or 1, "linux-proc"


def host_windows():
    class MS(ctypes.Structure):
        _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong), ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
    try:
        m = MS(); m.dwLength = ctypes.sizeof(MS)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
            raise OSError("GlobalMemoryStatusEx failed")
        return m.ullTotalPhys / GIB, os.cpu_count() or 1, "windows-ctypes"
    except (AttributeError, OSError):
        out = subprocess.run(["wmic", "computersystem", "get", "TotalPhysicalMemory", "/value"], capture_output=True, text=True, timeout=10, check=True).stdout
        return int(out.split("=")[1].strip()) / GIB, os.cpu_count() or 1, "windows-wmic"


def container_limits(read=_read):
    """Return (ram_gb or None, cores or None, label). cgroup v2 first, then v1."""
    ram = cores = None; label = []
    m = read("/sys/fs/cgroup/memory.max")
    if m is not None:  # v2
        if m.isdigit() and int(m) < UNLIMITED: ram = int(m) / GIB
        c = (read("/sys/fs/cgroup/cpu.max") or "").split()
        if len(c) == 2 and c[0].isdigit() and c[1].isdigit() and int(c[1]) > 0: cores = int(c[0]) / int(c[1])
        label.append("cgroup-v2")
    else:  # v1
        m = read("/sys/fs/cgroup/memory/memory.limit_in_bytes")
        if m and m.isdigit() and int(m) < UNLIMITED: ram = int(m) / GIB
        q, p = read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"), read("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
        if q and p and q.lstrip("-").isdigit() and p.isdigit() and int(q) > 0 and int(p) > 0: cores = int(q) / int(p)
        if m is not None or q is not None: label.append("cgroup-v1")
    if ram is not None or cores is not None: return ram, cores, "+".join(label)
    return None, None, ""


def compute(ram_gb, cores, source):
    cap = max(CAP_MIN, min(CAP_MAX, min(math.floor(ram_gb / GB_PER_AGENT), math.floor(cores))))
    return {"ram_gb": round(ram_gb, 2), "cores": round(cores, 2) if cores != int(cores) else int(cores), "source": source,
            "per_workflow_cap": cap, "max_working_agents": min(TOTAL_MAX, cap * AGENTS_PER_CAP),
            "measured_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def probe(system=None, host=None, read=_read):
    system = system or platform.system()
    ram, cores, src = (host or {"Darwin": host_darwin, "Linux": host_linux, "Windows": host_windows}[system])()
    cr, cc, label = container_limits(read) if system == "Linux" else (None, None, "")
    if cr is not None: ram = min(ram, cr)  # container limit wins when it is lower than the host
    if cc is not None: cores = min(cores, cc)
    return compute(ram, cores, src + ("+" + label if label else ""))


def selftest():
    fs = {}
    rd = lambda files: (lambda p: files.get(p))
    cases = [
        ("mac 64GB/12 cores -> 10", lambda: probe("Darwin", lambda: (64, 12, "macos-sysctl"), rd({})), 10, "macos-sysctl"),
        ("linux 8GB/8 cores no cgroup -> 5", lambda: probe("Linux", lambda: (8, 8, "linux-proc"), rd({})), 5, "linux-proc"),
        ("missing cgroup files -> host numbers", lambda: probe("Linux", lambda: (32, 16, "linux-proc"), rd({})), 10, "linux-proc"),
        ("cgroup v2 limit 3GB wins over 64GB host -> 2", lambda: probe("Linux", lambda: (64, 16, "linux-proc"),
            rd({"/sys/fs/cgroup/memory.max": str(3 * GIB), "/sys/fs/cgroup/cpu.max": "max 100000"})), 2, "cgroup-v2"),
        ("cgroup v2 cpu 200000/100000 = 2 cores -> 2", lambda: probe("Linux", lambda: (64, 16, "linux-proc"),
            rd({"/sys/fs/cgroup/memory.max": "max", "/sys/fs/cgroup/cpu.max": "200000 100000"})), 2, "cgroup-v2"),
        ("cgroup v1 4GB + 4 cpus -> 2", lambda: probe("Linux", lambda: (64, 16, "linux-proc"),
            rd({"/sys/fs/cgroup/memory/memory.limit_in_bytes": str(4 * GIB), "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "400000",
                "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000"})), 2, "cgroup-v1"),
        ("cgroup v1 unlimited sentinel ignored -> host", lambda: probe("Linux", lambda: (16, 8, "linux-proc"),
            rd({"/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712", "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "-1",
                "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000"})), 8, "linux-proc"),
        ("windows 16GB/8 -> 8", lambda: probe("Windows", lambda: (16, 8, "windows-ctypes"), rd({})), 8, "windows-ctypes"),
        ("tiny 1GB/1 core clamps up to 1", lambda: probe("Linux", lambda: (1, 1, "linux-proc"), rd({})), 1, "linux-proc"),
        ("huge 512GB/128 clamps to 10 and total 500", lambda: probe("Darwin", lambda: (512, 128, "macos-sysctl"), rd({})), 10, "macos-sysctl"),
    ]
    bad = 0
    for name, fn, want, src in cases:
        r = fn(); ok = r["per_workflow_cap"] == want and src in r["source"] and r["max_working_agents"] == min(500, want * 50)
        bad += not ok; print(("PASS " if ok else "FAIL ") + name, "" if ok else r)
    print("capacity_probe selftest: %s" % ("ALL PASS" if not bad else "%d FAILED" % bad))
    return 1 if bad else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv: sys.exit(selftest())
    print(json.dumps(probe(), indent=2))
