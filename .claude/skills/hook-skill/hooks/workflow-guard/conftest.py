# Tests must never touch tracked or live state: point every state dir the code reads from the environment at a throwaway dir.
import atexit, os, shutil, tempfile
_t = tempfile.mkdtemp(prefix="wg-test-state-")
atexit.register(shutil.rmtree, _t, ignore_errors=True)
os.environ.setdefault("WORKFLOW_GUARD_STATE", os.path.join(_t, "state"))
os.environ.setdefault("QUESTION_GATE_STATE", os.path.join(_t, "qg"))
# The generator measures the box (RAM, cores) for its per-workflow cap; a small CI runner measures 2-4, not the 10 these suites assert. Pin a fixed fake host.
os.environ.setdefault("WORKFLOW_GUARD_TEST_HOST", "32,10")
