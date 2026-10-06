"""validate.mjs hardening: window-helper integrity, args confinement, dynamic-code escapes (plan mode)."""
import importlib.util, json, os, subprocess, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent
NODE = os.environ.get('NODE', 'node')
_s = importlib.util.spec_from_file_location('staffing_vh', ROOT / 'staffing.py'); st = importlib.util.module_from_spec(_s); _s.loader.exec_module(st)


def generate(tmp, wid, n, cap):
    proj = Path(tmp) / f'p{wid}'; proj.mkdir()
    st._mkplan(proj, {wid: n}, cap=cap) if cap != 10 else st._mkplan(proj, {wid: n})
    r = subprocess.run(['python3', str(ROOT / 'make-workflow.py'), '--plan', str(proj / 'SWARM-PLAN.json'), '--workflow-id', wid, '--out-dir', str(proj / 'out')], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    launch = json.loads((proj / 'out' / f'launch-{wid}.json').read_text())
    return Path(launch['scriptPath']).read_text(), launch['args']


def validate(script, args, cap):
    env = {**os.environ, 'WORKFLOW_GUARD_CAP': str(cap)}
    r = subprocess.run([NODE, str(ROOT / 'validate.mjs')], input=json.dumps({'script': script, 'args': args, 'windowHelper': st.WINDOW_HELPER}), text=True, capture_output=True, env=env)
    return json.loads(r.stdout)


class Hardening(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.s12, cls.a12 = generate(cls.tmp.name, 'W0-01', 12, 10)
        cls.s8, cls.a8 = generate(cls.tmp.name, 'W6-01', 8, 6)
        cls.s3, cls.a3 = generate(cls.tmp.name, 'W0-02', 3, 10)

    @classmethod
    def tearDownClass(cls): cls.tmp.cleanup()

    def bad(self, script, needle, args=None, cap=10):
        v = validate(script, args or self.a12, cap)
        self.assertFalse(v['ok'], v)
        self.assertTrue(any(needle in e for e in v['errors']), v['errors'])

    def test_generated_outputs_accepted(self):
        for s, a, cap in ((self.s12, self.a12, 10), (self.s8, self.a8, 6), (self.s3, self.a3, 10)):
            v = validate(s, a, cap); self.assertTrue(v['ok'], v); self.assertLessEqual(v['conservativePeak'], cap)

    def test_N9a_local_wgSlot_shadow(self):
        sh = self.s12.replace("(u) => wgSlot(() => agent('Unit '", "(u) => { const wgSlot = (f) => f(); return wgSlot(() => agent('Unit '", 1)
        sh = sh.replace("schema:RESULT})),\n async (built,u)", "schema:RESULT})); },\n async (built,u)", 1)
        self.assertNotEqual(sh, self.s12)
        self.bad(sh, "'wgSlot' is reserved")

    def test_N9b_object_assign_on_wg(self):
        self.bad(self.s12.replace("\nconst RESULT", "\nObject.assign(wg, {active: -100});\nconst RESULT", 1), "'wg' is reserved")

    def test_wg_property_write_and_param(self):
        self.bad(self.s12.replace("\nconst RESULT", "\nwg.active = -5;\nconst RESULT", 1), "'wg' is reserved")
        self.bad(self.s12.replace("(built,u) =>", "(built,wgSlot) =>", 1), "'wgSlot' is reserved")

    def test_helper_not_top_level_or_in_comment(self):
        h = st.window_helper(10)
        self.bad(self.s12.replace(h, "{\n" + h + "}\n", 1), "top-level")
        self.bad(self.s12.replace(h, "/*\n" + h + "*/\n", 1), "top-level")

    def test_modified_helper_rejected(self):
        self.bad(self.s12.replace("wg.active >= WG_WINDOW", "wg.active >= WG_WINDOW * 5", 1), "reserved")

    def test_defineProperty_reflect_setproto(self):
        for snippet in ("Object.defineProperty(args.units, 'length', {value: 99});", "Reflect.set(args, 'x', 1);", "Object.setPrototypeOf(RESULT, null);", "RESULT.__proto__ = null;", "this.x = 1;"):
            v = validate(self.s12.replace("\nconst RESULT", "\n" + snippet + "\nconst RESULT", 1), self.a12, 10)
            self.assertFalse(v['ok'], snippet)

    def test_N11b_new_Function(self):
        s = self.s3.replace("const missing=", "const extra = await (new Function(\"return agent('x', {model:'opus', phase:'Build', label:'x'})\"))();\nconst missing=", 1)
        self.bad(s, 'Function', self.a3)

    def test_eval_globalThis_require_import(self):
        for snip in ("eval('1');", "globalThis.x = 1;", "require('fs');", "await import('fs');"):
            self.bad(self.s3.replace("const missing=", snip + "\nconst missing=", 1), 'not allowed', self.a3)

    def test_N13c_object_assign_args_units(self):
        self.bad(self.s3.replace("const results = await pipeline", "Object.assign(args.units, {7: {unit_id: 'X'}});\nconst results = await pipeline", 1), 'args', self.a3)

    def test_N13d_push_call_args_units(self):
        self.bad(self.s3.replace("const results = await pipeline", "Array.prototype.push.call(args.units, 1, 2);\nconst results = await pipeline", 1), 'args', self.a3)

    def test_args_aliasing_destructuring_and_computed(self):
        for snip in ("const a = args;", "const {units} = args;", "const q = args['units'];", "foo(args.units);", "const u2 = args.units;"):
            v = validate(self.s3.replace("const results = await pipeline", snip + "\nconst results = await pipeline", 1), self.a3, 10)
            self.assertFalse(v['ok'], snip)

    def test_generated_plan_script_has_no_derived_unit_list(self):
        for s in (self.s12, self.s8, self.s3):
            self.assertNotIn('args.units.', s.replace('args.units.length', ''))

    def test_args_units_filter_rejected_in_stage_and_elsewhere(self):
        # the under-staffing attack: the stage runs FEWER units than the launch declares
        s = self.s3.replace('pipeline(args.units,', "pipeline(args.units.filter(u=>u.unit_id!=='W0-02-U1'),", 1)
        self.assertNotEqual(s, self.s3)
        self.bad(s, 'args.units.filter (a derived unit list', self.a3)
        s2 = self.s3.replace("const missing=", "const some = args.units.filter(u => true);\nconst missing=", 1)
        self.bad(s2, 'args.units.filter (a derived unit list', self.a3)

    def test_legacy_non_plan_script_unchanged(self):
        s = "export const meta={name:'pres-W2-build+qc-SKR012..SKR012-1L',description:'d',phases:[{title:'Build'}]};\nawait agent('x SCRATCH ISOLATION lanes/<UNIT-ID>-<box-slug>/',{model:'opus',phase:'Build',label:'l'});\n"
        env = {k: v for k, v in os.environ.items() if k != 'WORKFLOW_GUARD_CAP'}
        r = subprocess.run([NODE, str(ROOT / 'validate.mjs')], input=json.dumps({'script': s, 'args': None, 'windowHelper': st.WINDOW_HELPER}), text=True, capture_output=True, env=env)
        self.assertTrue(json.loads(r.stdout)['ok'], r.stdout)


if __name__ == '__main__':
    unittest.main()
