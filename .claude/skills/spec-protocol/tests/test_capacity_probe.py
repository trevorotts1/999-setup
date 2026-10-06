#!/usr/bin/env python3
"""capacity_probe.py: per_workflow_cap = clamp(1, 10, min(floor(effective_ram_gb / GB_PER_AGENT), effective_cores)).
Covers macOS, Linux host, Linux cgroup v2 container, cgroup v1 container, missing cgroup files (host fallback),
Windows (mocked) and the operator's Mac mini (24 GB, 12 cores -> 10), plus a live run on THIS machine."""
import importlib.util, os, subprocess, sys, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
PROBE = os.environ.get("CAPACITY_PROBE_PATH") or os.path.join(HERE, "..", "tools", "hooks", "capacity_probe.py")
spec = importlib.util.spec_from_file_location("capacity_probe_under_test", PROBE)
cp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cp)
GIB = 1024 ** 3


def files(d):
    return lambda p: d.get(p)


class Probe(unittest.TestCase):
    def test_constant_is_the_single_knob(self):
        self.assertEqual(cp.GB_PER_AGENT, 1.5)

    def test_operator_mac_mini_is_10(self):
        # hw.memsize = 24 GiB, hw.logicalcpu = 12: floor(24 / 1.5) = 16, min(16, 12) = 12, clamped to 10
        with mock.patch.object(cp, "_sysctl", side_effect=lambda n: {"hw.memsize": 24 * GIB, "hw.logicalcpu": 12}[n]):
            r = cp.probe("Darwin", None, files({}))
        self.assertEqual((r["ram_gb"], r["cores"], r["per_workflow_cap"], r["max_working_agents"]), (24.0, 12, 10, 500))
        self.assertEqual(r["source"], "macos-sysctl")

    def test_macos_small_mac(self):
        with mock.patch.object(cp, "_sysctl", side_effect=lambda n: {"hw.memsize": 8 * GIB, "hw.logicalcpu": 8}[n]):
            r = cp.probe("Darwin", None, files({}))
        self.assertEqual(r["per_workflow_cap"], 5)  # RAM-bound: floor(8 / 1.5) = 5
        self.assertEqual(r["max_working_agents"], 250)

    def test_linux_host_reads_proc_meminfo(self):
        meminfo = "MemTotal:       16777216 kB\nMemFree:  1 kB\n"
        with mock.patch.object(cp, "_read", side_effect=lambda p: meminfo if p == "/proc/meminfo" else None), \
             mock.patch.object(cp.os, "cpu_count", return_value=4):
            r = cp.probe("Linux", None, files({}))
        self.assertEqual((r["ram_gb"], r["cores"], r["per_workflow_cap"], r["source"]), (16.0, 4, 4, "linux-proc"))

    def test_linux_cgroup_v2_container_beats_host(self):
        d = {"/sys/fs/cgroup/memory.max": str(3 * GIB), "/sys/fs/cgroup/cpu.max": "200000 100000"}
        r = cp.probe("Linux", lambda: (64, 16, "linux-proc"), files(d))
        self.assertEqual((r["ram_gb"], r["cores"], r["per_workflow_cap"]), (3.0, 2, 2))
        self.assertIn("cgroup-v2", r["source"])

    def test_linux_cgroup_v2_unlimited_values_use_host(self):
        d = {"/sys/fs/cgroup/memory.max": "max", "/sys/fs/cgroup/cpu.max": "max 100000"}
        r = cp.probe("Linux", lambda: (24, 12, "linux-proc"), files(d))
        self.assertEqual(r["per_workflow_cap"], 10)

    def test_linux_cgroup_v1_container_beats_host(self):
        d = {"/sys/fs/cgroup/memory/memory.limit_in_bytes": str(6 * GIB), "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "300000",
             "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000"}
        r = cp.probe("Linux", lambda: (64, 16, "linux-proc"), files(d))
        self.assertEqual((r["ram_gb"], r["cores"], r["per_workflow_cap"]), (6.0, 3, 3))
        self.assertIn("cgroup-v1", r["source"])

    def test_linux_cgroup_v1_unlimited_sentinel_uses_host(self):
        d = {"/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712", "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "-1",
             "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000"}
        r = cp.probe("Linux", lambda: (16, 8, "linux-proc"), files(d))
        self.assertEqual((r["per_workflow_cap"], r["source"]), (8, "linux-proc"))

    def test_missing_cgroup_files_fall_back_to_host(self):
        r = cp.probe("Linux", lambda: (32, 16, "linux-proc"), files({}))
        self.assertEqual((r["per_workflow_cap"], r["source"]), (10, "linux-proc"))

    def test_windows_mocked_ctypes_and_wmic_paths(self):
        r = cp.probe("Windows", lambda: (16, 8, "windows-ctypes"), files({}))
        self.assertEqual((r["per_workflow_cap"], r["source"]), (8, "windows-ctypes"))
        # no ctypes.windll on this machine -> the wmic fallback path, with the process call mocked
        fake = mock.Mock(stdout="TotalPhysicalMemory=%d\r\n" % (12 * GIB))
        with mock.patch.object(cp.subprocess, "run", return_value=fake), mock.patch.object(cp.os, "cpu_count", return_value=6):
            ram, cores, src = cp.host_windows()
        self.assertEqual((ram, cores), (12.0, 6))
        self.assertEqual(cp.compute(ram, cores, src)["per_workflow_cap"], 6)

    def test_clamps(self):
        self.assertEqual(cp.compute(1, 1, "x")["per_workflow_cap"], 1)
        self.assertEqual(cp.compute(0.5, 8, "x")["per_workflow_cap"], 1)   # never 0
        big = cp.compute(512, 128, "x")
        self.assertEqual((big["per_workflow_cap"], big["max_working_agents"]), (10, 500))

    def test_live_machine_answers_in_range_and_matches_the_cli(self):
        live = cp.probe()
        self.assertTrue(1 <= live["per_workflow_cap"] <= 10, live)
        self.assertEqual(live["max_working_agents"], min(500, live["per_workflow_cap"] * 50))
        out = subprocess.run([sys.executable, PROBE], capture_output=True, text=True, check=True).stdout
        import json
        self.assertEqual(json.loads(out)["per_workflow_cap"], live["per_workflow_cap"])

    def test_probe_selftest_passes(self):
        r = subprocess.run([sys.executable, PROBE, "--selftest"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
